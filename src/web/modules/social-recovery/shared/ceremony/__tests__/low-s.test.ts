/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "chrome-extension://cgjhdpkjghcgpplimocodhjgcceglpoj/tab.html#/social-recovery/ceremony"}
 */
/**
 * PT-041 delta (passkey proof of concept, 2026-09-23): a Google Password
 * Manager assertion returned a high `s`, so the signature is normalized before
 * a verifier that rejects high `s`, and this lane does it before the method
 * receives it (brief, open question 12). With the P-256 order n, `s > n/2`
 * becomes `n - s`, and `s <= n/2` stays as it is.
 */
import {
  asBytes,
  derSignature,
  fakeAssertion,
  fakeMethod,
  fakeOrchestrator,
  hosts,
  installCredentials,
  normalizeSignature,
  P256_HALF_N,
  P256_N,
  parseSignature,
  signaturesIn
} from './harness'

const R = BigInt('0x1c2e8b4f5a6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677')
// A high s with its top bit set, as a real one has, so its DER needs a 0x00 pad.
const HIGH_S = BigInt('0xf1e2d3c4b5a697887766554433221100ffeeddccbbaa99887766554433221100')

const normalized = (r: bigint, s: bigint) => {
  const out = normalizeSignature(derSignature(r, s))
  const parsed = parseSignature(out)
  if (!parsed) throw new Error(`the normalization returned no signature: ${String(out)}`)
  return { out, parsed }
}

describe('the high-s normalization', () => {
  it('uses the P-256 order the brief names', () => {
    expect(HIGH_S > P256_HALF_N && HIGH_S < P256_N).toBe(true)
  })

  it('rewrites s > n/2 as n - s and keeps r', () => {
    const { parsed } = normalized(R, HIGH_S)
    expect(parsed.r).toBe(R)
    expect(parsed.s).toBe(P256_N - HIGH_S)
    expect(parsed.s <= P256_HALF_N).toBe(true)
  })

  it('rewrites the largest s, n - 1, as 1', () => {
    expect(normalized(R, P256_N - BigInt(1)).parsed.s).toBe(BigInt(1))
  })

  it('rewrites the smallest high s, (n + 1) / 2, as (n - 1) / 2', () => {
    expect(normalized(R, P256_HALF_N + BigInt(1)).parsed.s).toBe(P256_HALF_N)
  })

  const LOW: [string, bigint][] = [
    ['the largest low s, (n - 1) / 2', P256_HALF_N],
    ['a low s with its top byte clear', P256_N - HIGH_S],
    ['s = 1', BigInt(1)]
  ]
  LOW.forEach(([title, s]) =>
    it(`leaves ${title} unchanged`, () => {
      const input = derSignature(R, s)
      const { out, parsed } = normalized(R, s)
      expect(parsed).toMatchObject({ r: R, s })
      // Unchanged means unchanged: a DER answer is the same bytes.
      if (parsed.form === 'der') expect(Array.from(asBytes(out) ?? [])).toEqual(Array.from(input))
    })
  )
})
;(['createClaim', 'testAccess'] as const).forEach((host) =>
  describe(`the ${host} host normalizes before the method receives the assertion`, () => {
    let creds: ReturnType<typeof installCredentials>

    afterEach(() => creds.restore())

    const handedOn = async (s: bigint) => {
      creds = installCredentials({ get: async () => fakeAssertion({ r: R, s }).credential })
      const method = fakeMethod()
      const orchestrator = fakeOrchestrator(method)
      await hosts[host]({ method, orchestrator })
      const packaged = [
        ...method.replyFrom.mock.calls.map((c) => c[2]),
        ...orchestrator.replyFrom.mock.calls.map((c) => c[2])
      ]
      expect(packaged.length).toBeGreaterThan(0)
      return packaged.flatMap((material) => signaturesIn(material)).filter((sig) => sig.r === R)
    }

    it('hands on n - s for a high s, and never the high s', async () => {
      const signatures = await handedOn(HIGH_S)
      expect(signatures.length).toBeGreaterThan(0)
      signatures.forEach((sig) => expect(sig.s).toBe(P256_N - HIGH_S))
    })

    it('hands on a low s as it came', async () => {
      const low = P256_N - HIGH_S
      const signatures = await handedOn(low)
      expect(signatures.length).toBeGreaterThan(0)
      signatures.forEach((sig) => expect(sig.s).toBe(low))
    })
  })
)
