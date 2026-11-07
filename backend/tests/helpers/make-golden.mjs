// Regenerates tests/fixtures/golden-run.json from the current engine.
//   node tests/helpers/make-golden.mjs
// Run this only after a deliberate change to the game rules, and bump VERSION in
// game-engine.js first. The fixture is a snapshot of what the engine does, so reviewing the
// diff is the point: it tells you the change altered how seeded games play out.
import fs from 'node:fs'
import { GameEngine } from '../../src/engine/index.js'
import { playRun } from './play-run.js'

const seed = 424242
const { moveLog, state } = playRun(seed)
const fixture = {
  engineVersion: GameEngine.VERSION,
  seed,
  moveLog,
  expected: {
    moveCount: moveLog.length,
    score: state.score,
    largestPrime: state.largestPrime,
    status: state.status,
    board: state.board
  }
}
fs.writeFileSync(new URL('../fixtures/golden-run.json', import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`)
console.log(`golden run: seed ${seed}, ${moveLog.length} moves, score ${state.score}, largest prime ${state.largestPrime}, ${state.status}`)
