import { HttpError } from '../utils/http-error.js'
import { isPrime } from '../utils/primality.js'

const DISPLAY_NAME_PATTERN = /^[A-Za-z0-9 _-]+$/
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

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

function validatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'INVALID_BODY', 'Request body must be a JSON object.')
  }

  const allowedFields = new Set(['displayName', 'score', 'largestPrime', 'moves', 'durationSeconds'])
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
  if (!isNonNegativeSafeInteger(body.score)) {
    throw new HttpError(400, 'INVALID_SCORE', 'score must be a non-negative safe integer.')
  }
  if (
    !isNonNegativeSafeInteger(body.largestPrime) ||
    (body.largestPrime !== 0 && !isPrime(body.largestPrime))
  ) {
    throw new HttpError(400, 'INVALID_LARGEST_PRIME', 'largestPrime must be zero or a prime safe integer.')
  }
  if (!isNonNegativeSafeInteger(body.moves)) {
    throw new HttpError(400, 'INVALID_MOVES', 'moves must be a non-negative safe integer.')
  }
  if (!isNonNegativeSafeInteger(body.durationSeconds)) {
    throw new HttpError(400, 'INVALID_DURATION', 'durationSeconds must be a non-negative safe integer.')
  }

  return {
    displayName,
    score: body.score,
    largestPrime: body.largestPrime,
    moves: body.moves,
    durationSeconds: body.durationSeconds
  }
}

function validateIdempotencyKey(value) {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new HttpError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key is required and must be 1–128 letters, numbers, dots, underscores, colons, or hyphens.'
    )
  }
  return value
}

export function createLeaderboardController(service) {
  return {
    getProjectedRank(req, res) {
      const score = validateScoreQuery(req.query.score)
      return res.json(service.getProjectedRank(score))
    },

    submitScore(req, res) {
      if (!req.is('application/json')) {
        throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.')
      }
      const payload = validatePayload(req.body)
      const idempotencyKey = validateIdempotencyKey(req.get('Idempotency-Key'))
      const submission = service.submitScore(payload, idempotencyKey)
      return res.status(submission.statusCode).json(submission.result)
    },

    getLeaderboard(req, res) {
      return res.json(service.getLeaderboard())
    }
  }
}
