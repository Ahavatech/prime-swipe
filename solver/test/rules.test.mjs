import assert from 'node:assert/strict'
import test from 'node:test'
import { CURRENT_RULES, LEGACY_RULES, DIRS, Engine as CurrentEngine, LegacyEngine, LETTERS, createRules, newGame, playMove, tableFor } from '../rules.mjs'

// Every test runs against both engine versions: the live one and the frozen v1 copy.
const VERSIONS = [['v2 (current)', CurrentEngine, CURRENT_RULES], ['v1 (legacy)', LegacyEngine, LEGACY_RULES]]

function mulberry(seed) {
  return CurrentEngine.createSeededRandom(seed >>> 0)
}

// Two policies, so the lockstep covers both aimless boards and the deeper ones that unlock
// the bigger spawn tiles.
function chooser(Engine, kind, seed) {
  const rnd = mulberry(seed ^ 0x9e3779b9)
  return (engineState) => {
    const options = []
    for (let d = 0; d < 4; d += 1) {
      const probe = Engine.move(engineState, DIRS[d], () => 0.5)
      if (probe.moved) options.push({ d, gain: probe.scoreDelta })
    }
    if (!options.length) return -1
    if (kind === 'greedy') {
      const best = Math.max(...options.map(o => o.gain))
      const top = options.filter(o => o.gain === best)
      return top[Math.floor(rnd() * top.length)].d
    }
    return options[Math.floor(rnd() * options.length)].d
  }
}

for (const [label, Engine, config] of VERSIONS) {
const rules = createRules(config)

test(`${label}: the fast rules play identically to the real engine, move by move`, () => {
  let steps = 0
  let sawTier1 = false
  let sawTier2 = false
  let goals = 0
  for (const kind of ['random', 'greedy']) {
    for (let seed = 1; seed <= 150; seed += 1) {
      const rngEngine = mulberry(seed)
      const rngFast = mulberry(seed)
      let engineState = Engine.createGame(rngEngine)
      const game = newGame(rules, rngFast)
      assert.deepEqual([...game.board], engineState.board, `opening board, ${kind} seed ${seed}`)
      const choose = chooser(Engine, kind, seed)

      while (engineState.status === 'playing') {
        const d = choose(engineState)
        if (d < 0) break
        const outcome = Engine.move(engineState, DIRS[d], rngEngine)
        const moved = playMove(rules, game, d, rngFast)
        assert.equal(moved, outcome.moved)
        engineState = outcome.state
        steps += 1
        const where = `${kind} seed ${seed} move ${game.moves}`
        assert.deepEqual([...game.board], engineState.board, `board, ${where}`)
        assert.equal(game.score, engineState.score, `score, ${where}`)
        assert.equal(game.largestPrime, engineState.largestPrime, `largest prime, ${where}`)
        assert.equal(game.goalReached, engineState.goalAchieved, `goal flag, ${where}`)
        assert.equal(game.over, engineState.status === 'game-over', `game over, ${where}`)
        const largest = Math.max(...game.board)
        sawTier1 ||= largest >= 23
        sawTier2 ||= largest >= 53
        if (engineState.goalAchieved) goals += 1
      }
      assert.equal(game.log, [...game.log].join(''))
    }
  }
  assert.ok(steps > 10000, `only ${steps} steps compared`)
  assert.ok(sawTier1 && sawTier2, 'the comparison should reach both unlock tiers')
  console.log(`  ${label} lockstep: ${steps} moves identical; unlock tiers reached: ${sawTier1}/${sawTier2}`)
})

test(`${label}: the spawn distribution matches the engine for arbitrary boards, including unlock tiers and assist`, () => {
  const rnd = mulberry(2026)
  let compared = 0
  const seenTiers = new Set()
  for (let i = 0; i < 3000; i += 1) {
    const board = Array.from({ length: 16 }, () => (rnd() < 0.5 ? 0 : Math.floor(rnd() * 60)))
    if (rnd() < 0.3) board[Math.floor(rnd() * 16)] = [23, 53, 101, 22, 52][Math.floor(rnd() * 5)]
    const expected = Engine.getSpawnDistribution(board, [])
    const table = tableFor(rules, Int16Array.from(board))
    const values = Object.keys(expected).map(Number).sort((a, b) => a - b)
    assert.deepEqual([...table.values], values, JSON.stringify(board))
    values.forEach((v, idx) => assert.equal(table.probs[idx], expected[v], `p(${v}) on ${JSON.stringify(board)}`))
    seenTiers.add(values.length)
    compared += 1
  }
  assert.deepEqual([...seenTiers].sort(), [6, 9, 11].map(String).map(Number).sort())
  assert.equal(compared, 3000)
})

test(`${label}: letters map to the engine directions`, () => {
  assert.equal(LETTERS, 'UDLR')
  LETTERS.split('').forEach((letter, index) => assert.equal(Engine.MOVE_CODES[letter], DIRS[index]))
})
}
