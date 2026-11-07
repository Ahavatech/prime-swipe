import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'
import { createRunTokenCodec } from '../src/services/run-token.js'

const secret = Buffer.alloc(32, 9)
const NOW = 1_800_000_000_000
const codec = createRunTokenCodec({ secret, ttlSeconds: 3600, now: () => NOW })

function resign(payloadObject, withSecret = secret) {
  const payload = Buffer.from(JSON.stringify(payloadObject)).toString('base64url')
  const mac = crypto.createHmac('sha256', withSecret).update(`ps1.${payload}`).digest('base64url')
  return `ps1.${payload}.${mac}`
}

const goodPayload = { r: 'a'.repeat(32), s: 1234, t: NOW, e: '1' }

test('a token round-trips its claims', () => {
  const { token, claims } = codec.issue('1')
  assert.deepEqual(codec.verify(token), { ok: true, claims })
  assert.equal(claims.issuedAtMs, NOW)
  assert.equal(claims.engineVersion, '1')
  assert.match(claims.runId, /^[0-9a-f]{32}$/)
  assert.ok(Number.isInteger(claims.seed) && claims.seed >= 0 && claims.seed < 2 ** 32)
  assert.equal(codec.expiresAtMs(claims), NOW + 3600 * 1000)
})

test('every token is unique and seeds vary', () => {
  const issued = Array.from({ length: 200 }, () => codec.issue('1'))
  assert.equal(new Set(issued.map(item => item.claims.runId)).size, 200)
  assert.ok(new Set(issued.map(item => item.claims.seed)).size > 190)
})

test('changing any part of a token breaks it', () => {
  const { token } = codec.issue('1')
  const [prefix, payload, mac] = token.split('.')

  // Edit the seed inside the payload and keep the original MAC.
  const edited = JSON.parse(Buffer.from(payload, 'base64url').toString())
  edited.s = (edited.s + 1) % 2 ** 32
  const forgedPayload = Buffer.from(JSON.stringify(edited)).toString('base64url')
  assert.equal(codec.verify(`${prefix}.${forgedPayload}.${mac}`).ok, false)

  // Flip one character anywhere in the MAC and in the payload.
  for (let i = 0; i < mac.length; i += 7) {
    const flipped = mac.slice(0, i) + (mac[i] === 'A' ? 'B' : 'A') + mac.slice(i + 1)
    assert.equal(codec.verify(`${prefix}.${payload}.${flipped}`).ok, false, `mac char ${i}`)
  }
  for (let i = 0; i < payload.length; i += 11) {
    const flipped = payload.slice(0, i) + (payload[i] === 'A' ? 'B' : 'A') + payload.slice(i + 1)
    assert.equal(codec.verify(`${prefix}.${flipped}.${mac}`).ok, false, `payload char ${i}`)
  }
  assert.equal(codec.verify(`${prefix}.${payload}.`).ok, false)
  assert.equal(codec.verify(`${prefix}.${payload}.${mac}.extra`).ok, false)
})

test('a token has exactly one valid spelling', () => {
  // Node's base64url decoder is lenient: it skips junk and ignores unused trailing bits. Without
  // an explicit canonical check, all of these decode to the genuine MAC and would verify.
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  for (let i = 0; i < 50; i += 1) {
    const { token } = codec.issue('1')
    const [prefix, payload, mac] = token.split('.')
    for (const suffix of ['$', '=', '\n', ' ', '%']) {
      assert.equal(codec.verify(token + suffix).ok, false, `suffix ${JSON.stringify(suffix)}`)
    }
    // The last MAC character carries 4 bits of data and 2 unused bits; changing only the
    // unused bits decodes to identical bytes.
    const last = ALPHABET.indexOf(mac.at(-1))
    for (const unused of [1, 2, 3]) {
      const sibling = ALPHABET[last ^ unused]
      assert.equal(codec.verify(`${prefix}.${payload}.${mac.slice(0, -1)}${sibling}`).ok, false)
    }
  }
})

test('a token signed with a different secret is refused', () => {
  const other = createRunTokenCodec({ secret: Buffer.alloc(32, 1), ttlSeconds: 3600, now: () => NOW })
  assert.equal(codec.verify(other.issue('1').token).ok, false)
  assert.equal(codec.verify(resign(goodPayload, Buffer.alloc(32, 1))).ok, false)
})

test('a correctly signed token with nonsense claims is still refused', () => {
  assert.equal(codec.verify(resign(goodPayload)).ok, true)
  const bad = [
    { ...goodPayload, r: 'not-hex' },
    { ...goodPayload, r: 'a'.repeat(31) },
    { ...goodPayload, s: -1 },
    { ...goodPayload, s: 2 ** 32 },
    { ...goodPayload, s: 1.5 },
    { ...goodPayload, s: '12' },
    { ...goodPayload, t: -5 },
    { ...goodPayload, t: 1.5 },
    { ...goodPayload, e: 1 },
    { ...goodPayload, e: 'x'.repeat(17) },
    { r: goodPayload.r },
    null,
    []
  ]
  for (const payload of bad) {
    assert.equal(codec.verify(resign(payload)).ok, false, JSON.stringify(payload))
  }
})

test('garbage input never throws', () => {
  for (const input of [undefined, null, 42, {}, [], '', '.', '..', 'ps1', 'ps1..', 'ps2.a.b', `ps1.${'a'.repeat(600)}.b`, 'ps1.%%%.%%%']) {
    assert.deepEqual(codec.verify(input).ok, false, String(input))
  }
})

test('the prefix is part of what is signed', () => {
  const { token } = codec.issue('1')
  const [, payload, mac] = token.split('.')
  assert.equal(codec.verify(`ps2.${payload}.${mac}`).ok, false)
})

test('a short secret is refused at construction', () => {
  assert.throws(() => createRunTokenCodec({ secret: Buffer.alloc(8), ttlSeconds: 60 }))
  assert.throws(() => createRunTokenCodec({ secret: 'a string, not a buffer'.repeat(4), ttlSeconds: 60 }))
})
