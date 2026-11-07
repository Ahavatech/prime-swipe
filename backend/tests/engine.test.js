import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { GameEngine as E } from '../src/engine/index.js'
import { playRun } from './helpers/play-run.js'

const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/golden-run.json', import.meta.url), 'utf8'))

test('the seeded random source is deterministic, in range, and differs by seed', () => {
  const a = E.createSeededRandom(12345)
  const b = E.createSeededRandom(12345)
  const first = Array.from({ length: 1000 }, () => a())
  assert.deepEqual(first, Array.from({ length: 1000 }, () => b()))
  assert.ok(first.every(value => value >= 0 && value < 1))
  assert.notDeepEqual(first.slice(0, 20), Array.from({ length: 20 }, E.createSeededRandom(12346)))
  // Not a degenerate generator: a thousand draws should not collapse onto a few values.
  assert.ok(new Set(first).size > 990)
})

test('seeds outside unsigned 32 bits are refused', () => {
  for (const bad of [-1, 2 ** 32, 1.5, NaN, '5', null, undefined]) {
    assert.throws(() => E.createSeededRandom(bad), RangeError, `seed ${String(bad)}`)
  }
  assert.doesNotThrow(() => E.createSeededRandom(0))
  assert.doesNotThrow(() => E.createSeededRandom(2 ** 32 - 1))
})

test('replaying a log reproduces live play exactly, across many seeds', () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const live = playRun(seed * 104729)
    const replayed = E.replay(seed * 104729, live.moveLog)
    assert.equal(replayed.ok, true, `seed ${seed * 104729}`)
    assert.deepEqual(replayed.state, live.state, `seed ${seed * 104729}`)
    assert.equal(replayed.moveCount, live.moveLog.length)
  }
})

test('the golden run still plays out the way it was recorded', () => {
  // This is a snapshot of what the engine did when the fixture was made. It is not independent
  // proof the rules are right. It exists so that changing spawn weights, merge rules or the
  // random draws fails here until VERSION is bumped on purpose and the fixture regenerated
  // (node tests/helpers/make-golden.mjs). Otherwise every run in flight would silently fail.
  assert.equal(golden.engineVersion, E.VERSION, 'bump VERSION and regenerate the fixture together')
  const result = E.replay(golden.seed, golden.moveLog)
  assert.equal(result.ok, true)
  assert.equal(result.moveCount, golden.expected.moveCount)
  assert.equal(result.state.score, golden.expected.score)
  assert.equal(result.state.largestPrime, golden.expected.largestPrime)
  assert.equal(result.state.status, golden.expected.status)
  assert.deepEqual(result.state.board, golden.expected.board)
})

test('a log is only valid under its own seed', () => {
  const live = playRun(777)
  let rejectedOrDifferent = 0
  for (const other of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const result = E.replay(other, live.moveLog)
    if (!result.ok || result.state.score !== live.state.score) {
      rejectedOrDifferent += 1
    }
  }
  assert.equal(rejectedOrDifferent, 8)
})

test('an unknown letter is rejected with its position', () => {
  const live = playRun(99)
  for (const letter of ['X', 'u', ' ', '0', '\u0000', 'é']) {
    const tampered = `${live.moveLog.slice(0, 5)}${letter}${live.moveLog.slice(6)}`
    assert.deepEqual(E.replay(99, tampered), { ok: false, reason: 'UNKNOWN_MOVE', index: 5 })
  }
})

test('a move that changes nothing is rejected, so a game has exactly one valid log', () => {
  // Find a state where one direction does nothing, then try to pad the log with it.
  let padded
  for (let seed = 1; seed < 500 && !padded; seed += 1) {
    const random = E.createSeededRandom(seed)
    const state = E.createGame(random)
    for (const [code, direction] of Object.entries(E.MOVE_CODES)) {
      if (!E.move(state, direction, E.createSeededRandom(1)).moved) {
        padded = { seed, code }
        break
      }
    }
  }
  assert.ok(padded, 'expected to find a no-op direction on some opening board')
  assert.deepEqual(E.replay(padded.seed, padded.code), { ok: false, reason: 'MOVE_DID_NOTHING', index: 0 })
})

test('moves after game over are rejected', () => {
  const live = playRun(424242)
  assert.equal(live.state.status, 'game-over')
  const result = E.replay(424242, `${live.moveLog}L`)
  assert.deepEqual(result, { ok: false, reason: 'MOVE_AFTER_GAME_OVER', index: live.moveLog.length })
})

test('any prefix of a legal log is itself a legal log', () => {
  const live = playRun(31337)
  for (const length of [1, 2, 10, Math.floor(live.moveLog.length / 2), live.moveLog.length - 1]) {
    assert.equal(E.replay(31337, live.moveLog.slice(0, length)).ok, true, `prefix ${length}`)
  }
})

test('a non-string log is a programming error, not a result', () => {
  assert.throws(() => E.replay(1, ['U']), TypeError)
  assert.throws(() => E.replay(1, null), TypeError)
})

test('move() reports the operands of every merge', () => {
  let checked = 0
  for (let seed = 1; seed <= 20; seed += 1) {
    const random = E.createSeededRandom(seed)
    let state = E.createGame(random)
    for (const code of playRun(seed).moveLog) {
      const before = state.board
      const outcome = E.move(state, E.MOVE_CODES[code], random)
      assert.equal(outcome.merges.length, outcome.mergedValues.length)
      outcome.merges.forEach(merge => {
        assert.equal(merge.from[0] + merge.from[1], merge.sum)
        assert.ok(E.isPrime(merge.sum))
        assert.ok(before.includes(merge.from[0]) && before.includes(merge.from[1]))
        checked += 1
      })
      state = outcome.state
    }
  }
  assert.ok(checked > 100)
})
