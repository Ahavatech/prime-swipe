import crypto from 'node:crypto'

// A run token is how the server commits to a game without storing anything when it starts.
//
//   ps1.<payload>.<mac>
//
// payload is base64url JSON { r: run id, s: seed, t: issued-at in ms, e: engine version }.
// mac is HMAC-SHA256 over "ps1.<payload>" with the server secret. Nothing is stored at
// issue time, so a public endpoint that anyone can call grows no table. A token is made
// single-use later, when its run id is inserted under a UNIQUE key.
//
// The client can read its own seed (it needs it to play), but it cannot change the seed, the
// time or the engine version without invalidating the MAC.

const PREFIX = 'ps1'
const MAX_TOKEN_LENGTH = 512
const RUN_ID_PATTERN = /^[0-9a-f]{32}$/
const SEED_LIMIT = 2 ** 32

function base64url(buffer) {
  return buffer.toString('base64url')
}

function sign(secret, payloadSegment) {
  return crypto.createHmac('sha256', secret).update(`${PREFIX}.${payloadSegment}`).digest()
}

// `randomSeed` is injectable so tests can pin seeds; production always uses the CSPRNG.
export function createRunTokenCodec({
  secret,
  ttlSeconds,
  now = Date.now,
  randomSeed = () => crypto.randomInt(0, SEED_LIMIT)
}) {
  if (!Buffer.isBuffer(secret) || secret.length < 32) {
    throw new Error('A run token secret of at least 32 bytes is required.')
  }

  return {
    ttlSeconds,

    issue(engineVersion) {
      const claims = {
        runId: crypto.randomBytes(16).toString('hex'),
        seed: randomSeed(),
        issuedAtMs: now(),
        engineVersion
      }
      const payload = base64url(Buffer.from(JSON.stringify({
        r: claims.runId,
        s: claims.seed,
        t: claims.issuedAtMs,
        e: claims.engineVersion
      })))
      return {
        token: `${PREFIX}.${payload}.${base64url(sign(secret, payload))}`,
        claims
      }
    },

    // Returns { ok: true, claims } or { ok: false, reason }. The reason is for logs and tests;
    // callers give the client one generic message so a forger learns nothing from the failure.
    verify(token) {
      if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) {
        return { ok: false, reason: 'MALFORMED' }
      }
      const parts = token.split('.')
      if (parts.length !== 3 || parts[0] !== PREFIX) {
        return { ok: false, reason: 'MALFORMED' }
      }
      const [, payloadSegment, macSegment] = parts

      // Check the MAC before parsing anything: nothing attacker-controlled is interpreted
      // until it has been proven to be ours.
      const given = Buffer.from(macSegment, 'base64url')
      // Node's decoder skips junk characters and ignores unused trailing bits, so several
      // different strings decode to the same MAC. Require the one canonical spelling, so a
      // token has exactly one valid form.
      if (given.toString('base64url') !== macSegment) {
        return { ok: false, reason: 'MALFORMED' }
      }
      const expected = sign(secret, payloadSegment)
      if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
        return { ok: false, reason: 'BAD_SIGNATURE' }
      }

      let payload
      try {
        payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'))
      } catch {
        return { ok: false, reason: 'MALFORMED' }
      }
      if (
        !payload || typeof payload !== 'object' ||
        typeof payload.r !== 'string' || !RUN_ID_PATTERN.test(payload.r) ||
        !Number.isInteger(payload.s) || payload.s < 0 || payload.s >= SEED_LIMIT ||
        !Number.isSafeInteger(payload.t) || payload.t < 0 ||
        typeof payload.e !== 'string' || payload.e.length > 16
      ) {
        return { ok: false, reason: 'MALFORMED' }
      }
      return {
        ok: true,
        claims: { runId: payload.r, seed: payload.s, issuedAtMs: payload.t, engineVersion: payload.e }
      }
    },

    expiresAtMs(claims) {
      return claims.issuedAtMs + ttlSeconds * 1000
    }
  }
}
