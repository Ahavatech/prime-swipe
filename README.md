# Prime Swipe

Prime Swipe is a 4×4 sliding-tile puzzle. Swipe or use the arrow keys or
WASD to pack tiles toward an edge and merge neighboring tiles whose sum is
prime.

The page has a header, a score strip, and the board. Even tiles are sand
colored; odd tiles darken as they grow. A newly merged tile shows its equation
until the next swipe. The rules and leaderboard open in dialogs.

## Rules

- A new run starts with one randomly placed odd tile (1 or 3) and one even
  tile (2 or 4), in different cells.
- After packing, scan from the swipe edge. Merge adjacent tiles when their
  sum is prime. Each tile can merge only once per swipe.
- 1 is not prime, but **1 + 1 = 2** is a legal merge.
- A changed swipe spawns one tile in a random empty cell. An unchanged or
  invalid swipe spawns nothing.
- Initial spawn weights are 1:20, 2:25, 3:10, 4:20, 5:10, and 6:15. When the
  largest board tile reaches 23, tiles 8, 10, and 12 unlock. At 53, tiles 14
  and 16 also unlock. Each unlocked tile has weight 5.
- When the board has fewer even tiles than odd tiles, even spawns gain 20
  percentage points and odd spawns lose 20. Tile 1 counts as odd. The active
  weights are normalized while each parity group's relative weights stay the
  same.
- **Score** is the sum of all merged tile values. **Largest prime** is the
  largest prime tile built during the run. Device Best tracks Largest prime,
  not Score.
- Building exactly 101 marks the goal reached. Play continues. The run ends
  only when the board is full and no horizontal or vertical neighbors can
  merge.

## Run locally

Requirements: Node.js 20+, npm, and Python for the static server.

To play without the leaderboard API, from the repository root run:

```powershell
npm test
python -m http.server 5500
```

Open `http://localhost:5500`.

To run the API locally, open a terminal at the repository root:

```powershell
cd backend
Copy-Item .env.example .env
npm ci
node --env-file=.env src/server.js
```

The API uses `backend/data/prime-swipe-dev.db` and applies migrations at
startup. In a second terminal at the repository root, build and serve the
frontend with its local API origin:

```powershell
$env:NODE_ENV = 'development'
$env:PRIME_SWIPE_API_BASE_URL = 'http://localhost:8080'
npm run pages:prepare -- dev-artifact
python -m http.server 5500 --directory dev-artifact
```

Open `http://localhost:5500`. The build script accepts localhost HTTP only in
development; release builds require an HTTPS API origin.

## Tests

From the repository root:

```powershell
npm test
npm ci --prefix backend
npm test --prefix backend
```

## Leaderboard API

The browser sends a run only after the player enters a name and submits it.
The API ranks by Score and returns Largest prime separately. Repeating a
submission with the same idempotency key and payload returns the saved result.

- `GET /api/v1/leaderboard/rank?score=<integer>` previews rank by Score.
- `POST /api/v1/scores` submits `{ displayName, score, largestPrime, moves, durationSeconds }` with an `Idempotency-Key` header.
- `GET /api/v1/leaderboard` returns the public rankings.
- `GET /api/v1/health` checks the API and database.
- `/openapi.json` and `/api-docs/` provide the API specification and UI.

## Manual release

The API and frontend deploy separately. The API runs on Fly.io as `prime-swipe`
in `ams`, with SQLite on the `prime_swipe_data` volume. From the repository
root, deploy API changes with:

```powershell
cd backend
fly deploy --app prime-swipe
```

Check `https://prime-swipe.fly.dev/api/v1/health` after deployment. Keep one
Machine attached to the SQLite volume unless a replication strategy is added.
If the frontend origin changes, update the API's `CORS_ORIGINS` to that exact
origin and deploy the API again.

GitHub Pages hosts the frontend at
`https://ahavatech.github.io/prime-swipe/`. The repository Actions variable
`PRIME_SWIPE_API_BASE_URL` is set to `https://prime-swipe.fly.dev`. After
pushing frontend changes, run **Deploy Prime Swipe Pages** manually from the
repository's **Actions** tab. The workflow tests the project, stages only the
frontend allowlist and font license, injects the configured API origin, and
deploys Pages. Pages must use **GitHub Actions** as its source.
