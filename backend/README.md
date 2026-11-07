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
`npm run migrate`. Version one is the base schema, version two adds
`largest_prime`, and version three adds verified runs. Rows saved before
version three were whatever the browser claimed, so they keep `verified = 0`:
they stay in the database and appear on the leaderboard in score order, clearly
labeled as legacy and unverified. Their scores also count toward rank; they are
never upgraded to verified.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test`, or `production`. |
| `PORT` | `8080` | HTTP port from 1 through 65535. |
| `DATABASE_PATH` | `./data/prime-swipe.db` | Separate Prime Swipe SQLite file. Production requires an absolute path on persistent storage. |
| `CORS_ORIGINS` | empty | Comma-separated exact HTTP(S) origins. Never use a wildcard. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Public API request window per client IP. |
| `RATE_LIMIT_MAX` | `100` | Requests per IP in the configured window. |
| `SUBMIT_RATE_LIMIT_MAX` | `20` | Requests per IP in the window for `POST /runs` and `POST /scores` combined. Submitting a run replays a game, so these get a tighter limit than reads. |
| `RUN_TOKEN_SECRET` | none | Signs run tokens. At least 32 characters. Required in production; in development an empty value generates a throwaway secret, so tokens stop working when the process restarts. |
| `RUN_TOKEN_TTL_SECONDS` | `21600` | How long after starting a run it can still be submitted (6 hours; at most 7 days). |
| `TRUST_PROXY_HOPS` | `0` | Trusted reverse-proxy hops; configure only for the chosen host. |

Production must set `DATABASE_PATH` to its Prime Swipe volume, such as
`/data/prime-swipe.db`, and `CORS_ORIGINS` to the actual frontend origin, such
as `https://<OWNER>.github.io` (origin only, no project path). Keep the API
application, volume, and database name distinct from 2048.

## API contract

### `GET /api/v1/leaderboard/rank?score=<integer>`

Returns `{ "rank": 7, "qualifies": true, "leaderboardLimit": 100 }`. Rank is
one plus the number of verified or historical legacy cumulative Scores
strictly greater than the candidate; equal Scores share a rank, and rank 100
qualifies. Outside the limit, `rank` is `null` and `qualifies` is `false`. A
preview does not save or verify a run, so treat it as advice.

### `POST /api/v1/runs`

Starts a run. No body. Returns `201`:

```json
{
  "runToken": "ps1.eyJy...",
  "seed": 3141592653,
  "engineVersion": "1",
  "issuedAt": "2026-11-07T12:00:00.000Z",
  "expiresAt": "2026-11-07T18:00:00.000Z"
}
```

The game is played from `seed` with `GameEngine.createSeededRandom(seed)`: one
random source per run, passed to `createGame` first and then to every `move`.
If the browser's `GameEngine.VERSION` differs from `engineVersion`, it should
not start the run, because the server would replay it under different rules.
Nothing is stored when a run starts.

### `POST /api/v1/scores`

Requires JSON:

```json
{
  "displayName": "ARCADE ACE",
  "runToken": "ps1.eyJy...",
  "moveLog": "LLURDDRL...",
  "score": 2400
}
```

`moveLog` is one letter per move that changed the board (`U`, `D`, `L`, `R`),
1 to 5000 letters. A move that changed nothing is never logged, and a log that
contains one is rejected. The server replays the log from the run's seed and
stores the score and largest prime it computes, not the browser's. `score` is
a checksum: it has to equal the replayed score or the run is rejected with
`SCORE_MISMATCH`. The log may stop before game over, because any legal
prefix is a legal run.

`displayName` is NFC-normalized and trimmed, then restricted to 1–12 ASCII
letters, numbers, spaces, hyphens, or underscores. The backend ranks by
**cumulative Score**; `largestPrime` is stored and returned as a separate
statistic.

A new run returns `201` with display name, Score, largest prime, moves and
rank. A run can be submitted once. Sending it again with the same name and move
log returns the original response with `200`, even after the token has expired.
Anything else for a used run returns `409 RUN_ALREADY_SUBMITTED`.

