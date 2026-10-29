/**
 * The committed Sepolia deployment's Aadhaar certificate carries the key the
 * deployed Aadhaar module trusts: its RSA modulus, split into the 121-bit
 * words Anon Aadhaar's circuit takes, packed two words to a field element and
 * hashed with Poseidon, is the module's one trusted public-key hash.
 */
import { X509Certificate } from 'crypto'

import { splitToWords } from '@anon-aadhaar/core'
import { poseidon } from 'maci-crypto/build/ts/hashing'

import { SEPOLIA_DEPLOYMENT } from '@web/modules/social-recovery/shared/client/deployments-sepolia'

const TRUSTED_KEY_HASH =
  19770349258225098911243612275321727303641256718510179842211794623059325011884n

const WORD_BITS = 121n
const WORD_COUNT = 17n
// Two to the power of the word width, the factor that packs the second word above the first.
const WORD_SCALE = BigInt(`0b1${'0'.repeat(Number(WORD_BITS))}`)

const modulusOf = (pem: string): bigint => {
  const { n } = new X509Certificate(pem).publicKey.export({ format: 'jwk' })
  return BigInt(`0x${Buffer.from(n ?? '', 'base64url').toString('hex')}`)
}

const publicKeyHashOf = (pem: string): bigint => {
  const words = splitToWords(modulusOf(pem), WORD_BITS, WORD_COUNT).map((word) => BigInt(word))
  const packed: bigint[] = []
  for (let at = 0; at < words.length; at += 2) {
    packed.push(at + 1 < words.length ? words[at] + words[at + 1] * WORD_SCALE : words[at])
  }
  return poseidon(packed)
}

describe('the committed Sepolia Aadhaar certificate', () => {
  it('hashes to the key the deployed Aadhaar module trusts', () => {
    expect(publicKeyHashOf(SEPOLIA_DEPLOYMENT.aadhaarCertificate ?? '')).toBe(TRUSTED_KEY_HASH)
  })
})
