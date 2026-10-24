# Snapszli sync token (fine-grained PAT)

Phones open the GitHub Pages app and sync scores by writing JSON under `data/devices/` via the GitHub **Contents** API. Enter the token once in the app (stored in each device’s `localStorage` — never commit it).

The app sends `Authorization: Bearer …` and only calls:

- `GET/PUT /repos/TomNslg/snapszli/contents/data/devices/…`

That works with a **fine-grained** personal access token limited to this repo.

## Create the token (Option A)

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. Fill in:

| Field | Value |
| --- | --- |
| Token name | e.g. `snapszli-sync` |
| Expiration | pick a date (recreate when it expires) |
| Resource owner | `TomNslg` |
| Repository access | **Only select repositories** → **`snapszli`** |
| Repository permissions → **Contents** | **Read and write** |
| All other permissions | **No access** (Metadata is granted automatically) |

3. Generate, copy the `github_pat_…` value in full.
4. On each phone: open https://TomNslg.github.io/snapszli/ → paste under the sync form → **Enregistrer le jeton** (runs a write test).

## Notes

- **403** → Contents is still Read-only, or the token is not scoped to `TomNslg/snapszli`.
- **401** → expired or mistyped; clear via **Changer le jeton** and paste a new one.
- A classic `ghp_…` token with scope `repo` still works, but it is not limited to one repository.