| Status | Code | Meaning |
|---|---|---|
| 400 | `RUN_TOKEN_REQUIRED` | The body has no `runToken`: an older client still sending a bare score. |
| 400 | `INVALID_RUN_TOKEN` | Not a token this server issued, or it was altered. |
| 400 | `INVALID_MOVE_LOG`, `INVALID_SCORE`, `INVALID_DISPLAY_NAME`, `INVALID_BODY` | Bad input. |
| 409 | `RUN_ALREADY_SUBMITTED` | This run was used with different contents. |
| 409 | `ENGINE_VERSION_MISMATCH` | The run started under different game rules. Start a new one. |
| 410 | `RUN_EXPIRED` | The token is older than `RUN_TOKEN_TTL_SECONDS`. |
| 422 | `RUN_REJECTED` | The move log is not a legal game. `details` gives the reason and position. |
| 422 | `SCORE_MISMATCH` | `score` differs from the replay. `details` gives the replayed score. |
| 422 | `RUN_TOO_FAST` | Submitted sooner than 40 ms per move after the run started. |
| 422 | `NOTHING_TO_RANK` | The run built no prime. |

### `GET /api/v1/leaderboard`

Returns `{ "entries": [...], "limit": 100 }`. Verified runs and historical
legacy scores are interleaved by Score descending, submission time, and
insertion order. Equal Scores share competition rank across both groups.
Public entries contain rank, display name, Score, largest prime, UTC submission
time, and a `verified` boolean. `false` identifies a legacy score that predates
replay verification; its original values are shown without claiming they were
verified. Seeds, move logs and internal IDs are never returned.

### Health and errors

`GET /api/v1/health` returns `{ "status": "ok", "database": "ok" }` only when
the database responds. OpenAPI is available at `/openapi.json` and Swagger UI
at `/api-docs/`.

Errors use `{ "error": { "code": "...", "message": "..." } }`. Invalid input
is `400`, unsupported media type `415`, oversized JSON `413`, conflicts `409`,
expired runs `410`, rejected runs `422`, rate limit `429`, disallowed origin
`403`, and database contention or unavailability `503`. No synthetic success is returned for unavailable
storage.

## How verification works

A run starts with a seed the server picks. The token returned with it is signed
with HMAC-SHA256 over the run id, seed, start time and engine version, so a
client cannot change any of them. The browser plays the game from the seed and
sends back its moves. The server replays them with the same engine and stores
what the replay produces. The run id is stored under a UNIQUE key, which makes a
run single-use.

What this proves: the score is reachable by legal play of the real rules, from a
seed the server issued, within the time window, exactly once. A request that
sets `score` to 9,999,999 no longer works, and neither does picking a favourable
seed or editing a few moves.

What it does not prove: that a person played. The player knows the seed, so the
game is fully determined and a solver can find strong move sequences offline and
submit them. The 40 ms per move floor only stops instant submission, because a
script can wait. Stopping solvers would mean the server running the game one
move at a time and keeping spawns hidden, which costs a round trip per move.
The fast checks run before the replay, and the two POST routes have their own
rate limit, so bad submissions are cheap to refuse.

### Changing the game rules

The browser's `game-engine.js` and the backend's copy in
`src/engine/game-engine.cjs` must be byte-identical, because the server has to
replay exactly what the browser played. After editing the root file, copy it
over the backend copy. `tests/engine-sync.test.js` fails if they differ.

Any change to how a seeded game plays out (spawn weights, unlock thresholds,
merge rules, the order or number of random draws) needs a new `VERSION` in the
engine. `tests/engine.test.js` replays a recorded run, so it fails until you bump
the version and regenerate the fixture with
`node tests/helpers/make-golden.mjs`. Runs started before the deploy are then
refused with `ENGINE_VERSION_MISMATCH` instead of failing in confusing ways.

## Tests and migrations

```powershell
npm test
npm run migrate
```

Tests use temporary databases and a controllable clock. They cover the engine's
replay and a recorded golden run, token forgery and malleability, every
rejection path of the verifier, single use and retries, expiry, engine drift
between the browser and server copies, upgrading version-one and version-two
databases without losing rows, interleaving legacy rows and verified runs in
the board and ranks,
request validation, ranks and ties, persistence, and public response shapes.

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

2. Set the secret that signs run tokens. Keep it out of the repository, and
   generate a fresh one for this app:

   ```sh
   fly secrets set RUN_TOKEN_SECRET="$(openssl rand -base64 48)" --app prime-swipe
   ```

   Changing it later invalidates every run that has been started but not yet
   submitted. The app refuses to start in production without it.

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

Deploy order: the updated browser game and this API change the submission
contract together. An older browser's submissions get `RUN_TOKEN_REQUIRED`, and
an updated browser calling an older API gets a 404 on `POST /runs`, so the game
should stay playable when starting a run fails and only disable submission.

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
