const test = require('node:test')
const assert = require('node:assert/strict')
const { createLeaderboardApi } = require('../leaderboard-api')

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }
}

const run = {
  runToken: 'signed-run-token',
  moveLog: 'UDLRUDLRUDLRUDLRUDLRUDLRUDLRUDLRU',
  displayName: 'ARCADE ACE',
  score: 1250
}

test('rank requests and responses use cumulative Score only', async () => {
  const requests = []
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    fetch: async (url, init) => {
      requests.push({ url, init })
      return jsonResponse({ rank: 7, qualifies: true, leaderboardLimit: 100 })
    }
  })

  assert.deepEqual(await api.getProjectedRank({ score: 1250 }), {
    rank: 7,
    qualifies: true,
    leaderboardLimit: 100,
    source: 'backend'
  })
  assert.equal(requests[0].url, 'https://api.example.test/api/v1/leaderboard/rank?score=1250')
  assert.equal(requests[0].init.credentials, 'omit')
})

test('starting a run requests and validates a server seed and token', async () => {
  let request
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    fetch: async (url, init) => {
      request = { url, init }
      return jsonResponse({
        runToken: 'signed-run-token',
        seed: 4294967295,
        engineVersion: '1',
        issuedAt: '2026-11-07T10:00:00.000Z',
        expiresAt: '2026-11-07T16:00:00.000Z'
      }, 201)
    }
  })

  assert.deepEqual(await api.startRun(), {
    runToken: 'signed-run-token',
    seed: 4294967295,
    engineVersion: '1',
    issuedAt: '2026-11-07T10:00:00.000Z',
    expiresAt: '2026-11-07T16:00:00.000Z',
    source: 'backend'
  })
  assert.equal(request.url, 'https://api.example.test/api/v1/runs')
  assert.equal(request.init.method, 'POST')
  assert.equal(request.init.body, undefined)
})

test('submission sends only the verified run contract without an idempotency header', async () => {
  let request
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    fetch: async (url, init) => {
      request = { url, init }
      return jsonResponse({
        displayName: 'ARCADE ACE',
        score: 1250,
        largestPrime: 101,
        moves: run.moveLog.length,
        rank: 4
      })
    }
  })

  const result = await api.submitScore({ ...run, displayName: '  ARCADE ACE  ' })
  assert.equal(request.url, 'https://api.example.test/api/v1/scores')
  assert.equal(request.init.headers['Idempotency-Key'], undefined)
  assert.deepEqual(JSON.parse(request.init.body), { ...run, displayName: 'ARCADE ACE' })
  assert.deepEqual(result, {
    displayName: 'ARCADE ACE',
    score: 1250,
    largestPrime: 101,
    moves: run.moveLog.length,
    rank: 4,
    source: 'backend'
  })
})

test('submission validation rejects invalid run proofs before sending', async () => {
  let requests = 0
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    fetch: async () => {
      requests += 1
      return jsonResponse({})
    }
  })

  await assert.rejects(
    api.submitScore({ ...run, moveLog: 'up' }),
    { code: 'INVALID_MOVE_LOG' }
  )
  await assert.rejects(api.submitScore({ ...run, runToken: '' }), { code: 'INVALID_RUN_TOKEN' })
  await assert.rejects(api.getProjectedRank({ score: -1 }), { code: 'INVALID_SCORE' })
  assert.equal(requests, 0)
})

test('run submission errors have plain recovery messages', async () => {
  const errors = [
    ['RUN_TOKEN_REQUIRED', /refresh/i],
    ['INVALID_RUN_TOKEN', /new game/i],
    ['RUN_ALREADY_SUBMITTED', /already submitted/i],
    ['ENGINE_VERSION_MISMATCH', /rules have changed/i],
    ['RUN_EXPIRED', /expired/i],
    ['RUN_REJECTED', /move history/i],
    ['SCORE_MISMATCH', /score did not match/i],
    ['RUN_TOO_FAST', /too quickly/i],
    ['NOTHING_TO_RANK', /rankable score/i]
  ]

  for (const [code, message] of errors) {
    const api = createLeaderboardApi({
      baseUrl: 'https://api.example.test',
      fetch: async () => jsonResponse({ error: { code, message: 'Technical server error.' } }, 422)
    })
    await assert.rejects(api.submitScore(run), error => {
      assert.equal(error.code, code)
      assert.match(error.message, message)
      assert.doesNotMatch(error.message, /Technical server error/)
      return true
    })
  }
})

test('leaderboard validates separate score, largestPrime and verification fields', async () => {
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    fetch: async () => jsonResponse({
      entries: [{
        rank: 1,
        displayName: 'ACE',
        score: 2000,
        largestPrime: 101,
        submittedAt: '2026-11-05T10:00:00.000Z',
        verified: true
      }],
      limit: 100
    })
  })

  const result = await api.getLeaderboard()
  assert.equal(result.entries[0].score, 2000)
  assert.equal(result.entries[0].largestPrime, 101)
  assert.equal(result.entries[0].verified, true)
  assert.equal(result.source, 'backend')
})

test('legacy leaderboard entries may contain historical non-prime values', async () => {
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    fetch: async () => jsonResponse({
      entries: [{
        rank: 1,
        displayName: 'ACE',
        score: 2000,
        largestPrime: 12,
        submittedAt: '2026-11-05T10:00:00.000Z',
        verified: false
      }],
      limit: 100
    })
  })

  const result = await api.getLeaderboard()
  assert.equal(result.entries[0].verified, false)
  assert.equal(result.entries[0].largestPrime, 12)
})

test('invalid success bodies and unavailable services never become success-shaped results', async () => {
  const invalid = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    fetch: async () => jsonResponse({
      displayName: 'ACE',
      score: 1250,
      largestPrime: 12,
      moves: run.moveLog.length,
      rank: 1
    })
  })
  await assert.rejects(invalid.submitScore(run), { code: 'INVALID_RESPONSE' })

  const unavailable = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    fetch: async () => { throw new Error('offline') }
  })
  await assert.rejects(unavailable.getLeaderboard(), { code: 'UNAVAILABLE' })
})

test('an empty API origin reports an explicit unavailable error', async () => {
  const api = createLeaderboardApi({ baseUrl: '', fetch: async () => jsonResponse({}) })
  await assert.rejects(api.getProjectedRank({ score: 0 }), { code: 'UNAVAILABLE' })
})
