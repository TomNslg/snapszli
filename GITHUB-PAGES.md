# Publish Snapszli on GitHub Pages

Serves the **app shell** (HTML/JS/CSS). **Scores stay on the iPhone** (`localStorage`).  
After one online visit, the **service worker** caches the shell so the Home Screen icon can open **offline**.

## One-time setup

1. On GitHub: **New repository** → name e.g. `snapszli` → **Public** → create (empty, no README needed).

2. On your Mac, in Terminal:

```bash
cd /Users/tomnesling/Desktop/ToDo/tasks/card-game-stats-iphone/app

git init
git add index.html app.js styles.css suits.js manifest.json icon.svg sw.js seeds README.md
git commit -m "Snapszli Home Screen app (offline shell)."
git branch -M main
git remote add origin https://github.com/YOUR_USER/snapszli.git
git push -u origin main
```

Replace `YOUR_USER` with your GitHub username (use SSH remote if you prefer).

3. Open the repo on GitHub → **Settings** (⚙️ **Paramètres**) → left sidebar **Pages**
   (under *Code and automation* / *Code et automatisation*).

4. On that page, look **above** “Custom domain / Domaine personnalisé”:

   - English: **Build and deployment** → **Source**
   - French: often **Création et déploiement** or **Génération et déploiement** → **Source**

   Choose either:

   - **Deploy from a branch** / **Déployer à partir d’une branche** → Branch **main** / folder **/ (root)** → Save  
   - **or** **GitHub Actions** (recommended if you don’t see “branch”) — then open the **Actions** tab once and allow the workflow if asked.

5. Wait ~1 minute. Site URL:

`https://YOUR_USER.github.io/snapszli/`

   Example for this project: `https://TomNslg.github.io/snapszli/`

6. iPhone **Safari** → open that URL (online once) → Share → **Add to Home Screen**.

**Ignore** “Add a verified domain” / “Ajouter un domaine vérifié” — that’s only for a custom domain like `snapszli.com`.

If the Source menu is missing entirely: push the included workflow (`.github/workflows/pages.yml`), then on Pages set Source to **GitHub Actions**, then **Actions** → run **Deploy GitHub Pages** if it didn’t start alone.

Later opens: offline OK for the app UI; data remains on device. Use **Sauvegarder** when you want a Files/iCloud JSON copy.

## Updating the hosted app

After editing files in this folder:

```bash
cd /Users/tomnesling/Desktop/ToDo/tasks/card-game-stats-iphone/app
git add -A
git commit -m "Update Snapszli."
git push
```

Bump `CACHE` in `sw.js` (e.g. `snapszli-shell-v2`) when you change JS/CSS so phones refresh the offline shell.

## Notes

- Project site lives under `/snapszli/` — keep asset URLs **relative** (already the case).
- Do **not** commit secrets; this folder is public if the repo is public.
- Seeds re-import only if local data is empty / missing those match ids.
