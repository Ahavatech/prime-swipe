const WITNESSES = Object.freeze([2n, 325n, 9375n, 28178n, 450775n, 9780504n, 1795265022n])

function modPow(base, exponent, modulus) {
  let result = 1n
  let factor = base % modulus
  let power = exponent
  while (power > 0n) {
    if (power % 2n === 1n) {
      result = (result * factor) % modulus
    }
    factor = (factor * factor) % modulus
    power /= 2n
  }
  return result
}

export function isPrime(value) {
  if (!Number.isSafeInteger(value) || value < 2) {
    return false
  }
  const number = BigInt(value)
  for (const prime of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
    if (number === prime) {
      return true
    }
    if (number % prime === 0n) {
      return false
    }
  }

  let oddPart = number - 1n
  let powerOfTwo = 0
  while (oddPart % 2n === 0n) {
    oddPart /= 2n
    powerOfTwo += 1
  }
  for (const witness of WITNESSES) {
    const base = witness % number
    if (base === 0n) {
      continue
    }
    let candidate = modPow(base, oddPart, number)
    if (candidate === 1n || candidate === number - 1n) {
      continue
    }
    let passed = false
    for (let round = 1; round < powerOfTwo; round += 1) {
      candidate = (candidate * candidate) % number
      if (candidate === number - 1n) {
        passed = true
        break
      }
    }
    if (!passed) {
      return false
    }
  }
  return true
}
