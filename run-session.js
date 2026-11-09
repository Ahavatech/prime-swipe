(function (root, factory) {
  const api = factory()

  if (typeof module === 'object' && module.exports) {
    module.exports = api
  } else {
    root.RunSession = api
  }
})(globalThis, function () {
  function randomSeed() {
    const values = new Uint32Array(1)
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      globalThis.crypto.getRandomValues(values)
      return values[0]
    }
    return Math.floor(Math.random() * 0x100000000)
  }

  function cloneState(state) {
    return {
      ...state,
      board: state.board.slice(),
      unlockedTiles: state.unlockedTiles.slice()
    }
  }

  function createRunSession({ engine, claims = null, seed } = {}) {
    if (!engine || typeof engine.createSeededRandom !== 'function' ||
      typeof engine.createGame !== 'function' || typeof engine.move !== 'function') {
      throw new TypeError('A compatible game engine is required.')
    }

    const ranked = claims !== null
    const sessionSeed = ranked ? claims.seed : (seed ?? randomSeed())
    if (!Number.isInteger(sessionSeed) || sessionSeed < 0 || sessionSeed > 0xffffffff) {
      throw new RangeError('Run seed must be an unsigned 32-bit integer.')
    }
    if (ranked && (
      typeof claims.runToken !== 'string' ||
      claims.runToken.length === 0 ||
      typeof claims.expiresAt !== 'string' ||
      Number.isNaN(Date.parse(claims.expiresAt))
    )) {
      throw new TypeError('Ranked run claims are invalid.')
    }

    const random = engine.createSeededRandom(sessionSeed)
    let state = engine.createGame(random)
    let moveLog = ''
    const runToken = ranked ? claims.runToken : null
    const expiresAt = ranked ? claims.expiresAt : null

    return {
      get ranked() {
        return ranked
      },
      get runToken() {
        return runToken
      },
      get expiresAt() {
        return expiresAt
      },
      move(direction) {
        const outcome = engine.move(state, direction, random)
        if (outcome.moved) {
          const code = engine.DIRECTION_CODES[direction]
          if (!code) {
            throw new RangeError(`Unsupported move direction: ${direction}`)
          }
          state = outcome.state
          moveLog += code
        }
        return outcome
      },
      snapshot() {
        return {
          state: cloneState(state),
          moveLog,
          runToken,
          expiresAt,
          ranked
        }
      },
      isExpired(now = Date.now()) {
        return ranked && Date.parse(expiresAt) <= now
      }
    }
  }

  return { createRunSession }
})
