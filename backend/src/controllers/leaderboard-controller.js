import { HttpError } from '../utils/http-error.js'
import { MAX_MOVES } from '../services/run-verifier.js'

const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9 _-]+$/
const MOVE_LOG_PATTERN = /^[UDLR]+$/
const MAX_TOKEN_LENGTH = 512

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function validateScoreQuery(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new HttpError(400, 'INVALID_SCORE', 'score must be a non-negative integer.')
  }
  const score = Number(value)
  if (!isNonNegativeSafeInteger(score)) {
    throw new HttpError(400, 'INVALID_SCORE', 'score must be a non-negative safe integer.')
  }
  return score
}

// The browser sends a run token it got from POST /runs, the moves it played, and the score it
// saw. The score is a checksum: the server replays the moves and stores its own result.
function validatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'INVALID_BODY', 'Request body must be a JSON object.')
  }

  // Checked first so an older client that still sends a bare score gets a clear explanation
  // instead of a list of unsupported fields.
  if (body.runToken === undefined) {
    throw new HttpError(
      400,
      'RUN_TOKEN_REQUIRED',
      'Scores are verified by replaying a run. Start one with POST /api/v1/runs and submit its runToken and moveLog.'
    )
  }

  const allowedFields = new Set(['displayName', 'runToken', 'moveLog', 'score'])
  const unexpected = Object.keys(body).filter(key => !allowedFields.has(key))
  if (unexpected.length) {
    throw new HttpError(400, 'INVALID_BODY', 'Request contains unsupported fields.', unexpected)
  }

  if (typeof body.displayName !== 'string') {
    throw new HttpError(400, 'INVALID_DISPLAY_NAME', 'displayName must be a string.')
  }
  const displayName = body.displayName.normalize('NFC').trim()
  if (!displayName || displayName.length > 12 || !DISPLAY_NAME_PATTERN.test(displayName)) {
    throw new HttpError(
      400,
      'INVALID_DISPLAY_NAME',
      'displayName must be 1–12 characters using letters, numbers, spaces, hyphens, or underscores.'
    )
  }
  if (typeof body.runToken !== 'string' || body.runToken.length === 0 || body.runToken.length > MAX_TOKEN_LENGTH) {
    throw new HttpError(400, 'INVALID_RUN_TOKEN', 'runToken is not a valid run token from this server.')
  }
  if (!isNonNegativeSafeInteger(body.score)) {
    throw new HttpError(400, 'INVALID_SCORE', 'score must be a non-negative safe integer.')
  }
  if (
    typeof body.moveLog !== 'string' ||
    body.moveLog.length < 1 ||
    body.moveLog.length > MAX_MOVES ||
    !MOVE_LOG_PATTERN.test(body.moveLog)
  ) {
    throw new HttpError(
      400,
      'INVALID_MOVE_LOG',
      `moveLog must be 1 to ${MAX_MOVES} letters, each one of U, D, L, R.`
    )
  }

  return {
    displayName,
    runToken: body.runToken,
    moveLog: body.moveLog,
    score: body.score
  }
}

export function createLeaderboardController(service) {
  return {
    getProjectedRank(req, res) {
      const score = validateScoreQuery(req.query.score)
      return res.json(service.getProjectedRank(score))
    },

    startRun(req, res) {
      return res.status(201).json(service.issueRun())
    },

    submitScore(req, res) {
      if (!req.is('application/json')) {
        throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.')
      }
      const submission = service.submitRun(validatePayload(req.body))
      return res.status(submission.statusCode).json(submission.result)
    },

    getLeaderboard(req, res) {
      return res.json(service.getLeaderboard())
    }
  }
}
