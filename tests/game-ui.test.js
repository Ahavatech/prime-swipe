const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const net = require('node:net')
const GameEngine = require('../game-engine')
const RunSession = require('../run-session')
const { createLeaderboardApi } = require('../leaderboard-api')

const ids = [
  'grid', 'score', 'best-prime', 'goal-status', 'game-status', 'notice',
  'new-game', 'open-rules', 'close-rules', 'rules-dialog',
  'open-leaderboard', 'close-leaderboard', 'leaderboard-dialog',
  'game-over-dialog', 'game-over-title', 'final-score',
  'final-largest-prime', 'final-moves', 'final-duration', 'final-best',
  'score-form', 'display-name', 'name-error', 'submit-score',
  'submission-status', 'play-again', 'close-summary', 'load-leaderboard',
  'leaderboard-status', 'sort-largest-prime', 'largest-prime-heading',
  'leaderboard-table-wrap', 'leaderboard-entries',
  'restart-after-submit'
]

class FakeElement {
  constructor() {
    this.children = []
    this.dataset = {}
    this.attributes = {}
    this.listeners = new Map()
    this.className = ''
    this.hidden = false
    this.disabled = false
    this.value = ''
    this.textContent = ''
    this.open = false
    this.classList = {
      add: token => this.updateClass(token, true),
      remove: token => this.updateClass(token, false),
      toggle: (token, force) => {
        const enabled = force ?? !this.className.split(/\s+/).includes(token)
        this.updateClass(token, enabled)
        return enabled
      }
    }
  }

  updateClass(token, enabled) {
    const classes = new Set(this.className.split(/\s+/).filter(Boolean))
    if (enabled) {
      classes.add(token)
    } else {
      classes.delete(token)
    }
    this.className = [...classes].join(' ')
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type).add(listener)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type, properties = {}) {
    const event = {
      type,
      target: this,
      preventDefault() { this.defaultPrevented = true },
      ...properties
    }
    let result = event
    for (const listener of this.listeners.get(type) ?? []) {
      result = listener(event) ?? result
    }
    return result
  }

  appendChild(child) {
    this.children.push(child)
    return child
  }

  replaceChildren(...children) {
    this.children = children
  }

  setAttribute(name, value) {
    this.attributes[name] = value
  }

  removeAttribute(name) {
    delete this.attributes[name]
  }

  closest() {
    return null
  }

  focus() {
    this.focused = true
  }

  showModal() {
    this.open = true
    this.hidden = false
  }

  close() {
    this.open = false
    this.dispatch('close')
  }
}

function cloneState(state) {
  return {
    ...state,
    board: state.board.slice(),
    unlockedTiles: (state.unlockedTiles || []).slice()
  }
}

function makeApi(overrides = {}) {
  const calls = { runs: [], rank: [], submissions: [], leaderboard: 0, leaderboardSorts: [] }
  return {
    calls,
    api: {
      async startRun() {
        calls.runs.push({})
        return overrides.startRun
          ? overrides.startRun()
          : {
            runToken: 'signed-run-token',
            seed: 12345,
            engineVersion: GameEngine.VERSION,
            issuedAt: '2026-11-07T10:00:00.000Z',
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            source: 'backend'
          }
      },
      async getProjectedRank(payload) {
        calls.rank.push(payload)
        return overrides.rank
          ? overrides.rank(payload)
          : { rank: 1, qualifies: true, leaderboardLimit: 100, source: 'backend' }
      },
      async submitScore(payload) {
        calls.submissions.push({ ...payload })
        if (overrides.submitScore) {
          return overrides.submitScore(payload)
        }
        return {
          displayName: payload.displayName,
          score: payload.score,
          largestPrime: 101,
          moves: payload.moveLog.length,
          rank: 1,
          source: 'backend'
        }
      },
      async getLeaderboard(options) {
        calls.leaderboard += 1
        calls.leaderboardSorts.push(options.sortBy)
        return overrides.leaderboard
          ? overrides.leaderboard(options)
          : {
            entries: [],
            limit: 12,
            source: 'backend'
          }
      }
    }
  }
}

