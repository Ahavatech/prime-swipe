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
  submissionId: 'prime-swipe-run-1',
  displayName: 'ARCADE ACE',
  score: 1250,
  largestPrime: 101,
  moves: 33,
  durationSeconds: 91
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

test('submission sends distinct Score and largestPrime values with a stable key', async () => {
  let request
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    fetch: async (url, init) => {
      request = { url, init }
      return jsonResponse({
        displayName: 'ARCADE ACE',
        score: 1250,
        largestPrime: 101,
        rank: 4
      })
    }
  })

  const result = await api.submitScore({ ...run, displayName: '  ARCADE ACE  ' })
  assert.equal(request.url, 'https://api.example.test/api/v1/scores')
  assert.equal(request.init.headers['Idempotency-Key'], run.submissionId)
  assert.deepEqual(JSON.parse(request.init.body), {
    displayName: 'ARCADE ACE',
    score: 1250,
    largestPrime: 101,
    moves: 33,
    durationSeconds: 91
  })
  assert.deepEqual(result, {
    displayName: 'ARCADE ACE',
    score: 1250,
    largestPrime: 101,
    rank: 4,
    source: 'backend'
  })
})

test('frontend validation rejects a non-prime largest-prime value before sending', async () => {
  let requests = 0
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    fetch: async () => {
      requests += 1
      return jsonResponse({})
    }
  })

  await assert.rejects(
    api.submitScore({ ...run, largestPrime: 221 }),
    { code: 'INVALID_LARGEST_PRIME' }
  )
  await assert.rejects(api.getProjectedRank({ score: -1 }), { code: 'INVALID_SCORE' })
  assert.equal(requests, 0)
})

test('leaderboard validates distinct score and largestPrime response fields', async () => {
  const api = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    fetch: async () => jsonResponse({
      entries: [{
        rank: 1,
        displayName: 'ACE',
        score: 2000,
        largestPrime: 101,
        submittedAt: '2026-11-05T10:00:00.000Z'
      }],
      limit: 100
    })
  })

  const result = await api.getLeaderboard()
  assert.equal(result.entries[0].score, 2000)
  assert.equal(result.entries[0].largestPrime, 101)
  assert.equal(result.source, 'backend')
})

test('invalid success bodies and unavailable services never become success-shaped results', async () => {
  const invalid = createLeaderboardApi({
    baseUrl: 'https://api.example.test',
    fetch: async () => jsonResponse({
      displayName: 'ACE',
      score: 1250,
      largestPrime: 12,
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
