# Prime Swipe solver

Search-based players, a benchmark harness, and the data behind the v2 spawn rules.

The question: in v1, reaching 101 was almost impossible (a simple bot won about 1 game in 100). Is that a
skill problem or a rules problem, and what change makes 101 reachable for a good player without
making it easy for a bad one?

## Answer in one table

Same seeds before and after. This table predates the goal-definition decision below: "win" here still means a
merge built **exactly** 101 (v1 is frozen and always means exactly 101; these v2 numbers are from before the
owner chose 101-or-higher). Every win below was replayed through the
real game engine, which agreed each time (v1 numbers were refereed by the v1 engine, v2 by the v2 engine).
Brackets are 95% Wilson intervals.

| Player | v1 (old spawn rules) | v2 (new spawn rules) | games (v1 / v2) |
|---|---|---|---|
| random | 0.17% [0.07–0.39] | 1.06% [0.81–1.38] | 3000 / 5000 |
| greedy (your sim.js) | 1.07% [0.76–1.50] | 7.18% [6.50–7.93] | 3000 / 5000 |
| lookahead (your sim.js) | 1.60% [1.21–2.11] | 8.44% [7.70–9.24] | 3000 / 5000 |
| expectimax, depth 1 | 3.50% [2.53–4.83] | 29.70% [27.74–31.74] | 1000 / 2000 |
| expectimax, depth 2 | not run | 47.33% [41.75–52.98] | – / 300 |
| Monte Carlo (48 rollouts × 20 moves) | 9.00% [6.26–12.78] | 44.80% [40.50–49.18] | 300 / 500 |

My target, which is my choice and not a fact about the game: a strong player wins roughly 40–50%, the simple
bots stay under about 10%, and blind play stays near 1%. v2 hits that. Search is worth a 5× jump over your
lookahead bot, and the search players are cheap (depth-1 expectimax is 0.026 ms a move).

## What changed (engine version 2)

| | v1 | v2 |
|---|---|---|
| Base spawn weights 1,2,3,4,5,6 | 20, 25, 10, 20, 10, 15 | 28, 19, 14, 15, 14, 10 |
| Parity assist (when evens < odds) | +0.2 even share | +0.5, capped at 1 |
| Unlock tiers, unlock weight | 23 → 8,10,12; 53 → 14,16; weight 5 | unchanged |

Files touched: `game-engine.js` (`VERSION` is now `'2'`, new `EVEN_ASSIST_BONUS` constant), the vendored backend copy
(byte-identical), `backend/tests/fixtures/golden-run.json` (regenerated), and the spawn-weights text in the rules
dialog in `index.html`.

## How it was found

1. **Fast referee.** `rules.mjs` re-implements the rules for speed (memoised row slides, precomputed spawn tables).
   It is not trusted: `test/rules.test.mjs` plays games in lockstep with the real engine and compares the board,
   score, largest prime, goal flag and game-over every move (18,270 moves on v2 and 17,618 on v1, reaching both
   unlock tiers), and checks the spawn distribution on 3,000 arbitrary boards. The v1 engine is kept in
   `legacy/` so the baseline can always be rerun.
2. **Players** (`bots.mjs`). Your three sim.js bots, ported and tested to have the same best-move set as the originals
   on 6,000+ real positions. Plus expectimax over afterstates using the true spawn distribution (exact enumeration at
   leaf chance nodes, sampled above) and flat Monte Carlo with heuristic rollouts.
3. **Baseline on v1**: random 0.17%, greedy 1.07%, lookahead 1.60%, expectimax-1 3.5%, Monte Carlo 9.0%.
4. **Heuristic tuning** (`tune.mjs`). Hill-climbing on 300–400 training seeds, scored on 2,000 held-out seeds.
   The result is below.
5. **Spawn sweep** (`sweep.mjs`, `results/sweep.jsonl`). 36 rule sets, even share × assist bonus × unlock weight,
   each measured with the three simple bots (600 games) and a cheaper Monte Carlo probe (160 games).
6. **Finalists** (`finals.mjs`) with the stronger solver and thousands of games, then the live-engine check
   (`confirm.mjs`, `results/confirm-v2.json`).

## Findings

**The heuristic barely matters; the rules do.** Hill-climbing the evaluation weights gained nothing that held up:
v1 held-out 3.70% → 3.70%, v2 30.5% → 32.4% on the tuning run's held-out seeds, then 29.7% vs 29.35% (tuned) on the
confirmation seeds. The fitness signal from a few hundred games was noisier than the gains. Changing the spawn
parameters moved the same bots by 10–40 points.

**Parity assist is the big lever, and it saturates.** In the sweep, an assist bonus of 0.5, 0.65 and 0.8 gave identical
results for an even share of 60%, because the even share is capped at 100% once the bonus passes 0.4. Raising it past that
does nothing; the rule becomes "if evens are outnumbered, spawn an even."

**Unlock weight lifts everyone, so it is a poor lever.** Raising it from 5 to 12 (even share 60%, assist 0.5) took
random from 0.8% to 4.8% and Monte Carlo from 36% to 59%. The skill gap stayed about the same. I left it alone, because making
big tiles common makes the game easier for everyone, not for good players.

**Candidates measured with the strong solver** (rules before settling on A; same seeds):