function createApp({ api, initialState, outcome, storageError = null } = {}) {
  const elements = new Map(ids.map(id => [id, new FakeElement()]))
  elements.get('grid').setAttribute('role', 'grid')
  elements.get('grid').setAttribute('aria-label', 'Prime Swipe 4 by 4 game board')
  const document = new FakeElement()
  document.body = new FakeElement()
  document.getElementById = id => elements.get(id)
  document.querySelector = selector => {
    if (selector !== 'dialog[open]') {
      return null
    }
    return ['rules-dialog', 'leaderboard-dialog', 'game-over-dialog']
      .map(id => elements.get(id))
      .find(element => element.open) || null
  }
  document.createElement = () => new FakeElement()
  const stored = new Map()
  const localStorage = {
    getItem(key) {
      if (storageError === 'read') {
        throw new Error('storage disabled')
      }
      return stored.get(key) ?? null
    },
    setItem(key, value) {
      if (storageError === 'write') {
        throw new Error('storage disabled')
      }
      stored.set(key, value)
    }
  }
  const moveRandoms = []
  const seededRandoms = []
  const seededSeeds = []
  const gameRandoms = []
  const engine = {
    ...GameEngine,
    createSeededRandom(seed) {
      seededSeeds.push(seed)
      const random = GameEngine.createSeededRandom(seed)
      seededRandoms.push(random)
      return random
    },
    createGame(random) {
      gameRandoms.push(random)
      if (initialState) {
        return cloneState(initialState)
      }
      return GameEngine.createGame(random ?? (() => 0.1))
    },
    move(state, direction, random) {
      moveRandoms.push(random)
      const moveOutcome = Array.isArray(outcome) ? outcome.shift() : outcome
      if (moveOutcome) {
        return {
          ...moveOutcome,
          state: cloneState(moveOutcome.state),
          mergedValues: moveOutcome.mergedValues || [],
          mergedIndices: moveOutcome.mergedIndices || [],
          merges: moveOutcome.merges || []
        }
      }
      return GameEngine.move(state, direction, random ?? (() => 0))
    }
  }
  const script = fs.readFileSync(path.join(__dirname, '..', 'functions.js'), 'utf8')
  vm.runInNewContext(script, {
    document,
    GameEngine: engine,
    RunSession,
    LeaderboardAPI: api || makeApi().api,
    localStorage,
    crypto: { randomUUID: () => 'fixed-run-id' },
    Date,
    Intl,
    Math
  })
  const ready = document.dispatch('DOMContentLoaded')
  return {
    document,
    elements,
    grid: elements.get('grid'),
    stored,
    ready,
    engine,
    moveRandoms,
    seededRandoms,
    seededSeeds,
    gameRandoms
  }
}

function gameWith(values, overrides = {}) {
  const board = Array(16).fill(0)
  for (const [index, value] of Object.entries(values)) {
    board[Number(index)] = value
  }
  return {
    board,
    score: 0,
    largestPrime: 0,
    goalAchieved: false,
    unlockedTiles: [],
    status: 'playing',
    ...overrides
  }
}

async function settle() {
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
}

test('initial UI presents two different-parity tiles and an accessible 4×4 grid', async () => {
  const app = createApp()
  await app.ready
  const tiles = app.grid.children.flatMap(row => row.children)
  const occupied = tiles.filter(tile => tile.dataset.value !== '0').map(tile => Number(tile.dataset.value))

  assert.equal(app.grid.children.length, 4)
  assert.ok(app.grid.children.every(row => row.children.length === 4))
  assert.equal(occupied.length, 2)
  assert.equal(occupied.filter(value => value % 2).length, 1)
  assert.equal(occupied.filter(value => value % 2 === 0).length, 1)
  assert.equal(app.grid.attributes.role, 'grid')
  assert.match(tiles.find(tile => tile.dataset.value !== '0').attributes['aria-label'], /Row \d, column \d: \d/)
})

