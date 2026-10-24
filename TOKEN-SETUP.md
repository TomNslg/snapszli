# Snapszli sync token (fine-grained PAT)

Phones open the GitHub Pages app and sync scores by writing JSON under `data/devices/` via the GitHub **Contents** API. Enter the token once in the app (stored in each device’s `localStorage` — never commit it).

The app sends `Authorization: Bearer …` and only calls:

- `GET/PUT /repos/TomNslg/snapszli/contents/data/devices/…`

That works with a **fine-grained** personal access token limited to this repo.

## Create the token

1. GitHub → profile photo → **Settings** / **Paramètres**
2. Left sidebar → **Developer settings** / **Paramètres de développeur**
3. **Personal access tokens** → **Fine-grained tokens** / **Jetons à grain fin** → **Generate new token** / **Générer un nouveau jeton**
4. Fill in:

| Field (EN / FR) | Value |
| --- | --- |
| Token name / Nom du jeton | e.g. `snapszli-sync` |
| Expiration | pick a date (recreate when it expires) |
| Resource owner / Propriétaire de ressource | `TomNslg` |
| Repository access / Accès au dépôt | **Only select repositories** / **Sélectionner uniquement les dépôts** → choose **`snapszli`** |

5. Under **Permissions** / **Autorisations** → expand **Repository permissions** / **Autorisations des dépôts**.

   You will see a **list of permission categories** (Actions, Administration, **Contents** / **Contenu**, Issues, …).  
   **“Read and write” is not a row in that list** — it is the **access level** in the dropdown on the right of a category.

6. Find the category named:

   - English UI: **Contents**
   - French UI: **Contenu**

   Open its dropdown (default is **No access** / **Aucun accès**) and choose:

   - English: **Read and write**
   - French: **Lecture et écriture**

   Leave every other category at **No access** / **Aucun accès**.  
   **Metadata** / **Metadata** becomes **Read-only** automatically when you grant Contents — that is expected.

7. **Generate token** / **Générer un jeton**, copy the full `github_pat_…` value.
8. On each phone: https://TomNslg.github.io/snapszli/ → paste → **Enregistrer le jeton** (runs a write test).

## Quick checklist

| What you set | Exact UI name |
| --- | --- |
| Permission **category** | **Contents** (EN) / **Contenu** (FR) |
| Access **level** for that category | **Read and write** (EN) / **Lecture et écriture** (FR) |
| Repo | only **`snapszli`** |

## Notes

- **403** → Contenu/Contents is still Read-only / Lecture seule, or the token is not scoped to `TomNslg/snapszli`.
- **401** → expired or mistyped; use **Changer le jeton** and paste a new one.
- A classic `ghp_…` token with scope `repo` still works, but it is not limited to one repository.
