#!/usr/bin/env node
/** Generate Faye vs Tom seed matches 2–24 → app/seeds/faye-tom-N.json */
const fs = require("fs");
const path = require("path");
const { splitIntoJeux, weightsFor } = require("./empirical-jeux.cjs");
const OUT = __dirname;

function setWon(a, b) {
  if (a >= 7 && a - b >= 2) return "A";
  if (b >= 7 && b - a >= 2) return "B";
  return null;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleAwards(targetA, targetB, rng, { requireWinner, nameA, nameB }) {
  const winnerSide = setWon(targetA, targetB);
  if (requireWinner && !winnerSide) throw new Error(`Invalid set ${targetA}-${targetB}`);
  const wA = weightsFor(nameA);
  const wB = weightsFor(nameB);
  for (let attempt = 0; attempt < 12000; attempt++) {
    const pool = [
      ...splitIntoJeux(targetA, rng, wA).map((j) => ({ side: "A", jeux: j })),
      ...splitIntoJeux(targetB, rng, wB).map((j) => ({ side: "B", jeux: j })),
    ];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let a = 0;
    let b = 0;
    let ok = true;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].side === "A") a += pool[i].jeux;
      else b += pool[i].jeux;
      const w = setWon(a, b);
      if (i < pool.length - 1 && w) {
        ok = false;
        break;
      }
      if (i === pool.length - 1) {
        if (a !== targetA || b !== targetB) ok = false;
        if (requireWinner && w !== winnerSide) ok = false;
      }
    }
    if (ok) return pool;
  }
  // +1 fallback
  const seq = [];
  let a = 0;
  let b = 0;
  while (a < targetA || b < targetB) {
    const preferA = a < targetA && (b >= targetB || a <= b);
    if (preferA) {
      a += 1;
      seq.push({ side: "A", jeux: 1 });
    } else if (b < targetB) {
      b += 1;
      seq.push({ side: "B", jeux: 1 });
    } else break;
  }
  return seq;
}

function awardsFromPairedLists(fayeList, tomList) {
  const n = Math.max(fayeList.length, tomList.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const f = fayeList[i] || 0;
    const t = tomList[i] || 0;
    if (f > 0 && t > 0) throw new Error(`Both scored round ${i}: ${f}/${t}`);
    if (f === 0 && t === 0) continue;
    out.push(f > 0 ? { side: "A", jeux: f } : { side: "B", jeux: t });
  }
  return out;
}

function roundFromAward(meta, playerA, playerB, matchN, si, ri, rng) {
  const trumpSuit = ["coeur", "grelot", "feuille", "gland"][Math.floor(rng() * 4)];
  const winnerId = meta.side === "A" ? playerA : playerB;
  const loserId = meta.side === "A" ? playerB : playerA;
  let loserFixed;
  let leftOut;
  let pariPerdu = false;
  if (meta.jeux === 3) {
    if (rng() < 0.35) {
      pariPerdu = true;
      loserFixed = 10 + Math.floor(rng() * 45);
      leftOut = Math.floor(rng() * 25);
    } else {
      loserFixed = 0;
      leftOut = Math.floor(rng() * 40);
    }
  } else if (meta.jeux === 2) {
    loserFixed = 8 + Math.floor(rng() * 24);
    leftOut = Math.floor(rng() * 30);
  } else {
    loserFixed = 33 + Math.floor(rng() * 25);
    leftOut = Math.floor(rng() * 20);
  }
  if (loserFixed + leftOut > 120) leftOut = Math.max(0, 120 - loserFixed);
  return {
    id: `seed-ft${matchN}-s${si}-r${ri}`,
    trumpSuit,
    winnerId,
    loserId,
    marriages: [],
    pariPerdu,
    loserFixed,
    leftOut,
  };
}

function buildMatch({ n, winner, sets, open, detailed, seed }) {
  const rng = mulberry32(seed);
  const playerA = "seed-faye";
  const playerB = "seed-tom";

  const builtSets = sets.map((target, si) => {
    let awards;
    if (detailed && detailed[si]) {
      awards = awardsFromPairedLists(detailed[si].faye, detailed[si].tom);
      const sumA = awards.filter((x) => x.side === "A").reduce((s, x) => s + x.jeux, 0);
      const sumB = awards.filter((x) => x.side === "B").reduce((s, x) => s + x.jeux, 0);
      if (sumA !== target[0] || sumB !== target[1]) {
        throw new Error(`M${n} set ${si + 1}: ${sumA}:${sumB} ≠ ${target[0]}:${target[1]}`);
      }
    } else {
      awards = shuffleAwards(target[0], target[1], rng, {
        requireWinner: !open || !!setWon(target[0], target[1]),
        nameA: "Faye",
        nameB: "Tom",
      });
    }
    const rounds = awards.map((a, ri) =>
      roundFromAward(a, playerA, playerB, n, si, ri, rng),
    );
    return {
      jeuxA: target[0],
      jeuxB: target[1],
      winner: setWon(target[0], target[1]),
      rounds,
    };
  });

  let setsA = 0;
  let setsB = 0;
  builtSets.forEach((s) => {
    if (s.winner === "A") setsA += 1;
    if (s.winner === "B") setsB += 1;
  });

  return {
    version: 1,
    kind: "snapszli-seed-from-set-scores",
    note: detailed
      ? "Match 18: ordre des jeux respecté (listes appariées). Points fixes artificiels."
      : open
        ? "Partie ouverte — manches artificielles (3/2/1 selon dist. empirique path)."
        : "Reconstruit depuis scores de sets; 3/2/1 selon dist. empirique (paths réels).",
    label: open ? `Faye vs Tom — match ${n} (ouverte)` : `Faye vs Tom — match ${n}`,
    players: [
      { id: playerA, name: "Faye" },
      { id: playerB, name: "Tom" },
    ],
    match: {
      id: `seed-faye-tom-${n}`,
      playerA,
      playerB,
      startedAt: `2026-01-${String(Math.min(n, 28)).padStart(2, "0")}T12:00:00.000Z`,
      endedAt: open ? null : `2026-01-${String(Math.min(n, 28)).padStart(2, "0")}T14:00:00.000Z`,
      setsA,
      setsB,
      status: open ? "open" : "done",
      sets: builtSets,
      source: detailed ? "set-scores-and-round-jeux" : "set-scores-only",
      setScores: sets.map(([a, b]) => ({ Faye: a, Tom: b })),
      declaredWinner: winner || null,
    },
  };
}

