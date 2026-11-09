// Players. Each factory returns choose(rules, game, rng) -> direction index (0..3).
//
//   random, greedy, lookahead   faithful ports of the three bots in the original sim.js
//   expectimax                  afterstate expectimax over the real spawn distribution
//   montecarlo                  flat Monte Carlo with heuristic rollouts
//
// `rng` is the bot's own random stream. The game's stream is never touched, so a bot cannot
// change what the game deals except by the moves it chooses.

import {
  CURRENT_RULES, createRules, slideBoard, scratch, spawn, tableFor, hasMerge, isOver
} from './rules.mjs'
import { DEFAULT_WEIGHTS, weightVector, evaluate } from './heuristic.mjs'

const CELLS = 16
const half = () => 0.5

function legalAfterstates(game) {
  const out = []
  for (let dir = 0; dir < 4; dir += 1) {
    const board = new Int16Array(CELLS)
    const gained = slideBoard(game.board, dir, board)
    if (gained >= 0) out.push({ dir, board, gained })
  }
  return out
}

function pickAmong(items, rng) {
  return items[Math.floor(rng() * items.length)]
}

function countEmpty(board) {
  let n = 0
  for (let i = 0; i < CELLS; i += 1) if (board[i] === 0) n += 1
  return n
}

// ---- the original three ----
export function randomBot() {
  return (rules, game, rng) => pickAmong(legalAfterstates(game), rng).dir
}

export function greedyBot() {
  return (rules, game, rng) => {
    const moves = legalAfterstates(game)
    const best = Math.max(...moves.map(m => m.gained))
    return pickAmong(moves.filter(m => m.gained === best), rng).dir
  }
}

// The original scored each move on the board the engine returned, which includes the spawned
// tile. The engine was called with a constant 0.5 as its random source, so the tile is the one
// placed at the middle empty cell with the 50th-percentile value. Reproduced here the same way.
export function lookaheadScore(rules, move) {
  const board = Int16Array.from(move.board)
  spawn(rules, board, half)
  return countEmpty(board) * 3 + move.gained * 0.2 + (hasMerge(board) ? 5 : 0)
}

// The set of directions the bot considers equally best (it picks one at random).
export function lookaheadBestDirs(rules, game) {
  const scored = legalAfterstates(game).map(m => ({ dir: m.dir, v: lookaheadScore(rules, m) }))
  const best = Math.max(...scored.map(s => s.v))
  return scored.filter(s => s.v === best).map(s => s.dir)
}

export function lookaheadBot() {
  return (rules, game, rng) => pickAmong(lookaheadBestDirs(rules, game), rng)
}

// ---- expectimax ----
// Searches afterstates: after the player slides, a tile appears (chance), then the player
// moves again. A node is "player to move on a board that has just received a tile".
//
// Chance nodes enumerate every (cell, value) pair when there are few enough; otherwise they
// sample `samples` pairs from the real distribution. Spawn probabilities come from the same
// table the game uses, including the parity assist, so the search models the true game.
const WIN = 1e6
const DEAD = -5e4

