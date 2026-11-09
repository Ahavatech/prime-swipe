(function (root, factory) {
  const engine = factory()

  if (typeof module === 'object' && module.exports) {
    module.exports = engine
  } else {
    root.GameEngine = engine
  }
})(globalThis, function () {
  const SIZE = 4
  const CELL_COUNT = SIZE * SIZE
  const DIRECTIONS = new Set(['up', 'down', 'left', 'right'])
  const BASE_SPAWN_WEIGHTS = Object.freeze({ 1: 20, 2: 25, 3: 10, 4: 20, 5: 10, 6: 15 })
  const FIRST_UNLOCK = Object.freeze([8, 10, 12])
  const SECOND_UNLOCK = Object.freeze([14, 16])
  const MILLER_RABIN_WITNESSES = Object.freeze([2n, 325n, 9375n, 28178n, 450775n, 9780504n, 1795265022n])

  // Bump this on ANY change that alters how a seeded game plays out: spawn weights, unlock
  // thresholds, merge rules, how many random numbers are drawn or in what order, or the PRNG.
  // The server refuses to verify a run that started under a different version, and the golden
  // run in the backend tests fails until you bump it and regenerate the fixture.
  const ENGINE_VERSION = '1'

  // A run is logged as one letter per effective move.
  const MOVE_CODES = Object.freeze({ U: 'up', D: 'down', L: 'left', R: 'right' })
  const DIRECTION_CODES = Object.freeze({ up: 'U', down: 'D', left: 'L', right: 'R' })

  function randomUnit(random) {
    const value = random()
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError('Random source must return a number between 0 and 1.')
    }
    return Math.min(value, 1 - Number.EPSILON)
  }

  function randomIndex(length, random) {
    return Math.floor(randomUnit(random) * length)
  }

  // mulberry32. Small and fast, with 32 bits of state, so there are only 2^32 distinct games.
  // It does not need to be unpredictable, because the player is given the seed. It needs to be
  // identical in every browser and in Node: only integer ops and one division by 2^32.
  function createSeededRandom(seed) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError('Seed must be an unsigned 32-bit integer.')
    }
    let state = seed | 0
    return function random() {
      state = (state + 0x6d2b79f5) | 0
      let t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function modPow(base, exponent, modulus) {
    let result = 1n
    let factor = base % modulus
    let power = exponent

    while (power > 0n) {
      if (power % 2n === 1n) {
        result = (result * factor) % modulus
      }
      factor = (factor * factor) % modulus
      power /= 2n
    }

    return result
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

    for (const witness of MILLER_RABIN_WITNESSES) {
      const base = witness % number
      if (base === 0n) {
        continue
      }

      let candidate = modPow(base, oddPart, number)
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

  function getLines(direction) {
    const lines = []
    for (let line = 0; line < SIZE; line += 1) {
      const indices = []
      for (let position = 0; position < SIZE; position += 1) {
        if (direction === 'left' || direction === 'right') {
          const column = direction === 'left' ? position : SIZE - 1 - position
          indices.push(line * SIZE + column)
        } else {
          const row = direction === 'up' ? position : SIZE - 1 - position
          indices.push(row * SIZE + line)
        }
      }
      lines.push(indices)
    }
    return lines
  }

  function largestBoardValue(board) {
    return board.reduce((largest, value) => Math.max(largest, value), 0)
  }

  function unlockForBoard(board, previouslyUnlocked = []) {
    const unlocked = new Set(previouslyUnlocked)
    const largest = largestBoardValue(board)
    if (largest >= 23) {
      FIRST_UNLOCK.forEach(value => unlocked.add(value))
    }
    if (largest >= 53) {
      SECOND_UNLOCK.forEach(value => unlocked.add(value))
    }
    return [...unlocked].sort((a, b) => a - b)
  }

  function getSpawnDistribution(board, unlockedTiles = []) {
    const unlocked = unlockForBoard(board, unlockedTiles)
    const weights = { ...BASE_SPAWN_WEIGHTS }
    unlocked.forEach(value => { weights[value] = 5 })

    const evenWeight = Object.entries(weights)
      .filter(([value]) => Number(value) % 2 === 0)
      .reduce((total, [, weight]) => total + weight, 0)
    const oddWeight = Object.entries(weights)
      .filter(([value]) => Number(value) % 2 === 1)
      .reduce((total, [, weight]) => total + weight, 0)
    const totalWeight = evenWeight + oddWeight
    const evenCount = board.filter(value => value > 0 && value % 2 === 0).length
    const oddCount = board.filter(value => value > 0 && value % 2 === 1).length
    const assist = evenCount < oddCount
    const evenShare = assist
      ? Math.min(1, evenWeight / totalWeight + 0.2)
      : evenWeight / totalWeight
    const oddShare = 1 - evenShare
    const distribution = {}

    for (const [valueText, weight] of Object.entries(weights)) {
      const value = Number(valueText)
      const groupWeight = value % 2 === 0 ? evenWeight : oddWeight
      const groupShare = value % 2 === 0 ? evenShare : oddShare
      distribution[value] = groupShare * weight / groupWeight
    }

    return distribution
  }

  function selectWeightedValue(distribution, random) {
    const target = randomUnit(random)
    let cumulative = 0
    const values = Object.keys(distribution).map(Number).sort((a, b) => a - b)
    for (const value of values) {
      cumulative += distribution[value]
      if (target < cumulative) {
        return value
      }
    }
    return values[values.length - 1]
  }

  function spawnTile(state, random = Math.random) {
    const emptyIndices = []
    state.board.forEach((value, index) => {
      if (value === 0) {
        emptyIndices.push(index)
      }
    })
    if (emptyIndices.length === 0) {
      return state
    }

    const board = state.board.slice()
    const destination = emptyIndices[randomIndex(emptyIndices.length, random)]
    const value = selectWeightedValue(
      getSpawnDistribution(board, state.unlockedTiles),
      random
    )
    board[destination] = value
    const unlockedTiles = unlockForBoard(board, state.unlockedTiles)
    return { ...state, board, unlockedTiles }
  }

  function createGame(random = Math.random) {
    const board = Array(CELL_COUNT).fill(0)
    const oddCell = randomIndex(CELL_COUNT, random)
    board[oddCell] = randomUnit(random) < 0.5 ? 1 : 3

    const emptyIndices = board.flatMap((value, index) => value === 0 ? [index] : [])
    const evenCell = emptyIndices[randomIndex(emptyIndices.length, random)]
    board[evenCell] = randomUnit(random) < 0.5 ? 2 : 4

    return {
      board,
      score: 0,
      largestPrime: 0,
      goalAchieved: false,
      unlockedTiles: [],
      status: 'playing'
    }
  }

  function hasLegalMerge(board) {
    for (let row = 0; row < SIZE; row += 1) {
      for (let column = 0; column < SIZE; column += 1) {
        const index = row * SIZE + column
        if (
          column < SIZE - 1 &&
          Number.isSafeInteger(board[index] + board[index + 1]) &&
          isPrime(board[index] + board[index + 1])
        ) {
          return true
        }
        if (
          row < SIZE - 1 &&
          Number.isSafeInteger(board[index] + board[index + SIZE]) &&
          isPrime(board[index] + board[index + SIZE])
        ) {
          return true
        }
      }
    }
    return false
  }

  function isGameOver(board) {
    return !board.includes(0) && !hasLegalMerge(board)
  }

  function move(state, direction, random = Math.random) {
    if (state.status !== 'playing' || !DIRECTIONS.has(direction)) {
      return { state, moved: false, scoreDelta: 0, mergedValues: [], mergedIndices: [], merges: [] }
    }

    const board = state.board.slice()
    const mergedValues = []
    const mergedIndices = []
    const merges = []
    let scoreDelta = 0

    for (const line of getLines(direction)) {
      const packed = line.map(index => board[index]).filter(value => value !== 0)
      const merged = []

      for (let index = 0; index < packed.length;) {
        const current = packed[index]
        const next = packed[index + 1]
        const sum = current + next
        if (
          next !== undefined &&
          Number.isSafeInteger(sum) &&
          isPrime(sum)
        ) {
          merges.push({ index: line[merged.length], from: [current, next], sum })
          mergedIndices.push(line[merged.length])
          merged.push(sum)
          mergedValues.push(sum)
          scoreDelta += sum
          index += 2
        } else {
          merged.push(current)
          index += 1
        }
      }

      while (merged.length < SIZE) {
        merged.push(0)
      }
      line.forEach((boardIndex, position) => {
        board[boardIndex] = merged[position]
      })
    }

    const moved = board.some((value, index) => value !== state.board[index])
    if (!moved) {
      return { state, moved: false, scoreDelta: 0, mergedValues: [], mergedIndices: [], merges: [] }
    }

    const nextState = {
      ...state,
      board,
      score: state.score + scoreDelta,
      largestPrime: Math.max(state.largestPrime || 0, ...mergedValues),
      goalAchieved: Boolean(state.goalAchieved || mergedValues.includes(101)),
      unlockedTiles: unlockForBoard(board, state.unlockedTiles)
    }
    const spawnedState = spawnTile(nextState, random)
    spawnedState.status = isGameOver(spawnedState.board) ? 'game-over' : 'playing'

    return { state: spawnedState, moved: true, scoreDelta, mergedValues, mergedIndices, merges }
  }

  // Plays a logged run from its seed. The log is untrusted input, so a bad log is a result
  // ({ ok: false }), not an exception. It follows the same protocol as the browser: one random
  // source per run; createGame draws first, then every effective move draws for its spawn.
  // A move that changes nothing is invalid. The browser never logs one, and refusing it means
  // a game has exactly one valid log, with no padding and no alternative spellings.
  function replay(seed, moveLog) {
    if (typeof moveLog !== 'string') {
      throw new TypeError('moveLog must be a string.')
    }
    const random = createSeededRandom(seed)
    let state = createGame(random)

    for (let index = 0; index < moveLog.length; index += 1) {
      const code = moveLog[index]
      // Defence in depth. Every code today is one character, and Object.prototype has no
      // one-character properties, so a plain lookup would be safe. This keeps it safe if a code
      // ever becomes longer. No test can tell the two apart, so none claims to.
      if (!Object.prototype.hasOwnProperty.call(MOVE_CODES, code)) {
        return { ok: false, reason: 'UNKNOWN_MOVE', index }
      }
      if (state.status !== 'playing') {
        return { ok: false, reason: 'MOVE_AFTER_GAME_OVER', index }
      }
      const outcome = move(state, MOVE_CODES[code], random)
      if (!outcome.moved) {
        return { ok: false, reason: 'MOVE_DID_NOTHING', index }
      }
      state = outcome.state
    }
    return { ok: true, state, moveCount: moveLog.length }
  }

  return {
    BASE_SPAWN_WEIGHTS,
    DIRECTION_CODES,
    MOVE_CODES,
    SIZE,
    VERSION: ENGINE_VERSION,
    createGame,
    createSeededRandom,
    getSpawnDistribution,
    hasLegalMerge,
    isGameOver,
    isPrime,
    move,
    replay,
    spawnTile,
    unlockForBoard
  }
})