| Rule set | random | greedy | lookahead | expectimax-1 | Monte Carlo |
|---|---|---|---|---|---|
| A (chosen): even share 45%, assist 0.5, unlock 5 | 0.97% | 7.20% | 8.60% | 30.0% | 43.3% |
| B: even share 45%, assist 0.5, unlock 8 | 2.30% | 14.5% | 16.8% | 46.5% | 59.0% |
| C: even share 60%, assist 0.5, unlock 8 | 2.33% | 12.4% | 13.8% | 43.6% | 51.7% |

I chose A. B and C win more for everyone, but random play wins about 2%, which cheapens the goal. If you want an easier
game, B is a one-line change: set unlock weight to 8 in `getSpawnDistribution`, bump `VERSION` and regenerate the fixture.

## Decision: 101 or higher (resolved)

The goal used to fire only on a merge of exactly 101. A merge can jump past it (97 + 6 = 103), and then 101 can
never appear again on a board that has no smaller tile left to build it with. Under the exact rule, the search
players that plan for 101 overshot less than weaker players (see the table this replaces, measured before the
change), but the owner's call was that overshooting shouldn't be punished: **the goal now fires on a merge of
101 or higher.**

What changed, and what didn't:
- `game-engine.js`: `goalAchieved` now checks `mergedValues.some(v => v >= 101)` instead of `.includes(101)`.
  This is a change to a *derived flag only* — it doesn't touch spawns, merges, or how many random numbers are
  drawn, so it did **not** need an `ENGINE_VERSION` bump or a golden-fixture regeneration (the fixture never
  asserted `goalAchieved`).
- `rules.mjs` gained a `goalExact` flag per rule set: `true` for `LEGACY_RULES` (the frozen v1 baseline must
  keep meaning exactly-101 forever) and `false` for `CURRENT_RULES`. `bots.mjs`'s win checks branch on it too.
  Getting this wrong would have silently made v1 benchmarks count overshoots as wins.
- `index.html`'s rules text now says "101 or higher."

Reconfirmed on the live engine after the change (`node confirm.mjs`, same seed ranges as `results/confirm-v2.json`;
the prior exact-101 numbers are preserved in `results/confirm-v2-exact101-baseline.json`). Every win below was
replayed through the real engine and agreed every time:

| Player | exactly-101 (before) | 101-or-higher (now) | games |
|---|---|---|---|
| random | 1.06% | 2.12% [1.76–2.56] | 5000 |
| greedy | 7.18% | 13.54% [12.62–14.52] | 5000 |
| lookahead | 8.44% | 15.86% [14.87–16.90] | 5000 |
| expectimax-1 | 29.70% | 43.85% [41.69–46.03] | 2000 |
| expectimax-1 (tuned) | – | 43.20% [41.04–45.38] | 2000 |
| expectimax-2 | 47.33% | 61.67% [56.05–66.99] | 300 |
| Monte Carlo (48×20) | 44.80% | 57.80% [53.43–62.05] | 500 |

As expected, the `overshot` metric (games that passed 101 without being counted a win) is now 0.0% for every
bot — every overshoot is a win, by definition, so there's nothing left for it to count. The strong players'
rate roughly tracks the ~43.6% estimate from the earlier analysis; the simpler bots gained more than expected,
because reaching 101-or-higher is easier than threading the exact value even for weak play.

## Limits

- The Monte Carlo and expectimax players are not optimal. 45–47% is a floor on what is achievable, not a ceiling.
  Depth-3 expectimax was too slow to finish here, and it was not benchmarked.
- All games were played by bots. Human win rates are unmeasured; if people play like lookahead or worse, expect single digits.
- Median game length stayed around 55–80 moves. The retune lets good players reach 101 before the board clogs. It does not
  fix the clogging itself.
- The sweep used a deliberately cheap Monte Carlo probe, so its absolute numbers understate the solver. Use it for
  ordering rule sets, not for win rates; the finals and confirmation tables are the reliable numbers.
- The sandbox had two CPU cores and no network, so large sweeps were small. Everything is reproducible with the scripts here.

## Reproduce

```
npm test                      # fast core vs real engine, bot ports, bot results re-checked by the engine
node tune.mjs --iters=60 --train=400
node sweep.mjs 1 && node sweep.mjs 2
node finals.mjs               # note: for candidate rules the engine referee disagrees by design (see below)
node confirm.mjs              # live engine; every win is replayed through game-engine.js
```

`finals.mjs` runs rule sets the live engine does not implement, so the referee check in its output (and in `finals.jsonl`
for A, B, C) reports disagreements. That is expected, and only the `current` rows (v1 at that time) and `confirm.mjs` (v2)
are engine-checked.

## Files

| File | Purpose |
|---|---|
| `rules.mjs` | Fast rules core, `CURRENT_RULES` (v2), `LEGACY_RULES` (v1) |
| `heuristic.mjs` | Board features and weights |
| `bots.mjs` | random, greedy, lookahead, expectimax, Monte Carlo |
| `play.mjs`, `benchmark.mjs`, `worker.mjs` | Game runner, 2-thread benchmark, Wilson intervals, engine referee |
| `tune.mjs`, `sweep.mjs`, `finals.mjs`, `confirm.mjs` | The experiments |
| `legacy/game-engine-v1.cjs` | Frozen v1 engine, for reproducing the baseline |
| `results/` | Raw data and logs from every run in this document |
