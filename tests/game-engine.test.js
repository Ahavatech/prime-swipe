const test = require('node:test')
const assert = require('node:assert/strict')
const GameEngine = require('../game-engine')

function randomSequence(...values) {
  let index = 0
  return () => values[index++ % values.length]
}

function gameWith(values, overrides = {}) {
  const board = Array(16).fill(0)
  for (const [index, value] of Object.entries(values)) {
    board[Number(index)] = value
  }
  return {
    board,
    score: 0,
    largestPrime: 0,
    goalAchieved: false,
    unlockedTiles: [],
    status: 'playing',
    ...overrides
  }
}

function assertMergeRecords(outcome) {
  assert.equal(outcome.merges.length, outcome.mergedValues.length)
  assert.equal(outcome.merges.length, outcome.mergedIndices.length)

  outcome.merges.forEach((merge, index) => {
    assert.equal(merge.from[0] + merge.from[1], merge.sum)
    assert.equal(GameEngine.isPrime(merge.sum), true)
    assert.equal(outcome.state.board[merge.index], merge.sum)
    assert.equal(outcome.mergedValues[index], merge.sum)
    assert.equal(outcome.mergedIndices[index], merge.index)
  })
}

test('primality handles 1 + 1 = 2, small composites, and large safe integers', () => {
  assert.equal(GameEngine.isPrime(2), true)
  assert.equal(GameEngine.isPrime(5), true)
  assert.equal(GameEngine.isPrime(1), false)
  assert.equal(GameEngine.isPrime(0), false)
  assert.equal(GameEngine.isPrime(-3), false)
  assert.equal(GameEngine.isPrime(21), false)
  assert.equal(GameEngine.isPrime(4_294_967_291), true)
  assert.equal(GameEngine.isPrime(Number.MAX_SAFE_INTEGER), false)
  assert.equal(GameEngine.isPrime(2.5), false)

  const ones = gameWith({ 0: 1, 1: 1 })
  const merged = GameEngine.move(ones, 'left', randomSequence(0, 0))
  assert.equal(merged.state.board[0], 2)
  assert.equal(merged.scoreDelta, 2)
  assert.deepEqual(merged.merges, [{ index: 0, from: [1, 1], sum: 2 }])
  assertMergeRecords(merged)
})

test('packs and merges left in leading-edge order, skipping non-prime sums', () => {
  const state = gameWith({ 1: 2, 2: 4, 3: 3 })
  const outcome = GameEngine.move(state, 'left', randomSequence(0.99, 0.99))

  assert.deepEqual(outcome.state.board.slice(0, 4), [2, 7, 0, 0])
  assert.equal(outcome.scoreDelta, 7)
  assert.deepEqual(outcome.mergedValues, [7])
  assert.deepEqual(outcome.mergedIndices, [1])
  assertMergeRecords(outcome)
})

test('packs and merges right, up, and down toward the selected edge', () => {
  const row = gameWith({ 0: 1, 1: 2, 2: 4 })
  const right = GameEngine.move(row, 'right', randomSequence(0.99, 0.99))
  assert.deepEqual(right.state.board.slice(0, 4), [0, 0, 3, 4])
  assert.equal(right.scoreDelta, 3)
  assert.deepEqual(right.mergedIndices, [2])
  assertMergeRecords(right)

  const column = gameWith({ 0: 1, 4: 2, 8: 4 })
  const down = GameEngine.move(column, 'down', randomSequence(0.99, 0.99))
  assert.deepEqual(
    [down.state.board[0], down.state.board[4], down.state.board[8], down.state.board[12]],
    [0, 0, 3, 4]
  )
  assert.deepEqual(down.mergedIndices, [8])
  assertMergeRecords(down)

  const upState = gameWith({ 4: 1, 8: 2, 12: 4 })
  const up = GameEngine.move(upState, 'up', randomSequence(0.99, 0.99))
  assert.deepEqual(
    [up.state.board[0], up.state.board[4], up.state.board[8], up.state.board[12]],
    [3, 4, 0, 0]
  )
  assert.deepEqual(up.mergedIndices, [0])
  assertMergeRecords(up)
})

test('a tile produced by a merge cannot merge again during that swipe', () => {
  const state = gameWith({ 0: 1, 1: 2, 2: 4, 3: 3 })
  const outcome = GameEngine.move(state, 'left', randomSequence(0.99, 0.99))

  assert.deepEqual(outcome.state.board.slice(0, 4), [3, 7, 0, 0])
  assert.equal(outcome.scoreDelta, 10)
  assert.deepEqual(outcome.mergedValues, [3, 7])
  assert.deepEqual(outcome.mergedIndices, [0, 1])
  assertMergeRecords(outcome)
})

test('initial game has exactly one odd and one even tile in distinct random cells', () => {
  const state = GameEngine.createGame(randomSequence(0, 0, 0.99, 0.99))
  const occupied = state.board.flatMap((value, index) => value ? [[index, value]] : [])

  assert.equal(occupied.length, 2)
  assert.equal(occupied[0][1] % 2, 1)
  assert.equal(occupied[1][1] % 2, 0)
  assert.equal(occupied[0][0], 0)
  assert.equal(occupied[1][0], 15)
  assert.equal(state.score, 0)
})

