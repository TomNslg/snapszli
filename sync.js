/* Snapszli — optional GitHub sync (one JSON file per device in the repo). */
(() => {
  const DEVICE_KEY = "snapszli-device-id";
  const TOKEN_KEY = "snapszli-sync-token";
  const config = window.SNAPSZLI_SYNC_CONFIG || { enabled: false };

  let enabled = false;
  let owner = "";
  let repo = "";
  let branch = "main";
  let deviceId = null;

  function getToken() {
    return String(config.token || localStorage.getItem(TOKEN_KEY) || "").trim();
  }

  function setToken(token) {
    const t = String(token || "").trim();
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }

  function hasToken() {
    return !!getToken();
  }

  function parseRepo(slug) {
    const parts = String(slug || "").trim().split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    return { owner: parts[0], repo: parts[1] };
  }

  function getDeviceId() {
    if (deviceId) return deviceId;
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    deviceId = id;
    return id;
  }

  function contentTs(payload) {
    return payload?.settings?.contentUpdatedAt || payload?.exportedAt || "";
  }

  function dataPath(file) {
    const base = String(config.dataPath || "data/devices").replace(/\/$/, "");
    return `${base}/${file}`;
  }

  function rawUrl(path) {
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  }

  function authHeaders(headers = {}) {
    const out = { ...headers };
    const token = getToken();
    if (token) out.Authorization = `Bearer ${token}`;
    return out;
  }

  async function ghFetch(path, options = {}) {
    const headers = authHeaders({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    });
    const res = await fetch(`https://api.github.com${path}`, { ...options, headers });
    if (!res.ok) {
      const err = new Error(`GitHub ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }

  async function readText(path) {
    if (getToken()) {
      try {
        const res = await ghFetch(`/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
        const json = await res.json();
        if (json.encoding === "base64" && json.content) {
          const bin = atob(json.content.replace(/\n/g, ""));
          const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
          return new TextDecoder().decode(bytes);
        }
      } catch (err) {
        if (err.status !== 404) throw err;
      }
    }
    const res = await fetch(rawUrl(path), { cache: "no-store" });
    if (!res.ok) {
      const err = new Error(`read ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.text();
  }

  async function readMeta(path) {
    const res = await ghFetch(`/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
    return res.json();
  }

  async function writeText(path, text, message) {
    if (!getToken()) throw new Error("sync token missing");
    let sha;
    try {
      sha = (await readMeta(path)).sha;
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    const body = {
      message,
      content: toBase64(text),
      branch,
    };
    if (sha) body.sha = sha;
    await ghFetch(`/repos/${owner}/${repo}/contents/${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function readManifest() {
    try {
      return JSON.parse(await readText(dataPath("manifest.json")));
    } catch (err) {
      if (err.status === 404) return { devices: [], updatedAt: null };
      throw err;
    }
  }

  async function updateManifest(id) {
    const manifest = await readManifest();
    const devices = new Set(manifest.devices || []);
    devices.add(id);
    const next = {
      devices: [...devices],
      updatedAt: new Date().toISOString(),
    };
    await writeText(dataPath("manifest.json"), `${JSON.stringify(next, null, 2)}\n`, "snapszli: update device manifest");
  }

  function init() {
    const parsed = parseRepo(config.repo);
    if (!config.enabled || !parsed) return false;
    owner = parsed.owner;
    repo = parsed.repo;
    branch = config.branch || "main";
    enabled = true;
    getDeviceId();
    return true;
  }

  async function pullAll() {
    if (!enabled) return [];
    const manifest = await readManifest();
    const ids = manifest.devices || [];
    const payloads = [];
    await Promise.all(
      ids.map(async (id) => {
        try {
          const text = await readText(dataPath(`${id}.json`));
          const payload = JSON.parse(text);
          if (payload && payload.kind === "snapszli-backup") payloads.push(payload);
        } catch {
          /* skip missing/bad device file */
        }
      }),
    );
    return payloads;
  }

  async function push(payload) {
    if (!enabled || !getToken()) return;
    const id = getDeviceId();
    const body = {
      ...payload,
      deviceId: id,
      kind: "snapszli-backup",
    };
    const text = `${JSON.stringify(body, null, 2)}\n`;
    await writeText(dataPath(`${id}.json`), text, `snapszli: sync device ${id.slice(0, 8)}`);
    try {
      await updateManifest(id);
    } catch {
      /* manifest may already list this device */
    }
  }

  function isEnabled() {
    return enabled;
  }

  function canWrite() {
    return enabled && hasToken();
  }

  window.SnapszliSync = {
    init,
    push,
    pullAll,
    isEnabled,
    canWrite,
    hasToken,
    setToken,
    getDeviceId,
    contentTs,
  };
})();
