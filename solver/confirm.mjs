// Final measurement on the live engine (v2). Same seeds as the v1 baseline in results/finals.jsonl,
// so before/after is a paired comparison. Every win is replayed through the real engine.
import fs from 'node:fs'
import { runWorkers, summarize, line } from './benchmark.mjs'
import { CURRENT_RULES } from './rules.mjs'

const tuned = JSON.parse(fs.readFileSync('results/tune-A.json', 'utf8')).tuned
const seeds = (start, n) => Array.from({ length: n }, (_, i) => start + i)
const plan = [
  ['random', 'random', 5000, {}],
  ['greedy', 'greedy', 5000, {}],
  ['lookahead', 'lookahead', 5000, {}],
  ['expectimax-1', 'expectimax-1', 2000, {}],
  ['expectimax-1 (tuned)', 'expectimax-1', 2000, { weights: tuned }],
  ['expectimax-2', 'expectimax-2', 300, {}],
  ['montecarlo', 'montecarlo', 500, { rollouts: 48, horizon: 20 }]
]
const result = { rules: CURRENT_RULES, bots: {} }
for (const [label, bot, n, opts] of plan) {
  const s = summarize(await runWorkers({ bot, botOptions: opts, rulesConfig: CURRENT_RULES, seeds: seeds(7_000_000, n) }))
  result.bots[label] = { bot, options: opts, ...s }
  console.log(line(label, s), ` overshoot ${(100 * s.overshot).toFixed(1)}%`)
}
fs.writeFileSync('results/confirm-v2.json', JSON.stringify(result, null, 2))
console.log('CONFIRM DONE')