test('a failed run request leaves gameplay available and disables score submission', async () => {
  const finished = gameWith({}, { score: 2, largestPrime: 2, status: 'game-over' })
  const calls = makeApi({
    startRun: async () => { throw new Error('Leaderboard service could not be reached.') }
  })
  const app = createApp({
    api: calls.api,
    initialState: gameWith({ 0: 1, 1: 1 }),
    outcome: { state: finished, moved: true, scoreDelta: 2, merges: [] }
  })
  await app.ready

  app.document.dispatch('keydown', { key: 'ArrowLeft' })

  assert.equal(app.elements.get('score').textContent, '2')
  assert.equal(app.elements.get('game-over-dialog').open, true)
  assert.equal(app.elements.get('submit-score').disabled, true)
  assert.equal(app.elements.get('score-form').hidden, true)
  assert.equal(app.elements.get('notice').textContent, 'Practice game, scores cannot be submitted.')
  assert.equal(calls.calls.submissions.length, 0)
})

test('a server engine-version mismatch starts an unsubmitable local game', async () => {
  const calls = makeApi({
    startRun: async () => ({
      runToken: 'stale-engine-token',
      seed: 1,
      engineVersion: 'older',
      issuedAt: '2026-11-07T10:00:00.000Z',
      expiresAt: '2026-11-07T16:00:00.000Z'
    })
  })
  const app = createApp({
    api: calls.api,
    initialState: gameWith({ 0: 1, 1: 1 }),
    outcome: { state: gameWith({}, { score: 2, largestPrime: 2 }), moved: true, scoreDelta: 2 }
  })
  await app.ready

  assert.equal(app.seededRandoms.length, 1)
  assert.match(app.elements.get('game-status').textContent, /Practice game/)
  app.document.dispatch('keydown', { key: 'ArrowLeft' })
  assert.equal(app.elements.get('score').textContent, '2')
})

test('swipes are ignored while a ranked run is pending and stale starts are discarded', async () => {
  const resolvers = []
  const calls = makeApi({
    startRun: () => new Promise(resolve => resolvers.push(resolve))
  })
  const app = createApp({ api: calls.api })

  assert.equal(app.elements.get('notice').textContent, 'Starting ranked run…')
  app.document.dispatch('keydown', { key: 'ArrowLeft' })
  assert.equal(app.elements.get('score').textContent, '0')
  app.elements.get('new-game').dispatch('click')

  const run = seed => ({
    runToken: `token-${seed}`,
    seed,
    engineVersion: GameEngine.VERSION,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  })
  resolvers[0](run(111))
  resolvers[1](run(222))
  await app.ready
  await settle()

  assert.deepEqual(app.seededSeeds, [222])
})

test('an empty API base falls back to playable practice mode', async () => {
  const api = createLeaderboardApi()
  const app = createApp({
    api,
    initialState: gameWith({ 0: 1, 1: 1 }),
    outcome: { state: gameWith({}, { score: 2, largestPrime: 2, status: 'game-over' }), moved: true, scoreDelta: 2 }
  })

  await app.ready
  assert.equal(app.elements.get('notice').textContent, 'Practice game, scores cannot be submitted.')
  app.document.dispatch('keydown', { key: 'ArrowLeft' })
  assert.equal(app.elements.get('score-form').hidden, true)
  app.elements.get('score-form').dispatch('submit')
  assert.match(app.elements.get('submission-status').textContent, /cannot be submitted/)
})

test('a stopped backend falls back to playable practice mode', async () => {
  const probe = net.createServer()
  await new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolve)
  })
  const { port } = probe.address()
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()))
  const api = createLeaderboardApi({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 500 })
  const app = createApp({ api })

  await app.ready
  assert.equal(app.elements.get('notice').textContent, 'Practice game, scores cannot be submitted.')
  app.document.dispatch('keydown', { key: 'ArrowRight' })
  assert.notEqual(app.elements.get('score').textContent, '')
  assert.equal(app.elements.get('score-form').hidden, true)
})

