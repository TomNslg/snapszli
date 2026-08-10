(() => {
  const STORAGE_KEY = "snapszli-v1";
  const LEGACY_STORAGE_KEY = "schaenpzli-v1";
  const SKIPPED_SEEDS_KEY = "snapszli-skipped-seeds";
  const Suit = window.SCHAENPZLI_SUITS;
  const SUITS = Suit.LIST;

  const state = {
    view: "home",
    params: {},
    draft: null,
  };

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function load() {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        raw = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (raw) {
          localStorage.setItem(STORAGE_KEY, raw);
        }
      }
      if (!raw) return { players: [], matches: [], settings: {} };
      const data = JSON.parse(raw);
      return {
        players: Array.isArray(data.players) ? data.players : [],
        matches: Array.isArray(data.matches) ? data.matches : [],
        settings: data.settings && typeof data.settings === "object" ? data.settings : {},
      };
    } catch {
      return { players: [], matches: [], settings: {} };
    }
  }

  function save(db, opts = {}) {
    if (!db.settings || typeof db.settings !== "object") db.settings = {};
    if (!opts.skipTouch) {
      db.settings.contentUpdatedAt = new Date().toISOString();
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    if (!opts.skipSync && window.SnapszliSync?.isEnabled() && window.SnapszliSync.canWrite()) {
      const payload = buildBackupPayload(db);
      payload.deviceId = window.SnapszliSync.getDeviceId();
      window.SnapszliSync.push(payload).catch(() => {});
    }
  }

  function getDb() {
    const db = load();
    if (migrateDbFlags(db)) save(db, { skipTouch: true });
    return db;
  }

  function getSkippedSeeds() {
    try {
      const skipped = JSON.parse(localStorage.getItem(SKIPPED_SEEDS_KEY) || "[]");
      return Array.isArray(skipped) ? skipped : [];
    } catch {
      return [];
    }
  }

  function setSkippedSeeds(ids) {
    localStorage.setItem(SKIPPED_SEEDS_KEY, JSON.stringify(ids || []));
  }

  function formatBackupWhen(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    try {
      return d.toLocaleString("fr-CH", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso.slice(0, 16).replace("T", " ");
    }
  }

  function needsBackupReminder(db) {
    const last = db.settings?.lastBackupAt;
    const updated = db.settings?.contentUpdatedAt;
    if (!last) return true;
    if (updated && updated > last) return true;
    const age = Date.now() - Date.parse(last);
    if (!Number.isNaN(age) && age > 14 * 864e5) return true;
    return false;
  }

  function buildBackupPayload(db) {
    const exportedAt = new Date().toISOString();
    return {
      kind: "snapszli-backup",
      version: 1,
      exportedAt,
      players: db.players || [],
      matches: db.matches || [],
      settings: { ...(db.settings || {}), lastBackupAt: exportedAt, contentUpdatedAt: exportedAt },
      skippedSeeds: getSkippedSeeds(),
    };
  }

  function backupContentTs(payload) {
    return payload?.settings?.contentUpdatedAt || payload?.exportedAt || "";
  }

  function mergeDevicePayloads(payloads) {
    const valid = (payloads || []).filter((p) => p && p.kind === "snapszli-backup");
    if (!valid.length) return null;
    const sorted = valid.slice().sort((a, b) => backupContentTs(a).localeCompare(backupContentTs(b)));

    const playersByName = new Map();
    const idToCanonical = new Map();

    function mapPlayer(player) {
      const name = String(player.name || "").trim();
      if (!name) return;
      if (!playersByName.has(name)) {
        const p = { ...player, name, archived: !!player.archived };
        playersByName.set(name, p);
        idToCanonical.set(player.id, p.id);
        return;
      }
      const existing = playersByName.get(name);
      idToCanonical.set(player.id, existing.id);
      if (!player.archived) existing.archived = false;
    }

    for (const payload of sorted) {
      for (const player of payload.players || []) mapPlayer(player);
    }

    function remapId(id) {
      return idToCanonical.get(id) || id;
    }

    function remapMatch(match) {
      const m = { ...match };
      m.playerA = remapId(m.playerA);
      m.playerB = remapId(m.playerB);
      if (Array.isArray(m.sets)) {
        m.sets = m.sets.map((s) => ({
          ...s,
          rounds: (s.rounds || []).map((r) => ({
            ...r,
            winnerId: remapId(r.winnerId),
            loserId: remapId(r.loserId),
            marriages: (r.marriages || []).map((mar) => ({
              ...mar,
              playerId: remapId(mar.playerId),
            })),
          })),
        }));
      }
      return m;
    }

    const matchesById = new Map();
    for (const payload of sorted) {
      for (const match of payload.matches || []) {
        matchesById.set(match.id, remapMatch(match));
      }
    }

    const settings = {};
    let skippedSeeds = [];
    for (const payload of sorted) {
      if (payload.settings && typeof payload.settings === "object") Object.assign(settings, payload.settings);
      if (Array.isArray(payload.skippedSeeds)) {
        skippedSeeds = [...new Set([...skippedSeeds, ...payload.skippedSeeds])];
      }
    }

    return {
      kind: "snapszli-backup",
      version: 1,
      exportedAt: sorted[sorted.length - 1]?.exportedAt || new Date().toISOString(),
      players: [...playersByName.values()],
      matches: [...matchesById.values()],
      settings,
      skippedSeeds,
    };
  }

  async function exportBackup(db) {
    const payload = buildBackupPayload(db);
    db.settings = payload.settings;
    save(db, { skipTouch: true });

    const text = JSON.stringify(payload, null, 2);
    const name = `snapszli-backup-${payload.exportedAt.slice(0, 10)}.json`;
    const file = new File([text], name, { type: "application/json" });

    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "Snapszli",
          text: "Sauvegarde Snapszli",
        });
        go("home");
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") {
        go("home");
        return;
      }
      /* fall through to download */
    }

    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    go("home");
  }

  function applyBackupPayload(payload, opts = {}) {
    if (!payload || payload.kind !== "snapszli-backup") {
      throw new Error("Fichier non reconnu (attendu: sauvegarde Snapszli).");
    }
    if (!Array.isArray(payload.players) || !Array.isArray(payload.matches)) {
      throw new Error("Sauvegarde incomplète (joueurs / parties manquants).");
    }
    const db = {
      players: payload.players,
      matches: payload.matches,
      settings: payload.settings && typeof payload.settings === "object" ? payload.settings : {},
    };
    migrateDbFlags(db);
    const now = new Date().toISOString();
    db.settings.lastBackupAt = payload.exportedAt || db.settings.lastBackupAt || now;
    db.settings.contentUpdatedAt = db.settings.lastBackupAt;
    if (Array.isArray(payload.skippedSeeds)) setSkippedSeeds(payload.skippedSeeds);
    save(db, { skipTouch: true, skipSync: !!opts.skipSync });
    return db;
  }

  function importBackupFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const payload = JSON.parse(String(reader.result || ""));
          applyBackupPayload(payload);
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
      reader.readAsText(file);
    });
  }

  function playerName(db, id) {
    return db.players.find((p) => p.id === id)?.name || "?";
  }

  /** Exact trimmed name → existing player id, or create. User owns uniqueness. */
  function ensurePlayerByName(db, rawName) {
    const name = String(rawName || "").trim();
    if (!name) return null;
    const existing = db.players.find((p) => p.name === name);
    if (existing) {
      existing.archived = false;
      return existing.id;
    }
    const id = uid();
    db.players.push({ id, name, archived: false });
    return id;
  }

  function marriageValue(suit, trumpSuit) {
    return Suit.normalize(suit) === Suit.normalize(trumpSuit) ? 40 : 20;
  }

  function sumMarriages(marriages, playerId, trumpSuit) {
    return marriages
      .filter((m) => m.playerId === playerId)
      .reduce((s, m) => s + marriageValue(m.suit, trumpSuit), 0);
  }

  function jeuxFromLoserTotal(loserTotal) {
    if (loserTotal <= 0) return 3;
    if (loserTotal < 33) return 2;
    return 1;
  }

  function deriveRound(round) {
    const loserFixed = Number(round.loserFixed) || 0;
    const leftOut = Number(round.leftOut) || 0;
    const winnerFixed = 120 - loserFixed - leftOut;
    const loserMarriages = sumMarriages(round.marriages || [], round.loserId, round.trumpSuit);
    const winnerMarriages = sumMarriages(round.marriages || [], round.winnerId, round.trumpSuit);
    const loserTotal = loserFixed + loserMarriages;
    const winnerTotal = winnerFixed + winnerMarriages;
    const jeux = round.pariPerdu ? 3 : jeuxFromLoserTotal(loserTotal);
    return { loserFixed, leftOut, winnerFixed, loserMarriages, winnerMarriages, loserTotal, winnerTotal, jeux };
  }

  function setWon(jeuxA, jeuxB) {
    if (jeuxA >= 7 && jeuxA - jeuxB >= 2) return "A";
    if (jeuxB >= 7 && jeuxB - jeuxA >= 2) return "B";
    return null;
  }

  function activeSet(match) {
    if (!match.sets.length) {
      match.sets.push({ jeuxA: 0, jeuxB: 0, winner: null, rounds: [] });
    }
    return match.sets[match.sets.length - 1];
  }

  function emptyDraft(match) {
    return {
      trumpSuit: null,
      winnerId: null,
      marriages: {}, // suit -> playerId
      pariPerdu: false,
      loserFixed: 0,
      leftOut: 0,
      editRoundId: null,
    };
  }

  function roundToDraft(round) {
    const marriages = {};
    (round.marriages || []).forEach((m) => {
      marriages[Suit.normalize(m.suit)] = m.playerId;
    });
    return {
      trumpSuit: Suit.normalize(round.trumpSuit),
      winnerId: round.winnerId,
      marriages,
      pariPerdu: !!round.pariPerdu,
      loserFixed: Number(round.loserFixed) || 0,
      leftOut: Number(round.leftOut) || 0,
      editRoundId: round.id,
    };
  }

  function flattenRounds(match) {
    const list = [];
    match.sets.forEach((s) => {
      (s.rounds || []).forEach((r) => list.push(r));
    });
    return list;
  }

  function replaceRoundAndRebuild(match, roundId, newRound) {
    const list = flattenRounds(match).map((r) => (r.id === roundId ? newRound : r));
    match.sets = [];
    match.setsA = 0;
    match.setsB = 0;
    match.status = "active";
    match.endedAt = null;
    match.sets.push({ jeuxA: 0, jeuxB: 0, winner: null, rounds: [] });
    list.forEach((r) => applyRound(match, r, true));
  }

  function go(view, params = {}) {
    state.view = view;
    state.params = params;
    if (view !== "round") state.draft = null;
    render();
  }

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function draftWinnerFixed(draft) {
    return Math.max(0, 120 - (Number(draft.loserFixed) || 0) - (Number(draft.leftOut) || 0));
  }

  function setDraftFixedPair(draft, loserFixed, winnerFixed) {
    draft.loserFixed = clampInt(loserFixed, 0, 120);
    const wf = clampInt(winnerFixed, 0, 120);
    draft.leftOut = Math.max(0, 120 - draft.loserFixed - wf);
  }

  function attachClearZeroInput(input, getValue, setValue, onAfter) {
    const refresh = () => {
      const v = getValue();
      if (document.activeElement !== input) input.value = String(v);
    };
    input.addEventListener("focus", () => {
      if (input.value === "0") input.value = "";
    });
    input.addEventListener("blur", () => {
      const raw = input.value.trim();
      setValue(raw === "" ? 0 : clampInt(raw, 0, 120));
      input.value = String(getValue());
      onAfter?.();
    });
    input.addEventListener("input", () => {
      const raw = input.value.trim();
      if (raw === "" || raw === "-") return;
      setValue(clampInt(raw, 0, 120));
    });
    refresh();
  }

  /* ---------- Views ---------- */

  function isUnfinishedMatch(m) {
    return m.status === "open" || m.status === "active";
  }

  function viewHome(db) {
    const active = db.matches.find((m) => m.status === "active");
    const openCount = db.matches.filter(isUnfinishedMatch).length;
    const g = globalMancheStats(db);
    const root = el(`<div>
      <div class="top"><h1 class="brand">Snapszli</h1></div>
      <div class="stack"></div>
    </div>`);
    const stack = root.querySelector(".stack");
    if (window.SnapszliSync?.isEnabled()) {
      const build = SnapszliSync.getBuild();
      const parties = db.matches?.length || 0;
      const lastErr = SnapszliSync.getLastError();
      if (SnapszliSync.canWrite()) {
        const id = SnapszliSync.getDeviceId().slice(0, 8);
        stack.append(el(`<p class="hint" style="margin-bottom:4px">Sync Git ${escapeHtml(build)} · appareil ${escapeHtml(id)} · ${parties} parties</p>`));
        if (lastErr) {
          stack.append(el(`<p class="hint" style="margin-bottom:4px;color:#b33">Dernière erreur sync : ${escapeHtml(lastErr)}</p>`));
        }
      } else {
        appendTokenForm(stack, build);
      }
    }
    if (active) {
      stack.append(
        btn("Reprendre la partie", () => go("live", { id: active.id })),
        btn("Nouvelle partie", () => go("newMatch"), "secondary"),
      );
    } else {
      stack.append(btn("Nouvelle partie", () => go("newMatch")));
    }
    stack.append(
      btn(
        openCount ? `Parties ouvertes (${openCount})` : "Parties ouvertes",
        () => go("openMatches"),
        "secondary",
      ),
      btn("Joueurs", () => go("players"), "secondary"),
      btn("Historique", () => go("history"), "secondary"),
    );

    if (window.SnapszliSync?.isEnabled()) {
      const syncActions = el(`<div class="backup-actions" style="margin-top:12px"></div>`);
      const actions = syncActions;
      if (SnapszliSync.canWrite()) {
        actions.append(btn("Synchroniser", () => {
          refreshCloudSync()
            .then((info) => alert(`Synchronisation OK — ${info.parties} parties (${info.kb} Ko).`))
            .catch((e) => {
              SnapszliSync.setLastError(e.message || String(e));
              alert(syncErrorMessage(e));
              go("home");
            });
        }, "secondary"));
        actions.append(btn("Changer le jeton", () => {
          SnapszliSync.clearToken();
          go("home");
        }, "secondary"));
      }
      stack.append(syncActions);
    }

    const suitCells = SUITS.map((s) => {
      const pct = g.hasDetail ? `${g.atoutPct[s.id]}%` : "N/A";
      return `<div class="home-metric">
        <span class="home-metric-ico">${s.svg()}</span>
        <span class="home-metric-val">${pct}</span>
      </div>`;
    }).join("");

    const panel = el(`<div class="home-stats">
      <label class="toggle-row card">
        <span class="toggle-label">Prendre en compte les points artificiels</span>
        <input type="checkbox" id="home-art-pts" ${g.includeArtificialPoints ? "checked" : ""} />
      </label>
      <div class="card home-stats-card">
        <div class="stat-line home-manches-line">
          <span class="muted">Manches jouées</span>
          <strong>${g.manchesTotal}</strong>
        </div>
        <div class="home-atout-grid">${suitCells}</div>
        <div class="home-marriage-row">
          <div class="home-metric">
            <span class="muted home-metric-lab">Atout</span>
            <span class="home-metric-val">${g.hasDetail ? `${g.marriageAtoutPct}%` : "N/A"}</span>
          </div>
          <div class="home-metric">
            <span class="muted home-metric-lab">Simple</span>
            <span class="home-metric-val">${g.hasDetail ? `${g.marriageSimplePct}%` : "N/A"}</span>
          </div>
        </div>
      </div>
    </div>`);
    panel.querySelector("#home-art-pts").onchange = (ev) => {
      if (!db.settings) db.settings = {};
      db.settings.homeIncludeArtificialPoints = !!ev.target.checked;
      save(db);
      go("home");
    };
    stack.append(panel);
    return root;
  }

  async function ensureSeedMatches(db) {
    const skipped = getSkippedSeeds();
    let seedFiles = [];
    try {
      const man = await fetch("seeds/manifest.json", { cache: "no-store" });
      if (man.ok) {
        const m = await man.json();
        seedFiles = [...(m.fayeTom || []), ...(m.extra || [])];
      }
    } catch {
      /* fall through */
    }
    if (!seedFiles.length) {
      for (let n = 1; n <= 24; n++) seedFiles.push(`faye-tom-${n}.json`);
    }
    let changed = false;
    for (const file of seedFiles) {
      const url = file.startsWith("seeds/") ? file : `seeds/${file}`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const payload = await res.json();
        const id = payload.match?.id;
        if (!id || skipped.includes(id) || db.matches.some((m) => m.id === id)) continue;
        mergeSeedPayload(db, payload);
        changed = true;
      } catch {
        /* offline / file open — skip */
      }
    }
    if (changed) save(db);
  }

  function rememberSkippedSeed(matchId) {
    if (!matchId) return;
    const skipped = getSkippedSeeds();
    if (!skipped.includes(matchId)) {
      skipped.push(matchId);
      setSkippedSeeds(skipped);
    }
  }

  function mergeSeedPayload(db, payload) {
    const idMap = {};
    (payload.players || []).forEach((p) => {
      idMap[p.id] = ensurePlayerByName(db, p.name);
    });
    const src = payload.match;
    if (!src) throw new Error("Pas de match dans le seed");
    const existing = db.matches.find((m) => m.id === src.id);
    if (existing) {
      return { message: "already", match: existing };
    }
    const mapId = (id) => idMap[id] || id;
    const remappedRounds = [];
    (src.sets || []).forEach((s) => {
      (s.rounds || []).forEach((r) => {
        remappedRounds.push({
          ...r,
          id: r.id || uid(),
          winnerId: mapId(r.winnerId),
          loserId: mapId(r.loserId),
          marriages: (r.marriages || []).map((m) => ({
            ...m,
            playerId: mapId(m.playerId),
            suit: Suit.normalize(m.suit),
          })),
          trumpSuit: Suit.normalize(r.trumpSuit),
        });
      });
    });
    const match = {
      id: src.id || uid(),
      playerA: mapId(src.playerA),
      playerB: mapId(src.playerB),
      startedAt: src.startedAt || new Date().toISOString(),
      endedAt: src.endedAt || null,
      setsA: 0,
      setsB: 0,
      status: "active",
      sets: [{ jeuxA: 0, jeuxB: 0, winner: null, rounds: [] }],
      source: src.source || "seed",
      label: payload.label || null,
      pointsArtificial: false,
    };
    remappedRounds.forEach((r) => applyRound(match, r, true));
    if (src.status === "open" || src.status === "done" || src.status === "abandoned") {
      match.status = src.status;
    }
    if (src.status === "open") {
      match.endedAt = null;
      // Open seeds finished later by play → points treated as canonical
      match.pointsArtificial = false;
    } else if (src.status === "done") {
      if (src.endedAt) match.endedAt = src.endedAt;
      // Done seeds: jeux/manches canonical; points/mariages/pari synthetiques
      match.pointsArtificial = true;
    } else if (src.endedAt) {
      match.endedAt = src.endedAt;
    }
    db.matches.unshift(match);
    return { message: "ok", match };
  }

  function viewPlayers(db) {
    const root = el(`<div>
      <div class="top">
        <button class="back" type="button" aria-label="Retour">←</button>
        <h1 class="brand" style="font-size:1.35rem">Joueurs</h1>
      </div>
      <div class="list" id="player-list"></div>
    </div>`);
    root.querySelector(".back").onclick = () => go("home");
    const list = root.querySelector("#player-list");
    const active = db.players.filter((p) => !p.archived);
    if (!active.length) {
      list.append(el(`<div class="empty">Aucun joueur pour l’instant.</div>`));
    } else {
      active.forEach((p) => {
        const s = playerStatsFor(db, p.id);
        const item = el(`<button class="list-item player-row" type="button">
          <strong class="player-row-name">${escapeHtml(p.name)}</strong>
          <span class="player-row-stats">
            <span class="player-row-main">${s.matches} · <span class="stat-ok">${s.wins}V</span> · <span class="stat-bad">${s.defeats}D</span></span>
            <span class="muted player-row-sub">${s.winPct}% · ${s.avgSets} sets</span>
          </span>
        </button>`);
        item.onclick = () => go("playerStats", { id: p.id });
        list.append(item);
      });
    }
    return root;
  }

  function viewNewMatch(db) {
    const playerNames = db.players
      .filter((p) => !p.archived)
      .map((p) => p.name)
      .sort((a, b) => a.localeCompare(b, "fr"));
    const datalistOpts = playerNames
      .map((n) => `<option value="${escapeHtml(n)}"></option>`)
      .join("");
    const root = el(`<div>
      <div class="top">
        <button class="back" type="button">←</button>
        <h1 class="brand" style="font-size:1.35rem">Nouvelle partie</h1>
      </div>
      <div class="card">
        <datalist id="player-names">${datalistOpts}</datalist>
        <div class="field">
          <label for="player-1">Player 1</label>
          <input id="player-1" list="player-names" placeholder="Nom" autocomplete="off" autocorrect="off" />
        </div>
        <div class="field">
          <label for="player-2">Player 2</label>
          <input id="player-2" list="player-names" placeholder="Nom" autocomplete="off" autocorrect="off" />
        </div>
      </div>
      <div style="margin-top:14px">
        <button class="btn" type="button" id="start" disabled>Démarrer</button>
      </div>
    </div>`);
    root.querySelector(".back").onclick = () => go("home");
    const i1 = root.querySelector("#player-1");
    const i2 = root.querySelector("#player-2");
    const start = root.querySelector("#start");

    function refreshStart() {
      const a = i1.value.trim();
      const b = i2.value.trim();
      start.disabled = !a || !b || a === b;
    }
    i1.oninput = i2.oninput = refreshStart;

    start.onclick = () => {
      const nameA = i1.value.trim();
      const nameB = i2.value.trim();
      if (!nameA || !nameB || nameA === nameB) return;
      const a = ensurePlayerByName(db, nameA);
      const b = ensurePlayerByName(db, nameB);
      const match = {
        id: uid(),
        playerA: a,
        playerB: b,
        startedAt: new Date().toISOString(),
        endedAt: null,
        setsA: 0,
        setsB: 0,
        status: "active",
        sets: [{ jeuxA: 0, jeuxB: 0, winner: null, rounds: [] }],
        source: "live",
        pointsArtificial: false,
      };
      db.matches.forEach((m) => {
        if (m.status === "active") m.status = "abandoned";
      });
      db.matches.unshift(match);
      save(db);
      go("live", { id: match.id });
    };
    return root;
  }

  function viewLive(db) {
    const match = db.matches.find((m) => m.id === state.params.id);
    if (!match) return viewHome(db);
    const nameA = playerName(db, match.playerA);
    const nameB = playerName(db, match.playerB);
    const done = match.status === "done";
    const canPlay = match.status === "active" || match.status === "open";
    const badge =
      match.status === "done"
        ? "Terminée"
        : match.status === "open"
          ? "Ouverte"
          : match.status === "abandoned"
            ? "Abandonnée"
            : "En cours";

    const root = el(`<div>
      <div class="top">
        <button class="back" type="button">←</button>
        <h1 class="brand" style="font-size:1.35rem">Partie</h1>
        <span class="spacer"></span>
        <span class="badge ${done ? "done" : ""}">${badge}</span>
      </div>
      <div class="score-table-wrap" id="tennis"></div>
      <div class="stack" style="margin-top:12px" id="actions"></div>
      <div class="card" style="margin-top:12px">
        <h3>Manches</h3>
        <div class="list" id="rounds"></div>
      </div>
    </div>`);

    root.querySelector(".back").onclick = () => go("home");

    // Tennis scoreboard: bordered table — name | jeux… ; bold = higher in that set
    const board = root.querySelector("#tennis");
    const sets = match.sets || [];
    const table = document.createElement("table");
    table.className = "score-table";

    function appendRow(name, side) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.className = "score-name";
      th.textContent = name;
      tr.appendChild(th);
      sets.forEach((s) => {
        const td = document.createElement("td");
        td.className = "score-jeux";
        const mine = side === "A" ? s.jeuxA : s.jeuxB;
        const theirs = side === "A" ? s.jeuxB : s.jeuxA;
        td.textContent = String(mine);
        if (mine > theirs) td.classList.add("lead");
        tr.appendChild(td);
      });
      table.appendChild(tr);
    }

    appendRow(nameA, "A");
    appendRow(nameB, "B");
    board.replaceChildren(table);

    const actions = root.querySelector("#actions");
    if (canPlay) {
      actions.append(btn("Nouvelle manche", () => {
        state.draft = emptyDraft(match);
        go("round", { id: match.id });
      }));
    } else {
      actions.append(btn("Retour accueil", () => go("home"), "secondary"));
    }

    const roundsEl = root.querySelector("#rounds");
    const all = flattenRounds(match).slice().reverse();
    if (!all.length) {
      roundsEl.append(el(`<div class="empty">Pas encore de manche.</div>`));
    } else {
      all.forEach((r) => {
        const d = deriveRound(r);
        const wName = playerName(db, r.winnerId);
        const item = el(`<button class="list-item" type="button" style="flex-direction:column;align-items:flex-start">
          <strong>+${d.jeux} jeu(x) → ${escapeHtml(wName)}</strong>
          <span class="muted">Atout <span class="suit-inline">${Suit.icon(r.trumpSuit)}</span> · perdu ${d.loserTotal} pts${r.pariPerdu ? " · pari perdu" : ""} · modifier</span>
        </button>`);
        item.onclick = () => {
          state.draft = roundToDraft(r);
          go("round", { id: match.id, editRoundId: r.id });
        };
        roundsEl.append(item);
      });
    }
    return root;
  }

  function rebuildMatchFromRounds(match) {
    const allRounds = flattenRounds(match);
    match.sets = [];
    match.setsA = 0;
    match.setsB = 0;
    match.status = "active";
    match.endedAt = null;
    match.sets.push({ jeuxA: 0, jeuxB: 0, winner: null, rounds: [] });
    allRounds.forEach((round) => applyRound(match, round, true));
  }

  function applyRound(match, round, pushToCurrent = true) {
    const d = deriveRound(round);
    let set = activeSet(match);
    if (pushToCurrent) set.rounds.push(round);

    if (round.winnerId === match.playerA) set.jeuxA += d.jeux;
    else set.jeuxB += d.jeux;

    const winnerSide = setWon(set.jeuxA, set.jeuxB);
    if (winnerSide) {
      set.winner = winnerSide;
      if (winnerSide === "A") match.setsA += 1;
      else match.setsB += 1;
      if (match.setsA >= 3 || match.setsB >= 3) {
        const wasInPlay = match.status === "open" || match.status === "active";
        match.status = "done";
        match.endedAt = new Date().toISOString();
        if (wasInPlay) match.pointsArtificial = false;
      } else {
        match.sets.push({ jeuxA: 0, jeuxB: 0, winner: null, rounds: [] });
      }
    }
  }

  function viewRound(db) {
    const match = db.matches.find((m) => m.id === state.params.id);
    if (!match) return viewHome(db);
    if (!state.draft) state.draft = emptyDraft(match);
    const editing = !!state.draft.editRoundId;
    if (match.status === "done" && !editing) return viewLive(db);
    if (match.status === "abandoned" && !editing) return viewLive(db);

    const draft = state.draft;
    const nameA = playerName(db, match.playerA);
    const nameB = playerName(db, match.playerB);
    const loserId = draft.winnerId
      ? draft.winnerId === match.playerA
        ? match.playerB
        : match.playerA
      : null;

    // Build preview round for summary
    const previewRound = draftToRound(draft, match, loserId);
    const derived = draft.trumpSuit && draft.winnerId
      ? deriveRound(previewRound)
      : null;

    const root = el(`<div>
      <div class="top">
        <button class="back" type="button">←</button>
        <h1 class="brand" style="font-size:1.35rem">${editing ? "Modifier manche" : "Manche"}</h1>
      </div>
      <div id="round-body"></div>
    </div>`);
    root.querySelector(".back").onclick = () => go("live", { id: match.id });

    const body = root.querySelector("#round-body");

    // 1 Trump
    body.append(el(`<div class="step-title">1. Atout</div>`));
    const suits = el(`<div class="suit-row"></div>`);
    SUITS.forEach((s) => {
      const b = el(`<button type="button" class="suit-btn${draft.trumpSuit === s.id ? " selected" : ""}" aria-label="${s.label}"></button>`);
      b.innerHTML = s.svg();
      b.onclick = () => {
        draft.trumpSuit = s.id;
        render();
      };
      suits.append(b);
    });
    body.append(suits);

    // 2 Winner
    body.append(el(`<div class="step-title" style="margin-top:16px">2. Gagnant</div>`));
    const winners = el(`<div class="row"></div>`);
    [
      { id: match.playerA, name: nameA },
      { id: match.playerB, name: nameB },
    ].forEach((p) => {
      const b = btn(p.name, () => {
        draft.winnerId = p.id;
        draft.pariPerdu = false;
        render();
      }, draft.winnerId === p.id ? "" : "secondary");
      if (draft.winnerId === p.id) b.classList.add("selected");
      winners.append(b);
    });
    body.append(winners);

    // 3 Grid
    body.append(el(`<div class="step-title" style="margin-top:16px">3. Mariages & pari perdu</div>`));
    const gridCard = el(`<div class="card grid-wrap"><table class="marriage-grid">
      <thead><tr><th></th><th>${escapeHtml(nameA)}</th><th>${escapeHtml(nameB)}</th></tr></thead>
      <tbody></tbody>
    </table></div>`);
    const tbody = gridCard.querySelector("tbody");

    SUITS.forEach((s) => {
      const tr = el(`<tr><th class="suit-th"></th></tr>`);
      tr.querySelector("th").innerHTML = s.svg();
      [match.playerA, match.playerB].forEach((pid) => {
        const td = document.createElement("td");
        const on = draft.marriages[s.id] === pid;
        const b = el(`<button type="button" class="cell-btn${on ? " on" : ""}">${on ? "●" : "○"}</button>`);
        b.onclick = () => {
          if (draft.marriages[s.id] === pid) delete draft.marriages[s.id];
          else draft.marriages[s.id] = pid;
          render();
        };
        td.append(b);
        tr.append(td);
      });
      tbody.append(tr);
    });

    // pari perdu row
    const trP = el(`<tr><th>pari perdu</th></tr>`);
    [match.playerA, match.playerB].forEach((pid) => {
      const td = document.createElement("td");
      const isLoser = loserId === pid;
      if (!draft.winnerId || !isLoser) {
        td.append(el(`<button type="button" class="cell-btn" disabled>—</button>`));
      } else {
        const on = draft.pariPerdu;
        const b = el(`<button type="button" class="cell-btn${on ? " on" : ""}">${on ? "●" : "○"}</button>`);
        b.onclick = () => {
          draft.pariPerdu = !draft.pariPerdu;
          render();
        };
        td.append(b);
      }
      trP.append(td);
    });
    tbody.append(trP);
    body.append(gridCard);

    // 4 Numbers
    body.append(el(`<div class="step-title" style="margin-top:16px">4. Points fixes</div>`));
    const nums = el(`<div class="num-row">
      <div class="field">
        <label>Fixes du perdant</label>
        <input type="number" inputmode="numeric" min="0" max="120" id="loser-fixed" />
      </div>
      <div class="field">
        <label>Fixes du gagnant</label>
        <input type="number" inputmode="numeric" min="0" max="120" id="winner-fixed" />
      </div>
    </div>`);
    const lf = nums.querySelector("#loser-fixed");
    const wf = nums.querySelector("#winner-fixed");
    attachClearZeroInput(
      lf,
      () => draft.loserFixed,
      (v) => setDraftFixedPair(draft, v, draftWinnerFixed(draft)),
      render,
    );
    attachClearZeroInput(
      wf,
      () => draftWinnerFixed(draft),
      (v) => setDraftFixedPair(draft, draft.loserFixed, v),
      render,
    );
    body.append(nums);

    // Summary + confirm
    if (derived) {
      const sum = el(`<div class="summary">
        <div><span class="muted">Fixes gagnant</span><strong>${derived.winnerFixed}</strong></div>
        <div><span class="muted">Total perdant</span><strong>${derived.loserTotal}</strong></div>
        <div class="full"><span class="muted">Jeux cette manche</span><strong>+${derived.jeux}${draft.pariPerdu ? " (pari perdu)" : ""}</strong></div>
      </div>`);
      body.append(sum);
    }

    const canConfirm = !!(draft.trumpSuit && draft.winnerId);

    const confirm = btn(editing ? "Enregistrer" : "Valider la manche", () => {
      draft.loserFixed = clampInt(lf.value, 0, 120);
      const winnerFixed = clampInt(wf.value, 0, 120);
      setDraftFixedPair(draft, draft.loserFixed, winnerFixed);
      if (draft.loserFixed + winnerFixed > 120) {
        alert("Fixes perdant + gagnant ne peuvent pas dépasser 120.");
        return;
      }
      const loser = draft.winnerId === match.playerA ? match.playerB : match.playerA;
      const round = draftToRound(draft, match, loser);
      if (editing) replaceRoundAndRebuild(match, draft.editRoundId, round);
      else applyRound(match, round, true);
      save(db);
      state.draft = null;
      go("live", { id: match.id });
    });
    confirm.disabled = !canConfirm;
    body.append(confirm);

    return root;
  }

  function draftToRound(draft, match, loserId) {
    const marriages = Object.entries(draft.marriages || {}).map(([suit, playerId]) => ({
      suit: Suit.normalize(suit),
      playerId,
    }));
    return {
      id: draft.editRoundId || uid(),
      trumpSuit: Suit.normalize(draft.trumpSuit),
      winnerId: draft.winnerId,
      loserId: loserId || (draft.winnerId === match.playerA ? match.playerB : match.playerA),
      marriages,
      pariPerdu: !!draft.pariPerdu,
      loserFixed: Number(draft.loserFixed) || 0,
      leftOut: Number(draft.leftOut) || 0,
    };
  }

  function clampInt(v, min, max) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function matchHasArtificialPoints(m) {
    return m.pointsArtificial === true;
  }

  function migrateDbFlags(db) {
    let changed = false;
    if (!db.settings || typeof db.settings !== "object") {
      db.settings = {};
      changed = true;
    }
    if (typeof db.settings.homeIncludeArtificialPoints !== "boolean") {
      db.settings.homeIncludeArtificialPoints = true;
      changed = true;
    }
    if (!db.settings.contentUpdatedAt) {
      db.settings.contentUpdatedAt = new Date().toISOString();
      changed = true;
    }
    db.players.forEach((p) => {
      if (typeof p.includeArtificialPoints !== "boolean") {
        p.includeArtificialPoints = true;
        changed = true;
      }
    });
    db.matches.forEach((m) => {
      if (typeof m.pointsArtificial === "boolean") return;
      const seeded = m.source && m.source !== "live";
      m.pointsArtificial = !!(seeded && m.status === "done");
      changed = true;
    });
    return changed;
  }

  /** Home panel: done parties only (like player stats). Atout/mariage gated by home toggle. */
  function globalMancheStats(db) {
    const includeArt =
      !db.settings || db.settings.homeIncludeArtificialPoints !== false;
    let manchesTotal = 0;
    let detailN = 0;
    const atout = { coeur: 0, grelot: 0, feuille: 0, gland: 0 };
    let marriageAtout = 0;
    let marriageSimple = 0;

    db.matches.forEach((m) => {
      if (m.status !== "done") return;
      const countDetail = includeArt || !matchHasArtificialPoints(m);
      (m.sets || []).forEach((s) => {
        (s.rounds || []).forEach((r) => {
          manchesTotal += 1;
          if (!countDetail) return;
          detailN += 1;
          const trump = Suit.normalize(r.trumpSuit);
          if (atout[trump] !== undefined) atout[trump] += 1;
          const mars = r.marriages || [];
          if (mars.some((x) => Suit.normalize(x.suit) === trump)) marriageAtout += 1;
          if (mars.some((x) => Suit.normalize(x.suit) !== trump)) marriageSimple += 1;
        });
      });
    });

    const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
    return {
      includeArtificialPoints: includeArt,
      manchesTotal,
      hasDetail: detailN > 0,
      atoutPct: {
        coeur: pct(atout.coeur, detailN),
        grelot: pct(atout.grelot, detailN),
        feuille: pct(atout.feuille, detailN),
        gland: pct(atout.gland, detailN),
      },
      marriageAtoutPct: pct(marriageAtout, detailN),
      marriageSimplePct: pct(marriageSimple, detailN),
    };
  }

  function playerStatsFor(db, playerId) {
    const p = db.players.find((x) => x.id === playerId);
    if (!p) return null;

    const includeArtPts = p.includeArtificialPoints !== false;

    let matches = 0;
    let wins = 0;
    let setsPlayed = 0;
    let roundsPlayed = 0;
    let roundsWon = 0;
    let roundsLost = 0;
    const jeuxWon = { 1: 0, 2: 0, 3: 0 };
    const jeuxLost = { 1: 0, 2: 0, 3: 0 };

    let ptsRoundsPlayed = 0;
    let ptsRoundsWon = 0;
    let ptsRoundsLost = 0;
    let pointsWonSum = 0;
    let pointsLostSum = 0;
    let roundsWithAtoutMarriage = 0;
    let roundsWithSimpleMarriage = 0;
    let pariPerduLost = 0;

    db.matches.forEach((m) => {
      if (m.status !== "done") return;
      if (m.playerA !== playerId && m.playerB !== playerId) return;
      matches += 1;
      const winner = m.setsA > m.setsB ? m.playerA : m.playerB;
      if (winner === playerId) wins += 1;

      const countPoints = includeArtPts || !matchHasArtificialPoints(m);

      (m.sets || []).forEach((s) => {
        const rounds = s.rounds || [];
        if (!rounds.length && !s.jeuxA && !s.jeuxB) return;
        setsPlayed += 1;
        rounds.forEach((r) => {
          roundsPlayed += 1;
          const d = deriveRound(r);
          const won = r.winnerId === playerId;
          const jeux = Math.min(3, Math.max(1, d.jeux || 1));

          if (won) {
            roundsWon += 1;
            jeuxWon[jeux] += 1;
          } else {
            roundsLost += 1;
            jeuxLost[jeux] += 1;
          }

          if (!countPoints) return;
          ptsRoundsPlayed += 1;
          const ownMarriages = (r.marriages || []).filter((x) => x.playerId === playerId);
          const trump = Suit.normalize(r.trumpSuit);
          if (ownMarriages.some((x) => Suit.normalize(x.suit) === trump)) {
            roundsWithAtoutMarriage += 1;
          }
          if (ownMarriages.some((x) => Suit.normalize(x.suit) !== trump)) {
            roundsWithSimpleMarriage += 1;
          }
          if (won) {
            ptsRoundsWon += 1;
            pointsWonSum += d.winnerTotal;
          } else {
            ptsRoundsLost += 1;
            pointsLostSum += d.loserTotal;
            if (r.pariPerdu) pariPerduLost += 1;
          }
        });
      });
    });

    const avg = (sum, n) => (n ? sum / n : 0);
    const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);

    return {
      name: p.name,
      includeArtificialPoints: includeArtPts,
      matches,
      wins,
      defeats: matches - wins,
      winPct: pct(wins, matches),
      avgSets: matches ? Math.round((setsPlayed / matches) * 10) / 10 : 0,
      rounds: { total: roundsPlayed, won: roundsWon, lost: roundsLost },
      roundWinPct: pct(roundsWon, roundsPlayed),
      avgRoundsPerSet: setsPlayed ? Math.round((roundsPlayed / setsPlayed) * 10) / 10 : 0,
      jeuxWon,
      jeuxLost,
      hasPtsWon: ptsRoundsWon > 0,
      hasPtsLost: ptsRoundsLost > 0,
      hasPtsRounds: ptsRoundsPlayed > 0,
      avgPointsWon: Math.round(avg(pointsWonSum, ptsRoundsWon) * 10) / 10,
      avgPointsLost: Math.round(avg(pointsLostSum, ptsRoundsLost) * 10) / 10,
      pctMarriageAtout: pct(roundsWithAtoutMarriage, ptsRoundsPlayed),
      pctMarriageSimple: pct(roundsWithSimpleMarriage, ptsRoundsPlayed),
      pariPerduLost,
      pariPerduLostPct: pct(pariPerduLost, ptsRoundsLost),
    };
  }

  function fmtStat(value, ok) {
    return ok ? String(value) : "N/A";
  }

  function jeuxBarsHtml(title, counts, toneClass) {
    const vals = [counts[3] || 0, counts[2] || 0, counts[1] || 0];
    const total = vals.reduce((a, b) => a + b, 0);
    const max = Math.max(...vals, 1);
    const labels = ["3 jeux", "2 jeux", "1 jeu"];
    const bars = labels
      .map((lab, i) => {
        const h = Math.round((100 * vals[i]) / max);
        const share = total ? Math.round((100 * vals[i]) / total) : 0;
        return `<div class="stat-bar-col">
          <div class="stat-bar-track"><div class="stat-bar-fill ${toneClass}" style="height:${h}%"></div></div>
          <div class="stat-bar-val">${vals[i]} <span class="muted">(${share}%)</span></div>
          <div class="stat-bar-lab muted">${lab}</div>
        </div>`;
      })
      .join("");
    return `<div class="card stat-chart-card">
      <div class="stat-section-title">${escapeHtml(title)}</div>
      <div class="stat-bars">${bars}</div>
    </div>`;
  }

  function viewPlayerStats(db) {
    const player = db.players.find((x) => x.id === state.params.id);
    const s = playerStatsFor(db, state.params.id);
    const root = el(`<div>
      <div class="top">
        <button class="back" type="button">←</button>
        <h1 class="brand" style="font-size:1.35rem">${s ? escapeHtml(s.name) : "Stats"}</h1>
      </div>
      <div id="body" class="stack stats-body"></div>
    </div>`);
    root.querySelector(".back").onclick = () => go("players");
    const body = root.querySelector("#body");
    if (!s || !player) {
      body.append(el(`<div class="empty">Joueur introuvable.</div>`));
      return root;
    }

    const toggle = el(`<label class="toggle-row card">
      <span class="toggle-label">Prendre en compte les points artificiels</span>
      <input type="checkbox" id="art-pts" ${s.includeArtificialPoints ? "checked" : ""} />
    </label>`);
    toggle.querySelector("#art-pts").onchange = (ev) => {
      player.includeArtificialPoints = !!ev.target.checked;
      save(db);
      go("playerStats", { id: player.id });
    };
    body.append(toggle);

    const ptsWon = fmtStat(s.avgPointsWon, s.hasPtsWon);
    const ptsLost = fmtStat(s.avgPointsLost, s.hasPtsLost);
    const marAtout = fmtStat(`${s.pctMarriageAtout}%`, s.hasPtsRounds);
    const marSimple = fmtStat(`${s.pctMarriageSimple}%`, s.hasPtsRounds);
    const pari = s.hasPtsLost
      ? `${s.pariPerduLost} (${s.pariPerduLostPct}%)`
      : "N/A";

    body.append(
      el(`<div>
        <div class="stat-section-title">Parties</div>
        <div class="stat-grid3">
          <div class="stat-tile"><strong>${s.matches}</strong><span class="muted">Total</span></div>
          <div class="stat-tile ok"><strong>${s.wins}</strong><span class="muted">Victoires</span></div>
          <div class="stat-tile bad"><strong>${s.defeats}</strong><span class="muted">Défaites</span></div>
        </div>
        <p class="hint">Taux de victoire ${s.winPct}% · moy. ${s.avgSets} sets / partie</p>
      </div>`),
      el(`<div>
        <div class="stat-section-title">Manches</div>
        <div class="stat-grid3">
          <div class="stat-tile"><strong>${s.rounds.total}</strong><span class="muted">Jouées</span></div>
          <div class="stat-tile"><strong>${s.rounds.won}</strong><span class="muted">Gagnées</span></div>
          <div class="stat-tile"><strong>${s.rounds.lost}</strong><span class="muted">Perdues</span></div>
        </div>
        <p class="hint">Taux de victoire ${s.roundWinPct}% · moy. ${s.avgRoundsPerSet} manches / set</p>
      </div>`),
      el(jeuxBarsHtml("Manches gagnées", s.jeuxWon, "ok")),
      el(jeuxBarsHtml("Manches perdues", s.jeuxLost, "bad")),
      el(`<div>
        <div class="stat-section-title">Moyennes par manche</div>
        <div class="card">
          <div class="stat-line"><span class="muted">Points (manche gagnée)</span><strong>${ptsWon}</strong></div>
          <div class="stat-line"><span class="muted">Points (manche perdue)</span><strong>${ptsLost}</strong></div>
          <div class="stat-line"><span class="muted">Mariages atout</span><strong>${marAtout}</strong></div>
          <div class="stat-line"><span class="muted">Mariages simples</span><strong>${marSimple}</strong></div>
        </div>
      </div>`),
      el(`<div>
        <div class="stat-section-title">Pari perdu</div>
        <div class="card">
          <div class="stat-line"><span class="muted">Manches perdues avec pari perdu</span><strong>${pari}</strong></div>
        </div>
      </div>`),
    );
    return root;
  }

  function appendMatchRows(list, db, matches, listView) {
    matches.forEach((m) => {
      const a = playerName(db, m.playerA);
      const b = playerName(db, m.playerB);
      const date = (m.startedAt || "").slice(0, 10);
      const statusNote =
        m.status === "open" ? " · ouverte" : m.status === "active" ? " · en cours" : "";
      const item = el(`<div class="history-row">
        <button class="list-item history-main" type="button">
          <div style="flex:1;text-align:left">
            <strong>${escapeHtml(a)} vs ${escapeHtml(b)}</strong>
            <div class="muted">${date} · ${m.setsA}–${m.setsB}${statusNote}</div>
          </div>
        </button>
        <button class="btn danger history-del" type="button" aria-label="Supprimer">✕</button>
      </div>`);
      item.querySelector(".history-main").onclick = () => go("live", { id: m.id });
      item.querySelector(".history-del").onclick = (ev) => {
        ev.stopPropagation();
        if (!confirm(`Supprimer ${a} vs ${b} ?`)) return;
        rememberSkippedSeed(m.id);
        db.matches = db.matches.filter((x) => x.id !== m.id);
        save(db);
        go(listView);
      };
      list.append(item);
    });
  }

  function viewHistory(db) {
    const root = el(`<div>
      <div class="top">
        <button class="back" type="button">←</button>
        <h1 class="brand" style="font-size:1.35rem">Historique</h1>
      </div>
      <div class="list" id="list"></div>
    </div>`);
    root.querySelector(".back").onclick = () => go("home");
    const list = root.querySelector("#list");
    if (!db.matches.length) {
      list.append(el(`<div class="empty">Aucune partie.</div>`));
    } else {
      appendMatchRows(list, db, db.matches, "history");
    }
    return root;
  }

  function viewOpenMatches(db) {
    const open = db.matches
      .filter(isUnfinishedMatch)
      .slice()
      .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
    const root = el(`<div>
      <div class="top">
        <button class="back" type="button">←</button>
        <h1 class="brand" style="font-size:1.35rem">Parties ouvertes</h1>
      </div>
      <div class="list" id="list"></div>
    </div>`);
    root.querySelector(".back").onclick = () => go("home");
    const list = root.querySelector("#list");
    if (!open.length) {
      list.append(el(`<div class="empty">Aucune partie ouverte.</div>`));
    } else {
      appendMatchRows(list, db, open, "openMatches");
    }
    return root;
  }

  function viewStats(db) {
    return viewPlayers(db);
  }

  function btn(label, onClick, variant = "") {
    const b = el(`<button class="btn ${variant}" type="button">${escapeHtml(label)}</button>`);
    b.onclick = onClick;
    return b;
  }

  function render() {
    const db = getDb();
    const app = document.getElementById("app");
    let node;
    switch (state.view) {
      case "players":
        node = viewPlayers(db);
        break;
      case "playerStats":
        node = viewPlayerStats(db);
        break;
      case "newMatch":
        node = viewNewMatch(db);
        break;
      case "live":
        node = viewLive(db);
        break;
      case "round":
        node = viewRound(db);
        break;
      case "history":
        node = viewHistory(db);
        break;
      case "openMatches":
        node = viewOpenMatches(db);
        break;
      case "stats":
        node = viewPlayers(db);
        break;
      default:
        node = viewHome(db);
    }
    app.replaceChildren(node);
  }

  let syncRefreshing = false;
  let syncVisibilityBound = false;

  async function pushToCloud() {
    if (!window.SnapszliSync?.canWrite()) {
      throw new Error("Jeton sync manquant — enregistrez le jeton Git d'abord.");
    }
    const db = getDb();
    const parties = db.matches?.length || 0;
    if (!parties) throw new Error("Aucune partie locale à envoyer.");
    const payload = buildBackupPayload(db);
    payload.deviceId = SnapszliSync.getDeviceId();
    const result = await SnapszliSync.push(payload);
    return { parties, kb: result.kb, deviceId: result.deviceId };
  }

  function syncErrorMessage(err) {
    const msg = err?.message || String(err);
    if (msg.includes("401")) {
      SnapszliSync.clearToken?.();
      return `${msg}\n\nJeton invalide ou expiré — recréez-le et collez-le via « Changer le jeton ».`;
    }
    if (msg.includes("403")) {
      return `${msg}\n\nLe jeton est reconnu mais refuse l'écriture. Essayez un jeton classique (scope « repo ») — voir sharing-setup.md.\n\nFine-grained : Repository access = TomNslg/snapszli uniquement, Contents = Read and write (pas Read only).`;
    }
    return msg;
  }

  function appendTokenForm(stack, build) {
    const syncCard = el(`<div class="card" style="margin-bottom:10px">
      <p class="hint" style="margin:0 0 8px">Sync Git ${escapeHtml(build)} — collez le jeton GitHub (Contents lecture+écriture).</p>
      <textarea id="sync-token" rows="4" placeholder="ghp_… ou github_pat_…" autocapitalize="off" autocorrect="off" spellcheck="false" style="width:100%;font:inherit"></textarea>
      <p class="hint" style="margin:8px 0 0">Jeton classique (scope « repo », ghp_…) recommandé. Copiez-le en entier.</p>
    </div>`);
    stack.append(syncCard);
    stack.append(btn("Enregistrer le jeton", async () => {
      const token = syncCard.querySelector("#sync-token").value.trim();
      if (!token) return alert("Jeton vide.");
      SnapszliSync.setToken(token);
      try {
        await SnapszliSync.testWrite();
        await initCloudSync();
        alert("Jeton OK — test d'écriture Git réussi.");
        go("home");
      } catch (e) {
        SnapszliSync.setLastError(e.message || String(e));
        alert(syncErrorMessage(e));
        go("home");
      }
    }, "secondary"));
  }

  async function refreshCloudSync() {
    if (!window.SnapszliSync?.isEnabled()) {
      throw new Error("Sync Git désactivé.");
    }
    if (syncRefreshing) throw new Error("Synchronisation déjà en cours.");
    syncRefreshing = true;
    try {
      const localPayload = buildBackupPayload(getDb());
      localPayload.deviceId = SnapszliSync.getDeviceId();
      const remotePayloads = await SnapszliSync.pullAll();
      const merged = mergeDevicePayloads([...remotePayloads, localPayload]);
      if (merged) {
        const localTs = backupContentTs(load());
        const mergedTs = backupContentTs(merged);
        if (mergedTs > localTs || merged.matches.length > (load().matches?.length || 0)) {
          applyBackupPayload(merged, { skipSync: true });
          render();
        }
      }
      return await pushToCloud();
    } catch (err) {
      SnapszliSync.setLastError?.(err.message || String(err));
      throw err;
    } finally {
      syncRefreshing = false;
    }
  }

  async function initCloudSync() {
    if (!window.SnapszliSync?.init()) return;

    const localPayload = buildBackupPayload(getDb());
    localPayload.deviceId = SnapszliSync.getDeviceId();

    try {
      const remotePayloads = await SnapszliSync.pullAll();
      const merged = mergeDevicePayloads([...remotePayloads, localPayload]);
      if (merged) {
        const localTs = backupContentTs(localPayload);
        const mergedTs = backupContentTs(merged);
        if (mergedTs > localTs || merged.matches.length > localPayload.matches.length) {
          applyBackupPayload(merged, { skipSync: true });
        }
      }

      if (SnapszliSync.canWrite() && getDb().matches?.length) {
        await pushToCloud();
      }
    } catch (err) {
      SnapszliSync.setLastError?.(err.message || String(err));
      console.warn("snapszli sync init", err);
    }

    if (!syncVisibilityBound) {
      syncVisibilityBound = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") refreshCloudSync();
      });
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const db = getDb();
    await initCloudSync();
    await ensureSeedMatches(db);
    state.view = "home";
    render();
  });
})();