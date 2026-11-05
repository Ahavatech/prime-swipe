const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const script = path.join(root, 'scripts', 'prepare-pages.mjs')

function build(output, apiOrigin, nodeEnv = 'production') {
  const env = { ...process.env, NODE_ENV: nodeEnv }
  if (apiOrigin === undefined) {
    delete env.PRIME_SWIPE_API_BASE_URL
  } else {
    env.PRIME_SWIPE_API_BASE_URL = apiOrigin
  }
  return spawnSync(process.execPath, [script, path.relative(root, output)], {
    cwd: root,
    env,
    encoding: 'utf8'
  })
}

test('Pages staging publishes only allowlisted frontend files and injects API origin', t => {
  const directory = fs.mkdtempSync(path.join(root, '.pages-build-test-'))
  const output = path.join(directory, 'artifact')
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  const result = build(output, 'https://prime-api.example.test')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(fs.readdirSync(output).sort(), [
    'assets',
    'functions.js',
    'game-engine.js',
    'index.html',
    'leaderboard-api.js',
    'styles.css'
  ])
  assert.deepEqual(fs.readdirSync(path.join(output, 'assets', 'fonts')).sort(), [
    'OFL.txt',
    'aldrich-latin-400-normal.woff2'
  ])
  assert.deepEqual(
    fs.readFileSync(path.join(output, 'assets', 'fonts', 'aldrich-latin-400-normal.woff2')),
    fs.readFileSync(path.join(root, 'assets', 'fonts', 'aldrich-latin-400-normal.woff2'))
  )
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8')
  assert.match(html, /<meta name="prime-swipe-api-base" content="https:\/\/prime-api\.example\.test">/)
  assert.doesNotMatch(html, /2048\.fly\.dev|prime-swipe-dev\.db|DATABASE_PATH/)
})

test('Pages staging rejects missing, non-HTTPS, and non-origin production configuration', t => {
  const directory = fs.mkdtempSync(path.join(root, '.pages-build-invalid-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  for (const [index, apiOrigin] of [
    [0, undefined],
    [1, 'http://api.example.test'],
    [2, 'https://api.example.test/path'],
    [3, 'https://api.example.test/']
  ]) {
    const output = path.join(directory, `artifact-${index}`)
    const result = build(output, apiOrigin)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /PRIME_SWIPE_API_BASE_URL/)
    assert.equal(fs.existsSync(output), false)
  }
})

test('local HTTP API origin is accepted only for an explicit development build', t => {
  const directory = fs.mkdtempSync(path.join(root, '.pages-build-local-test-'))
  const output = path.join(directory, 'artifact')
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  const result = build(output, 'http://localhost:8080', 'development')
  assert.equal(result.status, 0, result.stderr)
  assert.match(
    fs.readFileSync(path.join(output, 'index.html'), 'utf8'),
    /content="http:\/\/localhost:8080"/
  )
})

test('release workflow is manual-only', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-pages.yml'), 'utf8')
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s+(push|pull_request):/m)
})