test('an expired ranked session skips rank and submit requests and offers a new game', async () => {
  const calls = makeApi({
    startRun: async () => ({
      runToken: 'expired-token',
      seed: 1,
      engineVersion: GameEngine.VERSION,
      issuedAt: '2026-11-07T10:00:00.000Z',
      expiresAt: new Date(Date.now() - 1).toISOString()
    })
  })
  const app = createApp({
    api: calls.api,
    initialState: gameWith({ 0: 1, 1: 1 }),
    outcome: { state: gameWith({}, { score: 2, status: 'game-over' }), moved: true, scoreDelta: 2 }
  })

  await app.ready
  app.document.dispatch('keydown', { key: 'ArrowLeft' })
  app.elements.get('display-name').value = 'ACE'
  app.elements.get('score-form').dispatch('submit')
  await settle()

  assert.equal(calls.calls.rank.length, 0)
  assert.equal(calls.calls.submissions.length, 0)
  assert.equal(app.elements.get('score-form').hidden, true)
  assert.equal(app.elements.get('restart-after-submit').hidden, false)
  assert.match(app.elements.get('submission-status').textContent, /This run has expired/)
})

test('keyboard merge updates Score, largest-prime Best, and local persistence', async () => {
  const app = createApp({ initialState: gameWith({ 0: 1, 1: 1 }) })
  await app.ready
  app.document.dispatch('keydown', { key: 'ArrowLeft' })

  assert.equal(app.elements.get('score').textContent, '2')
  assert.equal(app.elements.get('best-prime').textContent, '2')
  assert.equal(app.stored.get('prime-swipe-best-prime'), '2')
  assert.match(app.elements.get('game-status').textContent, /1 \+ 1 = 2/)
  assert.match(app.elements.get('game-status').textContent, /One new tile spawned/)
})

test('merge feedback marks only the destination when another tile has the same value', async () => {
  const app = createApp({ initialState: gameWith({ 0: 1, 1: 2, 8: 3 }) })
  await app.ready
  app.document.dispatch('keydown', { key: 'ArrowLeft' })
  const tiles = app.grid.children.flatMap(row => row.children)

  assert.ok(tiles[0].className.split(/\s+/).includes('just-merged'))
  assert.equal(tiles[0].children[0].textContent, '1 + 2')
  assert.equal(tiles[8].className.split(/\s+/).includes('just-merged'), false)
  assert.equal(tiles[8].dataset.prime, undefined)
})

test('pointer swipe moves the board and merges through the touch input surface', async () => {
  const app = createApp({ initialState: gameWith({ 0: 1, 1: 2 }) })
  await app.ready
  app.grid.dispatch('pointerdown', { clientX: 120, clientY: 120, button: 0, pointerId: 1 })
  app.grid.dispatch('pointerup', { clientX: 65, clientY: 120, pointerId: 1 })

  assert.equal(app.elements.get('score').textContent, '3')
  assert.equal(app.elements.get('best-prime').textContent, '3')
})

test('invalid move does not spawn and local-storage failures are explicit', async () => {
  const app = createApp({ initialState: gameWith({ 0: 2 }) })
  await app.ready
  app.document.dispatch('keydown', { key: 'ArrowLeft' })
  assert.equal(app.elements.get('score').textContent, '0')
  assert.equal(app.elements.get('game-status').textContent, 'No tiles moved. No new tile spawned.')

  const storageFailure = createApp({
    initialState: gameWith({ 0: 2 }),
    storageError: 'read'
  })
  await storageFailure.ready
  assert.match(storageFailure.elements.get('game-status').textContent, /Local storage is unavailable/)
})

test('building exactly 101 marks the goal but leaves the game running', async () => {
  const app = createApp({ initialState: gameWith({ 0: 45, 1: 56 }) })
  await app.ready
  app.document.dispatch('keydown', { key: 'a' })

  assert.equal(app.elements.get('score').textContent, '101')
  assert.equal(app.elements.get('best-prime').textContent, '101')
  assert.equal(app.elements.get('goal-status').textContent, 'Reached')
  assert.equal(app.elements.get('game-over-dialog').open, false)
  assert.match(app.elements.get('game-status').textContent, /45 \+ 56 = 101/)
})

test('terminal merge announcement preserves its merge, spawn, and game-over status', async () => {
  const board = Array(16).fill(25)
  board[0] = 1
  board[1] = 2
  const initialState = gameWith({})
  initialState.board = board
  const app = createApp({ initialState })
  await app.ready

  app.document.dispatch('keydown', { key: 'ArrowLeft' })

  const announcement = app.elements.get('game-status').textContent
  assert.match(announcement, /1 \+ 2 = 3/)
  assert.match(announcement, /Score \+3/)
  assert.match(announcement, /One new tile spawned/)
  assert.match(announcement, /Game over/)
  assert.equal(app.elements.get('game-over-dialog').open, true)
})

