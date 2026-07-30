/**
 * Empirical 3/2/1 jeux-per-manche weights from progressive paths
 * (+ Faye–Tom 18 paired lists). Used only for artificial set reconstructions.
 *
 * Counts = manches won by that player on real chronological data.
 * Fallback = pooled opponent wins (everyone except Tom) when no player-specific data.
 */
"use strict";

/** @type {Record<string, {1:number,2:number,3:number}>} */
const COUNTS = {
  Tom: { 1: 42, 2: 46, 3: 23 }, // n=111
  Lionel: { 1: 18, 2: 20, 3: 9 }, // n=47
  Leo: { 1: 13, 2: 8, 3: 4 }, // n=25
  Faye: { 1: 6, 2: 1, 3: 3 }, // n=10
  Etienne: { 1: 3, 2: 2, 3: 1 }, // n=6
};

function weightsFromCounts(c) {
  const n = c[1] + c[2] + c[3];
  return { 1: c[1] / n, 2: c[2] / n, 3: c[3] / n };
}

const FALLBACK_COUNTS = { 1: 0, 2: 0, 3: 0 };
for (const [name, c] of Object.entries(COUNTS)) {
  if (name === "Tom") continue;
  FALLBACK_COUNTS[1] += c[1];
  FALLBACK_COUNTS[2] += c[2];
  FALLBACK_COUNTS[3] += c[3];
}

const WEIGHTS = {};
for (const [name, c] of Object.entries(COUNTS)) {
  WEIGHTS[name] = weightsFromCounts(c);
}
WEIGHTS.__fallback = weightsFromCounts(FALLBACK_COUNTS);

function weightsFor(playerName) {
  const key = String(playerName || "").trim();
  return WEIGHTS[key] || WEIGHTS.__fallback;
}

function greedySplit(total, rng, w) {
  const parts = [];
  let left = total;
  while (left > 0) {
    const max = Math.min(3, left);
    const options = [1, 2, 3].filter((j) => j <= max);
    let sum = 0;
    for (const j of options) sum += w[j] || 0;
    let pick = options[0];
    if (sum > 0) {
      let r = rng() * sum;
      for (const j of options) {
        r -= w[j] || 0;
        if (r <= 0) {
          pick = j;
          break;
        }
      }
    }
    parts.push(pick);
    left -= pick;
  }
  return parts;
}

function klToWeights(parts, w) {
  const c = { 1: 0, 2: 0, 3: 0 };
  parts.forEach((j) => {
    c[j] += 1;
  });
  const n = parts.length || 1;
  let kl = 0;
  for (const j of [1, 2, 3]) {
    const p = c[j] / n;
    const q = Math.max(w[j] || 0, 1e-6);
    if (p > 0) kl += p * Math.log(p / q);
  }
  return kl;
}

/**
 * Partition `total` jeux into 1|2|3 awards ≈ empirical win weights.
 * Tries several greedy draws and keeps the closest composition.
 */
function splitIntoJeux(total, rng, weights) {
  const w = weights || WEIGHTS.__fallback;
  if (total <= 0) return [];
  let best = null;
  let bestScore = Infinity;
  for (let trial = 0; trial < 64; trial++) {
    const parts = greedySplit(total, rng, w);
    const score = klToWeights(parts, w);
    if (score < bestScore) {
      bestScore = score;
      best = parts;
    }
  }
  return best;
}

module.exports = {
  COUNTS,
  WEIGHTS,
  weightsFor,
  splitIntoJeux,
};
