# Local n8n + cloudflared dev setup

> `docs/BACKLOG-M1.md` M1-08. Documentation only — no code changes. Written by inspecting the actual running Docker container and `cloudflared` process on Amro's machine (2026-08-26), not from memory or assumption — see each section for how it was captured. Updated the same day with Claude Cowork's Milestone 1 review decision to move from a quick tunnel to a named tunnel (section 2) — that switch is documented but not yet executed, pending Amro's one required interactive step.

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

**Decision (2026-08-26, Claude Cowork review of Milestone 1): use a named tunnel, not the quick tunnel this was originally set up with.** A stable hostname avoids reconfiguring `app_settings.n8n_url` (and re-validating the connection in Settings) every time `cloudflared` restarts — which the quick tunnel required, since it mints a brand-new random URL on every launch.

**Current state as of this decision**: still running the quick tunnel — `cloudflared tunnel --url http://localhost:5678`, confirmed via `Get-CimInstance Win32_Process` against the actual running process on 2026-08-26, currently exposing `https://jesse-coins-data-mounting.trycloudflare.com` (a `trycloudflare.com` domain, which only quick tunnels produce). The switch below has **not been executed yet** — step 1 requires Amro's own interactive Cloudflare login, which Claude Code cannot perform.

### Named tunnel setup (one-time)

1. **Log in** (interactive — opens a browser, Amro authorizes the CLI against his own Cloudflare account):
   ```
   cloudflared tunnel login
   ```
   This writes a certificate to `~/.cloudflared/cert.pem`. Nothing after this step needs to be interactive again.

2. **Create the tunnel** (once — this generates a stable Tunnel ID and a credentials JSON file under `~/.cloudflared/`):
   ```
   cloudflared tunnel create temo-n8n
   ```
   Note the Tunnel ID it prints. A named tunnel gets a stable `<tunnel-id>.cfargotunnel.com` address automatically — no custom domain/DNS registration required to use it, though one can be added later (`cloudflared tunnel route dns temo-n8n <hostname>`, if Amro wants a nicer custom hostname than the auto-generated one and has a domain on Cloudflare DNS to route it to).

3. **Config file** (`~/.cloudflared/config.yml`), pointing the tunnel at the local n8n port:
   ```yaml
   tunnel: temo-n8n
   credentials-file: <path cloudflared printed in step 2>
   ingress:
     - hostname: <the tunnel's assigned hostname, or a custom one from the optional DNS route above>
       service: http://localhost:5678
     - service: http_status:404
   ```

4. **Run it** (replaces the quick-tunnel command from here on):
   ```
   cloudflared tunnel run temo-n8n
   ```
   This is a long-running process — same as the quick tunnel, it needs to stay running for the tunnel to stay up, but unlike the quick tunnel, restarting it does **not** change the URL.

**This procedure has not been run end-to-end in this environment** — it's the standard, documented `cloudflared` named-tunnel flow, written out precisely so step 1 (the one part only Amro can do) is unblocked; steps 2–4 can be completed by either Amro or Claude Code immediately after step 1 finishes, and this runbook should be updated with the actual resulting hostname once that happens.

## 3. Where the URL gets configured in TEMO

`app_settings` (the same table/row all AI provider keys live in) has two relevant columns:
- `n8n_url` — the public URL cloudflared prints (step 2)
- `n8n_api_key` — an n8n API key, generated from inside the n8n UI itself (`http://localhost:5678` → Settings → n8n API → Create an API key)

**Update these through the app's own Settings page** (`app/settings/page.tsx` has a real n8n configuration section with a "Validate Connection" action — confirmed present in the code) rather than editing the database row directly. The connection status this shows (`n8n_connection_status` in `app_settings`) reflects whether the currently-configured URL + key can actually reach n8n right now.

## 4. When the tunnel URL changes

**Until the named-tunnel switch (section 2) is actually carried out**, this environment is still running the quick tunnel, whose URL changes every time `cloudflared` is restarted — after a reboot, a crash, or just closing the terminal it was running in. When that happens:
1. Restart `cloudflared tunnel --url http://localhost:5678` and note the new URL it prints.
2. Update `n8n_url` in Settings (step 3) to the new URL.
3. Click "Validate Connection" to confirm it's reachable again.

**Once the named tunnel from section 2 is set up**, this entire section becomes unnecessary — `cloudflared tunnel run temo-n8n`'s hostname is stable across restarts, so `n8n_url` in Settings only needs to be set once, ever (barring deliberately recreating the tunnel). Update this section to remove the quick-tunnel steps once the switch is confirmed live.
