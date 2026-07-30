# Snapszli — local / hosted app

Static Home Screen web app.  
**Data:** `localStorage` (`snapszli-v1`) on the device.  
**Offline:** `sw.js` caches the app shell after first load.  
**Backup:** Home → **Sauvegarder** / **Restaurer** (optional Files / iCloud).  
**Host without Mac:** see [GITHUB-PAGES.md](./GITHUB-PAGES.md).

## Run on Mac (dev server)

```bash
cd /Users/tomnesling/Desktop/ToDo/tasks/card-game-stats-iphone/app
python3 -m http.server 8765 --bind 0.0.0.0
```

- Mac: http://127.0.0.1:8765/  
- iPhone (same Wi‑Fi): `http://<mac-ip>:8765/`

Service workers need a real origin (http://localhost or https://) — fine with the server above; `file://` is unreliable.

## Features (v1)

- Parties, manches, stats, seeds, artificial-points toggles  
- Sauvegarder / Restaurer  
- Offline shell via service worker  

## Docs

- Scoring: `../scoring-rules.md`  
- Handoff: `../maintenance.md`  
- Pages deploy: `GITHUB-PAGES.md`
