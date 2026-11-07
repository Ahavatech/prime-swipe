import assert from 'node:assert/strict'
import test from 'node:test'
import { createDatabase } from '../src/db/database.js'
import { GameEngine } from '../src/engine/index.js'
import { createRunTokenCodec } from '../src/services/run-token.js'
import { SECRET, createHarness, seedLegacyScores, seedVerifiedScores } from './helpers/harness.js'
import { playRun } from './helpers/play-run.js'

const GOLDEN_SEED = 424242

async function errorOf(response) {
  const body = await response.json()
  return { status: response.status, code: body.error?.code, details: body.error?.details }
}

test('health endpoint checks the database and OpenAPI describes the verified contract', async t => {
  const api = await createHarness(t)
  const health = await api.request('/api/v1/health')
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok', database: 'ok' })

  const specResponse = await api.request('/openapi.json')
  const spec = await specResponse.json()
  assert.equal(specResponse.status, 200)
  assert.equal(spec.info.title, 'Prime Swipe Leaderboard API')
  assert.ok(spec.paths['/api/v1/runs'].post)
  assert.deepEqual(
    spec.paths['/api/v1/scores'].post.requestBody.content['application/json'].schema.required.sort(),
    ['displayName', 'moveLog', 'runToken', 'score']
  )
  const docs = await api.request('/api-docs/')
  assert.equal(docs.status, 200)
  assert.match(await docs.text(), /swagger-ui/)
})

test('starting a run returns a seed, a token and the rules version', async t => {
  const api = await createHarness(t)
  const run = await api.startRun()
  assert.equal(run.status, 201)
  assert.deepEqual(Object.keys(run).sort(), ['engineVersion', 'expiresAt', 'issuedAt', 'runToken', 'seed', 'status'])
  assert.equal(run.engineVersion, GameEngine.VERSION)
  assert.ok(Number.isInteger(run.seed) && run.seed >= 0 && run.seed < 2 ** 32)
  assert.equal(run.issuedAt, new Date(api.clock.now).toISOString())
  assert.equal(Date.parse(run.expiresAt) - Date.parse(run.issuedAt), 6 * 3600 * 1000)
  assert.equal(api.count(), 0, 'starting a run must not write anything')
})

test('a played run is replayed, stored with its proof, and ranked', async t => {
  const api = await createHarness(t)
  const { started, played, response } = await api.playAndSubmit({ paceMs: 150 })

  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), {
    displayName: 'ARCADE ACE',
    score: played.state.score,
    largestPrime: played.state.largestPrime,
    moves: played.moveLog.length,
    rank: 1
  })
  const row = api.db.prepare(`
    SELECT score, largest_prime AS largestPrime, moves, duration_seconds AS durationSeconds,
           verified, seed, engine_version AS engineVersion, move_log AS moveLog,
           idempotency_key AS runKey
    FROM scores
  `).get()
  assert.deepEqual(
    { ...row, runKey: undefined },
    {
      score: played.state.score,
      largestPrime: played.state.largestPrime,
      moves: played.moveLog.length,
      durationSeconds: Math.round(played.moveLog.length * 150 / 1000),
      verified: 1,
      seed: started.seed,
      engineVersion: GameEngine.VERSION,
      moveLog: played.moveLog,
      runKey: undefined
    }
  )
  assert.match(row.runKey, /^run:[0-9a-f]{32}$/)

  const board = await (await api.request('/api/v1/leaderboard')).json()
  assert.equal(board.entries.length, 1)
  assert.equal(board.entries[0].score, played.state.score)
})

test('the score the browser claims is a checksum and never what gets stored', async t => {
  const api = await createHarness(t)
  const run = await api.startRun()
  const played = playRun(run.seed)
  api.clock.now += played.moveLog.length * 150

  for (const claimed of [played.state.score + 1, played.state.score + 10_000, 9_999_999, played.state.score - 1]) {
    const rejected = await errorOf(await api.submit(run, played, { score: claimed }))
    assert.equal(rejected.status, 422)
    assert.equal(rejected.code, 'SCORE_MISMATCH')
    assert.deepEqual(rejected.details, [{ replayedScore: played.state.score }])
  }
  assert.equal(api.count(), 0)
  assert.equal(api.warnings.length, 4, 'a score mismatch is worth a log line: it can mean the engines drifted')

  // The honest claim still works afterwards: rejected attempts do not use up the run.
  assert.equal((await api.submit(run, played)).status, 201)
})

