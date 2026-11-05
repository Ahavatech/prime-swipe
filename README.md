# Prime Swipe

Prime Swipe is a responsive 4×4 sliding-tile puzzle. Unlike 2048, adjacent
tiles merge only when their sum is prime. The game has its own frontend build,
Node/Express API, and SQLite database identity; it does not read, migrate, or
submit to the 2048 leaderboard.

## Rules

- A new run starts with exactly two tiles in distinct random cells: one odd
  tile (1 or 3) and one even tile (2 or 4).
- A swipe packs every row or column toward the leading edge, then scans the
  packed tiles in order. Adjacent tiles merge only when their sum is prime;
  the result is that sum.
- A tile created by a merge cannot merge again during the same swipe. If a
  pair cannot merge, scanning continues from the next tile.
- Every changed swipe spawns exactly one tile in a random empty cell. An
  unchanged or invalid swipe changes nothing and spawns nothing.
- Initial spawn weights are 1:20, 2:25, 3:10, 4:20, 5:10, and 6:15. When the
  largest board tile reaches 23, 8, 10, and 12 unlock; at 53, 14 and 16 also
  unlock. Each unlocked tile has weight 5. Weights are normalized for each
  spawn.
- If there are fewer even tiles than odd tiles, even spawns gain 20 percentage
  points and odd spawns lose 20; the odd group includes tile 1. Relative
  weights inside each parity group are preserved.
- Each merge adds its result to cumulative **Score**. **Largest prime** is a
  separate run statistic: the largest prime result produced by a merge. Local
  **Best** is the highest largest-prime value built on this device, not the
  highest Score. Local Best is stored under `prime-swipe-best-prime`; storage
  failures are announced and do not prevent play.
- Making exactly 101 marks the goal reached, but never ends the run. Game over
  occurs only when all 16 cells are occupied and no horizontal or vertical
  adjacent pair can make a prime sum.
- 1 is not prime, but **1 + 1 = 2** is a legal merge.

## Play and accessibility

Use the arrow keys, WASD, or swipe the board on a touch screen. The board keeps
keyboard focus, exposes its rows and cells to assistive technology, and
announces move results in a live status region. Controls have visible focus,
minimum touch targets, and reduced-motion behavior. The rules and spawn
distribution are available in the page; the game-over dialog gives a run
summary and replay.

The display face is self-hosted Aldrich under the SIL Open Font License 1.1;
the license is included at `assets/fonts/OFL.txt`.

## Local setup

Requirements: Node.js 20+, npm, and Python (only for the static file server).

### Play without the API

From the repository root:

```powershell
npm test
python -m http.server 5500
```

Open `http://localhost:5500`. The game works without the leaderboard API; its
submission and leaderboard controls report an explicit unavailable state.

### Run the API and frontend together

Terminal 1:

```powershell
cd backend
Copy-Item .env.example .env
npm ci
node --env-file=.env src/server.js
```

The local database is `backend/data/prime-swipe-dev.db`, separate from any
2048 database. It migrates on startup. Terminal 2, from the repository root:

```powershell
$env:NODE_ENV = 'development'
$env:PRIME_SWIPE_API_BASE_URL = 'http://localhost:8080'
npm run pages:prepare -- dev-artifact
python -m http.server 5500 --directory dev-artifact
```

Open `http://localhost:5500`. The development build accepts only an explicit
localhost HTTP API origin; release builds require HTTPS. The committed HTML
keeps its API meta tag empty. To clean up the local artifact, remove only the
named `dev-artifact` directory.

## Tests

Run all frontend tests and API tests separately:

```powershell
npm test
npm ci --prefix backend
npm test --prefix backend
```

The game-engine tests cover primality (including 1+1=2), directional packing
and merge order, no re-merging, invalid and changed moves, spawning, unlocks,
parity assist, score, the 101 milestone, and game over. Frontend/API tests
cover request validation, response validation, errors, and API-origin build
configuration. API tests use temporary databases and cover server-side
validation, persistence, score rankings, ties, idempotency, leaderboard shape,
and migration from an existing version-one Prime Swipe database.

## Leaderboard API

The frontend opts in only when the player enters a name and submits. The
backend validates the name and run fields; it computes rank from cumulative
Score and stores `largestPrime` separately. Equal Scores share competition
rank. The public top-100 response contains rank, display name, Score, largest
prime, and submission time. Rank previews are advisory; only a validated
submission response confirms persistence and rank. A retry reuses the same
per-run idempotency key and payload. Network, API, validation, and empty
leaderboard states are explicit.

API endpoints (relative to the API origin):

- `GET /api/v1/leaderboard/rank?score=<non-negative integer>`
- `POST /api/v1/scores` with a stable `Idempotency-Key` header and
  `{ displayName, score, largestPrime, moves, durationSeconds }`
- `GET /api/v1/leaderboard`
- `GET /api/v1/health`
- `/openapi.json` and `/api-docs/`

See [`backend/README.md`](./backend/README.md) for configuration, response
shapes, errors, database behavior, and separate API hosting steps.

## Hosting and manual release

The Pages workflow is **manual only** (`workflow_dispatch`). It stages exactly
`index.html`, `styles.css`, `game-engine.js`, `leaderboard-api.js`,
`functions.js`, and the self-hosted font and its license; no API source,
database, environment file, or backend secret is included.
`PRIME_SWIPE_API_BASE_URL` is public origin configuration, not a secret.
Production staging rejects a missing value, a non-HTTPS URL, a path, or a
trailing slash.

Before a release, the repository owner still needs to:

1. Follow [`backend/README.md`](./backend/README.md#flyio-api-and-sqlite-volume)
   to create a dedicated Fly.io API app and volume. Do not reuse the `2048`
   app, database, or volume. The included `backend/fly.toml` is a template;
   replace its app-name placeholder and create the volume in the same region
   as the app before deploying.
2. Set the Fly app's `CORS_ORIGINS` to the exact public frontend origin. For a
   standard GitHub Pages site this is `https://<OWNER>.github.io` (origin
   only, no project path); use the exact custom-domain origin if configured.
3. Set the GitHub repository variable `PRIME_SWIPE_API_BASE_URL` to
   `https://prime-swipe.fly.dev`, with no path or trailing slash.
4. In the repository's Pages settings, select **GitHub Actions** as the
   source, then manually run **Deploy Prime Swipe Pages** after reviewing the
   changes.

The API and Pages releases are separate and manual; the Pages workflow never
deploys the API. No hosting-console settings were changed and no deployment
was performed for this implementation. Replace all placeholders with
owner-approved values before setting up either host.
