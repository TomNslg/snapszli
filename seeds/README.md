# Seeds

Auto-loaded via `manifest.json` on app start (normal historique entries).

| Series | Files |
|---|---|
| Faye vs Tom | `faye-tom-1.json` … `faye-tom-24.json` |
| Etienne / Catherine / Leo / Tam / Lionel vs Tom | `seed-*-tom-*.json` |

**Notations handled**
- Final set scores only → artificial manches
- Progressive paths `1:0,1:2,…` → deltas = jeux per round (unchanged)
- Open matches / unfinished sets → `status: open`

**Artificial 3/2/1** (`empirical-jeux.cjs`)
- When reconstructing a set without a path, each player’s jeux awards are sampled from their empirical win distribution on real path data:
  - Tom n=111 → ~38% / 41% / 21% (1/2/3)
  - Lionel n=47, Leo n=25, Faye n=10, Etienne n=6
  - Catherine / Tam (no path data) → pooled non-Tom opponent distribution
- Points / pari perdu stay synthetic placeholders (not calibrated).

**Assumptions (tell me if wrong)**
- Lionel #6 set 5: path ended `…2:5,8:2` (impossible jump) → used `…2:5,2:8` for **2:8**
- Lionel #7: `6:,3` → `6:3`
- Leo short `2:8` kept as separate open match (`seed-leo-tom-0`) plus fuller Leo #1–3
- Etienne #2 set 4 `…4:3` = set in progress, match open

**Re-import note:** match IDs are stable; existing `localStorage` keeps old artificial manches until those parties are deleted (then re-seed on reload).

Regen: `node generate-faye-tom.cjs` · `node generate-extra.cjs`
