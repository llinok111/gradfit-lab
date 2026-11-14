// baseline/naive.mjs — the baseline this project is measured against.
//
//   naiveGradient  : per-vertex central finite differences of the ENERGY.
//                    Cost: 2 * 3V energy evaluations, i.e. 6V * samples field calls.
//   naiveFit       : fixed-step gradient descent, no line search.
//
// Both are thin wrappers over src/core.mjs so the comparison cannot drift.

import { fdGradient, fixedStepDescent, energy, bboxDiag } from '../src/core.mjs';

export const H_REL = 1e-6;

export function naiveGradient(mesh, field, samples) {
  return fdGradient(mesh, field, samples, H_REL * bboxDiag(mesh));
}

export function naiveFit(mesh, field, samples, { iters = 60 } = {}) {
  const res = fixedStepDescent(mesh, field, samples, { iters, step: 0.05 * bboxDiag(mesh) });
  return { ...res, energyStart: energy(mesh, field, samples) };
}

export function naiveFitWithFD(mesh, field, samples, { iters = 60 } = {}) {
  const res = fixedStepDescent(mesh, field, samples, { iters, step: 0.05 * bboxDiag(mesh), useFD: true });
  return { ...res, energyStart: energy(mesh, field, samples) };
}
