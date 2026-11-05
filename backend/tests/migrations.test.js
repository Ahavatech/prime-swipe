import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { createDatabase } from '../src/db/database.js'

test('fresh Prime Swipe database applies all migrations and can be reopened', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-swipe-fresh-db-'))
  const databasePath = path.join(directory, 'prime-swipe.db')
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  const db = createDatabase(databasePath)
  assert.deepEqual(
    db.prepare('SELECT version FROM schema_migrations ORDER BY version').all(),
    [{ version: 1 }, { version: 2 }]
  )
  assert.ok(db.prepare('PRAGMA table_info(scores)').all().some(column => column.name === 'largest_prime'))
  db.close()

  const reopened = createDatabase(databasePath)
  assert.deepEqual(
    reopened.prepare('SELECT version FROM schema_migrations ORDER BY version').all(),
    [{ version: 1 }, { version: 2 }]
  )
  reopened.close()
})

test('upgrade from a version-one database preserves runs and adds largestPrime', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-swipe-upgrade-db-'))
  const databasePath = path.join(directory, 'prime-swipe.db')
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))

  const db = new Database(databasePath)
  db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
  `)
  const initialSchema = fs.readFileSync(
    new URL('../src/db/migrations/001_initial.sql', import.meta.url),
    'utf8'
  )
  db.exec(initialSchema)
  db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)').run('2026-01-01T00:00:00.000Z')
  db.prepare(`
    INSERT INTO scores (
      display_name, score, moves, duration_seconds, submitted_at,
      idempotency_key, submission_rank
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('EARLY PLAYER', 500, 7, 45, '2026-01-01T00:00:00.000Z', 'old-prime-run', 1)
  db.close()

  const upgraded = createDatabase(databasePath)
  assert.deepEqual(
    upgraded.prepare('SELECT score, largest_prime AS largestPrime FROM scores').get(),
    { score: 500, largestPrime: 0 }
  )
  assert.deepEqual(
    upgraded.prepare('SELECT version FROM schema_migrations ORDER BY version').all(),
    [{ version: 1 }, { version: 2 }]
  )
  upgraded.close()
})
