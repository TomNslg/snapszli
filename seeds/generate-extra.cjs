#!/usr/bin/env node
/**
 * Extra seeds: Etienne/Catherine/Leo/Tam/Lionel vs Tom
 * Progressive paths like 1:0,1:2 → delta jeux per round.
 */
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
  const seq = [];
  let a = 0;
  let b = 0;
  while (a < targetA || b < targetB) {
    if (a < targetA && (b >= targetB || a <= b)) {
      a += 1;
      seq.push({ side: "A", jeux: 1 });
    } else if (b < targetB) {
      b += 1;
      seq.push({ side: "B", jeux: 1 });
    } else break;
  }
  return seq;
}

/** Parse "1:0,1:2,3:2" → awards + final score. */
function pathToAwards(pathStr, label) {
  const parts = pathStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/\s/g, ""));
  let prevA = 0;
  let prevB = 0;
  const awards = [];
  parts.forEach((p, idx) => {
    // fix typos like 6:,3 → 6:3
    const fixed = p.replace(/,:/, ":").replace(/:$/, "");
    const m = fixed.match(/^(\d+):(\d+)$/);
    if (!m) throw new Error(`${label}: bad path token "${p}"`);
    const a = Number(m[1]);
    const b = Number(m[2]);
    const dA = a - prevA;
    const dB = b - prevB;
    if (dA < 0 || dB < 0) throw new Error(`${label}: score went down at ${p}`);
    if (dA > 0 && dB > 0) throw new Error(`${label}: both scored at ${p}`);
    if (dA === 0 && dB === 0) return;
    if (dA > 3 || dB > 3) {
      throw new Error(`${label}: jump >3 at ${prevA}:${prevB}→${a}:${b}`);
    }
    if (dA > 0) awards.push({ side: "A", jeux: dA });
    if (dB > 0) awards.push({ side: "B", jeux: dB });
    prevA = a;
    prevB = b;
  });
  return { awards, finalA: prevA, finalB: prevB };
}

function roundFromAward(meta, playerA, playerB, idPrefix, si, ri, rng) {
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
    id: `${idPrefix}-s${si}-r${ri}`,
    trumpSuit,
    winnerId,
    loserId,
    marriages: [],
    pariPerdu,
    loserFixed,
    leftOut,
  };
}

