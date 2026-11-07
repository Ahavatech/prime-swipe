import express from 'express'
import swaggerUi from 'swagger-ui-express'
import { loadConfig } from './config/env.js'
import { createDatabase } from './db/database.js'
import { createApiRouter } from './routes/api.js'
import { createLeaderboardService } from './services/leaderboard-service.js'
import { createCorsMiddleware } from './middleware/cors.js'
import { createRateLimitMiddleware } from './middleware/rate-limit.js'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { openApiSpec } from './openapi.js'
import { GameEngine } from './engine/index.js'
import { createRunTokenCodec } from './services/run-token.js'

// `clock`, `logger` and `randomSeed` exist so tests can control time, silence expected
// warnings, and pin seeds. Production uses the defaults.
export function createApp({ config = loadConfig(), database, clock = Date.now, logger = console, randomSeed } = {}) {
  const db = database ?? createDatabase(config.databasePath, { production: config.nodeEnv === 'production' })
  const tokens = createRunTokenCodec({
    secret: config.runTokenSecret,
    ttlSeconds: config.runTokenTtlSeconds,
    now: clock,
    randomSeed
  })
  const service = createLeaderboardService({ db, tokens, engine: GameEngine, now: clock, logger })
  const app = express()

  app.disable('x-powered-by')
  if (config.trustProxyHops > 0) {
    app.set('trust proxy', config.trustProxyHops)
  }
  app.use(createCorsMiddleware(config.corsOrigins))
  app.use(createRateLimitMiddleware({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax
  }))
  app.use(express.json({ limit: '8kb', strict: true }))
  app.get('/openapi.json', (req, res) => res.json(openApiSpec))
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    explorer: false,
    swaggerOptions: { displayRequestDuration: true }
  }))
  app.use('/api/v1', createApiRouter({
    db,
    service,
    // Starting and submitting a run are the only endpoints that cost real work (a replay),
    // so they get their own, tighter per-IP counter on top of the global one.
    submitRateLimit: createRateLimitMiddleware({
      windowMs: config.rateLimitWindowMs,
      max: config.submitRateLimitMax
    })
  }))
  app.use(notFoundHandler)
  app.use(errorHandler)

  app.locals.database = db
  app.locals.close = () => {
    if (db.open) {
      db.close()
    }
  }
  return app
}
