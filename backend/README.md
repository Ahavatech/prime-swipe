# Prime Swipe API

The separately hosted Node.js/Express service for opt-in Prime Swipe run
submissions and cumulative-Score rankings. It uses its own SQLite database
and ordered migrations. It is not compatible with or connected to the 2048
database.

## Requirements and local setup

Node.js 20+ and npm are required. From `backend/`:

```powershell
Copy-Item .env.example .env
npm ci
node --env-file=.env src/server.js
```

The development database defaults to `./data/prime-swipe-dev.db`; the API
listens on `0.0.0.0:8080`. `DATABASE_PATH` is relative to the backend working
directory unless absolute. Migrations run transactionally at startup or with
`npm run migrate`. They use a version-one base schema and a version-two
`largest_prime` column; the latter preserves earlier run rows with a default
of zero.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test`, or `production`. |
| `PORT` | `8080` | HTTP port from 1 through 65535. |
| `DATABASE_PATH` | `./data/prime-swipe.db` | Separate Prime Swipe SQLite file. Production requires an absolute path on persistent storage. |
| `CORS_ORIGINS` | empty | Comma-separated exact HTTP(S) origins. Never use a wildcard. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Public API request window per client IP. |
| `RATE_LIMIT_MAX` | `100` | Requests per IP in the configured window. |
| `TRUST_PROXY_HOPS` | `0` | Trusted reverse-proxy hops; configure only for the chosen host. |

Production must set `DATABASE_PATH` to its Prime Swipe volume, such as
`/data/prime-swipe.db`, and `CORS_ORIGINS` to the actual frontend origin, such
as `https://<OWNER>.github.io` (origin only, no project path). Keep the API
application, volume, and database name distinct from 2048.

## API contract

### `GET /api/v1/leaderboard/rank?score=<integer>`

Returns `{ "rank": 7, "qualifies": true, "leaderboardLimit": 100 }`. Rank is
one plus the number of persisted cumulative Scores strictly greater than the
candidate; equal Scores share a rank, and rank 100 qualifies. Outside the
limit, `rank` is `null` and `qualifies` is `false`. A preview does not save a
run.

### `POST /api/v1/scores`

Requires JSON and a per-run `Idempotency-Key` of 1–128 ASCII letters, numbers,
dots, underscores, colons, or hyphens:

```json
{
  "displayName": "ARCADE ACE",
  "score": 2400,
  "largestPrime": 101,
  "moves": 38,
  "durationSeconds": 94
}
```

`displayName` is NFC-normalized and trimmed, then restricted to 1–12 ASCII
letters, numbers, spaces, hyphens, or underscores. Score, largestPrime,
moves, and duration must be non-negative safe integers; `largestPrime` must
be zero (no prime merge built) or a prime. These are shape checks, not
anti-cheat proof. The backend ranks by **cumulative Score**; `largestPrime`
is persisted and returned as a distinct run statistic. New persisted runs
return `201` with display name, Score, largest prime, and server-calculated
rank. An identical retry returns the original response with `200`; reusing a
key for a different payload returns `409`.

### `GET /api/v1/leaderboard`

Returns `{ "entries": [...], "limit": 100 }`. Entries are ordered by Score
descending, submission time, and insertion order. Equal Scores share
competition rank. Public entries contain rank, display name, Score, largest
prime, and UTC submission time; internal IDs and idempotency keys are never
returned.

### Health and errors

`GET /api/v1/health` returns `{ "status": "ok", "database": "ok" }` only when
the database responds. OpenAPI is available at `/openapi.json` and Swagger UI
at `/api-docs/`.

Errors use `{ "error": { "code": "...", "message": "..." } }`. Invalid input
is `400`, unsupported media type `415`, oversized JSON `413`, key conflict
`409`, rate limit `429`, disallowed origin `403`, and database contention or
unavailability `503`. No synthetic success is returned for unavailable
storage.

