// Sweeps spawn parameters. For each candidate rule set it measures the simple bots (cheap, many
// games) and a fast Monte Carlo probe (costly, fewer games). Results append to results/sweep.jsonl.
import fs from 'node:fs'
import { runWorkers, summarize } from './benchmark.mjs'
import { CURRENT_RULES } from './rules.mjs'

const EVEN_PROP = { 2: 25, 4: 20, 6: 15 }
const ODD_PROP = { 1: 20, 3: 10, 5: 10 }

export function candidate({ evenShare, assistBonus, unlockWeight }) {
  const base = {}
  const evenTotal = Object.values(EVEN_PROP).reduce((a, b) => a + b, 0)
  const oddTotal = Object.values(ODD_PROP).reduce((a, b) => a + b, 0)
  for (const [v, w] of Object.entries(EVEN_PROP)) base[v] = Math.max(1, Math.round(100 * evenShare * w / evenTotal))
  for (const [v, w] of Object.entries(ODD_PROP)) base[v] = Math.max(1, Math.round(100 * (1 - evenShare) * w / oddTotal))
  return {
    ...CURRENT_RULES,
    name: `even${Math.round(evenShare * 100)}-assist${Math.round(assistBonus * 100)}-unlock${unlockWeight}`,
    base,
    assistBonus,
    unlockWeight
  }
}

const out = 'results/sweep.jsonl'
const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).rules.name) : [])
const seeds = n => Array.from({ length: n }, (_, i) => 2_000_000 + i)

const GRIDS = {
  1: { evenShare: [0.6, 0.45, 0.3], assistBonus: [0.2, 0.35, 0.5], unlockWeight: [5, 2] },
  2: { evenShare: [0.6, 0.45], assistBonus: [0.5, 0.65, 0.8], unlockWeight: [5, 8, 12] }
}
const which = process.argv[2] || '1'
const g = GRIDS[which]
const grid = []
for (const evenShare of g.evenShare) {
  for (const assistBonus of g.assistBonus) {
    for (const unlockWeight of g.unlockWeight) grid.push(candidate({ evenShare, assistBonus, unlockWeight }))
  }
}

for (const rules of grid) {
  if (done.has(rules.name)) continue
  const t = Date.now()
  const result = { rules }
  for (const [bot, n, opts] of [
    ['random', 600, {}], ['greedy', 600, {}], ['lookahead', 600, {}],
    ['montecarlo', 160, { rollouts: 12, horizon: 10 }]
  ]) {
    result[bot] = summarize(await runWorkers({ bot, botOptions: opts, rulesConfig: rules, seeds: seeds(n) }))
  }
  fs.appendFileSync(out, JSON.stringify(result) + '\n')
  const f = k => `${(100 * result[k].winRate).toFixed(1)}%`
  console.log(`${rules.name.padEnd(26)} rand ${f('random')} greedy ${f('greedy')} look ${f('lookahead')} MC ${f('montecarlo')} moves(MC med) ${result.montecarlo.moves.median}  ${((Date.now() - t) / 1000).toFixed(0)}s`)
}
console.log('SWEEP DONE')
