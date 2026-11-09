// A fast copy of the Prime Swipe rules for search and benchmarking.
//
// game-engine.js is the source of truth. This file exists because the engine is built for
// clarity (BigInt primality, fresh objects every move), and a solver needs millions of moves a
// second. Nothing here is trusted on faith: test/rules.test.mjs plays seeded games in lockstep
// with the real engine and fails on the first cell that differs, and every win the benchmark
// reports is replayed through the real engine before it is counted.
//
// The spawn model is a parameter, so alternative spawn weights can be swept without editing
// the engine. CURRENT_RULES must always describe what game-engine.js does today.

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
export const Engine = require('../game-engine.js')

export const DIRS = ['up', 'down', 'left', 'right'] // the index is the direction code
export const LETTERS = 'UDLR'

// Engine version 1: what the game shipped with. Kept so the baseline can always be reproduced
// (legacy/game-engine-v1.cjs is a frozen copy of that engine).
export const LegacyEngine = require('./legacy/game-engine-v1.cjs')
export const LEGACY_RULES = Object.freeze({
  name: 'v1',
  base: Object.freeze({ 1: 20, 2: 25, 3: 10, 4: 20, 5: 10, 6: 15 }),
  unlocks: Object.freeze([
    Object.freeze({ at: 23, tiles: Object.freeze([8, 10, 12]) }),
    Object.freeze({ at: 53, tiles: Object.freeze([14, 16]) })
  ]),
  unlockWeight: 5,
  assistBonus: 0.2,
  goal: 101,
  // legacy/game-engine-v1.cjs is frozen and never reflects the v2 goal-definition change below.
  goalExact: true
})

// Engine version 2: must describe what ../game-engine.js does today (test/rules.test.mjs checks).
export const CURRENT_RULES = Object.freeze({
  name: 'v2',
  base: Object.freeze({ 1: 28, 2: 19, 3: 14, 4: 15, 5: 14, 6: 10 }),
  unlocks: LEGACY_RULES.unlocks,
  unlockWeight: 5,
  assistBonus: 0.5,
  goal: 101,
  // game-engine.js now reaches the goal on a merge of 101 or higher, not only exactly 101.
  goalExact: false
})

const SIZE = 4
const CELLS = 16
const EPS_CAP = 1 - Number.EPSILON

// ---- primes: a sieve covers every sum the game can reach; the engine covers the rest ----
const SIEVE_LIMIT = 1 << 16
const PRIME = new Uint8Array(SIEVE_LIMIT)
PRIME.fill(1)
PRIME[0] = PRIME[1] = 0
for (let i = 2; i * i < SIEVE_LIMIT; i += 1) {
  if (PRIME[i]) for (let j = i * i; j < SIEVE_LIMIT; j += i) PRIME[j] = 0
}
export function isPrime(n) {
  return n < SIEVE_LIMIT ? PRIME[n] === 1 : Engine.isPrime(n)
}

// ---- lines, in the order the engine slides them ----
const LINES = DIRS.map(direction => {
  const lines = []
  for (let line = 0; line < SIZE; line += 1) {
    const cells = []
    for (let position = 0; position < SIZE; position += 1) {
      if (direction === 'left' || direction === 'right') {
        const column = direction === 'left' ? position : SIZE - 1 - position
        cells.push(line * SIZE + column)
      } else {
        const row = direction === 'up' ? position : SIZE - 1 - position
        cells.push(row * SIZE + line)
      }
    }
    lines.push(Int32Array.from(cells))
  }
  return lines
})

// ---- sliding one line toward its first cell, memoised ----
// result: [c0, c1, c2, c3, scoreGained, largestMergedSum, changed]
const rowMemo = new Map()
const packed = new Int32Array(4)

function computeRow(a, b, c, d) {
  let n = 0
  if (a) packed[n++] = a
  if (b) packed[n++] = b
  if (c) packed[n++] = c
  if (d) packed[n++] = d
  const out = new Int32Array(7)
  let written = 0
  let score = 0
  let largest = 0
  for (let i = 0; i < n;) {
    const sum = i + 1 < n ? packed[i] + packed[i + 1] : 0
    if (i + 1 < n && isPrime(sum)) {
      out[written++] = sum
      score += sum
      if (sum > largest) largest = sum
      i += 2
    } else {
      out[written++] = packed[i]
      i += 1
    }
  }
  out[4] = score
  out[5] = largest
  out[6] = out[0] !== a || out[1] !== b || out[2] !== c || out[3] !== d ? 1 : 0
  return out
}

function row(a, b, c, d) {
  if (a < 1024 && b < 1024 && c < 1024 && d < 1024) {
    const key = ((a * 1024 + b) * 1024 + c) * 1024 + d
    let hit = rowMemo.get(key)
    if (hit === undefined) {
      hit = computeRow(a, b, c, d)
      rowMemo.set(key, hit)
    }
    return hit
  }
  return computeRow(a, b, c, d)
}

export const scratch = { largestMerged: 0 }

// Slides `board` in direction `dir` into `out` (no spawn). Returns the score gained, or -1 if
// nothing moved. scratch.largestMerged is the biggest sum built by this move.
export function slideBoard(board, dir, out) {
  const lines = LINES[dir]
  let gained = 0
  let changed = 0
  let largest = 0
  for (let l = 0; l < SIZE; l += 1) {
    const cells = lines[l]
    const r = row(board[cells[0]], board[cells[1]], board[cells[2]], board[cells[3]])
    out[cells[0]] = r[0]
    out[cells[1]] = r[1]
    out[cells[2]] = r[2]
    out[cells[3]] = r[3]
    gained += r[4]
    if (r[5] > largest) largest = r[5]
    changed |= r[6]
  }
  scratch.largestMerged = largest
  return changed ? gained : -1
}

