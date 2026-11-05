const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'array', items: { type: 'string' } }
      }
    }
  }
}

const errorResponse = description => ({
  description,
  content: { 'application/json': { schema: errorSchema } }
})

const rankResult = {
  type: 'object',
  required: ['rank', 'qualifies', 'leaderboardLimit'],
  properties: {
    rank: { type: 'integer', minimum: 1, nullable: true },
    qualifies: { type: 'boolean' },
    leaderboardLimit: { type: 'integer', enum: [100] }
  }
}

const submissionResult = {
  type: 'object',
  required: ['displayName', 'score', 'largestPrime', 'rank'],
  properties: {
    displayName: { type: 'string' },
    score: { type: 'integer', minimum: 0 },
    largestPrime: { type: 'integer', minimum: 0 },
    rank: { type: 'integer', minimum: 1 }
  }
}

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Prime Swipe Leaderboard API',
    version: '1.0.0',
    description: [
      'Opt-in Prime Swipe run submissions and public cumulative-score rankings.',
      'The cumulative score and largest prime built are stored and returned as distinct values.',
      'Browser-submitted run statistics are validated for shape, not treated as anti-cheat proof.'
    ].join(' ')
  },
  servers: [{ url: '/', description: 'Current Prime Swipe API host' }],
  paths: {
    '/api/v1/leaderboard/rank': {
      get: {
        summary: 'Preview the rank for a cumulative Score',
        description: 'Rank is 1 plus the number of submitted scores strictly greater than the candidate. Equal scores share a rank; rank 100 qualifies. This endpoint does not submit a run.',
        parameters: [{
          in: 'query',
          name: 'score',
          required: true,
          schema: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
        }],
        responses: {
          200: {
            description: 'Projected cumulative-score rank.',
            content: { 'application/json': { schema: rankResult } }
          },
          400: errorResponse('Invalid score parameter.'),
          403: errorResponse('Origin is not allowed.'),
          429: errorResponse('Rate limit exceeded.'),
          503: errorResponse('Database is temporarily busy.')
        }
      }
    },
    '/api/v1/scores': {
      post: {
        summary: 'Submit an opted-in Prime Swipe run',
        description: 'New rows return 201 after transaction commit. An identical Idempotency-Key and payload returns the original response with 200. Reusing the key with a different payload returns 409. Ranking is by cumulative score; largestPrime remains a separate reported value.',
        parameters: [{
          in: 'header',
          name: 'Idempotency-Key',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' }
        }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['displayName', 'score', 'largestPrime', 'moves', 'durationSeconds'],
                properties: {
                  displayName: { type: 'string', minLength: 1, maxLength: 12, pattern: '^[A-Za-z0-9 _-]+$' },
                  score: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
                  largestPrime: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'Zero if no prime merge was built; otherwise a prime value.' },
                  moves: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
                  durationSeconds: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
                }
              }
            }
          }
        },
        responses: {
          201: { description: 'Run persisted and ranked.', content: { 'application/json': { schema: submissionResult } } },
          200: { description: 'Original result returned for an identical retry.', content: { 'application/json': { schema: submissionResult } } },
          400: errorResponse('Invalid body, name, statistic, or key.'),
          403: errorResponse('Origin is not allowed.'),
          409: errorResponse('Idempotency key conflict.'),
          413: errorResponse('Request body exceeds 8 KB.'),
          415: errorResponse('Content-Type must be application/json.'),
          429: errorResponse('Rate limit exceeded.'),
          503: errorResponse('Database is temporarily busy or unavailable.')
        }
      }
    },
    '/api/v1/leaderboard': {
      get: {
        summary: 'Get the top 100 runs by cumulative Score',
        description: 'Entries are ordered by score descending, then UTC submission time and insertion order. Equal scores share competition rank. The largest prime is a separate field and never substitutes for Score.',
        responses: {
          200: {
            description: 'Public entries without database IDs or idempotency keys.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['entries', 'limit'],
                  properties: {
                    entries: {
                      type: 'array',
                      maxItems: 100,
                      items: {
                        type: 'object',
                        required: ['rank', 'displayName', 'score', 'largestPrime', 'submittedAt'],
                        properties: {
                          rank: { type: 'integer', minimum: 1 },
                          displayName: { type: 'string' },
                          score: { type: 'integer', minimum: 0 },
                          largestPrime: { type: 'integer', minimum: 0 },
                          submittedAt: { type: 'string', format: 'date-time' }
                        }
                      }
                    },
                    limit: { type: 'integer', enum: [100] }
                  }
                }
              }
            }
          },
          403: errorResponse('Origin is not allowed.'),
          429: errorResponse('Rate limit exceeded.')
        }
      }
    },
    '/api/v1/health': {
      get: {
        summary: 'Check API and database health',
        responses: {
          200: {
            description: 'Database is accessible.',
            content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' }, database: { type: 'string' } } } } }
          },
          503: errorResponse('Database is unavailable.')
        }
      }
    }
  }
}