test('game-over dialog presents distinct run summary values and replay works', async () => {
  const finished = gameWith({}, {
    score: 850,
    largestPrime: 101,
    status: 'game-over'
  })
  const app = createApp({
    initialState: gameWith({ 0: 2 }),
    outcome: { state: finished, moved: true, scoreDelta: 0, mergedValues: [] }
  })
  await app.ready
  app.document.dispatch('keydown', { key: 'ArrowRight' })

  assert.equal(app.elements.get('game-over-dialog').open, true)
  assert.equal(app.elements.get('final-score').textContent, '850')
  assert.equal(app.elements.get('final-largest-prime').textContent, '101')
  assert.equal(app.elements.get('final-best').textContent, '101')
  assert.match(app.elements.get('game-status').textContent, /One new tile spawned/)
  app.elements.get('play-again').dispatch('click')
  await settle()
  assert.equal(app.elements.get('game-over-dialog').open, false)
  assert.equal(app.elements.get('score').textContent, '0')
})

test('one seeded random source drives game creation and every move', async () => {
  const app = createApp({ initialState: gameWith({ 0: 1, 1: 1 }) })
  await app.ready

  app.document.dispatch('keydown', { key: 'ArrowLeft' })

  assert.equal(app.seededRandoms.length, 1)
  assert.equal(app.gameRandoms.at(-1), app.seededRandoms[0])
  assert.equal(app.moveRandoms[0], app.seededRandoms[0])
})

test('only effective moves are added to the submitted move log', async () => {
  const starting = gameWith({ 0: 2 })
  const finished = gameWith({}, { score: 10, largestPrime: 5, status: 'game-over' })
  const calls = makeApi()
  const app = createApp({
    api: calls.api,
    initialState: starting,
    outcome: [
      { state: starting, moved: false, scoreDelta: 0 },
      { state: finished, moved: true, scoreDelta: 0 }
    ]
  })
  await app.ready

  app.document.dispatch('keydown', { key: 'ArrowLeft' })
  app.document.dispatch('keydown', { key: 'ArrowDown' })
  app.elements.get('display-name').value = 'ACE'
  app.elements.get('score-form').dispatch('submit')
  await settle()

  assert.equal(calls.calls.submissions[0].moveLog, 'D')
})

test('opt-in submission sends the run proof and confirms server-derived values', async () => {
  const calls = makeApi()
  const finished = gameWith({}, {
    score: 2400,
    largestPrime: 101,
    status: 'game-over'
  })
  const app = createApp({
    api: calls.api,
    initialState: gameWith({ 0: 2 }),
    outcome: { state: finished, moved: true, scoreDelta: 0, mergedValues: [] }
  })
  await app.ready
  app.document.dispatch('keydown', { key: 'ArrowRight' })
  app.elements.get('display-name').value = 'ACE'
  app.elements.get('score-form').dispatch('submit')
  await settle()

  assert.equal(calls.calls.rank.length, 1)
  assert.equal(calls.calls.rank[0].score, 2400)
  assert.equal(calls.calls.submissions.length, 1)
  assert.equal(calls.calls.submissions[0].score, 2400)
  assert.equal(calls.calls.submissions[0].runToken, 'signed-run-token')
  assert.equal(calls.calls.submissions[0].moveLog, 'R')
  assert.deepEqual(Object.keys(calls.calls.submissions[0]).sort(), ['displayName', 'moveLog', 'runToken', 'score'])
  assert.match(app.elements.get('submission-status').textContent, /Score confirmed by the server/)
  assert.match(app.elements.get('submission-status').textContent, /1 moves, rank 1/)
})