test('forged, edited and foreign run tokens are rejected', async t => {
  const api = await createHarness(t)
  const run = await api.startRun()
  const played = playRun(run.seed)
  api.clock.now += played.moveLog.length * 150
  const [prefix, payload, mac] = run.runToken.split('.')

  // Same MAC, different seed: the classic "pick my own seed" forgery.
  const edited = JSON.parse(Buffer.from(payload, 'base64url').toString())
  edited.s = edited.s === 0 ? 1 : edited.s - 1
  const withOtherSeed = `${prefix}.${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${mac}`

  // A token that is perfectly valid, but from a server with a different secret.
  const foreign = createRunTokenCodec({ secret: Buffer.alloc(32, 99), ttlSeconds: 3600, now: () => api.clock.now })
    .issue(GameEngine.VERSION).token
  // Correctly signed by us, but the run id is not a run id.
  const ours = createRunTokenCodec({ secret: SECRET, ttlSeconds: 3600, now: () => api.clock.now })

  for (const token of [withOtherSeed, foreign, 'garbage', `${prefix}.${payload}`, `${payload}.${mac}`, run.runToken.slice(0, -1), `${run.runToken}x`]) {
    const rejected = await errorOf(await api.submit({ runToken: token }, played))
    assert.deepEqual([rejected.status, rejected.code], [400, 'INVALID_RUN_TOKEN'], token.slice(0, 30))
  }
  assert.ok(ours)
  assert.equal(api.count(), 0)
})

test('an older client that still sends a bare score is told what changed', async t => {
  const api = await createHarness(t)
  const legacy = {
    displayName: 'ARCADE ACE',
    score: 2400,
    largestPrime: 101,
    moves: 38,
    durationSeconds: 94
  }
  const rejected = await errorOf(await api.post('/api/v1/scores', legacy, { 'Idempotency-Key': 'prime-swipe-abc' }))
  assert.deepEqual([rejected.status, rejected.code], [400, 'RUN_TOKEN_REQUIRED'])
  assert.equal(api.count(), 0)
})

test('edited, truncated and extended move logs are caught, and the server agrees with the engine', async t => {
  const api = await createHarness(t, { seeds: [GOLDEN_SEED] })
  const run = await api.startRun()
  const played = playRun(run.seed)
  const original = played.moveLog
  api.clock.now += 10 * 60 * 1000

  const candidates = new Set()
  for (const index of [0, 2, 7, 15, 30, 45, original.length - 1]) {
    for (const letter of 'UDLR') {
      if (letter !== original[index]) {
        candidates.add(original.slice(0, index) + letter + original.slice(index + 1))
      }
    }
  }
  for (let length = 5; length < original.length; length += 6) {
    candidates.add(original.slice(0, length))
  }
  for (const extra of ['U', 'L', 'UD', 'RRRR']) {
    candidates.add(original + extra)
  }
  candidates.delete(original)

  // What the engine says should happen, for each. Anything that is a legal game with the same
  // score as the claim would be accepted, so those go last: accepting one uses up the run.
  const claimed = played.state.score
  const expectations = [...candidates].map(moveLog => {
    const result = GameEngine.replay(run.seed, moveLog)
    const code = !result.ok ? 'RUN_REJECTED' : result.state.score !== claimed ? 'SCORE_MISMATCH' : 'ACCEPTED'
    return { moveLog, code }
  }).sort((a, b) => (a.code === 'ACCEPTED') - (b.code === 'ACCEPTED'))

  const kinds = new Set(expectations.map(item => item.code))
  assert.ok(kinds.has('RUN_REJECTED') && kinds.has('SCORE_MISMATCH'), 'the mutation set should hit both failure paths')

  for (const { moveLog, code } of expectations) {
    const response = await api.submit(run, { moveLog, state: played.state })
    if (code === 'ACCEPTED') {
      // A different log that really is a legal game with that exact score: stored as what it is.
      assert.equal(response.status, 201)
      break
    }
    const rejected = await errorOf(response)
    assert.deepEqual([rejected.status, rejected.code], [422, code], moveLog)
  }
})

test('a move log from one run does not work under another run', async t => {
  const api = await createHarness(t, { seeds: [111, 222] })
  const runA = await api.startRun()
  const runB = await api.startRun()
  const playedA = playRun(runA.seed)
  api.clock.now += 10 * 60 * 1000

  const underB = GameEngine.replay(runB.seed, playedA.moveLog)
  assert.ok(!underB.ok || underB.state.score !== playedA.state.score, 'precondition: seeds 111 and 222 play differently')

  const rejected = await errorOf(await api.submit(runB, playedA))
  assert.equal(rejected.status, 422)
  assert.ok(['RUN_REJECTED', 'SCORE_MISMATCH'].includes(rejected.code))
  assert.equal(api.count(), 0)
})

