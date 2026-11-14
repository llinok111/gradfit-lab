// gradfit-lab core — differentiable mesh fitting to implicit target surfaces.
// Pure ES module: no three.js, no DOM, no I/O, no globals. Runs in node and browser.
//
// Convention: a mesh is { vertices: [[x,y,z],...], faces: [[i0,i1,i2],...] }.
// A field is { kind, params, f(p)->number, grad(p)->[dx,dy,dz] } with an ANALYTIC gradient.
// Energy over sampled surface points: E = mean_j f(p_j)^2.

const TAU = Math.PI * 2;

/* ---------------------------------------------------------------- vectors */

export function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

export function norm3(a) { return Math.sqrt(dot3(a, a)); }

export function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }

export function unit3(a) {
  const n = norm3(a);
  if (!(n > 0)) return [0, 0, 0];
  return [a[0] / n, a[1] / n, a[2] / n];
}

/* ------------------------------------------------------------------ meshes */

export function normalizeVertices(verts) { return verts.map(unit3); }

// Icosphere by midpoint subdivision (subdiv 0 = 20 faces / 12 vertices).
export function icosphere(subdiv) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = normalizeVertices([
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ]);
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? a + ':' + b : b + ':' + a;
      let idx = cache.get(key);
      if (idx !== undefined) return idx;
      const m = unit3([
        (verts[a][0] + verts[b][0]) / 2,
        (verts[a][1] + verts[b][1]) / 2,
        (verts[a][2] + verts[b][2]) / 2,
      ]);
      verts.push(m); idx = verts.length - 1; cache.set(key, idx); return idx;
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return { vertices: verts, faces };
}

// Closed torus: major radius R, tube radius r, nu x nv quads.
export function torusMesh(nu, nv, R, r) {
  const vertices = [];
  for (let i = 0; i < nu; i++) {
    const u = (TAU * i) / nu, cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j < nv; j++) {
      const v = (TAU * j) / nv, cv = Math.cos(v), sv = Math.sin(v);
      vertices.push([(R + r * cv) * cu, (R + r * cv) * su, r * sv]);
    }
  }
  const faces = [];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * nv + j, b = ((i + 1) % nu) * nv + j;
      const c = ((i + 1) % nu) * nv + ((j + 1) % nv), d = i * nv + ((j + 1) % nv);
      faces.push([a, b, c], [a, c, d]);
    }
  }
  return { vertices, faces };
}

// Open tube along z in [-h/2, h/2], radius 1 (a cylinder wall).
export function tubeMesh(nu, nv, h) {
  const vertices = [];
  for (let i = 0; i < nu; i++) {
    const u = (TAU * i) / nu, cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j < nv; j++) {
      vertices.push([cu, su, -h / 2 + (h * j) / (nv - 1)]);
    }
  }
  const faces = [];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j + 1 < nv; j++) {
      const a = i * nv + j, b = ((i + 1) % nu) * nv + j;
      const c = ((i + 1) % nu) * nv + j + 1, d = i * nv + j + 1;
      faces.push([a, b, c], [a, c, d]);
    }
  }
  return { vertices, faces };
}

export function cloneMesh(mesh) {
  return { vertices: mesh.vertices.map((v) => [v[0], v[1], v[2]]), faces: mesh.faces.map((f) => [f[0], f[1], f[2]]) };
}

export function bboxDiag(mesh) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of mesh.vertices) {
    for (let k = 0; k < 3; k++) { if (v[k] < lo[k]) lo[k] = v[k]; if (v[k] > hi[k]) hi[k] = v[k]; }
  }
  return norm3(sub3(hi, lo));
}

export function scaleMesh(mesh, s) {
  return { vertices: mesh.vertices.map((v) => [v[0] * s, v[1] * s, v[2] * s]), faces: mesh.faces.map((f) => [f[0], f[1], f[2]]) };
}

/* --------------------------------------------------------------- implicit fields */
// Every field exposes an analytic gradient; no shared magic constant is used by the
// finite-difference oracle (that oracle only reads f, never grad).

export function ellipsoidField(a, b, c) {
  return {
    kind: 'ellipsoid', params: { a, b, c },
    f: (p) => (p[0] / a) ** 2 + (p[1] / b) ** 2 + (p[2] / c) ** 2 - 1,
    grad: (p) => [2 * p[0] / (a * a), 2 * p[1] / (b * b), 2 * p[2] / (c * c)],
  };
}

export function superquadricField(a, b, c, n) {
  const pw = (v, e) => Math.abs(v) ** e;
  return {
    kind: 'superquadric', params: { a, b, c, n },
    f: (p) => pw(p[0] / a, n) + pw(p[1] / b, n) + pw(p[2] / c, n) - 1,
    grad: (p) => [
      n * pw(p[0], n - 1) * Math.sign(p[0]) / a ** n,
      n * pw(p[1], n - 1) * Math.sign(p[1]) / b ** n,
      n * pw(p[2], n - 1) * Math.sign(p[2]) / c ** n,
    ],
  };
}

