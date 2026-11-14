// Deterministic sample-data generator. No randomness, no clock, no network:
// running it twice produces byte-identical files.
//
//   node tools/gen-sample.mjs
//
// Writes data/scenes.json (mesh + target spec) and data/reference.json
// (node-side ground truth the browser re-computes bit-for-bit).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCENES, SCALES, buildScene, makeSamples, analyticGradient, fdGradient,
  compareVectors, fit, meanAbsF, energy, bboxDiag, relDrop,
} from '../src/core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const H_REL = 1e-6; // FD step = H_REL * bbox diagonal (relative, disclosed in README)

const reference = { hRel: H_REL, scenes: {} };
for (const spec of SCENES) {
  const { mesh, field, order } = buildScene(spec);
  const samples = makeSamples(mesh, order);
  const diag = bboxDiag(mesh);
  const h = H_REL * diag;
  const gA = analyticGradient(mesh, field, samples);
  const gF = fdGradient(mesh, field, samples, h);
  const cmp = compareVectors(gA, gF);
  const e0 = energy(mesh, field, samples);
  reference.scenes[spec.name] = {
    vertices: mesh.vertices.length,
    faces: mesh.faces.length,
    samples: samples.length,
    bboxDiag: diag,
    h,
    energy0: e0,
    meanAbs0: meanAbsF(mesh, field, samples),
    gradDim: cmp.dim,
    gradCosine: cmp.cosine,
    gradRelErr: cmp.relErr,
    gradNormFD: cmp.normB,
    optEnergyEnd: fit(mesh, field, samples, { iters: 60 }).energyEnd,
  };
}

// Scale invariance: same scene re-expressed at 5 magnitudes, relative numbers
// must be unchanged (scale is applied to both mesh and field).
const scaleProbe = SCENES[0];
const scaleRows = [];
{
  const base = buildScene(scaleProbe);
  for (const s of SCALES) {
    const mesh = { vertices: base.mesh.vertices.map((v) => v.map((c) => c * s)), faces: base.mesh.faces };
    const field = { kind: base.field.kind, params: base.field.params, f: (p) => base.field.f(p.map((c) => c / s)), grad: (p) => base.field.grad(p.map((c) => c / s)).map((g) => g / s) };
    const samples = makeSamples(mesh, base.order);
    const diag = bboxDiag(mesh);
    const cmp = compareVectors(analyticGradient(mesh, field, samples), fdGradient(mesh, field, samples, H_REL * diag));
    const e0 = energy(mesh, field, samples);
    const e1 = fit(mesh, field, samples, { iters: 60 }).energyEnd;
    scaleRows.push({ scale: s, bboxDiag: diag, gradCosine: cmp.cosine, gradRelErr: cmp.relErr, energy0: e0, energyEnd: e1, relDrop: relDrop(e0, e1) });
  }
}

const scenesOut = { scenes: SCENES, scales: SCALES };
writeFileSync(join(dataDir, 'scenes.json'), JSON.stringify(scenesOut, null, 2) + '\n');
writeFileSync(join(dataDir, 'reference.json'), JSON.stringify({ ...reference, scaleRows }, null, 2) + '\n');
console.log('wrote data/scenes.json and data/reference.json');
for (const [k, v] of Object.entries(reference.scenes)) {
  console.log(`  ${k}: V=${v.vertices} F=${v.faces} S=${v.samples} cos=${v.gradCosine.toFixed(12)} relErr=${v.gradRelErr.toExponential(3)}`);
}
