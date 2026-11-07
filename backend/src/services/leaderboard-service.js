import { HttpError } from '../utils/http-error.js'
import { verifyRun } from './run-verifier.js'

export const LEADERBOARD_LIMIT = 100

export function createLeaderboardService({ db, tokens, engine, now = Date.now, logger = console }) {
  // Only verified rows can be submitted or retried through the run-token API.
  const findExisting = db.prepare(`
    SELECT display_name AS displayName,
           score,
           largest_prime AS largestPrime,
           moves,
           move_log AS moveLog,
           submission_rank AS rank
    FROM scores
    WHERE idempotency_key = ? AND verified = 1
  `)
  const insertRun = db.prepare(`
    INSERT INTO scores (
      display_name, score, moves, duration_seconds, submitted_at,
      idempotency_key, submission_rank, largest_prime,
      verified, seed, engine_version, move_log
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?, ?)
  `)
  const countHigherScores = db.prepare('SELECT COUNT(*) AS count FROM scores WHERE score > ?')
  const findId = db.prepare('SELECT id FROM scores WHERE idempotency_key = ?')
  const updateRank = db.prepare('UPDATE scores SET submission_rank = ? WHERE id = ?')
  const listEntries = db.prepare(`
    SELECT RANK() OVER (ORDER BY score DESC) AS rank,
           display_name AS displayName,
           score,
           largest_prime AS largestPrime,
           submitted_at AS submittedAt,
           verified
    FROM scores
    ORDER BY score DESC, submitted_at ASC, id ASC
    LIMIT ?
  `)

  function storedResult(row) {
    return {
      displayName: row.displayName,
      score: row.score,
      largestPrime: row.largestPrime,
      moves: row.moves,
      rank: row.rank
    }
  }

  // The same run sent again with the same name and move log is a retry and gets its original
  // answer. Anything else for an already-used run is a conflict.
  function resolveExisting(existing, payload) {
    if (existing.displayName === payload.displayName && existing.moveLog === payload.moveLog) {
      if (existing.score !== payload.score) {
        throw new HttpError(
          422,
          'SCORE_MISMATCH',
          'The submitted score does not match the replayed run.',
          [{ replayedScore: existing.score }]
        )
      }
      return { statusCode: 200, result: storedResult(existing) }
    }
    throw new HttpError(409, 'RUN_ALREADY_SUBMITTED', 'This run was already submitted with different contents.')
  }

  // Runs in one IMMEDIATE transaction. The existence check is repeated inside it so that two
  // submissions of one run can never both insert, and the UNIQUE key backs that up at the
  // storage layer. Replay is done before this, so the write lock is held only briefly.
  const commitRun = db.transaction((runKey, claims, payload, derived) => {
    const existing = findExisting.get(runKey)
    if (existing) {
      return resolveExisting(existing, payload)
    }
    insertRun.run(
      payload.displayName,
      derived.score,
      derived.moves,
      derived.durationSeconds,
      new Date(now()).toISOString(),
      runKey,
      derived.largestPrime,
      claims.seed,
      claims.engineVersion,
      payload.moveLog
    )
    const rank = countHigherScores.get(derived.score).count + 1
    updateRank.run(rank, findId.get(runKey).id)
    return {
      statusCode: 201,
      result: {
        displayName: payload.displayName,
        score: derived.score,
        largestPrime: derived.largestPrime,
        moves: derived.moves,
        rank
      }
    }
  }).immediate

  return {
    issueRun() {
      const { token, claims } = tokens.issue(engine.VERSION)
      return {
        runToken: token,
        seed: claims.seed,
        engineVersion: claims.engineVersion,
        issuedAt: new Date(claims.issuedAtMs).toISOString(),
        expiresAt: new Date(tokens.expiresAtMs(claims)).toISOString()
      }
    },

    // `score` is advisory only: a checksum the replay must reproduce, never what gets stored.
    submitRun({ displayName, runToken, moveLog, score }) {
      const checked = tokens.verify(runToken)
      if (!checked.ok) {
        throw new HttpError(400, 'INVALID_RUN_TOKEN', 'runToken is not a valid run token from this server.')
      }
      const { claims } = checked
      const payload = { displayName, moveLog, score }
      const runKey = `run:${claims.runId}`

      // A retry of a stored run is answered from storage before any expiry or replay work,
      // so it still works if the token has aged out in the meantime.
      const existing = findExisting.get(runKey)
      if (existing) {
        return resolveExisting(existing, payload)
      }

      let derived
      try {
        derived = verifyRun({
          engine,
          claims,
          expiresAtMs: tokens.expiresAtMs(claims),
          moveLog,
          claimedScore: score,
          nowMs: now()
        })
      } catch (error) {
        // These two mean the client and server disagree about the rules, which is a deploy
        // problem worth seeing in the logs, not just an attack.
        if (error.code === 'SCORE_MISMATCH' || error.code === 'ENGINE_VERSION_MISMATCH') {
          logger.warn(`Run ${claims.runId} rejected: ${error.code} (token engine ${claims.engineVersion}, server engine ${engine.VERSION}).`)
        }
        throw error
      }
      return commitRun(runKey, claims, payload, derived)
    },

    getProjectedRank(score) {
      const rank = countHigherScores.get(score).count + 1
      return {
        rank: rank <= LEADERBOARD_LIMIT ? rank : null,
        qualifies: rank <= LEADERBOARD_LIMIT,
        leaderboardLimit: LEADERBOARD_LIMIT
      }
    },

    getLeaderboard() {
      return {
        entries: listEntries.all(LEADERBOARD_LIMIT).map(entry => ({
          ...entry,
          verified: entry.verified === 1
        })),
        limit: LEADERBOARD_LIMIT
      }
    }
  }
}