test('a non-qualifying rank preview never submits a run', async () => {
  const calls = makeApi({
    rank: async () => ({
      rank: null,
      qualifies: false,
      leaderboardLimit: 100,
      source: 'backend'
    })
  })
  const finished = gameWith({}, { score: 2, status: 'game-over' })
  const app = createApp({
    api: calls.api,
    initialState: gameWith({ 0: 2 }),
    outcome: { state: finished, moved: true, scoreDelta: 0, mergedValues: [] }
  })
  await app.ready
  app.document.dispatch('keydown', { key: 'ArrowRight' })
  app.elements.get('display-name').value = 'ACE'
  app.elements.get('score-form').dispatch('submit')
  await settle()

  assert.equal(calls.calls.submissions.length, 0)
  assert.match(app.elements.get('submission-status').textContent, /was not submitted/)
})

test('failed submission is not shown as success and retry reuses the same run proof', async () => {
  let attempts = 0
  const calls = makeApi({
    submitScore: async payload => {
      attempts += 1
      if (attempts === 1) {
        throw new Error('network unavailable')
      }
      return {
        displayName: payload.displayName,
        score: payload.score,
        largestPrime: 5,
        moves: payload.moveLog.length,
        rank: 2,
        source: 'backend'
      }
    }
  })
  const finished = gameWith({}, {
    score: 20,
    largestPrime: 5,
    status: 'game-over'
  })
  const app = createApp({
    api: calls.api,
    initialState: gameWith({ 0: 2 }),
    outcome: { state: finished, moved: true, scoreDelta: 0, mergedValues: [] }
  })
  await app.ready
  app.document.dispatch('keydown', { key: 'ArrowRight' })
  app.elements.get('display-name').value = 'ACE'
  app.elements.get('score-form').dispatch('submit')
  await settle()
  assert.match(app.elements.get('submission-status').textContent, /network unavailable/)
  assert.equal(app.elements.get('submit-score').textContent, 'Retry submission')

  app.elements.get('score-form').dispatch('submit')
  await settle()
  assert.equal(calls.calls.submissions.length, 2)
  assert.deepEqual(calls.calls.submissions[0], calls.calls.submissions[1])
  assert.match(app.elements.get('submission-status').textContent, /rank 2/)
})

test('terminal run errors hide retry and offer a fresh game', async () => {
  const calls = makeApi({
    submitScore: async () => {
      const error = new Error('This run was already submitted. Start a new game to submit another score.')
      error.code = 'RUN_ALREADY_SUBMITTED'
      throw error
    }
  })
  const app = createApp({
    api: calls.api,
    initialState: gameWith({ 0: 1, 1: 1 }),
    outcome: { state: gameWith({}, { score: 2, status: 'game-over' }), moved: true, scoreDelta: 2 }
  })

  await app.ready
  app.document.dispatch('keydown', { key: 'ArrowLeft' })
  app.elements.get('display-name').value = 'ACE'
  app.elements.get('score-form').dispatch('submit')
  await settle()

  assert.equal(app.elements.get('score-form').hidden, true)
  assert.equal(app.elements.get('submit-score').hidden, true)
  assert.equal(app.elements.get('restart-after-submit').hidden, false)
  assert.match(app.elements.get('submission-status').textContent, /already submitted/)
})

test('temporarily unavailable submissions keep a retry action', async () => {
  const calls = makeApi({
    submitScore: async () => {
      const error = new Error('Leaderboard service could not be reached.')
      error.code = 'UNAVAILABLE'
      throw error
    }
  })
  const app = createApp({
    api: calls.api,
    initialState: gameWith({ 0: 1, 1: 1 }),
    outcome: { state: gameWith({}, { score: 2, status: 'game-over' }), moved: true, scoreDelta: 2 }
  })

  await app.ready
  app.document.dispatch('keydown', { key: 'ArrowLeft' })
  app.elements.get('display-name').value = 'ACE'
  app.elements.get('score-form').dispatch('submit')
  await settle()

  assert.equal(app.elements.get('score-form').hidden, false)
  assert.equal(app.elements.get('submit-score').hidden, false)
  assert.equal(app.elements.get('submit-score').textContent, 'Retry submission')
  assert.equal(app.elements.get('restart-after-submit').hidden, true)
  assert.match(app.elements.get('submission-status').textContent, /try this same run/)
})

