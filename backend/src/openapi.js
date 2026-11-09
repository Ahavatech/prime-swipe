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
        details: { type: 'array', items: {}, description: 'Extra context: field names, or { reason, index } for a rejected move log.' }
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

const runStart = {
  type: 'object',
  required: ['runToken', 'seed', 'engineVersion', 'issuedAt', 'expiresAt'],
  properties: {
    runToken: { type: 'string', description: 'Opaque signed token. Send it back unchanged with the move log.' },
    seed: { type: 'integer', minimum: 0, maximum: 4294967295, description: 'Seed for createSeededRandom. The whole game, including every spawn, follows from it.' },
    engineVersion: { type: 'string', description: 'The game rules version this run must be played under. Do not play it if your engine reports a different one.' },
    issuedAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' }
  }
}

const submissionResult = {
  type: 'object',
  required: ['displayName', 'score', 'largestPrime', 'moves', 'rank'],
  properties: {
    displayName: { type: 'string' },
    score: { type: 'integer', minimum: 0, description: 'Computed by the server from the replayed run.' },
    largestPrime: { type: 'integer', minimum: 0, description: 'Computed by the server from the replayed run.' },
    moves: { type: 'integer', minimum: 1 },
    rank: { type: 'integer', minimum: 1 }
  }
}

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Prime Swipe Leaderboard API',
    version: '2.0.0',
    description: [
      'Opt-in Prime Swipe run submissions and public cumulative-score rankings.',
      'A run starts with POST /runs, which returns a seed. The browser plays the game from that seed and submits the moves it played.',
      'The server replays those moves with the same engine and stores the score it computes itself, so a score cannot be edited in transit.',
      'This proves a score is reachable by legal play from a server-issued seed. It does not prove a person played it.'
    ].join(' ')
  },
  servers: [{ url: '/', description: 'Current Prime Swipe API host' }],
  paths: {
    '/api/v1/leaderboard/rank': {
      get: {
        summary: 'Preview the rank for a cumulative Score',
        description: 'Rank is 1 plus the number of verified scores strictly greater than the candidate. Equal scores share a rank; rank 100 qualifies. Advisory only: it does not submit or verify a run.',
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
    '/api/v1/runs': {
      post: {
        summary: 'Start a run',
        description: 'Issues a server-chosen seed and a signed run token. Nothing is stored until the run is submitted. A token can be submitted once and expires after a few hours.',
        responses: {
          201: { description: 'Run issued.', content: { 'application/json': { schema: runStart } } },
          403: errorResponse('Origin is not allowed.'),
          429: errorResponse('Rate limit exceeded.')
        }
      }
    },
    '/api/v1/scores': {
      post: {
        summary: 'Submit a played run for verification',
        description: 'The server replays moveLog from the run seed. New runs return 201 after the transaction commits. Sending the same run again with the same name, moveLog and score returns the original response with 200. The same name and moveLog with a different score returns 422 SCORE_MISMATCH, as on a first attempt. A different name or moveLog for a used run returns 409. Score and largest prime in the response come from the replay.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['displayName', 'runToken', 'moveLog', 'score'],
                properties: {
                  displayName: { type: 'string', minLength: 1, maxLength: 12, pattern: '^[A-Za-z0-9 _-]+$' },
                  runToken: { type: 'string', maxLength: 512, description: 'The token returned by POST /runs, unchanged.' },
                  moveLog: { type: 'string', minLength: 1, maxLength: 5000, pattern: '^[UDLR]+$', description: 'One letter per move that changed the board: U, D, L, R. Moves that changed nothing are not logged.' },
                  score: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'The score the player saw. A checksum: it must equal the replayed score, and the stored value is always the replayed one.' }
                }
              }
            }
          }
        },
        responses: {
          201: { description: 'Run verified, persisted and ranked.', content: { 'application/json': { schema: submissionResult } } },
          200: { description: 'Original result returned for a retry of an already-stored run.', content: { 'application/json': { schema: submissionResult } } },
          400: errorResponse('Invalid body, name, token or move log. RUN_TOKEN_REQUIRED means the client still sends the old unverified payload.'),
          403: errorResponse('Origin is not allowed.'),
          409: errorResponse('RUN_ALREADY_SUBMITTED, or ENGINE_VERSION_MISMATCH when the run started under different game rules.'),
          410: errorResponse('RUN_EXPIRED: the run token is too old.'),
          413: errorResponse('Request body exceeds 8 KB.'),
          415: errorResponse('Content-Type must be application/json.'),
          422: errorResponse('The run was understood but not accepted: RUN_REJECTED (illegal move log), SCORE_MISMATCH, RUN_TOO_FAST or NOTHING_TO_RANK.'),
          429: errorResponse('Rate limit exceeded.'),
          503: errorResponse('Database is temporarily busy or unavailable.')
        }
      }
    },
    '/api/v1/leaderboard': {
      get: {
        summary: 'Get up to 12 runs ordered by Score or largest prime',
        description: 'Verified and legacy unverified runs appear. By default, entries are ordered by Score descending; set sort=largestPrime or sort=largestPrimeAsc to order by largest prime descending or ascending. Ranks remain based on cumulative Score; verified ranks count verified runs only, while unverified entries retain their historical stored rank. Unverified entries are labeled. Rank previews and qualification still include verified runs only.',
        parameters: [{
          in: 'query',
          name: 'sort',
          required: false,
          schema: { type: 'string', enum: ['score', 'largestPrime', 'largestPrimeAsc'], default: 'score' },
          description: 'Display ordering only. Ranks are always based on cumulative Score.'
        }],
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
                      maxItems: 12,
                      items: {
                        type: 'object',
                        required: ['rank', 'displayName', 'score', 'largestPrime', 'submittedAt', 'verified'],
                        properties: {
                          rank: { type: 'integer', minimum: 1 },
                          displayName: { type: 'string' },
                          score: { type: 'integer', minimum: 0 },
                          largestPrime: { type: 'integer', minimum: 0 },
                          submittedAt: { type: 'string', format: 'date-time' },
                          verified: { type: 'boolean' }
                        }
                      }
                    },
                    limit: { type: 'integer', enum: [12] }
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
