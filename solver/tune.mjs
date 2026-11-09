// Hill-climbs the heuristic weights. Fitness is smoother than win rate (which is ~0 early on):
// mean of min(largest prime, goal) plus a bonus per win. Train and held-out seeds never overlap.
import fs from 'node:fs'
import { runWorkers, summarize, line } from './benchmark.mjs'
import { CURRENT_RULES } from './rules.mjs'
import { DEFAULT_WEIGHTS, FEATURES } from './heuristic.mjs'
import { Engine } from './rules.mjs'

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')))
const rulesFile = args.rules
const rulesConfig = rulesFile ? JSON.parse(fs.readFileSync(rulesFile, 'utf8')) : CURRENT_RULES
const out = args.out || 'results/tune-current.json'
const iterations = Number(args.iters || 40)
const trainN = Number(args.train || 300)
const bot = args.bot || 'expectimax-1'

const trainSeeds = Array.from({ length: trainN }, (_, i) => 1_000_000 + i)
const heldOut = Array.from({ length: Number(args.heldout || 2000) }, (_, i) => 5_000_000 + i)

async function fitness(weights) {
  const games = await runWorkers({ bot, botOptions: { weights }, rulesConfig, seeds: trainSeeds })
  const goal = rulesConfig.goal
  const mean = games.reduce((a, g) => a + Math.min(g.largestPrime, goal) + (g.won ? 100 : 0), 0) / games.length
  return { mean, wins: games.filter(g => g.won).length }
}

let best = { ...DEFAULT_WEIGHTS }
let bestFit = await fitness(best)
console.log('start', bestFit)
const rand = Engine.createSeededRandom(20260108)
const history = [{ iter: 0, fit: bestFit.mean, wins: bestFit.wins, weights: best }]
for (let it = 1; it <= iterations; it += 1) {
  const name = FEATURES[Math.floor(rand() * FEATURES.length)]
  const scale = Math.max(0.3, Math.abs(best[name]) * 0.5)
  const delta = (rand() < 0.5 ? -1 : 1) * scale * (0.3 + rand())
  const trial = { ...best, [name]: best[name] + delta }
  const fit = await fitness(trial)
  const accepted = fit.mean > bestFit.mean
  if (accepted) { best = trial; bestFit = fit }
  history.push({ iter: it, tried: name, delta, fit: fit.mean, wins: fit.wins, accepted })
  console.log(`${String(it).padStart(3)} ${name.padEnd(9)} ${delta.toFixed(2).padStart(6)} -> ${fit.mean.toFixed(2)} wins ${fit.wins}${accepted ? '  *' : ''}`)
}

const before = summarize(await runWorkers({ bot, botOptions: { weights: DEFAULT_WEIGHTS }, rulesConfig, seeds: heldOut }))
const after = summarize(await runWorkers({ bot, botOptions: { weights: best }, rulesConfig, seeds: heldOut }))
console.log(line('default (held-out)', before))
console.log(line('tuned   (held-out)', after))
console.log('weights', best)
fs.mkdirSync('results', { recursive: true })
fs.writeFileSync(out, JSON.stringify({ rules: rulesConfig.name, bot, trainSeeds: [trainSeeds[0], trainN], heldOutSeeds: [heldOut[0], heldOut.length], default: DEFAULT_WEIGHTS, tuned: best, heldOut: { default: before, tuned: after }, history }, null, 2))
