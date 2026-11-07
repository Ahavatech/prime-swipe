import { GameEngine } from '../../src/engine/index.js'

const ORDER = ['up', 'down', 'left', 'right']
const flat = () => 0.5

// A deterministic bot: simulates each direction with a throwaway random source and prefers
// empty cells, then score. Ties go to the first direction in ORDER, so a seed always plays the
// same game. It exists to produce genuine runs for tests, not to play well.
function chooseDirection(state) {
  let best = null
  for (const direction of ORDER) {
    const outcome = GameEngine.move(state, direction, flat)
    if (!outcome.moved) {
      continue
    }
    const empties = outcome.state.board.filter(value => value === 0).length
    const value = empties * 3 + outcome.scoreDelta * 0.2 + (GameEngine.hasLegalMerge(outcome.state.board) ? 5 : 0)
    if (best === null || value > best.value) {
      best = { direction, value }
    }
  }
  return best?.direction ?? null
}

// Plays a seed to the end (or to maxMoves) exactly as the browser will: one random source,
// createGame first, then one effective move at a time. Returns the log and the final state.
export function playRun(seed, { maxMoves = Infinity } = {}) {
  const random = GameEngine.createSeededRandom(seed)
  let state = GameEngine.createGame(random)
  let moveLog = ''
  while (state.status === 'playing' && moveLog.length < maxMoves) {
    const direction = chooseDirection(state)
    if (direction === null) {
      break
    }
    const outcome = GameEngine.move(state, direction, random)
    state = outcome.state
    moveLog += GameEngine.DIRECTION_CODES[direction]
  }
  return { moveLog, state }
}
