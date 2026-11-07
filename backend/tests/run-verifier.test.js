import assert from 'node:assert/strict'
import test from 'node:test'
import { GameEngine } from '../src/engine/index.js'
import { MAX_MOVES, MIN_MS_PER_MOVE, verifyRun } from '../src/services/run-verifier.js'
import { playRun } from './helpers/play-run.js'

const SEED = 424242
const ISSUED = 1_800_000_000_000
const played = playRun(SEED)

function attempt(overrides = {}) {
  const base = {
    engine: GameEngine,
    claims: { runId: 'a'.repeat(32), seed: SEED, issuedAtMs: ISSUED, engineVersion: GameEngine.VERSION },
    expiresAtMs: ISSUED + 6 * 3600 * 1000,
    moveLog: played.moveLog,
    claimedScore: played.state.score,
    nowMs: ISSUED + played.moveLog.length * 150
  }
  return verifyRun({ ...base, ...overrides })
}

function rejection(overrides) {
  try {
    attempt(overrides)
  } catch (error) {
    return { status: error.status, code: error.code, details: error.details }
  }
  assert.fail('expected the run to be rejected')
}

test('a real run is accepted and every number comes from the replay', () => {
  const derived = attempt()
  assert.deepEqual(derived, {
    score: played.state.score,
    largestPrime: played.state.largestPrime,
    moves: played.moveLog.length,
    durationSeconds: Math.round(played.moveLog.length * 150 / 1000)
  })
})

test('a different score claim is rejected and reports the replayed score', () => {
  for (const claimed of [played.state.score + 1, played.state.score - 1, 999_999, 0]) {
    const result = rejection({ claimedScore: claimed })
    assert.equal(result.code, 'SCORE_MISMATCH')
    assert.equal(result.status, 422)
    assert.deepEqual(result.details, [{ replayedScore: played.state.score }])
  }
})

test('an illegal move log is rejected with the first bad position', () => {
  const tampered = `${played.moveLog.slice(0, 10)}Z${played.moveLog.slice(11)}`
  const result = rejection({ moveLog: tampered })
  assert.equal(result.code, 'RUN_REJECTED')
  assert.deepEqual(result.details, [{ reason: 'UNKNOWN_MOVE', index: 10 }])
})

test('a log played under another seed is rejected or does not reproduce the score', () => {
  let refused = 0
  for (const seed of [1, 2, 3, 4, 5]) {
    try {
      attempt({ claims: { runId: 'b'.repeat(32), seed, issuedAtMs: ISSUED, engineVersion: GameEngine.VERSION } })
    } catch (error) {
      assert.ok(['RUN_REJECTED', 'SCORE_MISMATCH'].includes(error.code), error.code)
      refused += 1
    }
  }
  assert.equal(refused, 5)
})

test('a run that started under different rules is refused before any replay', () => {
  const result = rejection({ claims: { runId: 'a'.repeat(32), seed: SEED, issuedAtMs: ISSUED, engineVersion: '0' } })
  assert.equal(result.status, 409)
  assert.equal(result.code, 'ENGINE_VERSION_MISMATCH')
})

test('an expired run is refused, and the boundary is exact', () => {
  const expiresAtMs = ISSUED + 6 * 3600 * 1000
  assert.equal(rejection({ nowMs: expiresAtMs + 1 }).code, 'RUN_EXPIRED')
  assert.equal(rejection({ nowMs: expiresAtMs + 1 }).status, 410)
  assert.doesNotThrow(() => attempt({ nowMs: expiresAtMs }))
})

test('a run submitted faster than it can be played is refused, boundary included', () => {
  const needed = played.moveLog.length * MIN_MS_PER_MOVE
  assert.equal(rejection({ nowMs: ISSUED + needed - 1 }).code, 'RUN_TOO_FAST')
  assert.equal(rejection({ nowMs: ISSUED }).code, 'RUN_TOO_FAST')
  assert.equal(rejection({ nowMs: ISSUED - 5000 }).code, 'RUN_TOO_FAST')
  assert.doesNotThrow(() => attempt({ nowMs: ISSUED + needed }))
})

test('the cheap checks run before the replay, so floods of bad logs cost nothing', () => {
  // This log is illegal AND too fast. The answer must be TOO_FAST, which means the replay
  // never ran. Replay on a hostile log is where the CPU would go.
  const garbage = 'U'.repeat(MAX_MOVES)
  assert.equal(rejection({ moveLog: garbage, nowMs: ISSUED }).code, 'RUN_TOO_FAST')
  // Same for rules mismatch and expiry: neither reaches the replay.
  assert.equal(rejection({ moveLog: garbage, claims: { runId: 'a'.repeat(32), seed: SEED, issuedAtMs: ISSUED, engineVersion: '0' } }).code, 'ENGINE_VERSION_MISMATCH')
})

test('log length bounds are enforced', () => {
  assert.equal(rejection({ moveLog: '' }).code, 'INVALID_MOVE_LOG')
  // Late enough to clear the pace check for this many moves, early enough to be unexpired.
  assert.equal(rejection({ moveLog: 'U'.repeat(MAX_MOVES + 1), nowMs: ISSUED + 10_000_000 }).code, 'INVALID_MOVE_LOG')
})

test('a run that built no prime has nothing to rank', () => {
  let found
  for (let seed = 1; seed < 2000 && !found; seed += 1) {
    for (const code of 'UDLR') {
      const result = GameEngine.replay(seed, code)
      if (result.ok && result.state.score === 0) {
        found = { seed, code }
        break
      }
    }
  }
  assert.ok(found, 'expected a seed whose first move builds no prime')
  const result = rejection({
    claims: { runId: 'c'.repeat(32), seed: found.seed, issuedAtMs: ISSUED, engineVersion: GameEngine.VERSION },
    moveLog: found.code,
    claimedScore: 0,
    nowMs: ISSUED + 1000
  })
  assert.equal(result.code, 'NOTHING_TO_RANK')
  assert.equal(result.status, 422)
})

test('a log may stop before game over: any legal prefix is a legal run', () => {
  const prefix = played.moveLog.slice(0, 30)
  const live = GameEngine.replay(SEED, prefix)
  const derived = attempt({ moveLog: prefix, claimedScore: live.state.score, nowMs: ISSUED + 10_000 })
  assert.equal(derived.moves, 30)
  assert.equal(derived.score, live.state.score)
})