test('initial spawn distribution matches the specified weights', () => {
  const distribution = GameEngine.getSpawnDistribution(Array(16).fill(0))
  assert.deepEqual(distribution, { 1: 0.2, 2: 0.25, 3: 0.1, 4: 0.2, 5: 0.1, 6: 0.15 })
  assert.equal(Object.values(distribution).reduce((sum, weight) => sum + weight, 0), 1)
})

test('unlocks spawn values at the 23 and 53 board thresholds', () => {
  const below23 = gameWith({ 0: 22 })
  const at23 = gameWith({ 0: 23, 1: 8 })
  const at53 = gameWith({ 0: 53 })

  assert.deepEqual(GameEngine.unlockForBoard(below23.board), [])
  assert.deepEqual(GameEngine.unlockForBoard(at23.board), [8, 10, 12])
  assert.deepEqual(GameEngine.unlockForBoard(at53.board), [8, 10, 12, 14, 16])

  const unlocked = GameEngine.getSpawnDistribution(at23.board)
  assert.ok(Math.abs(unlocked[8] - 5 / 115) < 1e-12)
  assert.ok(Math.abs(unlocked[10] - 5 / 115) < 1e-12)
  assert.ok(Math.abs(unlocked[12] - 5 / 115) < 1e-12)
  assert.ok(Math.abs(Object.values(unlocked).reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12)
})

test('parity assist shifts 20 percentage points toward even tiles and preserves group weights', () => {
  const board = [1, 3, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  const distribution = GameEngine.getSpawnDistribution(board)
  const evenProbability = distribution[2] + distribution[4] + distribution[6]
  const oddProbability = distribution[1] + distribution[3] + distribution[5]

  assert.ok(Math.abs(evenProbability - 0.8) < 1e-12)
  assert.ok(Math.abs(oddProbability - 0.2) < 1e-12)
  assert.equal(distribution[2] / distribution[4], 25 / 20)
  assert.equal(distribution[1] / distribution[3], 20 / 10)

  const capped = GameEngine.getSpawnDistribution(
    board,
    [8, 10, 12, 14, 16]
  )
  const cappedEven = Object.entries(capped)
    .filter(([value]) => Number(value) % 2 === 0)
    .reduce((sum, [, weight]) => sum + weight, 0)
  assert.ok(Math.abs(cappedEven - 0.88) < 1e-12)
})

test('invalid swipes change nothing and do not spawn', () => {
  const state = gameWith({ 15: 2 })
  const invalid = GameEngine.move(state, 'diagonal', () => {
    throw new Error('Invalid directions must not spawn.')
  })
  const unchanged = GameEngine.move(state, 'right', () => {
    throw new Error('Unchanged moves must not spawn.')
  })

  assert.equal(invalid.state, state)
  assert.equal(unchanged.state, state)
  assert.equal(invalid.moved, false)
  assert.equal(unchanged.moved, false)
  assert.deepEqual(invalid.merges, [])
  assert.deepEqual(unchanged.merges, [])
})

test('a changed swipe spawns exactly once and unlocks persist for the run', () => {
  const state = gameWith({ 1: 20, 2: 3 })
  let randomCalls = 0
  const outcome = GameEngine.move(state, 'left', () => {
    randomCalls += 1
    return 0
  })

  assert.equal(outcome.moved, true)
  assert.equal(randomCalls, 2)
  assert.equal(outcome.state.board.filter(Boolean).length, 2)
  assert.deepEqual(outcome.state.unlockedTiles, [8, 10, 12])

  const next = { ...outcome.state, board: Array(16).fill(0) }
  assert.deepEqual(GameEngine.unlockForBoard(next.board, next.unlockedTiles), [8, 10, 12])
})

test('score and largest-prime value accumulate while reaching 101 does not end the run', () => {
  const state = gameWith({ 0: 45, 1: 56 }, { score: 18, largestPrime: 31 })
  const outcome = GameEngine.move(state, 'left', randomSequence(0.99, 0.99))

  assert.equal(outcome.scoreDelta, 101)
  assert.equal(outcome.state.score, 119)
  assert.equal(outcome.state.largestPrime, 101)
  assert.equal(outcome.state.goalAchieved, true)
  assert.equal(outcome.state.status, 'playing')
})

test('game over requires a full board with no horizontal or vertical prime sum', () => {
  const fullAndDeadlocked = [
    8, 8, 8, 8,
    8, 8, 8, 8,
    8, 8, 8, 8,
    8, 8, 8, 8
  ]
  const fullWithMerge = fullAndDeadlocked.slice()
  fullWithMerge[0] = 1
  fullWithMerge[1] = 2

  assert.equal(GameEngine.isGameOver(fullAndDeadlocked), true)
  assert.equal(GameEngine.isGameOver(fullWithMerge), false)
  assert.equal(GameEngine.isGameOver(fullAndDeadlocked.slice(0, 15).concat(0)), false)
})

test('a changed move that fills a deadlocked board ends the run', () => {
  const state = gameWith({
    0: 8, 2: 16, 3: 24,
    4: 32, 5: 40, 6: 48, 7: 56,
    8: 64, 9: 72, 10: 80, 11: 88,
    12: 96, 13: 104, 14: 112, 15: 120
  })
  state.board[1] = 0
  const outcome = GameEngine.move(state, 'left', randomSequence(0, 0.17))

  assert.equal(outcome.moved, true)
  assert.equal(outcome.state.status, 'game-over')
  assert.equal(outcome.state.board.includes(0), false)
})
