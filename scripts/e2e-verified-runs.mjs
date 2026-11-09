import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backendRoot = path.join(root, 'backend')
const require = createRequire(import.meta.url)
const GameEngine = require('../game-engine.js')
const RunSession = require('../run-session.js')
const { createLeaderboardApi } = require('../leaderboard-api.js')
const directions = ['up', 'left', 'down', 'right']

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function unusedPort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}

function playToGameOver(claims) {
  const session = RunSession.createRunSession({ engine: GameEngine, claims })
  let index = claims.seed % directions.length
  let attempts = 0
  while (session.snapshot().state.status === 'playing' && attempts < 5000) {
    session.move(directions[index])
    index = (index + 1) % directions.length
    attempts += 1
  }
  assert.equal(session.snapshot().state.status, 'game-over', `seed ${claims.seed} did not finish`)
  return session
}

async function waitForMoveWindow(issuedAt, moveCount) {
  const remaining = Date.parse(issuedAt) + moveCount * 40 + 75 - Date.now()
  if (remaining > 0) {
    await delay(remaining)
  }
}

async function waitUntilHealthy(child, baseUrl, getOutput) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Backend exited before becoming healthy.\n${getOutput()}`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`)
      if (response.ok) {
        return
      }
    } catch {}
    await delay(100)
  }
  throw new Error(`Backend did not become healthy.\n${getOutput()}`)
}

const port = await unusedPort()
const baseUrl = `http://127.0.0.1:${port}`
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-swipe-verified-e2e-'))
const child = spawn(process.execPath, [path.join(backendRoot, 'src', 'server.js')], {
  cwd: backendRoot,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    DATABASE_PATH: path.join(tempDirectory, 'prime-swipe-e2e.db'),
    RUN_TOKEN_SECRET: randomBytes(32).toString('hex')
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let output = ''
child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk })
child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk })

try {
  await waitUntilHealthy(child, baseUrl, () => output)
  const api = createLeaderboardApi({ baseUrl, fetch })
  const claims = await api.startRun()
  assert.equal(claims.engineVersion, GameEngine.VERSION)

  const session = playToGameOver(claims)
  const snapshot = session.snapshot()
  assert.ok(snapshot.moveLog.length > 0)
  const replay = GameEngine.replay(claims.seed, snapshot.moveLog)
  assert.equal(replay.ok, true)
  assert.equal(replay.state.score, snapshot.state.score)

  const payload = {
    displayName: 'E2E PLAYER',
    runToken: snapshot.runToken,
    moveLog: snapshot.moveLog,
    score: snapshot.state.score
  }
  await waitForMoveWindow(claims.issuedAt, payload.moveLog.length)
  const submitted = await api.submitScore(payload)
  assert.equal(submitted.source, 'backend')
  assert.equal(submitted.score, replay.state.score)
  assert.ok(Number.isSafeInteger(submitted.rank) && submitted.rank > 0)

  const retried = await api.submitScore(payload)
  assert.deepEqual(retried, submitted)

  const leaderboard = await api.getLeaderboard()
  assert.equal(leaderboard.limit, 12)
  const listedRun = leaderboard.entries.find(entry => entry.displayName === payload.displayName)
  assert.ok(listedRun)
  assert.equal(listedRun.verified, true)
  assert.equal(listedRun.score, submitted.score)

  const primeLeaderboard = await api.getLeaderboard({ sortBy: 'largestPrime' })
  assert.ok(primeLeaderboard.entries.length <= 12)
  assert.deepEqual(
    primeLeaderboard.entries.map(entry => entry.largestPrime),
    [...primeLeaderboard.entries.map(entry => entry.largestPrime)].sort((a, b) => b - a)
  )

  const tamperClaims = await api.startRun()
  const tamperSession = playToGameOver(tamperClaims)
  const tamperSnapshot = tamperSession.snapshot()
  const tamperedPayload = {
    ...payload,
    runToken: tamperSnapshot.runToken,
    moveLog: `${tamperSnapshot.moveLog}U`,
    score: tamperSnapshot.state.score
  }
  await waitForMoveWindow(tamperClaims.issuedAt, tamperedPayload.moveLog.length)
  await assert.rejects(api.submitScore(tamperedPayload), error => {
    assert.ok(['RUN_REJECTED', 'SCORE_MISMATCH'].includes(error.code), error.code)
    return true
  })

  console.log(
    `Verified-run E2E passed: rank ${submitted.rank}, score ${submitted.score}, ` +
    `${submitted.moves} moves; identical retry returned the original result; ` +
    'tampered log was rejected.'
  )
} catch (error) {
  console.error(error)
  if (output) {
    console.error(output)
  }
  process.exitCode = 1
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM')
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      delay(5000)
    ])
    if (child.exitCode === null) {
      child.kill()
    }
  }
  fs.rmSync(tempDirectory, { recursive: true, force: true })
}