test('a run can be submitted once: other contents conflict, an identical retry is answered from storage', async t => {
  const api = await createHarness(t)
  const { started, played, response } = await api.playAndSubmit()
  const first = await response.json()
  assert.equal(response.status, 201)

  const retry = await api.submit(started, played)
  assert.equal(retry.status, 200)
  assert.deepEqual(await retry.json(), first)

  const renamed = await errorOf(await api.submit(started, played, { displayName: 'SOMEONE ELSE' }))
  assert.deepEqual([renamed.status, renamed.code], [409, 'RUN_ALREADY_SUBMITTED'])

  const prefix = played.moveLog.slice(0, 20)
  const shorter = GameEngine.replay(started.seed, prefix)
  const other = await errorOf(await api.submit(started, { moveLog: prefix, state: shorter.state }))
  assert.deepEqual([other.status, other.code], [409, 'RUN_ALREADY_SUBMITTED'])

  assert.equal(api.count(), 1)
})

test('a write by another process between the check and the commit is handled, not a 500', async t => {
  // The service looks for an existing run, replays, then commits. If a second process commits the
  // same run in that gap, the commit must notice (inside its transaction) instead of tripping
  // the UNIQUE key. Node runs a request synchronously, so the gap is forced through the clock.
  const insertRival = (api, runToken, row) => {
    const { claims } = createRunTokenCodec({ secret: SECRET, ttlSeconds: 3600 }).verify(runToken)
    const rival = createDatabase(api.databasePath)
    try {
      rival.prepare(`
        INSERT INTO scores (display_name, score, moves, duration_seconds, submitted_at, idempotency_key,
                            submission_rank, largest_prime, verified, seed, engine_version, move_log)
        VALUES (?, ?, ?, 5, '2026-01-01T00:00:00.000Z', ?, 1, ?, 1, ?, ?, ?)
      `).run(row.displayName, row.score, row.moves, `run:${claims.runId}`, row.largestPrime, claims.seed, GameEngine.VERSION, row.moveLog)
    } finally {
      rival.close()
    }
  }

  for (const [label, rivalName, expected] of [
    ['identical contents', 'ARCADE ACE', [200, null]],
    ['different name', 'SOMEONE ELSE', [409, 'RUN_ALREADY_SUBMITTED']]
  ]) {
    const api = await createHarness(t)
    const run = await api.startRun()
    const played = playRun(run.seed)
    api.clock.now += played.moveLog.length * 150
    api.clock.hook = () => insertRival(api, run.runToken, {
      displayName: rivalName,
      score: played.state.score,
      largestPrime: played.state.largestPrime,
      moves: played.moveLog.length,
      moveLog: played.moveLog
    })

    const response = await api.submit(run, played)
    const body = await response.json()
    assert.equal(response.status, expected[0], label)
    assert.equal(body.error?.code ?? null, expected[1], label)
    assert.equal(api.count(), 1, `${label}: exactly one row`)
  }
})

test('the largest accepted request fits inside the body limit', async t => {
  // MAX_MOVES and the 8 KB limit have to stay consistent: raising one without the other would
  // turn a valid maximum-length log into a 413.
  const api = await createHarness(t)
  const run = await api.startRun()
  const response = await api.post('/api/v1/scores', {
    displayName: 'W'.repeat(12),
    runToken: run.runToken,
    moveLog: 'U'.repeat(5000),
    score: Number.MAX_SAFE_INTEGER
  })
  assert.notEqual(response.status, 413)
  assert.equal((await errorOf(response)).code, 'RUN_TOO_FAST')
})

test('a retry that claims a different score is refused, as the first attempt would have been', async t => {
  const api = await createHarness(t)
  const { started, played, response } = await api.playAndSubmit()
  const first = await response.json()
  assert.equal(response.status, 201)

  // Same run, same name, same moves, wrong score claim. On a first attempt this is 422; a retry
  // must not turn it into a 200 just because the run is already stored.
  for (const claimed of [played.state.score + 1, played.state.score - 1, 0, 9_999_999]) {
    const rejected = await errorOf(await api.submit(started, played, { score: claimed }))
    assert.deepEqual([rejected.status, rejected.code], [422, 'SCORE_MISMATCH'], `claimed ${claimed}`)
    assert.deepEqual(rejected.details, [{ replayedScore: played.state.score }])
  }

  // The honest retry is still answered from storage, unchanged.
  const honest = await api.submit(started, played)
  assert.equal(honest.status, 200)
  assert.deepEqual(await honest.json(), first)
  assert.equal(api.count(), 1)
})

