import { HttpError } from '../utils/http-error.js'

// Upper bound on a move log. The 8 KB body limit is what really caps the request; this keeps
// the error message honest and the replay cost bounded (about 10 microseconds per move).
export const MAX_MOVES = 5000

// A run cannot finish faster than this many milliseconds per move, measured by the server
// from the moment it issued the run. It is a speed bump for scripts that submit a precomputed
// game instantly, not a defence: a script can wait. 40 ms is 25 moves a second, well past
// what a person sustains, so honest players never see it.
export const MIN_MS_PER_MOVE = 40

// Decides whether a claimed run is real and returns the numbers the server will store. Every
// returned value comes from replaying the game. The only thing taken from the client is
// the move log, and `claimedScore` is a checksum that must match, never a source of truth.
//
// Cheap checks run first so a flood of bad submissions never reaches the replay.
export function verifyRun({ engine, claims, expiresAtMs, moveLog, claimedScore, nowMs }) {
  if (claims.engineVersion !== engine.VERSION) {
    throw new HttpError(
      409,
      'ENGINE_VERSION_MISMATCH',
      'This run started under a different version of the game rules. Start a new run to submit a score.'
    )
  }
  if (nowMs > expiresAtMs) {
    throw new HttpError(410, 'RUN_EXPIRED', 'This run is too old to submit. Start a new run.')
  }
  if (moveLog.length < 1 || moveLog.length > MAX_MOVES) {
    throw new HttpError(400, 'INVALID_MOVE_LOG', `moveLog must contain 1 to ${MAX_MOVES} moves.`)
  }

  const elapsedMs = nowMs - claims.issuedAtMs
  if (elapsedMs < moveLog.length * MIN_MS_PER_MOVE) {
    throw new HttpError(422, 'RUN_TOO_FAST', 'This run was submitted faster than the game can be played.')
  }

  const replayed = engine.replay(claims.seed, moveLog)
  if (!replayed.ok) {
    throw new HttpError(
      422,
      'RUN_REJECTED',
      'The move log is not a legal game for this run.',
      [{ reason: replayed.reason, index: replayed.index }]
    )
  }

  const { score, largestPrime } = replayed.state
  if (score !== claimedScore) {
    throw new HttpError(
      422,
      'SCORE_MISMATCH',
      'The submitted score does not match the replayed run.',
      [{ replayedScore: score }]
    )
  }
  if (score === 0) {
    throw new HttpError(422, 'NOTHING_TO_RANK', 'This run built no prime, so there is nothing to rank.')
  }

  return {
    score,
    largestPrime,
    moves: moveLog.length,
    durationSeconds: Math.round(elapsedMs / 1000)
  }
}
