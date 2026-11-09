// Finalists, measured properly: every bot, many games, a strong Monte Carlo solver, and the
// real engine as referee for every win. Appends to results/finals.jsonl.
import fs from 'node:fs'
import { runWorkers, summarize, line } from './benchmark.mjs'
import { CURRENT_RULES } from './rules.mjs'

const make = (name, base, assistBonus, unlockWeight) => ({ ...CURRENT_RULES, name, base, assistBonus, unlockWeight })
const FINALISTS = {
  current: CURRENT_RULES,
  'A-even45-u5': make('A-even45-u5', { 1: 28, 2: 19, 3: 14, 4: 15, 5: 14, 6: 10 }, 0.5, 5),
  'B-even45-u8': make('B-even45-u8', { 1: 28, 2: 19, 3: 14, 4: 15, 5: 14, 6: 10 }, 0.5, 8),
  'C-even60-u8': make('C-even60-u8', { 1: 20, 2: 25, 3: 10, 4: 20, 5: 10, 6: 15 }, 0.5, 8)
}
const only = process.argv[2]
const seeds = (start, n) => Array.from({ length: n }, (_, i) => start + i)
const out = 'results/finals.jsonl'

for (const [key, rules] of Object.entries(FINALISTS)) {
  if (only && only !== key) continue
  const t = Date.now()
  const result = { rules }
  const plan = [
    ['random', 3000, {}], ['greedy', 3000, {}], ['lookahead', 3000, {}],
    ['expectimax-1', 1000, {}],
    ['montecarlo', 300, { rollouts: 48, horizon: 20 }]
  ]
  for (const [bot, n, opts] of plan) {
    result[bot] = { options: opts, ...summarize(await runWorkers({ bot, botOptions: opts, rulesConfig: rules, seeds: seeds(7_000_000, n) })) }
    console.log(line(`${key}/${bot}`, result[bot]))
  }
  fs.appendFileSync(out, JSON.stringify(result) + '\n')
  console.log(`-- ${key} done in ${((Date.now() - t) / 1000).toFixed(0)}s`)
}
console.log('FINALS DONE')