## Tests and migrations

```powershell
npm test
npm run migrate
```

Tests use temporary databases. They include fresh creation, reopening,
upgrading an existing version-one database without losing rows, request
validation, Score-based ranks, ties, persistence, idempotency, and public
response shapes.

## Fly.io API and SQLite volume

The Fly configuration is in `fly.toml` and builds this directory's
`Dockerfile`. The API stores its SQLite database at `/data/prime-swipe.db`,
which must be backed by a Fly Volume mounted at `/data`. Configure a dedicated
Prime Swipe app and volume; never reuse the 2048 app or storage.

SQLite is a single-machine database in this deployment. Keep one Fly Machine
attached to this volume and in the volume's region. Do not scale this app to
multiple Machines: each Machine would need its own volume and would otherwise
serve a different database. A single volume also means downtime if its host is
unavailable or the app is being deployed. Fly documents that its automatic
daily volume snapshots (five days retained by default) are not a primary
backup; plan and test a separate backup/recovery process before relying on
leaderboard data. For high availability, use a replication design such as
[LiteFS](https://docs.fly.io/litefs/) or a managed database rather than adding
Machines to this plain SQLite configuration.

See Fly's [volume overview](https://docs.fly.io/volumes/overview/) and
[app configuration reference](https://docs.fly.io/reference/configuration/)
for current platform behavior.

### One-time setup and API deploy

Install the Fly CLI and authenticate with the Fly account that should own this
app. The configured app name is `prime-swipe`; confirm that name is available
in your Fly organization. Replace `replace-with-fly-region` in `fly.toml` with
the selected three-letter region code, then from `backend/`:

1. Create the app and its persistent volume in the same region (do not use a
   2048 app or volume):

   ```sh
   fly apps create prime-swipe
   fly volumes create prime_swipe_data --app prime-swipe --region <YOUR_REGION> --size 1
   ```

3. Allow only the actual frontend site origin. For a standard GitHub Pages
   site, the origin is `https://<OWNER>.github.io`; omit the repository path.
   For a custom Pages domain, use its exact `https://` origin instead:

   ```sh
   fly secrets set CORS_ORIGINS=https://<OWNER>.github.io --app prime-swipe
   ```

   `CORS_ORIGINS` is public origin configuration, not a credential; setting
   it via Fly's runtime configuration keeps the deploy template free of an
   account-specific URL.

4. Deploy the API from `backend/` and inspect its status and health:

   ```sh
   fly deploy --app prime-swipe
   fly status --app prime-swipe
   ```

   Then open `https://prime-swipe.fly.dev/api/v1/health`. A healthy
   response must report both API and database status as `ok`. The Fly health
   check in `fly.toml` uses the same endpoint.

The template sets `DATABASE_PATH=/data/prime-swipe.db`, `PORT=8080`,
`NODE_ENV=production`, and `TRUST_PROXY_HOPS=1`; the mount and HTTP service are
also declared there. HTTPS is forced at Fly's proxy. The health check should
remain enabled so a missing or unhealthy database does not appear ready.

### Connect GitHub Pages

In the game repository's **Settings → Pages**, select **GitHub Actions** as
the build and deployment source. Add the Actions repository variable
`PRIME_SWIPE_API_BASE_URL` with the Fly origin, for example
`https://prime-swipe.fly.dev` (no trailing slash or path). In the
Fly app, `CORS_ORIGINS` must match the browser's frontend origin exactly; a
project Pages URL's `/repository-name` path is not part of that origin.

After both origins are set, manually run **Deploy Prime Swipe Pages** from
**Actions** and verify leaderboard loading and an opt-in score submission on
the deployed site. The workflow deploys only the static frontend; it does not
deploy Fly or change Pages settings.

These are setup instructions, not evidence that an app or volume exists or
that either service is live. Confirm the app name is available, choose the
region, frontend owner or custom domain, and backup plan before running the
commands.