test('leaderboard defaults to Score and supports sorting while labeling legacy entries', async () => {
  const calls = makeApi({
    leaderboard: async ({ sortBy }) => {
      const entries = [
        {
          rank: 2,
          displayName: 'ACE',
          score: 2400,
          largestPrime: 101,
          submittedAt: '2026-11-05T10:00:00.000Z',
          verified: true
        },
        {
          rank: 1,
          displayName: 'ACE',
          score: 1200,
          largestPrime: 12,
          submittedAt: '2026-11-04T10:00:00.000Z',
          verified: false
        },
        {
          rank: 1,
          displayName: 'BIG PRIME',
          score: 500,
          largestPrime: 127,
          submittedAt: '2026-11-06T10:00:00.000Z',
          verified: true
        }
      ]
      entries.sort((a, b) => sortBy === 'score'
        ? b.score - a.score
        : sortBy === 'largestPrime'
          ? b.largestPrime - a.largestPrime || b.score - a.score
          : a.largestPrime - b.largestPrime || b.score - a.score)
      return { entries, limit: 12, source: 'backend' }
    }
  })
  const app = createApp({ api: calls.api })
  await app.ready
  app.elements.get('open-leaderboard').dispatch('click')
  await settle()

  assert.equal(app.elements.get('leaderboard-dialog').open, true)
  assert.equal(calls.calls.leaderboard, 1)
  const rows = app.elements.get('leaderboard-entries').children
  assert.deepEqual(rows.map(row => row.children[0].textContent), ['1', '2', '3'])
  assert.deepEqual(rows[0].children.map(cell => cell.textContent), ['1', 'ACE', '2,400', '101'])
  assert.deepEqual(rows[1].children.map(cell => cell.textContent), ['2', 'ACE', '1,200', '12'])
  assert.deepEqual(rows[2].children.map(cell => cell.textContent), ['3', 'BIG PRIME', '500', '127'])
  assert.equal(rows[1].children[1].children[0].textContent, 'unverified')
  assert.equal(rows[0].children[3].className.split(/\s+/).includes('largest-prime-record'), false)
  assert.equal(rows[2].children[3].className.split(/\s+/).includes('largest-prime-record'), true)
  assert.equal(calls.calls.leaderboardSorts[0], 'score')
  assert.equal(app.elements.get('leaderboard-table-wrap').hidden, false)
  const sortButton = app.elements.get('sort-largest-prime')
  const heading = app.elements.get('largest-prime-heading')
  sortButton.dispatch('click')
  await settle()
  assert.equal(calls.calls.leaderboardSorts[1], 'largestPrime')
  assert.equal(heading.attributes['aria-sort'], 'descending')
  assert.equal(sortButton.attributes['aria-pressed'], 'true')
  assert.equal(sortButton.attributes['aria-label'], 'Sort by largest prime descending')
  assert.deepEqual(
    app.elements.get('leaderboard-entries').children.map(row => row.children[1].textContent),
    ['BIG PRIME', 'ACE', 'ACE']
  )
  assert.deepEqual(app.elements.get('leaderboard-entries').children.map(row => row.children[0].textContent), ['1', '2', '3'])
  sortButton.dispatch('click')
  await settle()
  assert.equal(calls.calls.leaderboardSorts[2], 'largestPrimeAsc')
  assert.equal(heading.attributes['aria-sort'], 'ascending')
  assert.equal(sortButton.attributes['aria-label'], 'Sort by largest prime ascending')
  assert.deepEqual(
    app.elements.get('leaderboard-entries').children.map(row => row.children[3].textContent),
    ['12', '101', '127']
  )
  sortButton.dispatch('click')
  await settle()
  assert.equal(calls.calls.leaderboardSorts[3], 'score')
  assert.equal(heading.attributes['aria-sort'], 'none')
  assert.deepEqual(
    app.elements.get('leaderboard-entries').children.map(row => row.children[2].textContent),
    ['2,400', '1,200', '500']
  )
  app.elements.get('close-leaderboard').dispatch('click')
  assert.equal(app.elements.get('leaderboard-dialog').open, false)
})

test('rules open in a dialog and can be closed', async () => {
  const app = createApp()
  await app.ready
  app.elements.get('open-rules').dispatch('click')
  assert.equal(app.elements.get('rules-dialog').open, true)
  app.elements.get('close-rules').dispatch('click')
  assert.equal(app.elements.get('rules-dialog').open, false)
})