test('a retry still works after the token has expired', async t => {
  const api = await createHarness(t)
  const { started, played, response } = await api.playAndSubmit()
  const first = await response.json()
  api.clock.now += 7 * 3600 * 1000
  const retry = await api.submit(started, played)
  assert.equal(retry.status, 200)
  assert.deepEqual(await retry.json(), first)
})

test('an expired run is refused', async t => {
  const api = await createHarness(t)
  const run = await api.startRun()
  const played = playRun(run.seed)
  api.clock.now += 6 * 3600 * 1000 + 1
  const rejected = await errorOf(await api.submit(run, played))
  assert.deepEqual([rejected.status, rejected.code], [410, 'RUN_EXPIRED'])
  assert.equal(api.count(), 0)
})

test('a run submitted faster than it can be played is refused, and is not used up by the attempt', async t => {
  const api = await createHarness(t)
  const run = await api.startRun()
  const played = playRun(run.seed)

  const tooFast = await errorOf(await api.submit(run, played))
  assert.deepEqual([tooFast.status, tooFast.code], [422, 'RUN_TOO_FAST'])
  assert.equal(api.count(), 0)

  api.clock.now += played.moveLog.length * 150
  assert.equal((await api.submit(run, played)).status, 201)
})

test('a run that started under different rules is refused with a clear reason', async t => {
  const api = await createHarness(t)
  const oldRules = createRunTokenCodec({ secret: SECRET, ttlSeconds: 3600, now: () => api.clock.now }).issue('0')
  const played = playRun(oldRules.claims.seed)
  api.clock.now += played.moveLog.length * 150
  const rejected = await errorOf(await api.submit({ runToken: oldRules.token }, played))
  assert.deepEqual([rejected.status, rejected.code], [409, 'ENGINE_VERSION_MISMATCH'])
  assert.equal(api.warnings.length, 1)
})

test('a run that built no prime is not ranked', async t => {
  let found
  for (let seed = 1; seed < 2000 && !found; seed += 1) {
    for (const code of 'UDLR') {
      const result = GameEngine.replay(seed, code)
      if (result.ok && result.state.score === 0) {
        found = { seed, code, state: result.state }
        break
      }
    }
  }
  const api = await createHarness(t, { seeds: [found.seed] })
  const run = await api.startRun()
  api.clock.now += 1000
  const rejected = await errorOf(await api.submit(run, { moveLog: found.code, state: found.state }))
  assert.deepEqual([rejected.status, rejected.code], [422, 'NOTHING_TO_RANK'])
})

test('two simultaneous submissions of one run store exactly one row', async t => {
  const api = await createHarness(t)
  const run = await api.startRun()
  const played = playRun(run.seed)
  api.clock.now += played.moveLog.length * 150

  const identical = await Promise.all([api.submit(run, played), api.submit(run, played)])
  assert.deepEqual(identical.map(response => response.status).sort(), [200, 201])
  assert.deepEqual(await identical[0].json(), await identical[1].json())
  assert.equal(api.count(), 1)

  const second = await api.startRun()
  const playedSecond = playRun(second.seed)
  api.clock.now += playedSecond.moveLog.length * 150
  const racing = await Promise.all([
    api.submit(second, playedSecond, { displayName: 'ONE' }),
    api.submit(second, playedSecond, { displayName: 'TWO' })
  ])
  assert.deepEqual(racing.map(response => response.status).sort(), [201, 409])
  assert.equal(api.count(), 2)
})

test('scores from verified runs are ranked together and ties share a rank', async t => {
  const api = await createHarness(t, { seeds: [1, 2, 3, 4] })
  const results = []
  for (let i = 0; i < 4; i += 1) {
    const { played, response } = await api.playAndSubmit({ displayName: `PLAYER${i}` })
    assert.equal(response.status, 201)
    results.push({ score: played.state.score, rank: (await response.json()).rank })
    api.clock.now += 1000
  }
  results.forEach((result, index) => {
    const higherBefore = results.slice(0, index).filter(other => other.score > result.score).length
    assert.equal(result.rank, higherBefore + 1, `run ${index} (score ${result.score})`)
  })

  const board = (await (await api.request('/api/v1/leaderboard')).json()).entries
  assert.deepEqual(board.map(entry => entry.score), [...board.map(entry => entry.score)].sort((a, b) => b - a))
  const tie = board.find((entry, index) => index > 0 && entry.score === board[index - 1].score)
  if (tie) {
    assert.equal(tie.rank, board[board.indexOf(tie) - 1].rank)
  }
})

