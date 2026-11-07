import crypto from 'node:crypto'
import path from 'node:path'

function positiveInteger(value, name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === '') {
    return fallback
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}.`)
  }
  return parsed
}

function nonNegativeInteger(value, name, fallback) {
  if (value === undefined || value === '') {
    return fallback
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer.`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a non-negative safe integer.`)
  }
  return parsed
}

function parseCorsOrigins(value = '') {
  return value.split(',').map(origin => origin.trim()).filter(Boolean).map(origin => {
    let parsed
    try {
      parsed = new URL(origin)
    } catch {
      throw new Error(`CORS_ORIGINS contains an invalid origin: ${origin}`)
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error(`CORS_ORIGINS entries must be exact HTTP(S) origins: ${origin}`)
    }
    return parsed.origin
  })
}

const MIN_RUN_TOKEN_SECRET_LENGTH = 32

function loadRunTokenSecret(value, nodeEnv) {
  const secret = value?.trim()
  if (!secret) {
    if (nodeEnv === 'production') {
      throw new Error('RUN_TOKEN_SECRET is required in production; set it with `fly secrets set RUN_TOKEN_SECRET=...`.')
    }
    // Development and tests get a throwaway secret. Run tokens stop working when the process
    // restarts, which is fine locally and is exactly why production must set its own.
    return crypto.randomBytes(32)
  }
  if (secret.length < MIN_RUN_TOKEN_SECRET_LENGTH) {
    throw new Error(`RUN_TOKEN_SECRET must be at least ${MIN_RUN_TOKEN_SECRET_LENGTH} characters.`)
  }
  return Buffer.from(secret, 'utf8')
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development'
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production.')
  }

  const port = positiveInteger(env.PORT, 'PORT', 8080, 65535)
  const databasePath = env.DATABASE_PATH?.trim()
  if (nodeEnv === 'production' && !databasePath) {
    throw new Error('DATABASE_PATH is required in production; configure a persistent Prime Swipe database volume.')
  }
  if (nodeEnv === 'production' && !path.isAbsolute(databasePath)) {
    throw new Error('DATABASE_PATH must be absolute in production and point to Prime Swipe persistent storage.')
  }

  return {
    nodeEnv,
    port,
    host: '0.0.0.0',
    databasePath: databasePath
      ? path.resolve(databasePath)
      : path.resolve(process.cwd(), 'data', 'prime-swipe.db'),
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
    rateLimitWindowMs: positiveInteger(env.RATE_LIMIT_WINDOW_MS, 'RATE_LIMIT_WINDOW_MS', 60_000),
    rateLimitMax: positiveInteger(env.RATE_LIMIT_MAX, 'RATE_LIMIT_MAX', 100),
    // Stricter per-IP cap for the two POST endpoints, because submitting a run replays a game.
    submitRateLimitMax: positiveInteger(env.SUBMIT_RATE_LIMIT_MAX, 'SUBMIT_RATE_LIMIT_MAX', 20),
    runTokenSecret: loadRunTokenSecret(env.RUN_TOKEN_SECRET, nodeEnv),
    // How long a started run can wait before it is submitted. Capped at a week.
    runTokenTtlSeconds: positiveInteger(env.RUN_TOKEN_TTL_SECONDS, 'RUN_TOKEN_TTL_SECONDS', 6 * 60 * 60, 7 * 24 * 60 * 60),
    trustProxyHops: nonNegativeInteger(env.TRUST_PROXY_HOPS, 'TRUST_PROXY_HOPS', 0)
  }
}