// Prolate spheroid / capsule: zero set is the ellipsoid with foci p0,p1.
export function capsuleField(p0, p1, r) {
  const L = norm3(sub3(p1, p0));
  return {
    kind: 'capsule', params: { p0, p1, r, L },
    f: (p) => norm3(sub3(p, p0)) + norm3(sub3(p, p1)) - L - 2 * r,
    grad: (p) => {
      const u = unit3(sub3(p, p0)), w = unit3(sub3(p, p1));
      return [u[0] + w[0], u[1] + w[1], u[2] + w[2]];
    },
  };
}

export function torusField(R, r) {
  return {
    kind: 'torus', params: { R, r },
    f: (p) => {
      const q = Math.hypot(p[0], p[1]);
      return (q - R) ** 2 + p[2] ** 2 - r * r;
    },
    grad: (p) => {
      const q = Math.hypot(p[0], p[1]);
      if (!(q > 0)) return [0, 0, 2 * p[2]];
      return [2 * (q - R) * p[0] / q, 2 * (q - R) * p[1] / q, 2 * p[2]];
    },
  };
}

// Double-lobe torus: tube centre-line radius R(phi) = R0 + A*cos(2*phi).
export function lobeTorusField(R0, A, r) {
  return {
    kind: 'lobe-torus', params: { R0, A, r },
    f: (p) => {
      const q = Math.hypot(p[0], p[1]);
      const phi = Math.atan2(p[1], p[0]);
      const g = q - (R0 + A * Math.cos(2 * phi));
      return g * g + p[2] * p[2] - r * r;
    },
    grad: (p) => {
      const q = Math.hypot(p[0], p[1]);
      if (!(q > 0)) return [0, 0, 2 * p[2]];
      const phi = Math.atan2(p[1], p[0]);
      const g = q - (R0 + A * Math.cos(2 * phi));
      const dR = -2 * A * Math.sin(2 * phi);
      // dphi/dx = -y/q^2 ; dphi/dy = x/q^2
      const gx = g * (p[0] / q + (dR * p[1]) / (q * q));
      const gy = g * (p[1] / q - (dR * p[0]) / (q * q));
      return [2 * gx, 2 * gy, 2 * p[2]];
    },
  };
}

export function coneField(r0, k) {
  return {
    kind: 'cone', params: { r0, k },
    f: (p) => Math.hypot(p[0], p[1]) - (r0 + k * p[2]),
    grad: (p) => {
      const q = Math.hypot(p[0], p[1]);
      if (!(q > 0)) return [0, 0, -k];
      return [p[0] / q, p[1] / q, -k];
    },
  };
}

// Scale a field so its zero set scales by s: f_s(p) = f(p/s), grad_s(p) = grad_f(p/s)/s.
export function scaleField(field, s) {
  return {
    kind: field.kind, params: field.params,
    f: (p) => field.f([p[0] / s, p[1] / s, p[2] / s]),
    grad: (p) => {
      const g = field.grad([p[0] / s, p[1] / s, p[2] / s]);
      return [g[0] / s, g[1] / s, g[2] / s];
    },
  };
}

/* ------------------------------------------------------------------ sampling */

// Deterministic barycentric lattice of order n (n>=1): (n+1)(n+2)/2 points per face.
export function baryLattice(n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; i + j <= n; j++) {
      const k = n - i - j;
      out.push([i / n, j / n, k / n]);
    }
  }
  return out;
}

export function makeSamples(mesh, order) {
  // order must be >= 1: baryLattice(0) would divide by zero and yield NaN weights,
  // which silently poisons every downstream number.
  const lat = baryLattice(Math.max(1, order | 0));
  const samples = [];
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    for (const w of lat) samples.push({ face: mesh.faces[fi], w });
  }
  return samples;
}

export function samplePoint(mesh, s) {
  const [a, b, c] = s.face, w = s.w, V = mesh.vertices;
  return [
    w[0] * V[a][0] + w[1] * V[b][0] + w[2] * V[c][0],
    w[0] * V[a][1] + w[1] * V[b][1] + w[2] * V[c][1],
    w[0] * V[a][2] + w[1] * V[b][2] + w[2] * V[c][2],
  ];
}

/* ------------------------------------------------------------- energy/gradient */

export function energy(mesh, field, samples) {
  let sum = 0;
  for (let j = 0; j < samples.length; j++) {
    const f = field.f(samplePoint(mesh, samples[j]));
    sum += f * f;
  }
  return sum / samples.length;
}

