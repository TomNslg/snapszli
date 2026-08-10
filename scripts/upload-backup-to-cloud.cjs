#!/usr/bin/env node
/**
 * Upload a Snapszli backup JSON to GitHub cloud sync (one device file).
 *
 * Usage:
 *   SNAPSZLI_GH_TOKEN=github_pat_... node scripts/upload-backup-to-cloud.cjs "/path/to/snapszli-backup.json"
 *
 * Optional:
 *   SNAPSZLI_DEVICE_ID=my-phone-id   (default: random UUID printed to stdout)
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO = "TomNslg/snapszli";
const BRANCH = "main";
const DATA_PATH = "data/devices";

const [owner, repo] = REPO.split("/");
const token = process.env.SNAPSZLI_GH_TOKEN?.trim();
const backupPath = process.argv[2];

if (!token) {
  console.error("Missing SNAPSZLI_GH_TOKEN (fine-grained PAT with Contents read/write on snapszli).");
  process.exit(1);
}
if (!backupPath) {
  console.error("Usage: SNAPSZLI_GH_TOKEN=... node scripts/upload-backup-to-cloud.cjs <backup.json>");
  process.exit(1);
}

const abs = path.resolve(backupPath);
if (!fs.existsSync(abs)) {
  console.error(`File not found: ${abs}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
if (raw.kind !== "snapszli-backup") {
  console.error("Not a snapszli-backup file.");
  process.exit(1);
}

const deviceId = process.env.SNAPSZLI_DEVICE_ID?.trim() || crypto.randomUUID();
const payload = {
  ...raw,
  kind: "snapszli-backup",
  deviceId,
  exportedAt: raw.exportedAt || new Date().toISOString(),
  settings: {
    ...(raw.settings || {}),
    contentUpdatedAt: raw.settings?.contentUpdatedAt || raw.exportedAt || new Date().toISOString(),
  },
};

const api = (p, opts = {}) =>
  fetch(`https://api.github.com${p}`, {
    ...opts,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });

async function readMeta(filePath) {
  const res = await api(`/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(BRANCH)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`read ${filePath}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function writeFile(filePath, text, message) {
  const meta = await readMeta(filePath);
  const body = {
    message,
    content: Buffer.from(text, "utf8").toString("base64"),
    branch: BRANCH,
  };
  if (meta?.sha) body.sha = meta.sha;
  const res = await api(`/repos/${owner}/${repo}/contents/${filePath}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`write ${filePath}: ${res.status} ${await res.text()}`);
}

async function main() {
  const players = payload.players?.length || 0;
  const matches = payload.matches?.length || 0;
  console.log(`Backup: ${players} players, ${matches} parties`);
  console.log(`Device id: ${deviceId}`);

  const deviceFile = `${DATA_PATH}/${deviceId}.json`;
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(deviceFile, text, `snapszli: seed device ${deviceId.slice(0, 8)} from backup`);

  let manifest = { devices: [], updatedAt: null };
  try {
    const meta = await readMeta(`${DATA_PATH}/manifest.json`);
    if (meta?.content) {
      const bin = Buffer.from(meta.content.replace(/\n/g, ""), "base64").toString("utf8");
      manifest = JSON.parse(bin);
    }
  } catch {
    /* new manifest */
  }
  const devices = new Set(manifest.devices || []);
  devices.add(deviceId);
  manifest = { devices: [...devices], updatedAt: new Date().toISOString() };
  await writeFile(`${DATA_PATH}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, "snapszli: update device manifest");

  console.log(`Uploaded → ${deviceFile}`);
  console.log("Done. Open the app and tap Synchroniser (or reopen) to merge.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