export function hasMerge(board) {
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      const i = r * SIZE + c
      if (c < SIZE - 1 && isPrime(board[i] + board[i + 1])) return true
      if (r < SIZE - 1 && isPrime(board[i] + board[i + SIZE])) return true
    }
  }
  return false
}

export function isOver(board) {
  for (let i = 0; i < CELLS; i += 1) if (board[i] === 0) return false
  return !hasMerge(board)
}

// ---- the spawn model, built to produce bit-identical numbers to the engine ----
export function createRules(config = CURRENT_RULES) {
  const tiers = config.unlocks.length + 1
  const tables = []
  for (let tier = 0; tier < tiers; tier += 1) {
    const weights = { ...config.base }
    for (let u = 0; u < tier; u += 1) {
      for (const tile of config.unlocks[u].tiles) weights[tile] = config.unlockWeight
    }
    const values = Object.keys(weights).map(Number).sort((a, b) => a - b)
    let evenWeight = 0
    let oddWeight = 0
    for (const v of values) {
      if (v % 2 === 0) evenWeight += weights[v]
      else oddWeight += weights[v]
    }
    const total = evenWeight + oddWeight
    const pair = []
    for (const assist of [false, true]) {
      const evenShare = assist ? Math.min(1, evenWeight / total + config.assistBonus) : evenWeight / total
      const oddShare = 1 - evenShare
      const probs = new Float64Array(values.length)
      const cumulative = new Float64Array(values.length)
      let running = 0
      values.forEach((v, i) => {
        const even = v % 2 === 0
        probs[i] = (even ? evenShare : oddShare) * weights[v] / (even ? evenWeight : oddWeight)
        running += probs[i]
        cumulative[i] = running
      })
      pair.push({ values: Int32Array.from(values), probs, cumulative })
    }
    tables.push(pair)
  }
  const thresholds = config.unlocks.map(u => u.at)
  return { config, tables, thresholds, goal: config.goal, goalExact: config.goalExact }
}

// Which spawn table applies to a board: depends only on its largest tile and on whether
// there are fewer even tiles than odd ones. The engine looks at the board before the new tile.
export function tableFor(rules, board) {
  let largest = 0
  let evens = 0
  let odds = 0
  for (let i = 0; i < CELLS; i += 1) {
    const v = board[i]
    if (v === 0) continue
    if (v > largest) largest = v
    if (v & 1) odds += 1
    else evens += 1
  }
  let tier = 0
  while (tier < rules.thresholds.length && largest >= rules.thresholds[tier]) tier += 1
  return rules.tables[tier][evens < odds ? 1 : 0]
}

export function pickValue(table, unit) {
  const target = Math.min(unit, EPS_CAP)
  for (let i = 0; i < table.values.length; i += 1) {
    if (target < table.cumulative[i]) return table.values[i]
  }
  return table.values[table.values.length - 1]
}

// Places one tile exactly as the engine does: pick the empty cell first, then the value.
export function spawn(rules, board, random) {
  let count = 0
  for (let i = 0; i < CELLS; i += 1) if (board[i] === 0) count += 1
  if (count === 0) return
  const table = tableFor(rules, board)
  let pick = Math.floor(Math.min(random(), EPS_CAP) * count)
  const value = pickValue(table, random())
  for (let i = 0; i < CELLS; i += 1) {
    if (board[i] === 0) {
      if (pick === 0) {
        board[i] = value
        return
      }
      pick -= 1
    }
  }
}

// ---- a whole game, refereed here ----
export function newGame(rules, random) {
  const board = new Int16Array(CELLS)
  const oddCell = Math.floor(Math.min(random(), EPS_CAP) * CELLS)
  board[oddCell] = Math.min(random(), EPS_CAP) < 0.5 ? 1 : 3
  const empty = []
  for (let i = 0; i < CELLS; i += 1) if (board[i] === 0) empty.push(i)
  const evenCell = empty[Math.floor(Math.min(random(), EPS_CAP) * empty.length)]
  board[evenCell] = Math.min(random(), EPS_CAP) < 0.5 ? 2 : 4
  return { board, score: 0, largestPrime: 0, goalReached: false, moves: 0, over: false, log: '' }
}

const stage = new Int16Array(CELLS)

// Applies one move (and its spawn) to `game` in place. Returns false if the move changed nothing.
export function playMove(rules, game, dir, random) {
  const gained = slideBoard(game.board, dir, stage)
  if (gained < 0) return false
  game.board.set(stage)
  game.score += gained
  const built = scratch.largestMerged
  if (built > game.largestPrime) game.largestPrime = built
  if (gained > 0 && builtGoal(game, rules)) game.goalReached = true
  spawn(rules, game.board, random)
  game.moves += 1
  game.log += LETTERS[dir]
  game.over = isOver(game.board)
  return true
}

// v1 (frozen) only reaches the goal on a merge of exactly the goal value; v2 also counts a merge
// that jumps past it (97 + 6 = 103 still wins). builtGoal re-derives that from the stage board
// rather than from the largest sum alone.
function builtGoal(game, rules) {
  // `stage` holds the board after sliding. Once any cell reaches (or, for v2, passes) the goal
  // value, it stays that way or higher for the rest of the run (such tiles are effectively
  // permanent), so checking presence in `stage` is sufficient for the first time it happens.
  if (rules.goalExact) {
    for (let i = 0; i < CELLS; i += 1) if (stage[i] === rules.goal) return true
    return false
  }
  for (let i = 0; i < CELLS; i += 1) if (stage[i] >= rules.goal) return true
  return false
}