test('legacy rows appear in score order and are clearly marked unverified', async t => {
  const api = await createHarness(t)
  seedLegacyScores(api.db, [{ score: 999_999, largestPrime: 997 }, { score: 500_000 }])
  seedVerifiedScores(api.db, [{ score: 1000, largestPrime: 101 }, { score: 800 }])

  const board = await (await api.request('/api/v1/leaderboard')).json()
  assert.deepEqual(board.entries.map(entry => entry.score), [999_999, 500_000, 1000, 800])
  assert.deepEqual(board.entries.map(entry => entry.verified), [false, false, true, true])
  assert.deepEqual(board.entries.map(entry => entry.rank), [1, 2, 3, 4])

  const preview = await (await api.request('/api/v1/leaderboard/rank?score=900')).json()
  assert.deepEqual(preview, { rank: 4, qualifies: true, leaderboardLimit: 100 })
  assert.equal(api.db.prepare('SELECT COUNT(*) AS c FROM scores WHERE verified = 0').get().c, 2)
})

test('rank is based on cumulative Score, not largestPrime, and rank 100 is the cut line', async t => {
  const api = await createHarness(t)
  seedVerifiedScores(api.db, [
    { score: 1000, largestPrime: 101 },
    { score: 800, largestPrime: 997 },
    { score: 800, largestPrime: 5 }
  ])
  assert.deepEqual(await (await api.request('/api/v1/leaderboard/rank?score=800')).json(), { rank: 2, qualifies: true, leaderboardLimit: 100 })
  assert.deepEqual(await (await api.request('/api/v1/leaderboard/rank?score=700')).json(), { rank: 4, qualifies: true, leaderboardLimit: 100 })

  seedVerifiedScores(api.db, Array.from({ length: 97 }, (_, i) => ({ score: 5000 + i, idempotencyKey: `run:fill-${i}` })))
  // 3 + 97 scores above 700 puts it at 101st: past the limit, so no rank is reported.
  assert.deepEqual(await (await api.request('/api/v1/leaderboard/rank?score=700')).json(), { rank: null, qualifies: false, leaderboardLimit: 100 })
  assert.equal((await (await api.request('/api/v1/leaderboard')).json()).entries.length, 100)
})

test('public entries expose no seed, move log, run key or id', async t => {
  const api = await createHarness(t)
  await api.playAndSubmit()
  const board = await (await api.request('/api/v1/leaderboard')).json()
  assert.deepEqual(Object.keys(board.entries[0]).sort(), ['displayName', 'largestPrime', 'rank', 'score', 'submittedAt', 'verified'])
  assert.equal(board.entries[0].verified, true)
  assert.deepEqual(Object.keys(board).sort(), ['entries', 'limit'])
})

