// Plays whole games and records what happened.

import { Engine, createRules, newGame, playMove, LETTERS } from './rules.mjs'

export const MAX_MOVES = 5000 // the verified-run backend refuses longer logs

// One game. `seed` fixes what the game deals; `botSeed` fixes the bot's own choices.
export function playGame({ rules, bot, seed, botSeed = seed ^ 0x9e3779b9, maxMoves = MAX_MOVES }) {
  const deal = Engine.createSeededRandom(seed >>> 0)
  const rng = Engine.createSeededRandom(botSeed >>> 0)
  const game = newGame(rules, deal)
  const started = process.hrtime.bigint()
  while (!game.over && game.moves < maxMoves && !game.goalReached) {
    const dir = bot(rules, game, rng)
    if (!playMove(rules, game, dir, deal)) {
      throw new Error(`bot chose a move that does nothing: ${LETTERS[dir]} at move ${game.moves}`)
    }
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
  return {
    seed: seed >>> 0,
    moves: game.moves,
    score: game.score,
    largestPrime: game.largestPrime,
    won: game.goalReached,
    over: game.over,
    capped: !game.over && !game.goalReached,
    log: game.log,
    elapsedMs
  }
}

// Replays a finished log through the real engine and reports what it says. This is the referee:
// a win only counts if the real game agrees.
export function referee(seed, log) {
  const result = Engine.replay(seed, log)
  if (!result.ok) return { ok: false, reason: result.reason, index: result.index }
  return {
    ok: true,
    goalAchieved: result.state.goalAchieved === true,
    score: result.state.score,
    largestPrime: result.state.largestPrime,
    moves: result.moveCount
  }
}

export { createRules }