export function meanAbsF(mesh, field, samples) {
  let sum = 0;
  for (let j = 0; j < samples.length; j++) sum += Math.abs(field.f(samplePoint(mesh, samples[j])));
  return sum / samples.length;
}

// dE/dv_i = (2/N) * sum_j f(p_j) * grad f(p_j) * w_j(i)
export function analyticGradient(mesh, field, samples) {
  const n = mesh.vertices.length;
  const g = new Float64Array(3 * n);
  const c = 2 / samples.length;
  for (let j = 0; j < samples.length; j++) {
    const s = samples[j];
    const p = samplePoint(mesh, s);
    const fv = field.f(p);
    const gv = field.grad(p);
    const k = c * fv;
    for (let t = 0; t < 3; t++) {
      const idx = s.face[t], w = s.w[t];
      g[3 * idx] += k * gv[0] * w;
      g[3 * idx + 1] += k * gv[1] * w;
      g[3 * idx + 2] += k * gv[2] * w;
    }
  }
  return g;
}

// Independent oracle path: central finite differences of the ENERGY only.
// It never reads field.grad, so a wrong analytic gradient cannot hide here.
export function fdGradient(mesh, field, samples, h) {
  const out = new Float64Array(3 * mesh.vertices.length);
  const V = mesh.vertices;
  for (let i = 0; i < V.length; i++) {
    for (let k = 0; k < 3; k++) {
      const keep = V[i][k];
      V[i][k] = keep + h; const ep = energy(mesh, field, samples);
      V[i][k] = keep - h; const em = energy(mesh, field, samples);
      V[i][k] = keep;
      out[3 * i + k] = (ep - em) / (2 * h);
    }
  }
  return out;
}

// Independent oracle for the FIELD gradient: central differences of the scalar f.
export function fdFieldGrad(field, p, h) {
  const out = [];
  for (let k = 0; k < 3; k++) {
    const pp = [p[0], p[1], p[2]], pm = [p[0], p[1], p[2]];
    pp[k] += h; pm[k] -= h;
    out.push((field.f(pp) - field.f(pm)) / (2 * h));
  }
  return out;
}

export function compareVectors(a, b) {
  let d2 = 0, na = 0, nb = 0, mx = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) {
      // a non-finite component can never pass a certificate: fail loudly.
      return { dim: a.length, cosine: -1, relErr: Infinity, maxAbsDiff: Infinity, normA: NaN, normB: NaN };
    }
    const d = a[i] - b[i];
    d2 += d * d; na += a[i] * a[i]; nb += b[i] * b[i];
    if (Math.abs(d) > mx) mx = Math.abs(d);
  }
  const na_ = Math.sqrt(na), nb_ = Math.sqrt(nb);
  let dsum = 0;
  for (let i = 0; i < a.length; i++) dsum += a[i] * b[i];
  const den = na_ * nb_;
  return {
    dim: a.length,
    // a zero vector is not "perfectly aligned": report 0, never 1 (a 1 here would
    // let an all-zero gradient pass the cosine criterion).
    cosine: den > 0 ? dsum / den : 0,
    relErr: nb_ > 0 ? Math.sqrt(d2) / nb_ : (Math.sqrt(d2) > 0 ? Infinity : 0),
    maxAbsDiff: mx,
    normA: na_, normB: nb_,
  };
}

export function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den > 0 ? d / den : 0;
}

/* --------------------------------------------------------------- optimization */

// Steepest descent on the unit-gradient direction with backtracking Armijo line
// search; displacement is measured in length units so behaviour is scale free.
export function fit(mesh, field, samples, opts = {}) {
  const iters = opts.iters ?? 60;
  const c1 = opts.c1 ?? 1e-4;
  const shrink = opts.shrink ?? 0.5;
  const diag = bboxDiag(mesh);
  let step = opts.step0 ?? 0.1 * diag;
  const m = cloneMesh(mesh);
  let E = energy(m, field, samples);
  const history = [{ iter: 0, energy: E }];
  const snaps = opts.keepMeshes ? [cloneMesh(m)] : null;
  for (let it = 1; it <= iters; it++) {
    const g = analyticGradient(m, field, samples);
    const gn = normGrad(g);
    if (!(gn > 0)) { history.push({ iter: it, energy: E, gradNorm: 0 }); break; }
    const d = new Float64Array(g.length);
    for (let i = 0; i < g.length; i++) d[i] = -g[i] / gn;
    let t = step, accepted = false;
    for (let b = 0; b < 40; b++) {
      const trial = { vertices: m.vertices.map((v, i) => [v[0] + t * d[3 * i], v[1] + t * d[3 * i + 1], v[2] + t * d[3 * i + 2]]), faces: m.faces };
      const Et = energy(trial, field, samples);
      if (Et <= E - c1 * t * gn) {
        m.vertices = trial.vertices; E = Et; step = t; accepted = true; break;
      }
      t *= shrink;
    }
    if (!accepted) { history.push({ iter: it, energy: E, stalled: true }); break; }
    history.push({ iter: it, energy: E, gradNorm: gn, step: t });
    if (snaps) snaps.push(cloneMesh(m));
  }
  return { mesh: m, history, snapshots: snaps, energyStart: history[0].energy, energyEnd: E };
}