test('submission validation names the problem', async t => {
  const api = await createHarness(t)
  const run = await api.startRun()
  const played = playRun(run.seed)
  api.clock.now += played.moveLog.length * 150
  const valid = { displayName: 'ARCADE ACE', runToken: run.runToken, moveLog: played.moveLog, score: played.state.score }

  const cases = [
    [{ ...valid, displayName: 'TOO LONG PLAYER' }, 'INVALID_DISPLAY_NAME'],
    [{ ...valid, displayName: 'bad<name>' }, 'INVALID_DISPLAY_NAME'],
    [{ ...valid, displayName: '   ' }, 'INVALID_DISPLAY_NAME'],
    [{ ...valid, displayName: 5 }, 'INVALID_DISPLAY_NAME'],
    [{ ...valid, runToken: 5 }, 'INVALID_RUN_TOKEN'],
    [{ ...valid, runToken: '' }, 'INVALID_RUN_TOKEN'],
    [{ ...valid, runToken: 'x'.repeat(513) }, 'INVALID_RUN_TOKEN'],
    [{ ...valid, score: -1 }, 'INVALID_SCORE'],
    [{ ...valid, score: 1.5 }, 'INVALID_SCORE'],
    [{ ...valid, score: '689' }, 'INVALID_SCORE'],
    [{ ...valid, score: Number.MAX_SAFE_INTEGER + 1 }, 'INVALID_SCORE'],
    [{ ...valid, moveLog: '' }, 'INVALID_MOVE_LOG'],
    [{ ...valid, moveLog: 'UDLX' }, 'INVALID_MOVE_LOG'],
    [{ ...valid, moveLog: 'udlr' }, 'INVALID_MOVE_LOG'],
    [{ ...valid, moveLog: 'U'.repeat(5001) }, 'INVALID_MOVE_LOG'],
    [{ ...valid, moveLog: ['U'] }, 'INVALID_MOVE_LOG'],
    [{ ...valid, highestTile: 2048 }, 'INVALID_BODY'],
    [{ ...valid, largestPrime: 101 }, 'INVALID_BODY'],
    [{ ...valid, moves: 38 }, 'INVALID_BODY'],
    [[valid], 'INVALID_BODY'],
    // express.json({ strict: true }) refuses anything that is not an object or array, so a
    // bare null never reaches the validator.
    [null, 'MALFORMED_JSON']
  ]
  for (const [body, code] of cases) {
    const rejected = await errorOf(await api.post('/api/v1/scores', JSON.stringify(body)))
    assert.deepEqual([rejected.status, rejected.code], [400, code], JSON.stringify(body)?.slice(0, 80))
  }
  assert.equal(api.count(), 0)
})

test('the display name is normalized before it is stored and returned', async t => {
  const api = await createHarness(t)
  const run = await api.startRun()
  const played = playRun(run.seed)
  api.clock.now += played.moveLog.length * 150
  const response = await api.submit(run, played, { displayName: '  PLAYER  ' })
  assert.equal(response.status, 201)
  assert.equal((await response.json()).displayName, 'PLAYER')
})

test('invalid rank queries return explicit errors', async t => {
  const api = await createHarness(t)
  for (const score of ['', '-1', '1.5', 'not-a-score', '9007199254740992']) {
    const response = await api.request(`/api/v1/leaderboard/rank?score=${encodeURIComponent(score)}`)
    const rejected = await errorOf(response)
    assert.deepEqual([rejected.status, rejected.code], [400, 'INVALID_SCORE'])
  }
})

test('the two POST endpoints share a stricter rate limit; reads are unaffected', async t => {
  const api = await createHarness(t, { config: { submitRateLimitMax: 3 } })
  assert.equal((await api.startRun()).status, 201)
  assert.equal((await api.startRun()).status, 201)
  assert.equal((await api.post('/api/v1/scores', {})).status, 400)
  const limited = await api.post('/api/v1/runs', undefined)
  assert.equal(limited.status, 429)
  assert.equal((await limited.json()).error.code, 'RATE_LIMITED')
  assert.ok(limited.headers.get('retry-after'))
  assert.equal((await api.request('/api/v1/leaderboard')).status, 200)
})

test('CORS, media type and malformed JSON errors keep consistent envelopes', async t => {
  const api = await createHarness(t)
  const denied = await api.request('/api/v1/leaderboard', { headers: { Origin: 'https://unapproved.example.test' } })
  assert.equal(denied.status, 403)
  assert.equal((await denied.json()).error.code, 'CORS_ORIGIN_DENIED')

  const preflight = await api.request('/api/v1/scores', {
    method: 'OPTIONS',
    headers: { Origin: 'https://game.example.test' }
  })
  assert.equal(preflight.status, 204)
  assert.match(preflight.headers.get('access-control-allow-headers'), /Content-Type/)

  const mediaType = await api.request('/api/v1/scores', { method: 'POST', body: '{}' })
  assert.equal((await errorOf(mediaType)).code, 'UNSUPPORTED_MEDIA_TYPE')

  const malformed = await api.post('/api/v1/scores', '{')
  assert.deepEqual([malformed.status, (await malformed.json()).error.code], [400, 'MALFORMED_JSON'])
})

test('a verified run persists after closing and reopening the database', async t => {
  const api = await createHarness(t)
  const { played, response } = await api.playAndSubmit()
  assert.equal(response.status, 201)
  api.app.locals.close()

  const reopened = createDatabase(api.databasePath)
  try {
    assert.deepEqual(
      reopened.prepare('SELECT score, verified, move_log AS moveLog FROM scores').get(),
      { score: played.state.score, verified: 1, moveLog: played.moveLog }
    )
  } finally {
    reopened.close()
  }
})