// Match 18: paired Faye[i]/Tom[i] (one nonzero). Adjustments:
// - set2 Tom last 3→0 so sum is 6 (was 9)
// - set4 Tom padded with trailing 0 (8 pairs)
const detail18 = [
  { faye: [0, 0, 2, 0, 0], tom: [2, 3, 0, 1, 3] },
  { faye: [1, 3, 1, 0, 0, 0, 1, 3], tom: [0, 0, 0, 2, 1, 3, 0, 0] }, // last Tom 3→0
  { faye: [], tom: [2, 2, 3] },
  { faye: [0, 3, 0, 1, 1, 0, 1, 0], tom: [2, 0, 2, 0, 0, 2, 0, 3] }, // insert 0 before last 3
];

const MATCHES = [
  { n: 1, winner: "Tom", sets: [[7, 1], [5, 7], [8, 6], [1, 8], [5, 7]] },
  { n: 2, winner: "Tom", sets: [[1, 8], [7, 1], [3, 8], [1, 8]] },
  { n: 3, winner: "Tom", sets: [[4, 8], [2, 7], [5, 7]] },
  { n: 4, winner: "Faye", sets: [[7, 4], [9, 7], [4, 7], [8, 6]] },
  { n: 5, winner: "Tom", sets: [[8, 11], [2, 7], [6, 8]] },
  { n: 6, winner: "Tom", sets: [[0, 7], [3, 7], [4, 9]] },
  { n: 7, winner: null, open: true, sets: [[10, 6], [2, 7]] },
  { n: 8, winner: "Tom", sets: [[3, 9], [3, 8], [5, 7]] },
  { n: 9, winner: "Tom", sets: [[2, 7], [5, 8], [6, 9]] },
  { n: 10, winner: "Tom", sets: [[6, 8], [7, 0], [7, 3], [0, 7], [4, 8]] },
  { n: 11, winner: "Tom", sets: [[1, 7], [3, 8], [2, 8]] },
  { n: 12, winner: "Tom", sets: [[0, 8], [5, 7], [9, 3], [2, 7]] },
  { n: 13, winner: "Tom", sets: [[7, 2], [3, 7], [1, 8], [5, 7]] },
  { n: 14, winner: "Faye", sets: [[5, 7], [0, 7], [9, 7], [7, 2], [9, 5]] },
  { n: 15, winner: "Tom", sets: [[1, 7], [5, 8], [7, 10]] },
  { n: 16, winner: "Faye", sets: [[9, 7], [7, 3], [6, 8], [7, 2]] },
  { n: 17, winner: "Tom", sets: [[2, 7], [6, 9], [4, 8]] },
  {
    n: 18,
    winner: "Tom",
    sets: [
      [2, 9],
      [9, 6],
      [0, 7],
      [6, 9],
    ],
    detailed: detail18,
  },
  { n: 19, winner: "Tom", sets: [[4, 7], [3, 8], [5, 8]] },
  { n: 20, winner: "Faye", sets: [[1, 7], [7, 0], [8, 6], [4, 9], [7, 4]] },
  { n: 21, winner: "Faye", sets: [[8, 2], [9, 5], [0, 7], [5, 8], [8, 2]] },
  { n: 22, winner: "Tom", sets: [[3, 7], [3, 7], [1, 7]] },
  { n: 23, winner: "Faye", sets: [[8, 0], [0, 7], [9, 7], [8, 4]] },
  { n: 24, winner: null, open: true, sets: [[6, 10], [6, 8]] },
];

for (const m of MATCHES) {
  const payload = buildMatch({
    n: m.n,
    winner: m.winner,
    sets: m.sets,
    open: !!m.open,
    detailed: m.detailed || null,
    seed: 20260730 + m.n * 97,
  });
  if (!m.open && m.winner) {
    const got = payload.match.setsA > payload.match.setsB ? "Faye" : "Tom";
    if (got !== m.winner) {
      console.warn(`WARN #${m.n}: want ${m.winner}, got ${payload.match.setsA}-${payload.match.setsB}`);
    }
  }
  fs.writeFileSync(path.join(OUT, `faye-tom-${m.n}.json`), JSON.stringify(payload, null, 2));
  console.log(
    `#${m.n} ${payload.match.setsA}-${payload.match.setsB} ${payload.match.status}`,
  );
}
console.log("ok", MATCHES.length);
