import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../src/app.js'
import { GameEngine } from '../../src/engine/index.js'
import { playRun } from './play-run.js'

export const SECRET = Buffer.alloc(32, 7)
export const START_MS = Date.UTC(2026, 10, 7, 12, 0, 0)

export function testConfig(databasePath, overrides = {}) {
  return {
    nodeEnv: 'test',
    port: 0,
    host: '127.0.0.1',
    databasePath,
    corsOrigins: ['https://game.example.test'],
    rateLimitWindowMs: 60_000,
    rateLimitMax: 1000,
    submitRateLimitMax: 1000,
    trustProxyHops: 0,
    runTokenSecret: SECRET,
    runTokenTtlSeconds: 6 * 60 * 60,
    ...overrides
  }
}

// Starts the real app on a random port with a clock the test controls. `seeds` pins the seeds
// the server hands out, in order, so a test can know them in advance.
export async function createHarness(t, { config, seeds } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-swipe-api-test-'))
  const databasePath = path.join(directory, 'prime-swipe-test.db')
  // `hook`, when set, runs once on the next clock read. The service reads the clock between
  // its first look for an existing run and the commit, so a hook there is a deterministic way
  // to have "another process" write in that gap.
  const clock = { now: START_MS, hook: null }
  const warnings = []
  let nextSeed = 0
  const app = createApp({
    config: testConfig(databasePath, config),
    clock: () => {
      const hook = clock.hook
      clock.hook = null
      hook?.()
      return clock.now
    },
    logger: { warn: message => warnings.push(message), error() {}, log() {} },
    randomSeed: seeds ? () => seeds[nextSeed++ % seeds.length] : undefined
  })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    app.locals.close()
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}`

  const api = {
    app,
    databasePath,
    clock,
    warnings,
    db: app.locals.database,
    request: (route, init) => fetch(`${baseUrl}${route}`, init),
    post(route, body, headers = {}) {
      return api.request(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body)
      })
    },
    async startRun() {
      const response = await api.post('/api/v1/runs', undefined)
      return { status: response.status, ...(await response.json()) }
    },
    // What the browser does: play the seed to the end, then submit. `paceMs` is how long each
    // move took, so the server's clock moves forward the way a real game's would.
    async playAndSubmit({ run, displayName = 'ARCADE ACE', paceMs = 150, maxMoves } = {}) {
      const started = run ?? await api.startRun()
      const played = playRun(started.seed, { maxMoves })
      api.clock.now += played.moveLog.length * paceMs
      const response = await api.submit(started, played)
      return { started, played, response }
    },
    submit(run, { moveLog, state }, overrides = {}) {
      return api.post('/api/v1/scores', {
        displayName: 'ARCADE ACE',
        runToken: run.runToken,
        moveLog,
        score: state.score,
        ...overrides
      })
    },
    count: () => api.db.prepare('SELECT COUNT(*) AS count FROM scores').get().count
  }
  return api
}

// Inserts finished, verified rows directly. For testing ranking, ordering and the 100-row
// limit, where the point is the SQL and not how the rows got there.
export function seedVerifiedScores(db, rows) {
  const insert = db.prepare(`
    INSERT INTO scores (
      display_name, score, largest_prime, moves, duration_seconds, submitted_at,
      idempotency_key, submission_rank, verified, seed, engine_version, move_log
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 'U')
  `)
  db.transaction(values => {
    values.forEach((row, index) => {
      insert.run(
        row.displayName ?? `PLAYER${index}`,
        row.score,
        row.largestPrime ?? 0,
        row.moves ?? 1,
        row.durationSeconds ?? 0,
        new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        row.idempotencyKey ?? `run:seed-${index}`,
        row.rank ?? index + 1,
        GameEngine.VERSION
      )
    })
  })(rows)
}

// A row as the API wrote them before verification existed: verified = 0, no seed or log.
export function seedLegacyScores(db, rows) {
  const insert = db.prepare(`
    INSERT INTO scores (
      display_name, score, largest_prime, moves, duration_seconds, submitted_at,
      idempotency_key, submission_rank
    ) VALUES (?, ?, ?, 10, 10, ?, ?, 1)
  `)
  rows.forEach((row, index) => {
    insert.run(row.displayName ?? `LEGACY${index}`, row.score, row.largestPrime ?? 0, '2025-12-31T00:00:00.000Z', `legacy-${index}`)
  })
}
