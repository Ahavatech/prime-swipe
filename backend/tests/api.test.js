import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/db/database.js'

const validPayload = {
  displayName: 'ARCADE ACE',
  score: 2400,
  largestPrime: 101,
  moves: 38,
  durationSeconds: 94
}

function testConfig(databasePath, overrides = {}) {
  return {
    nodeEnv: 'test',
    port: 0,
    host: '127.0.0.1',
    databasePath,
    corsOrigins: ['https://game.example.test'],
    rateLimitWindowMs: 60_000,
    rateLimitMax: 100,
    trustProxyHops: 0,
    ...overrides
  }
}

async function createHarness(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-swipe-api-test-'))
  const databasePath = path.join(directory, 'prime-swipe-test.db')
  const app = createApp({ config: testConfig(databasePath, options.config) })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    app.locals.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  return {
    app,
    databasePath,
    async request(route, init) {
      return fetch(`${baseUrl}${route}`, init)
    }
  }
}

function seedScores(db, rows) {
  const insert = db.prepare(`
    INSERT INTO scores (
      display_name, score, largest_prime, moves, duration_seconds,
      submitted_at, idempotency_key, submission_rank
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  db.transaction(values => {
    values.forEach((row, index) => {
      insert.run(
        row.displayName ?? `PLAYER${index}`,
        row.score,
        row.largestPrime ?? 0,
        row.moves ?? 0,
        row.durationSeconds ?? 0,
        new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        row.idempotencyKey ?? `seed-${index}`,
        row.rank ?? index + 1
      )
    })
  })(rows)
}

test('health endpoint checks the separate Prime Swipe database and OpenAPI describes the contract', async t => {
  const api = await createHarness(t)
  const health = await api.request('/api/v1/health')
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok', database: 'ok' })

  const specResponse = await api.request('/openapi.json')
  const spec = await specResponse.json()
  assert.equal(specResponse.status, 200)
  assert.equal(spec.info.title, 'Prime Swipe Leaderboard API')
  assert.equal(
    spec.paths['/api/v1/scores'].post.requestBody.content['application/json'].schema.required.includes('largestPrime'),
    true
  )
  const docs = await api.request('/api-docs/')
  assert.equal(docs.status, 200)
  assert.match(await docs.text(), /swagger-ui/)
})

test('rank is based on cumulative Score, not largestPrime', async t => {
  const api = await createHarness(t)
  seedScores(api.app.locals.database, [
    { score: 1000, largestPrime: 101 },
    { score: 800, largestPrime: 997 },
    { score: 800, largestPrime: 5 }
  ])

  const tie = await api.request('/api/v1/leaderboard/rank?score=800')
  assert.deepEqual(await tie.json(), {
    rank: 2,
    qualifies: true,
    leaderboardLimit: 100
  })
  const lower = await api.request('/api/v1/leaderboard/rank?score=700')
  assert.deepEqual(await lower.json(), {
    rank: 4,
    qualifies: true,
    leaderboardLimit: 100
  })
})

test('a valid run persists Score and largestPrime separately before confirmation', async t => {
  const api = await createHarness(t)
  const response = await api.request('/api/v1/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'prime-run-1' },
    body: JSON.stringify(validPayload)
  })

  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), {
    displayName: 'ARCADE ACE',
    score: 2400,
    largestPrime: 101,
    rank: 1
  })
  assert.deepEqual(
    api.app.locals.database.prepare('SELECT score, largest_prime AS largestPrime FROM scores').get(),
    { score: 2400, largestPrime: 101 }
  )
})

test('identical idempotent retry returns the original persisted result without duplication', async t => {
  const api = await createHarness(t)
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'prime-run-retry' },
    body: JSON.stringify(validPayload)
  }

  const first = await api.request('/api/v1/scores', init)
  const retry = await api.request('/api/v1/scores', init)
  assert.equal(first.status, 201)
  assert.equal(retry.status, 200)
  assert.deepEqual(await retry.json(), await first.json())
  assert.equal(api.app.locals.database.prepare('SELECT COUNT(*) AS count FROM scores').get().count, 1)

  const conflicting = await api.request('/api/v1/scores', {
    ...init,
    body: JSON.stringify({ ...validPayload, largestPrime: 103 })
  })
  assert.equal(conflicting.status, 409)
  assert.equal((await conflicting.json()).error.code, 'IDEMPOTENCY_CONFLICT')
})

test('leaderboard shape and order keep Score distinct from largestPrime', async t => {
  const api = await createHarness(t)
  seedScores(api.app.locals.database, [
    { score: 1000, largestPrime: 7 },
    { score: 800, largestPrime: 997 },
    { score: 800, largestPrime: 11 }
  ])
  const response = await api.request('/api/v1/leaderboard')
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.limit, 100)
  assert.deepEqual(body.entries.map(({ rank, score, largestPrime }) => ({ rank, score, largestPrime })), [
    { rank: 1, score: 1000, largestPrime: 7 },
    { rank: 2, score: 800, largestPrime: 997 },
    { rank: 2, score: 800, largestPrime: 11 }
  ])
  assert.equal('id' in body.entries[0], false)
  assert.equal('idempotencyKey' in body.entries[0], false)
})

test('backend rejects invalid primes, unsafe values, old 2048 fields, and malformed names', async t => {
  const api = await createHarness(t)
  const invalidPayloads = [
    [{ ...validPayload, largestPrime: 1 }, 'INVALID_LARGEST_PRIME'],
    [{ ...validPayload, largestPrime: 221 }, 'INVALID_LARGEST_PRIME'],
    [{ ...validPayload, largestPrime: Number.MAX_SAFE_INTEGER + 1 }, 'INVALID_LARGEST_PRIME'],
    [{ ...validPayload, score: -1 }, 'INVALID_SCORE'],
    [{ ...validPayload, highestTile: 2048 }, 'INVALID_BODY'],
    [{ ...validPayload, displayName: 'TOO LONG PLAYER' }, 'INVALID_DISPLAY_NAME']
  ]

  for (const [payload, code] of invalidPayloads) {
    const response = await api.request('/api/v1/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `invalid-${code}` },
      body: JSON.stringify(payload)
    })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, code)
  }
  assert.equal(api.app.locals.database.prepare('SELECT COUNT(*) AS count FROM scores').get().count, 0)
})

test('name is normalized before it is stored and returned', async t => {
  const api = await createHarness(t)
  const response = await api.request('/api/v1/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'prime-normalized' },
    body: JSON.stringify({ ...validPayload, displayName: '  PLAYER  ' })
  })
  assert.equal(response.status, 201)
  assert.equal((await response.json()).displayName, 'PLAYER')
})

test('invalid rank queries and missing idempotency keys return explicit errors', async t => {
  const api = await createHarness(t)
  for (const score of ['', '-1', '1.5', 'not-a-score', '9007199254740992']) {
    const response = await api.request(`/api/v1/leaderboard/rank?score=${encodeURIComponent(score)}`)
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'INVALID_SCORE')
  }
  const missingKey = await api.request('/api/v1/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validPayload)
  })
  assert.equal(missingKey.status, 400)
  assert.equal((await missingKey.json()).error.code, 'INVALID_IDEMPOTENCY_KEY')
})

test('CORS, media type, and malformed JSON errors keep consistent envelopes', async t => {
  const api = await createHarness(t)
  const denied = await api.request('/api/v1/leaderboard', {
    headers: { Origin: 'https://unapproved.example.test' }
  })
  assert.equal(denied.status, 403)
  assert.equal((await denied.json()).error.code, 'CORS_ORIGIN_DENIED')

  const mediaType = await api.request('/api/v1/scores', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'prime-media-type' },
    body: JSON.stringify(validPayload)
  })
  assert.equal(mediaType.status, 415)
  assert.equal((await mediaType.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE')

  const malformed = await api.request('/api/v1/scores', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'prime-malformed'
    },
    body: '{'
  })
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).error.code, 'MALFORMED_JSON')
})

test('database rows persist after closing and reopening the Prime Swipe database', async t => {
  const api = await createHarness(t)
  seedScores(api.app.locals.database, [{
    score: 3900,
    largestPrime: 101,
    idempotencyKey: 'persistent-prime-row'
  }])
  api.app.locals.close()

  const reopened = createDatabase(api.databasePath)
  try {
    assert.deepEqual(
      reopened.prepare('SELECT score, largest_prime AS largestPrime FROM scores').get(),
      { score: 3900, largestPrime: 101 }
    )
  } finally {
    reopened.close()
  }
})
