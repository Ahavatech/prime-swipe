import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

// The backend runs a copy of the engine so the Docker build (which only sees backend/) can
// load it. The browser runs game-engine.js at the repo root. If the two differ, honest runs
// stop verifying, so they must be byte-identical.
const vendored = new URL('../src/engine/game-engine.cjs', import.meta.url)
const root = new URL('../../game-engine.js', import.meta.url)

test('the vendored engine is byte-identical to the repo-root game-engine.js', t => {
  if (!fs.existsSync(root)) {
    t.skip('repo-root game-engine.js is not alongside backend/ (running outside the full repo)')
    return
  }
  assert.equal(
    fs.readFileSync(vendored, 'utf8'),
    fs.readFileSync(root, 'utf8'),
    'backend/src/engine/game-engine.cjs has drifted from game-engine.js; copy the root file over it'
  )
})
