import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { createDatabase } from '../src/db/database.js'

const ALL_VERSIONS = [{ version: 1 }, { version: 2 }, { version: 3 }]

const openByTest = new WeakMap()

// Registers a database so cleanup can close it. Cleanup has to close first and delete second:
// Windows refuses to delete a file SQLite still has open (EPERM), and node:test runs `after`
// hooks in the order they were registered, so closing in a hook of its own would run too late.
function track(t, db) {
  openByTest.get(t).push(db)
  return db
}

function tempDatabase(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const open = []
  openByTest.set(t, open)
  t.after(() => {
    for (const db of open) {
      try {
        db.close()
      } catch {
        // already closed by the test itself
      }
    }
    // Retries cover the -wal/-shm files that antivirus or the indexer can hold for a moment.
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  return path.join(directory, 'prime-swipe.db')
}

function migration(name) {
  return fs.readFileSync(new URL(`../src/db/migrations/${name}`, import.meta.url), 'utf8')
}

// Builds a database exactly as an earlier release left it, by running only those migrations.
function databaseAtVersion(t, databasePath, files) {
  const db = track(t, new Database(databasePath))
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);')
  files.forEach((file, index) => {
    db.exec(migration(file))
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(index + 1, '2026-01-01T00:00:00.000Z')
  })
  return db
}

test('fresh Prime Swipe database applies all migrations and can be reopened', t => {
  const databasePath = tempDatabase(t, 'prime-swipe-fresh-db-')

  const db = track(t, createDatabase(databasePath))
  assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all(), ALL_VERSIONS)
  const columns = db.prepare('PRAGMA table_info(scores)').all().map(column => column.name)
  for (const expected of ['largest_prime', 'verified', 'seed', 'engine_version', 'move_log']) {
    assert.ok(columns.includes(expected), `missing column ${expected}`)
  }
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'scores_verified_order_idx'").get())
  db.close()

  const reopened = track(t, createDatabase(databasePath))
  assert.deepEqual(reopened.prepare('SELECT version FROM schema_migrations ORDER BY version').all(), ALL_VERSIONS)
  reopened.close()
})

test('upgrade from version one keeps old runs, adds largestPrime, and marks them unverified', t => {
  const databasePath = tempDatabase(t, 'prime-swipe-upgrade-v1-')
  const old = databaseAtVersion(t, databasePath, ['001_initial.sql'])
  old.prepare(`
    INSERT INTO scores (display_name, score, moves, duration_seconds, submitted_at, idempotency_key, submission_rank)
    VALUES ('EARLY PLAYER', 500, 7, 45, '2026-01-01T00:00:00.000Z', 'old-prime-run', 1)
  `).run()
  old.close()

  const upgraded = track(t, createDatabase(databasePath))
  assert.deepEqual(
    upgraded.prepare('SELECT score, largest_prime AS largestPrime, verified, seed, move_log AS moveLog FROM scores').get(),
    { score: 500, largestPrime: 0, verified: 0, seed: null, moveLog: null }
  )
  assert.deepEqual(upgraded.prepare('SELECT version FROM schema_migrations ORDER BY version').all(), ALL_VERSIONS)
  upgraded.close()
})

test('upgrade from version two keeps every unverified run exactly as it was', t => {
  const databasePath = tempDatabase(t, 'prime-swipe-upgrade-v2-')
  const old = databaseAtVersion(t, databasePath, ['001_initial.sql', '002_add_largest_prime.sql'])
  const insert = old.prepare(`
    INSERT INTO scores (display_name, score, largest_prime, moves, duration_seconds, submitted_at, idempotency_key, submission_rank)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insert.run('FIRST', 2400, 101, 38, 94, '2026-02-01T00:00:00.000Z', 'prime-swipe-aaa', 1)
  insert.run('SECOND', 999999, 997, 3, 1, '2026-02-02T00:00:00.000Z', 'prime-swipe-bbb', 1)
  const before = old.prepare('SELECT * FROM scores ORDER BY id').all()
  old.close()

  const upgraded = track(t, createDatabase(databasePath))
  const after = upgraded.prepare('SELECT * FROM scores ORDER BY id').all()
  assert.equal(after.length, 2)
  for (const [index, row] of after.entries()) {
    const { verified, seed, engine_version: engineVersion, move_log: moveLog, ...original } = row
    assert.deepEqual(original, before[index], 'existing columns must be untouched')
    assert.deepEqual([verified, seed, engineVersion, moveLog], [0, null, null, null])
  }
  upgraded.close()
})

test('verified accepts only 0 or 1, and a run key can be used once', t => {
  const db = track(t, createDatabase(tempDatabase(t, 'prime-swipe-constraints-')))
  const insert = db.prepare(`
    INSERT INTO scores (display_name, score, moves, duration_seconds, submitted_at, idempotency_key, submission_rank, verified)
    VALUES ('A', 1, 1, 1, '2026-01-01T00:00:00.000Z', ?, 1, ?)
  `)
  assert.throws(() => insert.run('run:x', 2), /CHECK|constraint/i)
  insert.run('run:y', 1)
  assert.throws(() => insert.run('run:y', 1), /UNIQUE|constraint/i)
})
