# Local n8n + cloudflared dev setup

> `docs/BACKLOG-M1.md` M1-08. Documentation only — no code changes. Written by inspecting the actual running Docker container and `cloudflared` process on Amro's machine (2026-08-26), not from memory or assumption — see each section for how it was captured.

## Why this exists

TEMO talks to n8n through `supabase/functions/n8n-proxy`, which calls a real n8n instance over its REST API. In local development that instance runs in Docker on `localhost:5678`, which Supabase's hosted Edge Functions cannot reach directly — `cloudflared` exposes it as a public HTTPS URL that the edge function is configured to call instead. Before this document, this setup only existed in Amro's head (`docs/GOVERNANCE.md` Section 5).

## 1. Running n8n locally (Docker)

Confirmed via `docker inspect n8n` against the actual running container:

- **Image**: `docker.n8n.io/n8nio/n8n:latest`
- **Container name**: `n8n`
- **Port mapping**: `5678:5678`
- **Persistent data volume**: named volume `n8n_data` mounted at `/home/node/.n8n` (this is where workflows, credentials, and execution history live — do not delete this volume without meaning to lose them)
- **Restart policy**: `no` — the container does **not** auto-start after a machine reboot or Docker Desktop restart. After a reboot, it needs to be started again manually (`docker start n8n`, or the equivalent `docker run` below if the container was removed).
- **Notable env vars set** (values, non-secret): `N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=false`, `N8N_USER_MANAGEMENT_DISABLED=false`, `N8N_PERSONALIZATION_ENABLED=false`, `N8N_RELEASE_TYPE=stable`

**Everyday commands** (the container already exists — just start/stop it):
```
docker start n8n
docker stop n8n
docker logs -f n8n        # tail logs
```

**Recreating from scratch**, if the container is ever removed (`docker rm`), reconstructed from the inspected configuration above — **this is a reconstruction of what's currently running, not necessarily the literal original command Amro typed**, but it reproduces the same image/port/volume/env shape:
```
docker run -d --name n8n \
  -p 5678:5678 \
  -v n8n_data:/home/node/.n8n \
  -e N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=false \
  -e N8N_USER_MANAGEMENT_DISABLED=false \
  -e N8N_PERSONALIZATION_ENABLED=false \
  docker.n8n.io/n8nio/n8n:latest
```
The named volume (`n8n_data`) is what actually matters for not losing workflows — as long as `-v n8n_data:/home/node/.n8n` is reused, recreating the container is safe.

## 2. Exposing it publicly (cloudflared)

Confirmed via `Get-CimInstance Win32_Process` against the actual running process on 2026-08-26:

```
cloudflared tunnel --url http://localhost:5678
```

This is a **quick tunnel** (no `--config`/named-tunnel flags) — cloudflared generates a random `https://<random-words>.trycloudflare.com` URL each time it starts, valid only for that process's lifetime. Confirmed by direct observation: the URL currently configured in `app_settings.n8n_url` is `https://jesse-coins-data-mounting.trycloudflare.com` — a `trycloudflare.com` domain, which only quick tunnels produce.

**Run it** (leave the terminal window open, or run it as a background process — it must stay running for the tunnel to stay up):
```
cloudflared tunnel --url http://localhost:5678
```
Watch its output for a line like `https://<random-words>.trycloudflare.com` — that's the URL to configure in step 3.

## 3. Where the URL gets configured in TEMO

`app_settings` (the same table/row all AI provider keys live in) has two relevant columns:
- `n8n_url` — the public URL cloudflared prints (step 2)
- `n8n_api_key` — an n8n API key, generated from inside the n8n UI itself (`http://localhost:5678` → Settings → n8n API → Create an API key)

**Update these through the app's own Settings page** (`app/settings/page.tsx` has a real n8n configuration section with a "Validate Connection" action — confirmed present in the code) rather than editing the database row directly. The connection status this shows (`n8n_connection_status` in `app_settings`) reflects whether the currently-configured URL + key can actually reach n8n right now.

## 4. When the tunnel URL changes

Because this is a quick tunnel, **the URL changes every time `cloudflared` is restarted** — after a reboot, a crash, or just closing the terminal it was running in. When that happens:
1. Restart `cloudflared tunnel --url http://localhost:5678` and note the new URL it prints.
2. Update `n8n_url` in Settings (step 3) to the new URL.
3. Click "Validate Connection" to confirm it's reachable again.

**Open decision, not made here**: the ticket that requested this runbook explicitly asks whether to move to a **named tunnel** instead — a stable subdomain (e.g. `n8n-temo.yourdomain.com` or a `*.cfargotunnel.com` address) that doesn't change across restarts, at the cost of one-time setup (a Cloudflare account, `cloudflared tunnel login`, `cloudflared tunnel create <name>`, a DNS route, and a small config file instead of a bare `--url` flag). This is a real tradeoff — mostly-set-and-forget stability vs. an extra setup step that also ties the tunnel to a specific Cloudflare account/domain — and it's **Amro's call to make**, not something inferred from the current quick-tunnel setup. If a named tunnel is wanted, this runbook should be updated with the exact `cloudflared tunnel create`/config-file steps once that decision is made.