export function expectimaxBot({
  depth = 2,
  weights = DEFAULT_WEIGHTS,
  scoreWeight = 0.02,
  exactLimit = 60,
  samples = 12
} = {}) {
  const vector = weightVector(weights)
  const afterBuffers = Array.from({ length: depth + 1 }, () => new Int16Array(CELLS))
  const spawnBuffers = Array.from({ length: depth + 1 }, () => new Int16Array(CELLS))
  let currentRules
  let rng

  function playerNode(board, remaining) {
    if (remaining === 0) return evaluate(board, vector)
    let best = -Infinity
    const after = afterBuffers[remaining]
    for (let dir = 0; dir < 4; dir += 1) {
      const gained = slideBoard(board, dir, after)
      if (gained < 0) continue
      let value
      if (hasGoal(after)) {
        value = WIN
      } else {
        value = gained * scoreWeight + chanceNode(after, remaining - 1)
      }
      if (value > best) best = value
    }
    return best === -Infinity ? DEAD : best
  }

  function hasGoal(board) {
    const met = currentRules.goalExact ? (value) => value === currentRules.goal : (value) => value >= currentRules.goal
    for (let i = 0; i < CELLS; i += 1) if (met(board[i])) return true
    return false
  }

  function chanceNode(after, remaining) {
    const table = tableFor(currentRules, after)
    let empties = 0
    for (let i = 0; i < CELLS; i += 1) if (after[i] === 0) empties += 1
    if (empties === 0) return DEAD
    const next = spawnBuffers[remaining]
    const values = table.values
    const exact = empties * values.length <= exactLimit
    let total = 0
    if (exact) {
      for (let cell = 0; cell < CELLS; cell += 1) {
        if (after[cell] !== 0) continue
        for (let k = 0; k < values.length; k += 1) {
          next.set(after)
          next[cell] = values[k]
          total += table.probs[k] * playerNode(next, remaining)
        }
      }
      return total / empties
    }
    for (let s = 0; s < samples; s += 1) {
      next.set(after)
      spawn(currentRules, next, rng)
      total += playerNode(next, remaining)
    }
    return total / samples
  }

  return (rules, game, random) => {
    currentRules = rules
    rng = random
    const moves = legalAfterstates(game)
    let bestValue = -Infinity
    let bestDirs = []
    for (const move of moves) {
      let value
      if (hasGoal(move.board)) value = WIN
      else value = move.gained * scoreWeight + chanceNode(move.board, depth - 1)
      if (value > bestValue + 1e-9) {
        bestValue = value
        bestDirs = [move.dir]
      } else if (Math.abs(value - bestValue) <= 1e-9) {
        bestDirs.push(move.dir)
      }
    }
    return pickAmong(bestDirs, rng)
  }
}

// ---- flat Monte Carlo ----
// For each legal move, play `rollouts` random continuations of up to `horizon` moves using a
// cheap greedy-on-heuristic policy, and score each by the heuristic at the end (or a win
// bonus). Pick the move with the best average.
export function monteCarloBot({
  rollouts = 24,
  horizon = 12,
  weights = DEFAULT_WEIGHTS
} = {}) {
  const vector = weightVector(weights)
  const board = new Int16Array(CELLS)
  const stage = new Int16Array(CELLS)
  const options = new Int16Array(CELLS)

  return (rules, game, rng) => {
    const moves = legalAfterstates(game)
    let bestValue = -Infinity
    let bestDirs = []
    for (const move of moves) {
      let total = 0
      for (let r = 0; r < rollouts; r += 1) {
        board.set(move.board)
        let value = 0
        let won = false
        if (board.some((value) => rules.goalExact ? value === rules.goal : value >= rules.goal)) won = true
        if (!won) {
          spawn(rules, board, rng)
          for (let step = 0; step < horizon; step += 1) {
            // greedy on heuristic over the four afterstates
            let bestDir = -1
            let bestScore = -Infinity
            for (let dir = 0; dir < 4; dir += 1) {
              const gained = slideBoard(board, dir, stage)
              if (gained < 0) continue
              const s = evaluate(stage, vector) + gained * 0.02 + rng() * 0.01
              if (s > bestScore) {
                bestScore = s
                bestDir = dir
                options.set(stage)
              }
            }
            if (bestDir < 0) {
              value = DEAD
              break
            }
            board.set(options)
            if (board.some((value) => rules.goalExact ? value === rules.goal : value >= rules.goal)) {
              won = true
              break
            }
            spawn(rules, board, rng)
            if (isOver(board)) {
              value = DEAD
              break
            }
          }
          if (!won && value === 0) value = evaluate(board, vector)
        }
        total += won ? WIN : value
      }
      const mean = total / rollouts + move.gained * 0.02
      if (mean > bestValue + 1e-9) {
        bestValue = mean
        bestDirs = [move.dir]
      } else if (Math.abs(mean - bestValue) <= 1e-9) {
        bestDirs.push(move.dir)
      }
    }
    return pickAmong(bestDirs, rng)
  }
}

export const BOTS = {
  random: () => randomBot(),
  greedy: () => greedyBot(),
  lookahead: () => lookaheadBot(),
  'expectimax-1': opts => expectimaxBot({ depth: 1, ...opts }),
  'expectimax-2': opts => expectimaxBot({ depth: 2, ...opts }),
  'expectimax-3': opts => expectimaxBot({ depth: 3, ...opts }),
  montecarlo: opts => monteCarloBot(opts)
}

export function makeBot(name, options) {
  if (!BOTS[name]) throw new Error(`unknown bot "${name}"`)
  return BOTS[name](options)
}

export { CURRENT_RULES, createRules }