export function normGrad(g) {
  let s = 0;
  for (let i = 0; i < g.length; i++) s += g[i] * g[i];
  return Math.sqrt(s);
}

// Naive baseline: fixed step, no line search, gradient supplied by the caller.
export function fixedStepDescent(mesh, field, samples, opts = {}) {
  const iters = opts.iters ?? 60;
  const diag = bboxDiag(mesh);
  const step = opts.step ?? 0.05 * diag;
  const useFD = !!opts.useFD;
  const h = opts.h ?? 1e-6 * diag;
  const m = cloneMesh(mesh);
  let E = energy(m, field, samples);
  const history = [{ iter: 0, energy: E }];
  const snaps = opts.keepMeshes ? [cloneMesh(m)] : null;
  for (let it = 1; it <= iters; it++) {
    const g = useFD ? fdGradient(m, field, samples, h) : analyticGradient(m, field, samples);
    const gn = normGrad(g);
    if (!(gn > 0)) break;
    for (let i = 0; i < m.vertices.length; i++) {
      m.vertices[i][0] -= step * g[3 * i] / gn;
      m.vertices[i][1] -= step * g[3 * i + 1] / gn;
      m.vertices[i][2] -= step * g[3 * i + 2] / gn;
    }
    E = energy(m, field, samples);
    history.push({ iter: it, energy: E });
  }
  return { mesh: m, history, energyStart: history[0].energy, energyEnd: E };
}

/* ------------------------------------------------------------------- scenes */

export function buildScene(spec) {
  let mesh, field, order;
  if (spec.source === 'icosphere') { mesh = icosphere(spec.subdiv); order = spec.order; }
  else if (spec.source === 'torus') { mesh = torusMesh(spec.nu, spec.nv, spec.R, spec.r); order = spec.order; }
  else if (spec.source === 'tube') { mesh = tubeMesh(spec.nu, spec.nv, spec.h); order = spec.order; }
  else throw new Error('unknown source ' + spec.source);
  const t = spec.target;
  if (t.kind === 'ellipsoid') field = ellipsoidField(t.a, t.b, t.c);
  else if (t.kind === 'superquadric') field = superquadricField(t.a, t.b, t.c, t.n);
  else if (t.kind === 'capsule') field = capsuleField(t.p0, t.p1, t.r);
  else if (t.kind === 'torus') field = torusField(t.R, t.r);
  else if (t.kind === 'lobe-torus') field = lobeTorusField(t.R0, t.A, t.r);
  else if (t.kind === 'cone') field = coneField(t.r0, t.k);
  else throw new Error('unknown target ' + t.kind);
  return { name: spec.name, mesh, field, order };
}

export function relDrop(e0, e1) { return e0 > 0 ? 1 - e1 / e0 : 0; }

export const SCENES = [
  { name: 'sphere-to-ellipsoid', source: 'icosphere', subdiv: 2, order: 2, target: { kind: 'ellipsoid', a: 1.55, b: 0.85, c: 0.6 } },
  { name: 'sphere-to-superquadric', source: 'icosphere', subdiv: 2, order: 2, target: { kind: 'superquadric', a: 1.4, b: 0.9, c: 0.7, n: 6 } },
  { name: 'sphere-to-capsule', source: 'icosphere', subdiv: 2, order: 2, target: { kind: 'capsule', p0: [0, 0, -0.9], p1: [0, 0, 0.9], r: 0.55 } },
  { name: 'torus-to-torus', source: 'torus', nu: 20, nv: 12, R: 1.0, r: 0.32, order: 2, target: { kind: 'torus', R: 0.72, r: 0.5 } },
  { name: 'torus-to-lobe-torus', source: 'torus', nu: 20, nv: 12, R: 1.0, r: 0.32, order: 2, target: { kind: 'lobe-torus', R0: 0.95, A: 0.35, r: 0.3 } },
  { name: 'tube-to-cone', source: 'tube', nu: 24, nv: 12, h: 1.6, order: 2, target: { kind: 'cone', r0: 0.9, k: -0.45 } },
];

export const SCALES = [1e-6, 1e-3, 1, 1e3, 1e6];
