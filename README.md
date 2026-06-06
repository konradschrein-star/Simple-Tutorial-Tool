# Simple Tutorial Tool

A self-hostable tool for turning a **title + a list of steps** into a finished
tutorial video. You write the steps, it generates a narration script with an
LLM, turns that into clean voice-over with text-to-speech, you screen-record
yourself doing the steps, and the server splices the clean audio onto your
recording (time-scaling the video to match the narration). The result is a
polished tutorial with consistent voice-over and no "ums" or dead air.

## How it works

```
Title + steps ──▶ LLM script ──▶ TTS voice-over ──▶ you screen-record
                                                          │
                                                          ▼
                              final video ◀── splice clean audio onto recording
                                                  (video time-scaled to the audio)
```

- **Web app** (`apps/web`) — Next.js control panel: create jobs, preview the
  generated audio, record/upload your screen capture, and download the result.
- **Worker** (`apps/worker`) — background processor: script generation, TTS, and
  the ffmpeg splice/stitch steps, dispatched over a Redis queue.
- **Postgres** stores jobs/settings; **Redis** runs the job queue; **ffmpeg**
  does the audio/video work.

Provider API keys (for TTS/LLM) are entered in the app's **Settings** page and
stored encrypted in the database — they never live in the code or in env files.

## Requirements

- Node.js ≥ 22 and [pnpm](https://pnpm.io) ≥ 9
- `ffmpeg` on your PATH (or set `FFMPEG_PATH`)
- PostgreSQL and Redis — the included `docker-compose.yml` provides both

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Start Postgres + Redis (or point .env at your own)
docker compose up -d

# 3. Configure env
cp .env.example .env
#    then fill in JWT_SECRET, SECRETS_ENCRYPTION_KEY, LOCAL_MEDIA_ROOT,
#    and ADMIN_EMAIL / ADMIN_PASSWORD. Generate the secrets with:
#      openssl rand -base64 48   # JWT_SECRET
#      openssl rand -base64 32   # SECRETS_ENCRYPTION_KEY

# 4. Build shared packages, create the database schema, create your admin login
pnpm build:packages
pnpm db:push
pnpm setup:admin
```

## Running

**Development** (two terminals):

```bash
pnpm dev:web      # http://localhost:3000
pnpm dev:worker
```

**Production**:

```bash
pnpm build
pnpm start:web    # serves on PORT (default 3000)
pnpm start:worker
```

Open the app, log in with the admin credentials from your `.env`, then go to
**Settings** and paste an API key for at least one TTS provider (and an LLM
provider, unless you set `ANTHROPIC_API_KEY` to use the built-in script
generator). Now create a tutorial from the **Create** tab.

## Configuration

All configuration is via environment variables — see [`.env.example`](./.env.example)
for the full list with comments. The essentials:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Signs the login session cookie (≥ 32 chars) |
| `SECRETS_ENCRYPTION_KEY` | Encrypts stored provider API keys (32 bytes, base64) |
| `LOCAL_MEDIA_ROOT` | Absolute path for recordings + rendered videos. **The web app and worker must share this path.** |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Your single admin login (applied by `pnpm setup:admin`) |

Optional: `ANTHROPIC_API_KEY` (built-in script generator), `FFMPEG_PATH`,
`PORT`, `BIND_HOST`, `ALLOWED_ORIGINS`, and the `GOOGLE_OAUTH_*` / `PUBLIC_URL`
vars for optional Google Drive auto-upload.

## Project structure

```
apps/
  web/        Next.js control panel + custom server (handles large uploads)
  worker/     BullMQ worker: script → TTS → splice → stitch
packages/
  contracts/  Zod schemas, enums, queue payloads
  db/         Drizzle schema + repositories (Postgres)
  queue/      Typed BullMQ queue/worker factories
  media-core/ ffmpeg helpers (probe + mux)
```

## License

MIT — see [LICENSE](./LICENSE).
