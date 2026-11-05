(function (root, factory) {
  const api = factory(root)

  if (typeof module === 'object' && module.exports) {
    module.exports = api
  } else {
    root.LeaderboardAPI = api.createLeaderboardApi()
  }
})(globalThis, function (root) {
  class LeaderboardApiError extends Error {
    constructor(message, code, status = null) {
      super(message)
      this.name = 'LeaderboardApiError'
      this.code = code
      this.status = status
    }
  }

  const NAME_PATTERN = /^[A-Za-z0-9 _-]{1,12}$/
  const PRIME_WITNESSES = [2n, 325n, 9375n, 28178n, 450775n, 9780504n, 1795265022n]

  function isSafeNonNegativeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0
  }

  function isPrime(value) {
    if (!Number.isSafeInteger(value) || value < 2) {
      return false
    }
    const number = BigInt(value)
    for (const prime of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
      if (number === prime) {
        return true
      }
      if (number % prime === 0n) {
        return false
      }
    }

    let oddPart = number - 1n
    let powerOfTwo = 0
    while (oddPart % 2n === 0n) {
      oddPart /= 2n
      powerOfTwo += 1
    }

    for (const witness of PRIME_WITNESSES) {
      let factor = witness % number
      let exponent = oddPart
      let candidate = 1n
      while (exponent > 0n) {
        if (exponent % 2n === 1n) {
          candidate = (candidate * factor) % number
        }
        factor = (factor * factor) % number
        exponent /= 2n
      }
      if (candidate === 1n || candidate === number - 1n) {
        continue
      }
      let passed = false
      for (let round = 1; round < powerOfTwo; round += 1) {
        candidate = (candidate * candidate) % number
        if (candidate === number - 1n) {
          passed = true
          break
        }
      }
      if (!passed) {
        return false
      }
    }
    return true
  }

  function isLargestPrime(value) {
    return value === 0 || isPrime(value)
  }

  function readApiBaseUrl() {
    const config = root.document?.querySelector('meta[name="prime-swipe-api-base"]')
    return config?.content.trim().replace(/\/+$/, '') || ''
  }

  function createLeaderboardApi(options = {}) {
    const baseUrl = options.baseUrl ?? readApiBaseUrl()
    const fetcher = options.fetch ?? root.fetch
    const timeoutMs = options.timeoutMs ?? 10_000

    async function request(path, init) {
      if (!baseUrl || typeof fetcher !== 'function') {
        throw new LeaderboardApiError('Leaderboard service is not configured.', 'UNAVAILABLE')
      }

      const controller = typeof root.AbortController === 'function'
        ? new root.AbortController()
        : null
      let timeoutId
      const timeout = new Promise((resolve, reject) => {
        timeoutId = root.setTimeout(() => {
          controller?.abort()
          reject(new LeaderboardApiError('Leaderboard request timed out.', 'TIMEOUT'))
        }, timeoutMs)
      })

      const operation = (async () => {
        let response
        try {
          response = await fetcher(`${baseUrl}${path}`, {
            ...init,
            credentials: 'omit',
            ...(controller ? { signal: controller.signal } : {})
          })
        } catch (error) {
          if (error?.name === 'AbortError') {
            throw new LeaderboardApiError('Leaderboard request timed out.', 'TIMEOUT')
          }
          throw new LeaderboardApiError('Leaderboard service could not be reached.', 'UNAVAILABLE')
        }

        let body
        try {
          body = await response.json()
        } catch {
          if (response.ok) {
            throw new LeaderboardApiError(
              'Leaderboard service returned an invalid response.',
              'INVALID_RESPONSE',
              response.status
            )
          }
        }

        if (!response.ok) {
          const unavailable = [502, 503, 504].includes(response.status)
          throw new LeaderboardApiError(
            body?.error?.message || (unavailable
              ? 'Leaderboard service is temporarily unavailable.'
              : 'Leaderboard service rejected the request.'),
            unavailable ? 'UNAVAILABLE' : (body?.error?.code || 'REQUEST_FAILED'),
            response.status
          )
        }
        return body
      })()

      try {
        return await Promise.race([operation, timeout])
      } catch (error) {
        if (error instanceof LeaderboardApiError) {
          throw error
        }
        throw new LeaderboardApiError('Leaderboard service could not be reached.', 'UNAVAILABLE')
      } finally {
        root.clearTimeout(timeoutId)
      }
    }

    function validateRank(result) {
      if (
        !result ||
        typeof result.qualifies !== 'boolean' ||
        !Number.isSafeInteger(result.leaderboardLimit) ||
        result.leaderboardLimit < 1 ||
        (result.qualifies
          ? (!Number.isSafeInteger(result.rank) ||
            result.rank < 1 ||
            result.rank > result.leaderboardLimit)
          : result.rank !== null)
      ) {
        throw new LeaderboardApiError('Leaderboard service returned an invalid rank.', 'INVALID_RESPONSE')
      }
      return { ...result, source: 'backend' }
    }

    function validateLeaderboard(result) {
      if (
        !result ||
        !Array.isArray(result.entries) ||
        !Number.isSafeInteger(result.limit) ||
        result.limit < 1 ||
        result.limit > 100 ||
        result.entries.length > result.limit
      ) {
        throw new LeaderboardApiError('Leaderboard service returned an invalid leaderboard.', 'INVALID_RESPONSE')
      }

      for (const entry of result.entries) {
        if (
          !entry ||
          !Number.isSafeInteger(entry.rank) ||
          entry.rank < 1 ||
          typeof entry.displayName !== 'string' ||
          !NAME_PATTERN.test(entry.displayName) ||
          !isSafeNonNegativeInteger(entry.score) ||
          !isSafeNonNegativeInteger(entry.largestPrime) ||
          !isLargestPrime(entry.largestPrime) ||
          typeof entry.submittedAt !== 'string' ||
          Number.isNaN(Date.parse(entry.submittedAt))
        ) {
          throw new LeaderboardApiError('Leaderboard service returned an invalid leaderboard entry.', 'INVALID_RESPONSE')
        }
      }
      return { ...result, source: 'backend' }
    }

    return {
      async getProjectedRank({ score }) {
        if (!isSafeNonNegativeInteger(score)) {
          throw new LeaderboardApiError('Score must be a non-negative safe integer.', 'INVALID_SCORE')
        }
        const query = new URLSearchParams({ score: String(score) })
        return validateRank(await request(`/api/v1/leaderboard/rank?${query}`))
      },

      async submitScore({ submissionId, displayName, score, largestPrime, moves, durationSeconds }) {
        const normalizedName = typeof displayName === 'string'
          ? displayName.normalize('NFC').trim()
          : ''
        if (!NAME_PATTERN.test(normalizedName)) {
          throw new LeaderboardApiError('Enter a name using 1–12 letters, numbers, spaces, hyphens, or underscores.', 'INVALID_DISPLAY_NAME')
        }
        if (!/^[A-Za-z0-9._:-]{1,128}$/.test(submissionId || '')) {
          throw new LeaderboardApiError('The run submission key is invalid.', 'INVALID_IDEMPOTENCY_KEY')
        }
        if (!isSafeNonNegativeInteger(score)) {
          throw new LeaderboardApiError('Score must be a non-negative safe integer.', 'INVALID_SCORE')
        }
        if (!isSafeNonNegativeInteger(largestPrime) || !isLargestPrime(largestPrime)) {
          throw new LeaderboardApiError('Largest prime must be zero or a prime safe integer.', 'INVALID_LARGEST_PRIME')
        }
        if (!isSafeNonNegativeInteger(moves) || !isSafeNonNegativeInteger(durationSeconds)) {
          throw new LeaderboardApiError('Run statistics must be non-negative safe integers.', 'INVALID_RUN_STATS')
        }

        const payload = { displayName: normalizedName, score, largestPrime, moves, durationSeconds }
        const result = await request('/api/v1/scores', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': submissionId
          },
          body: JSON.stringify(payload)
        })
        if (
          !result ||
          result.displayName !== normalizedName ||
          result.score !== score ||
          result.largestPrime !== largestPrime ||
          !Number.isSafeInteger(result.rank) ||
          result.rank < 1
        ) {
          throw new LeaderboardApiError('Leaderboard service returned an invalid submission confirmation.', 'INVALID_RESPONSE')
        }
        return { ...result, source: 'backend' }
      },

      async getLeaderboard() {
        return validateLeaderboard(await request('/api/v1/leaderboard'))
      }
    }
  }

  return { LeaderboardApiError, createLeaderboardApi }
})
