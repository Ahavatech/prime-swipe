import { createRequire } from 'node:module'

// The engine is the same file the browser runs, kept as CommonJS so both can load it.
// backend/src/engine/game-engine.cjs must stay byte-identical to the repo-root game-engine.js;
// tests/engine-sync.test.js fails when they drift.
const require = createRequire(import.meta.url)

export const GameEngine = require('./game-engine.cjs')
