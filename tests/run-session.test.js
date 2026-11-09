const test = require('node:test')
const assert = require('node:assert/strict')
const GameEngine = require('../game-engine')
const { createRunSession } = require('../run-session')

function claims(seed) {
  return {
    runToken: `token-${seed}`,
    seed,
    engineVersion: GameEngine.VERSION,
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  }
}

function playToGameOver(session, seed, maxMoves = 5000) {
  const directions = ['up', 'left', 'down', 'right']
  let directionIndex = seed % directions.length
  let attempts = 0
  while (session.snapshot().state.status === 'playing' && attempts < maxMoves) {
    session.move(directions[directionIndex])
    directionIndex = (directionIndex + 1) % directions.length
    attempts += 1
  }
  assert.equal(session.snapshot().state.status, 'game-over', `seed ${seed} did not reach game over`)
}

test('50 seeded games replay to the same score, largest prime, and board', () => {
  for (let seed = 0; seed < 50; seed += 1) {
    const session = createRunSession({ engine: GameEngine, claims: claims(seed) })
    playToGameOver(session, seed)
    const snapshot = session.snapshot()
    const replay = GameEngine.replay(seed, snapshot.moveLog)

    assert.equal(replay.ok, true, `seed ${seed} replay failed`)
    assert.equal(replay.state.score, snapshot.state.score, `seed ${seed} score differs`)
    assert.equal(replay.state.largestPrime, snapshot.state.largestPrime, `seed ${seed} largest prime differs`)
    assert.deepEqual(replay.state.board, snapshot.state.board, `seed ${seed} board differs`)
  }
})

test('moves that change nothing are omitted from the run log', () => {
  const state = GameEngine.createGame(() => 0)
  const engine = {
    ...GameEngine,
    createGame: () => state,
    move: () => ({
      state,
      moved: false,
      scoreDelta: 0,
      mergedValues: [],
      mergedIndices: [],
      merges: []
    })
  }
  const session = createRunSession({ engine, claims: claims(123) })

  assert.equal(session.move('left').moved, false)
  assert.equal(session.snapshot().moveLog, '')
})

test('practice sessions are unranked and contain no run token', () => {
  const session = createRunSession({ engine: GameEngine, claims: null, seed: 42 })
  assert.equal(session.ranked, false)
  assert.equal(session.runToken, null)
  assert.equal(session.snapshot().runToken, null)
})

test('identical claims and moves produce identical logs', () => {
  const runClaims = claims(987654321)
  const first = createRunSession({ engine: GameEngine, claims: runClaims })
  const second = createRunSession({ engine: GameEngine, claims: runClaims })

  for (const direction of ['left', 'up', 'right', 'down', 'left', 'down', 'up', 'right']) {
    first.move(direction)
    second.move(direction)
  }
  assert.equal(first.snapshot().moveLog, second.snapshot().moveLog)
})

test('expiration follows the claims expiry timestamp', () => {
  const expiresAt = new Date(Date.now() + 10_000)
  const session = createRunSession({
    engine: GameEngine,
    claims: { ...claims(9), expiresAt: expiresAt.toISOString() }
  })

  assert.equal(session.isExpired(expiresAt.getTime() - 1), false)
  assert.equal(session.isExpired(expiresAt.getTime()), true)
})
