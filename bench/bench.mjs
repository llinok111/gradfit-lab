// bench/bench.mjs — timings with cold start, warmup and >=5 repetitions.
//   node bench/bench.mjs   -> writes bench/result.json

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCENES, buildScene, makeSamples, analyticGradient, fdGradient,
  compareVectors, fit, energy, meanAbsF, bboxDiag, relDrop, fixedStepDescent,
} from '../src/core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const H_REL = 1e-6;

const scenes = SCENES.map(buildScene);
const prepped = scenes.map((sc) => ({ sc, samples: makeSamples(sc.mesh, sc.order), h: H_REL * bboxDiag(sc.mesh) }));

// one unit of work: analytic gradient for every scene
function analyticAll() {
  let acc = 0;
  for (const p of prepped) acc += analyticGradient(p.sc.mesh, p.sc.field, p.samples)[0];
  return acc;
}
// baseline unit of work: finite-difference gradient for scene 0
function fdOne() {
  const p = prepped[0];
  return fdGradient(p.sc.mesh, p.sc.field, p.samples, p.h)[0];
}
function fitAll() {
  let acc = 0;
  for (const p of prepped) acc += fit(p.sc.mesh, p.sc.field, p.samples, { iters: 60 }).energyEnd;
  return acc;
}

function stats(ms) {
  const s = [...ms].sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1 || 1);
  const pct = (q) => {
    const idx = Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1));
    return s[idx];
  };
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return {
    n, min: s[0], median, p25: pct(0.25), p75: pct(0.75), p95: pct(0.95),
    stddev: Math.sqrt(variance), mean, max: s[n - 1],
  };
}

function timeIt(fn, reps) {
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) fn();
  return performance.now() - t0;
}

const REPS = 11;
const INNER = 3;

// Cold start = the very first execution of each workload in this fresh process,
// measured BEFORE any warmup runs.
const coldAnalytic = timeIt(analyticAll, 1);
const coldFD = timeIt(fdOne, 1);
const coldFit = timeIt(fitAll, 1);

// warmup (1 full pass of each workload), results discarded
analyticAll(); fdOne(); fitAll();

const aSamples = [], aOneSamples = [], fSamples = [], fitSamples = [];
for (let i = 0; i < REPS; i++) {
  aSamples.push(timeIt(analyticAll, INNER) / INNER);
  aOneSamples.push(timeIt(() => analyticGradient(prepped[0].sc.mesh, prepped[0].sc.field, prepped[0].samples), INNER) / INNER);
  fitSamples.push(timeIt(fitAll, 1));
}
for (let i = 0; i < 7; i++) fSamples.push(timeIt(fdOne, 1));

const analytic = stats(aSamples), analyticOne = stats(aOneSamples), fd = stats(fSamples), fitting = stats(fitSamples);

// exact per-scene evidence, from the same run
const perScene = [];
let certified = 0;
for (const p of prepped) {
  const c = compareVectors(analyticGradient(p.sc.mesh, p.sc.field, p.samples), fdGradient(p.sc.mesh, p.sc.field, p.samples, p.h));
  certified += c.dim;
  const e0 = energy(p.sc.mesh, p.sc.field, p.samples);
  const ours = fit(p.sc.mesh, p.sc.field, p.samples, { iters: 60 });
  const naive = fixedStepDescent(p.sc.mesh, p.sc.field, p.samples, { iters: 60 });
  perScene.push({
    name: p.sc.name,
    vertices: p.sc.mesh.vertices.length,
    faces: p.sc.mesh.faces.length,
    samples: p.samples.length,
    gradDim: c.dim,
    gradCosine: c.cosine,
    gradRelErr: c.relErr,
    energy0: e0,
    energyEnd: ours.energyEnd,
    relDropOurs: relDrop(e0, ours.energyEnd),
    relDropNaive: relDrop(e0, naive.energyEnd),
    meanAbs0: meanAbsF(p.sc.mesh, p.sc.field, p.samples),
    meanAbs1: meanAbsF(ours.mesh, p.sc.field, p.samples),
  });
}

const out = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  reps: REPS,
  innerAnalyticLoop: INNER,
  fdReps: 7,
  coldStartMs: { analyticAll6Scenes: +coldAnalytic.toFixed(3), fdGradientScene0: +coldFD.toFixed(3), fitAll6Scenes: +coldFit.toFixed(3) },
  analyticAll6ScenesMs: analytic,
  analyticScene0Ms: analyticOne,
  fdGradientScene0Ms: fd,
  fitAll6ScenesMs: fitting,
  speedup: { fdOverAnalyticScene0: +(fd.median / analyticOne.median).toFixed(2), note: 'same scene 0, same samples: finite-difference gradient vs analytic gradient' },
  detail: {
    certifiedComponents: certified,
    hRel: H_REL,
    perScene,
  },
  notes: [
    'coldStartMs is the first execution of that workload in a fresh process, before warmup.',
    'median is the order statistic (mean of the two middle samples when n is even); p25/p75/p95 are order statistics.',
    'FD step h = hRel * bbox diagonal, so timings and certificates are scale relative.',
  ],
};

writeFileSync(join(here, 'result.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({
  cold: out.coldStartMs,
  analyticMedian: +analytic.median.toFixed(3),
  analyticScene0Median: +analyticOne.median.toFixed(3),
  analyticStddev: +analytic.stddev.toFixed(3),
  analyticRelStddev: +(analytic.stddev / analytic.median).toFixed(4),
  fdMedian: +fd.median.toFixed(3),
  fitMedian: +fitting.median.toFixed(3),
  speedup: out.speedup.fdOverAnalyticScene0,
  certifiedComponents: certified,
}, null, 2));
