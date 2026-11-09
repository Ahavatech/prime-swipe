// Board evaluation for Prime Swipe.
//
// 2048 heuristics reward ordered rows and a big tile in the corner. None of that applies here:
// a merge needs a prime sum, so what matters is how many merges are available, how much of the
// board is stuck, and how the parity balance looks. The weights below are a starting point;
// tune.mjs improves them by hill-climbing against held-out seeds.
//
// Features (all counted on a board after a spawn, player to move):
//   empty      empty cells
//   merge      adjacent pairs whose sum is prime (moves that would merge)
//   even, odd  tile counts by parity. Odd tiles can only leave via 1+1=2 and evens only by
//              merging with an odd, so both are clutter, in different ways.
//   evenEven   adjacent even pairs: they can never merge, so they are walls
//   oddOdd     adjacent odd pairs: only 1+1 can merge
//   stranded   tiles with no mergeable neighbour right now
//   logMax     log2 of the largest tile (progress)

import { isPrime } from './rules.mjs'

export const FEATURES = ['empty', 'merge', 'even', 'odd', 'evenEven', 'oddOdd', 'stranded', 'logMax']

export const DEFAULT_WEIGHTS = Object.freeze({
  empty: 3,
  merge: 4,
  even: -0.5,
  odd: -0.5,
  evenEven: -0.5,
  oddOdd: -0.2,
  stranded: -0.3,
  logMax: 2
})

const counts = new Float64Array(FEATURES.length)

// Fills `out` (or an internal buffer) with the feature values of a board.
export function features(board, out = counts) {
  let empty = 0
  let even = 0
  let odd = 0
  let merge = 0
  let evenEven = 0
  let oddOdd = 0
  let stranded = 0
  let largest = 0
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      const i = r * 4 + c
      const v = board[i]
      if (v === 0) {
        empty += 1
        continue
      }
      if (v > largest) largest = v
      if (v & 1) odd += 1
      else even += 1
      let partner = false
      // Look right and down; each adjacent pair is visited once. A partner on the left or
      // above is credited when that earlier cell is visited, so track it via `partner` below.
      if (c < 3 && board[i + 1] !== 0) {
        const w = board[i + 1]
        if (isPrime(v + w)) {
          merge += 1
        } else if (!(v & 1) && !(w & 1)) {
          evenEven += 1
        } else if ((v & 1) && (w & 1)) {
          oddOdd += 1
        }
      }
      if (r < 3 && board[i + 4] !== 0) {
        const w = board[i + 4]
        if (isPrime(v + w)) {
          merge += 1
        } else if (!(v & 1) && !(w & 1)) {
          evenEven += 1
        } else if ((v & 1) && (w & 1)) {
          oddOdd += 1
        }
      }
      // stranded: no neighbour in any direction forms a prime sum with this tile
      if (c > 0 && board[i - 1] !== 0 && isPrime(v + board[i - 1])) partner = true
      else if (c < 3 && board[i + 1] !== 0 && isPrime(v + board[i + 1])) partner = true
      else if (r > 0 && board[i - 4] !== 0 && isPrime(v + board[i - 4])) partner = true
      else if (r < 3 && board[i + 4] !== 0 && isPrime(v + board[i + 4])) partner = true
      if (!partner) stranded += 1
    }
  }
  out[0] = empty
  out[1] = merge
  out[2] = even
  out[3] = odd
  out[4] = evenEven
  out[5] = oddOdd
  out[6] = stranded
  out[7] = largest > 0 ? Math.log2(largest) : 0
  return out
}

// Turns a weights object into a flat array in FEATURES order, for the hot path.
export function weightVector(weights = DEFAULT_WEIGHTS) {
  return Float64Array.from(FEATURES, name => weights[name])
}

export function evaluate(board, vector) {
  const f = features(board)
  let total = 0
  for (let i = 0; i < f.length; i += 1) total += f[i] * vector[i]
  return total
}
