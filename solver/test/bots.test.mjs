import assert from 'node:assert/strict'
import test from 'node:test'
import { Engine, CURRENT_RULES, createRules, DIRS } from '../rules.mjs'
import { lookaheadBestDirs, makeBot } from '../bots.mjs'
import { playGame, referee } from '../play.mjs'

const rules = createRules(CURRENT_RULES)
const dummy = () => 0.5
const empties = board => board.filter(v => v === 0).length

// The original lookahead bot, verbatim from sim.js, running on the real engine.
function originalBestDirs(state) {
  const moves = DIRS.map((d, i) => ({ i, r: Engine.move(state, d, dummy) })).filter(x => x.r.moved)
  const value = x => empties(x.r.state.board) * 3 + x.r.scoreDelta * 0.2 + (Engine.hasLegalMerge(x.r.state.board) ? 5 : 0)
  const best = Math.max(...moves.map(value))
  return moves.filter(m => value(m) === best).map(m => m.i)
}

test('the ported lookahead bot has the same best set as the original on every position', () => {
  let positions = 0
  for (let seed = 1; seed <= 150; seed += 1) {
    const random = Engine.createSeededRandom(seed)
    let state = Engine.createGame(random)
    const wander = Engine.createSeededRandom(seed * 7919)
    while (state.status === 'playing') {
      const game = { board: Int16Array.from(state.board) }
      assert.deepEqual(lookaheadBestDirs(rules, game).sort(), originalBestDirs(state).sort(), `seed ${seed} position ${positions}`)
      positions += 1
      const legal = DIRS.filter(d => Engine.move(state, d, dummy).moved)
      state = Engine.move(state, legal[Math.floor(wander() * legal.length)], random).state
    }
  }
  assert.ok(positions > 6000, `only ${positions} positions checked`)
})

test('every bot plays legal games and the real engine agrees with the result', () => {
  for (const name of ['random', 'greedy', 'lookahead', 'expectimax-1', 'expectimax-2', 'montecarlo']) {
    const bot = makeBot(name)
    for (let seed = 1; seed <= 4; seed += 1) {
      const game = playGame({ rules, bot, seed })
      const real = referee(seed, game.log)
      assert.equal(real.ok, true, `${name} seed ${seed}`)
      assert.equal(real.score, game.score, `${name} seed ${seed} score`)
      assert.equal(real.largestPrime, game.largestPrime, `${name} seed ${seed} largest`)
      assert.equal(real.goalAchieved, game.won, `${name} seed ${seed} goal`)
    }
  }
})

test('a bot cannot change what the game deals except through its moves', () => {
  // Same seed, same bot, different bot stream: the opening board must be identical.
  const a = playGame({ rules, bot: makeBot('random'), seed: 5, botSeed: 1, maxMoves: 0 })
  const b = playGame({ rules, bot: makeBot('random'), seed: 5, botSeed: 2, maxMoves: 0 })
  assert.equal(a.moves, 0)
  assert.equal(b.moves, 0)
  assert.equal(a.log, b.log)
})
