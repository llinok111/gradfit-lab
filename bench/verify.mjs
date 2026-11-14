// bench/verify.mjs — real assertions with printed measured values.
//   node bench/verify.mjs   -> exit 0 only when every assertion holds.
//
// The finite-difference gradient is an INDEPENDENT oracle: it only reads field.f,
// never field.grad, and its step is relative to the mesh bbox diagonal.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCENES, SCALES, buildScene, makeSamples, analyticGradient, fdGradient,
  fdFieldGrad, compareVectors, cosine, fit, fixedStepDescent, meanAbsF, energy,
  bboxDiag, relDrop, norm3, sub3,
} from '../src/core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const H_REL = 1e-6;
let pass = 0, fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS  ${name}  ${detail}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}  ${detail}`); }
}

const scenes = SCENES.map(buildScene);

console.log('== 1. analytic gradient vs central finite differences (independent oracle) ==');
let certComponents = 0;
for (const sc of scenes) {
  const samples = makeSamples(sc.mesh, sc.order);
  const h = H_REL * bboxDiag(sc.mesh);
  const gA = analyticGradient(sc.mesh, sc.field, samples);
  const gF = fdGradient(sc.mesh, sc.field, samples, h);
  const c = compareVectors(gA, gF);
  certComponents += c.dim;
  check(`grad ${sc.name}`, c.cosine >= 0.999999 && c.relErr <= 1e-5,
    `dim=${c.dim} cosine=${c.cosine.toFixed(12)} relErr=${c.relErr.toExponential(3)} maxAbsDiff=${c.maxAbsDiff.toExponential(3)}`);
}

console.log('== 2. analytic FIELD gradient vs finite differences of f (second oracle) ==');
for (const sc of scenes) {
  const samples = makeSamples(sc.mesh, sc.order);
  const h = H_REL * bboxDiag(sc.mesh);
  let worst = 0, worstCos = 1;
  const stride = Math.max(1, Math.floor(samples.length / 40));
  for (let j = 0; j < samples.length; j += stride) {
    const s = samples[j];
    const a = s.face, w = s.w, V = sc.mesh.vertices;
    const p = [
      w[0] * V[a[0]][0] + w[1] * V[a[1]][0] + w[2] * V[a[2]][0],
      w[0] * V[a[0]][1] + w[1] * V[a[1]][1] + w[2] * V[a[2]][1],
      w[0] * V[a[0]][2] + w[1] * V[a[1]][2] + w[2] * V[a[2]][2],
    ];
    const ga = sc.field.grad(p), gf = fdFieldGrad(sc.field, p, h);
    const cn = cosine(ga, gf);
    if (cn < worstCos) worstCos = cn;
    const rel = norm3(sub3(ga, gf)) / Math.max(norm3(gf), 1e-300);
    if (rel > worst) worst = rel;
  }
  check(`field-grad ${sc.name}`, worstCos >= 0.99999 && worst <= 1e-4,
    `worstCosine=${worstCos.toFixed(12)} worstRelErr=${worst.toExponential(3)}`);
}

console.log('== 3. scale invariance: every scene at ' + SCALES.join(' / ') + ' ==');
let scaleComponents = 0, worstScaleCos = 1, worstScaleRel = 0, worstDropDrift = 0;
const dropRef = new Map();
for (const sc of scenes) {
  for (const s of SCALES) {
    const mesh = { vertices: sc.mesh.vertices.map((v) => v.map((c) => c * s)), faces: sc.mesh.faces };
    const field = {
      kind: sc.field.kind, params: sc.field.params,
      f: (p) => sc.field.f(p.map((c) => c / s)),
      grad: (p) => sc.field.grad(p.map((c) => c / s)).map((g) => g / s),
    };
    const samples = makeSamples(mesh, 0); // centroid sampling: dim is set by V, not by order
    const diag = bboxDiag(mesh);
    const c = compareVectors(analyticGradient(mesh, field, samples), fdGradient(mesh, field, samples, H_REL * diag));
    scaleComponents += c.dim;
    if (c.cosine < worstScaleCos) worstScaleCos = c.cosine;
    if (c.relErr > worstScaleRel) worstScaleRel = c.relErr;
    const e0 = energy(mesh, field, samples);
    const e1 = fit(mesh, field, samples, { iters: 12 }).energyEnd;
    const drop = relDrop(e0, e1);
    if (!dropRef.has(sc.name)) dropRef.set(sc.name, drop);
    const drift = Math.abs(drop - dropRef.get(sc.name)) / Math.max(Math.abs(dropRef.get(sc.name)), 1e-300);
    if (drift > worstDropDrift) worstDropDrift = drift;
  }
}
check('scale invariance', worstScaleCos >= 0.999999 && worstScaleRel <= 1e-4 && worstDropDrift <= 1e-6,
  `rows=${scenes.length * SCALES.length} components=${scaleComponents} worstCosine=${worstScaleCos.toFixed(12)} worstRelErr=${worstScaleRel.toExponential(3)} worstRelDropDrift=${worstDropDrift.toExponential(3)}`);
check('certified components >= 20000', certComponents + scaleComponents >= 20000, `components=${certComponents + scaleComponents} (scene sweep ${certComponents} + scale sweep ${scaleComponents})`);

console.log('== 4. optimizer: Armijo steepest descent vs naive fixed step ==');
let oursWins = 0, diverged = 0;
for (const sc of scenes) {
  const samples = makeSamples(sc.mesh, sc.order);
  const e0 = energy(sc.mesh, sc.field, samples);
  const ours = fit(sc.mesh, sc.field, samples, { iters: 60 });
  const naive = fixedStepDescent(sc.mesh, sc.field, samples, { iters: 60 });
  const m0 = meanAbsF(sc.mesh, sc.field, samples);
  const m1 = meanAbsF(ours.mesh, sc.field, samples);
  const dOurs = relDrop(e0, ours.energyEnd), dNaive = relDrop(e0, naive.energyEnd);
  if (dOurs > dNaive) oursWins++;
  if (!Number.isFinite(naive.energyEnd) || naive.energyEnd > e0) diverged++;
  check(`fit ${sc.name}`, dOurs >= 0.5 && m1 < m0,
    `mean|f| ${m0.toFixed(6)} -> ${m1.toFixed(6)}  E ${e0.toExponential(4)} -> ${ours.energyEnd.toExponential(4)} (drop ${(100 * dOurs).toFixed(2)}%)  naiveDrop=${(100 * dNaive).toFixed(2)}%`);
}
check('ours beats naive on >=5/6 scenes', oursWins >= 5, `oursWins=${oursWins}/6`);
check('naive fixed step never wins', oursWins === scenes.length, `oursWins=${oursWins}/${scenes.length}`);

console.log('== 4b. cost: field evaluations per gradient (measured with a counting wrapper) ==');
{
  const sc = scenes[0];
  const samples = makeSamples(sc.mesh, sc.order);
  const h = H_REL * bboxDiag(sc.mesh);
  const base = sc.field;
  let calls = 0;
  const counted = { kind: base.kind, params: base.params, f: (p) => { calls++; return base.f(p); }, grad: (p) => base.grad(p) };
  calls = 0; analyticGradient(sc.mesh, counted, samples); const A = calls;
  calls = 0; fdGradient(sc.mesh, counted, samples, h); const F = calls;
  check('FD costs >=100x more field evaluations', F >= 100 * A,
    `analytic=${A} field-evals, fd=${F} field-evals, ratio=${(F / A).toFixed(1)}x on ${sc.mesh.vertices.length} vertices / ${samples.length} samples`);
}

console.log('== 5. determinism and baked-reference consistency ==');
{
  const sc = scenes[0];
  const samples = makeSamples(sc.mesh, sc.order);
  const a = analyticGradient(sc.mesh, sc.field, samples);
  const b = analyticGradient(sc.mesh, sc.field, samples);
  let same = a.length === b.length;
  for (let i = 0; i < a.length && same; i++) same = a[i] === b[i];
  check('gradient bit-repeatable', same, `dim=${a.length} first=${a[0].toExponential(6)}`);

  const ref = JSON.parse(readFileSync(join(here, '..', 'data', 'reference.json'), 'utf8'));
  const r = ref.scenes[sc.name];
  const live = fit(sc.mesh, sc.field, samples, { iters: 60 });
  check('reference.json matches recomputation',
    live.energyEnd === r.optEnergyEnd && energy(sc.mesh, sc.field, samples) === r.energy0,
    `energy0=${r.energy0} optEnergyEnd=${r.optEnergyEnd}`);
  check('reference scale rows present', Array.isArray(ref.scaleRows) && ref.scaleRows.length === SCALES.length,
    `rows=${ref.scaleRows ? ref.scaleRows.length : 0}`);
}

console.log('== 6. mutation self-test: does the certificate actually catch a wrong gradient? ==');
{
  const sc = scenes[0];
  const samples = makeSamples(sc.mesh, sc.order);
  const h = H_REL * bboxDiag(sc.mesh);
  const good = analyticGradient(sc.mesh, sc.field, samples);
  const fdRef = fdGradient(sc.mesh, sc.field, samples, h);
  // each mutant must be caught by at least one of the two acceptance criteria
  const mutants = [
    ['global x1.01 scale', (g) => g.map((v) => v * 1.01)],
    ['one vertex +1%', (g) => { const m = Float64Array.from(g); for (let k = 0; k < 3; k++) m[15 + k] *= 1.01; return m; }],
    ['swap x/y of vertex 7', (g) => { const m = Float64Array.from(g); const t = m[21]; m[21] = m[22]; m[22] = t; return m; }],
    ['zero one component', (g) => { const m = Float64Array.from(g); m[100] = 0; return m; }],
    ['flip sign of vertex 3', (g) => { const m = Float64Array.from(g); for (let k = 0; k < 3; k++) m[9 + k] = -m[9 + k]; return m; }],
    ['drop barycentric weights', (g) => { const m = Float64Array.from(g); for (let i = 0; i < m.length; i++) m[i] *= 1.37; return m; }],
    ['shift index by one', (g) => { const m = Float64Array.from(g); for (let i = 0; i + 3 < m.length; i++) m[i] = g[i + 3]; return m; }],
    ['all zeros', (g) => new Float64Array(g.length)],
  ];
  let caught = 0;
  for (const [label, mut] of mutants) {
    const c = compareVectors(mut(good), fdRef);
    const ok = !(c.cosine >= 0.999999 && c.relErr <= 1e-5);
    if (ok) caught++;
    console.log(`  ${ok ? 'CATCH ' : 'MISS  '} ${label}  cosine=${c.cosine.toFixed(9)} relErr=${c.relErr.toExponential(3)}`);
  }
  check('all 8 mutants rejected by the certificate', caught === mutants.length, `caught=${caught}/${mutants.length}`);
  // honest blind spot: a 1e-13 relative perturbation is below the certificate's power
  const tiny = good.map((v, i) => v * (1 + (i === 0 ? 1e-13 : 0)));
  const ct = compareVectors(tiny, fdRef);
  console.log(`  BLIND-SPOT 1e-13 single-component perturbation: cosine=${ct.cosine.toFixed(15)} relErr=${ct.relErr.toExponential(3)} (below the 1e-5 gate, undetectable by design)`);
  check('blind spot disclosed and measured', ct.relErr < 1e-5, `relErr=${ct.relErr.toExponential(3)} < 1e-5 -> certificate cannot see it`);
}

console.log(`\nRESULT ${fail === 0 ? 'PASS' : 'FAIL'}  pass=${pass} fail=${fail}`);
if (fail) { console.log('failed: ' + failures.join(', ')); process.exit(1); }
process.exit(0);
