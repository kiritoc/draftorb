/**
 * @draftorb/engine — Joint model fitting (T-123).
 *
 * Full-batch logistic regression with L2 regularization over sparse
 * features. Deterministic: rows are consumed in the order given, feature
 * order is fixed by construction, and coefficient updates use a fixed
 * learning-rate schedule — no randomness anywhere.
 */

import {
  DEFAULT_JOINT_FIT_CONFIG,
  type JointFeature,
  type JointFitConfig,
  type JointModelParams,
} from './features.js';

export interface JointTrainingRow {
  /** 1 when the ally side won, 0 otherwise. */
  readonly label: 0 | 1;
  readonly features: readonly JointFeature[];
}

function sigmoid(x: number): number {
  if (x >= 0) {
    const e = Math.exp(-x);
    return 1 / (1 + e);
  }
  const e = Math.exp(x);
  return e / (1 + e);
}

/**
 * Fits `JointModelParams` on match-level rows. Coefficients live in plain
 * objects keyed by feature key; absent keys are treated as 0 and only
 * touched when a gradient step visits them.
 */
export function fitJointModel(
  rows: readonly JointTrainingRow[],
  config: JointFitConfig = DEFAULT_JOINT_FIT_CONFIG,
): JointModelParams {
  const champMain: Record<string, number> = {};
  const allyPair: Record<string, number> = {};
  const enemyPair: Record<string, number> = {};
  const laneVs: Record<string, number> = {};
  const tables = { champMain, allyPair, enemyPair, laneVs } as const;

  let bias = 0;

  // Pre-flatten features once: (table, key, sign) triples.
  const flat = rows.map((row) =>
    row.features.map((feature) => ({
      table: tables[feature.layer],
      key: feature.key,
      sign: feature.sign,
    })),
  );

  for (let iteration = 0; iteration < config.iterations; iteration += 1) {
    const lr = config.learningRate / (1 + iteration * 0.02);
    let biasGrad = 0;
    const grads = new Map<Record<string, number>, Map<string, number>>([
      [champMain, new Map()],
      [allyPair, new Map()],
      [enemyPair, new Map()],
      [laneVs, new Map()],
    ]);

    for (let rowIndex = 0; rowIndex < flat.length; rowIndex += 1) {
      const features = flat[rowIndex]!;
      const label = rows[rowIndex]!.label;
      let logit = bias;
      for (const feature of features) {
        logit += feature.sign * (feature.table[feature.key] ?? 0);
      }
      const error = sigmoid(logit) - label;
      biasGrad += error;
      for (const feature of features) {
        const tableGrad = grads.get(feature.table)!;
        tableGrad.set(feature.key, (tableGrad.get(feature.key) ?? 0) + error * feature.sign);
      }
    }

    const n = Math.max(1, rows.length);
    bias -= (lr * biasGrad) / n;
    for (const [table, tableGrad] of grads) {
      for (const [key, grad] of tableGrad) {
        const coef = table[key] ?? 0;
        table[key] = coef - lr * (grad / n + config.l2 * coef);
      }
    }
  }

  return {
    version: 1,
    bias,
    champMain,
    allyPair,
    enemyPair,
    laneVs,
    l2: config.l2,
    iterations: config.iterations,
    learningRate: config.learningRate,
  };
}
