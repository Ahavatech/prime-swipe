// Runs a bot over many seeded games on 2+ worker threads and summarises the results.
import { Worker } from 'node:worker_threads'
import os from 'node:os'
import { CURRENT_RULES } from './rules.mjs'
import { referee } from './play.mjs'

export function wilson(k, n, z = 1.96) {
  if (n === 0) return [0, 0]
  const p = k / n
  const d = 1 + z * z / n
  const c = p + z * z / (2 * n)
  const m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)]
}

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

export function runWorkers({ bot, botOptions = {}, rulesConfig = CURRENT_RULES, seeds, threads = os.cpus().length }) {
  const chunks = Array.from({ length: threads }, () => [])
  seeds.forEach((s, i) => chunks[i % threads].push(s))
  return Promise.all(chunks.filter(c => c.length).map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.mjs', import.meta.url), {
      workerData: { bot, botOptions, rulesConfig, seeds: chunk }
    })
    w.once('message', resolve)
    w.once('error', reject)
  }))).then(parts => parts.flat())
}

export function summarize(games, { referee: check = true } = {}) {
  const n = games.length
  let wins = 0
  let refereed = 0
  let disagreements = 0
  for (const g of games) {
    if (!g.won) continue
    wins += 1
    if (check) {
      const r = referee(g.seed, g.log)
      if (r.ok && r.goalAchieved) refereed += 1
      else disagreements += 1
    }
  }
  const moves = games.map(g => g.moves).sort((a, b) => a - b)
  const largest = games.map(g => g.largestPrime).sort((a, b) => a - b)
  const scores = games.map(g => g.score).sort((a, b) => a - b)
  const ge = t => games.filter(g => g.largestPrime >= t).length
  const totalMs = games.reduce((a, g) => a + g.elapsedMs, 0)
  const totalMoves = games.reduce((a, g) => a + g.moves, 0)
  return {
    games: n,
    wins,
    winRate: wins / n,
    winCI: wilson(wins, n),
    refereeConfirmed: check ? refereed : null,
    refereeDisagreements: check ? disagreements : null,
    reach23: ge(23) / n,
    reach53: ge(53) / n,
    reach89: ge(89) / n,
    moves: { p10: pct(moves, 0.1), median: pct(moves, 0.5), p90: pct(moves, 0.9) },
    largest: { median: pct(largest, 0.5), p90: pct(largest, 0.9), max: largest[n - 1] },
    score: { median: pct(scores, 0.5), p90: pct(scores, 0.9) },
    overshot: games.filter(g => !g.won && g.largestPrime > 101).length / n,
    capped: games.filter(g => g.capped).length,
    msPerMove: totalMs / Math.max(1, totalMoves)
  }
}

export async function bench(opts) {
  const games = await runWorkers(opts)
  return summarize(games, { referee: opts.referee !== false })
}

export function line(name, s) {
  const [lo, hi] = s.winCI
  return `${name.padEnd(16)} win ${(100 * s.winRate).toFixed(2).padStart(6)}% [${(100 * lo).toFixed(2)}–${(100 * hi).toFixed(2)}]  ` +
    `≥53 ${(100 * s.reach53).toFixed(1).padStart(5)}%  moves p10/med/p90 ${s.moves.p10}/${s.moves.median}/${s.moves.p90}  ` +
    `largest med/p90 ${s.largest.median}/${s.largest.p90}  ${s.msPerMove.toFixed(3)} ms/move` +
    (s.refereeDisagreements ? `  REFEREE DISAGREES x${s.refereeDisagreements}` : '') + (s.refereeConfirmed !== null && s.wins ? `  (engine confirmed ${s.refereeConfirmed}/${s.wins} wins)` : '')
}