function buildMatch({
  id,
  label,
  nameA,
  nameB,
  sets, // [{ score:[a,b], path?: string, open?: boolean }]
  open,
  seed,
  note,
}) {
  const rng = mulberry32(seed);
  const playerA = `seed-${nameA.toLowerCase()}`;
  const playerB = `seed-${nameB.toLowerCase()}`;
  const idPrefix = id;

  const builtSets = sets.map((spec, si) => {
    let awards;
    let finalA;
    let finalB;
    if (spec.path) {
      const parsed = pathToAwards(spec.path, `${id} set${si + 1}`);
      awards = parsed.awards;
      finalA = parsed.finalA;
      finalB = parsed.finalB;
      if (spec.score) {
        if (spec.score[0] !== finalA || spec.score[1] !== finalB) {
          // Prefer path end; warn if header score differs
          console.warn(
            `WARN ${id} set${si + 1}: header ${spec.score[0]}:${spec.score[1]} vs path ${finalA}:${finalB} — using path`,
          );
        }
      }
    } else {
      finalA = spec.score[0];
      finalB = spec.score[1];
      const finished = !!setWon(finalA, finalB);
      awards = shuffleAwards(finalA, finalB, rng, {
        requireWinner: finished && !spec.openSet,
        nameA,
        nameB,
      });
    }
    const rounds = awards.map((a, ri) =>
      roundFromAward(a, playerA, playerB, idPrefix, si, ri, rng),
    );
    return {
      jeuxA: finalA,
      jeuxB: finalB,
      winner: setWon(finalA, finalB),
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
    kind: "snapszli-seed",
    note: note || "Seed from notebook; artificial sets use empirical 3/2/1 (paths).",
    label,
    players: [
      { id: playerA, name: nameA },
      { id: playerB, name: nameB },
    ],
    match: {
      id,
      playerA,
      playerB,
      startedAt: new Date(Date.UTC(2026, 0, 1 + (seed % 27), 12)).toISOString(),
      endedAt: open ? null : new Date(Date.UTC(2026, 0, 1 + (seed % 27), 14)).toISOString(),
      setsA,
      setsB,
      status: open ? "open" : "done",
      sets: builtSets,
      source: "notebook",
    },
  };
}

const MATCHES = [];

// ——— Etienne : Tom ———
MATCHES.push({
  id: "seed-etienne-tom-1",
  label: "Etienne vs Tom — match 1",
  nameA: "Etienne",
  nameB: "Tom",
  open: false,
  seed: 101,
  sets: [{ score: [4, 7] }, { score: [4, 9] }, { score: [5, 9] }],
});
MATCHES.push({
  id: "seed-etienne-tom-2",
  label: "Etienne vs Tom — match 2 (ouverte)",
  nameA: "Etienne",
  nameB: "Tom",
  open: true,
  seed: 102,
  note: "Ouverte: set4 en cours 4:3.",
  sets: [
    { score: [11, 8] },
    { score: [4, 7] },
    { path: "3:0,4:0,5:0,6:0,6:2,6:4,6:5,6:7,6:8" },
    { path: "2:0,4:0,4:3", openSet: true },
  ],
});

// ——— Catherine : Tom ———
MATCHES.push({
  id: "seed-catherine-tom-1",
  label: "Catherine vs Tom — match 1",
  nameA: "Catherine",
  nameB: "Tom",
  open: false,
  seed: 201,
  sets: [{ score: [7, 5] }, { score: [6, 8] }, { score: [0, 7] }, { score: [2, 8] }],
});

// ——— Leo : Tom ———
MATCHES.push({
  id: "seed-leo-tom-0",
  label: "Leo vs Tom — match (ouverte, un set)",
  nameA: "Leo",
  nameB: "Tom",
  open: true,
  seed: 300,
  note: "Entrée courte 2:8 — set terminé, match ouvert (0–1).",
  sets: [{ score: [2, 8] }],
});
MATCHES.push({
  id: "seed-leo-tom-1",
  label: "Leo vs Tom — match 1",
  nameA: "Leo",
  nameB: "Tom",
  open: false,
  seed: 301,
  sets: [
    { score: [9, 3], path: "1:0,3:0,4:0,5:0,6:0,6:1,6:2,6:3,9:3" },
    { score: [2, 7], path: "0:2,2:2,2:4,2:7" },
    { score: [3, 9], path: "0:3,0:5,3:5,3:6,3:9" },
    { score: [7, 3], path: "1:0,2:0,2:3,5:3,6:3,7:3" },
    { score: [6, 8], path: "1:0,1:2,1:4,3:4,4:4,4:5,6:5,6:8" },
  ],
});
MATCHES.push({
  id: "seed-leo-tom-2",
  label: "Leo vs Tom — match 2",
  nameA: "Leo",
  nameB: "Tom",
  open: false,
  seed: 302,
  sets: [
    { path: "2:0,2:1,2:2,3:2,3:3,3:5,3:6,3:8" },
    { path: "3:0,3:1,3:3,3:5,4:5,4:7" },
    { path: "2:0,2:1,2:3,4:3,5:3,5:4,5:7" },
  ],
});
MATCHES.push({
  id: "seed-leo-tom-3",
  label: "Leo vs Tom — match 3 (ouverte)",
  nameA: "Leo",
  nameB: "Tom",
  open: true,
  seed: 303,
  sets: [{ path: "0:1,0:3,0:4,2:4,2:6,2:7" }],
});

// ——— Tam : Tom ———
MATCHES.push({
  id: "seed-tam-tom-1",
  label: "Tam vs Tom — match 1 (ouverte)",
  nameA: "Tam",
  nameB: "Tom",
  open: true,
  seed: 401,
  note: "Set en cours 1:6 (non terminé).",
  sets: [{ score: [1, 6], openSet: true }],
});

// ——— Lionel : Tom ———
MATCHES.push({
  id: "seed-lionel-tom-1",
  label: "Lionel vs Tom — match 1",
  nameA: "Lionel",
  nameB: "Tom",
  open: false,
  seed: 501,
  sets: [
    { score: [6, 10] },
    { score: [8, 6] },
    { path: "3:0,4:0,6:0,6:1,6:3,6:5,6:8" },
    { path: "0:2,0:3,0:6,1:6,1:8" },
  ],
});
MATCHES.push({
  id: "seed-lionel-tom-2",
  label: "Lionel vs Tom — match 2",
  nameA: "Lionel",
  nameB: "Tom",
  open: false,
  seed: 502,
  sets: [
    { score: [8, 2], path: "1:0,1:2,3:2,5:2,6:2,8:2" },
    { score: [7, 5], path: "0:3,0:5,2:5,5:5,7:5" },
    { score: [5, 8], path: "0:2,0:4,3:4,3:6,5:6,5:8" },
    { score: [1, 9], path: "0:1,0:2,0:3,1:3,1:5,1:6,1:9" },
    { score: [0, 7], path: "0:1,0:4,0:5,0:7" },
  ],
});
MATCHES.push({
  id: "seed-lionel-tom-3",
  label: "Lionel vs Tom — match 3",
  nameA: "Lionel",
  nameB: "Tom",
  open: false,
  seed: 503,
  note: "Set4 7:4 sans chemin détaillé → manches artificielles.",
  sets: [
    { score: [9, 1], path: "1:0,3:0,3:1,5:1,6:1,9:1" },
    { score: [7, 2], path: "2:0,3:0,5:0,5:2,6:2,7:2" },
    { score: [7, 9], path: "0:1,2:1,2:3,2:6,5:6,6:6,7:6,7:9" },
    { score: [7, 4] },
  ],
});
MATCHES.push({
  id: "seed-lionel-tom-4",
  label: "Lionel vs Tom — match 4",
  nameA: "Lionel",
  nameB: "Tom",
  open: false,
  seed: 504,
  sets: [{ score: [9, 4] }, { score: [2, 8] }, { score: [3, 7] }, { score: [4, 7] }],
});
MATCHES.push({
  id: "seed-lionel-tom-5",
  label: "Lionel vs Tom — match 5",
  nameA: "Lionel",
  nameB: "Tom",
  open: false,
  seed: 505,
  sets: [
    { score: [7, 3] },
    { score: [2, 8] },
    { score: [5, 7] },
    { score: [7, 9], path: "2:0,2:1,2:2,2:5,2:6,4:6,7:6,7:9" },
  ],
});
MATCHES.push({
  id: "seed-lionel-tom-6",
  label: "Lionel vs Tom — match 6",
  nameA: "Lionel",
  nameB: "Tom",
  open: false,
  seed: 506,
  note: "Set5: chemin noté 2:8/…8:2 — utilisé 2:8 (…2:5,2:8); jump 2:5→8:2 impossible.",
  sets: [
    { score: [7, 4], path: "2:0,2:2,2:3,3:3,3:4,6:4,7:4" },
    { score: [4, 7], path: "2:0,2:2,2:4,2:5,4:5,4:7" },
    { score: [7, 4], path: "2:0,3:0,6:0,6:1,6:2,6:4,7:4" },
    { score: [0, 7], path: "0:2,0:4,0:6,0:7" },
    { score: [2, 8], path: "0:3,0:4,0:5,2:5,2:8" },
  ],
});
MATCHES.push({
  id: "seed-lionel-tom-7",
  label: "Lionel vs Tom — match 7 (ouverte)",
  nameA: "Lionel",
  nameB: "Tom",
  open: true,
  seed: 507,
  note: "Typo 6:,3 → 6:3.",
  sets: [{ score: [7, 4], path: "2:0,3:0,3:2,3:3,6:3,6:4,7:4" }],
});

const written = [];
for (const m of MATCHES) {
  try {
    const payload = buildMatch(m);
    const file = path.join(OUT, `${m.id}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    written.push(m.id);
    console.log(
      `${m.id} ${payload.match.setsA}-${payload.match.setsB} ${payload.match.status}`,
    );
  } catch (e) {
    console.error(`FAIL ${m.id}:`, e.message);
    process.exitCode = 1;
  }
}

fs.writeFileSync(
  path.join(OUT, "manifest.json"),
  JSON.stringify(
    {
      fayeTom: Array.from({ length: 24 }, (_, i) => `faye-tom-${i + 1}.json`),
      extra: written.map((id) => `${id}.json`),
    },
    null,
    2,
  ),
);
console.log("manifest ok", written.length);
