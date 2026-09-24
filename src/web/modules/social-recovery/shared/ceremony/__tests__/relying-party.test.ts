/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "chrome-extension://cgjhdpkjghcgpplimocodhjgcceglpoj/tab.html#/social-recovery/ceremony"}
 */
/**
 * PT-041, ux.md D-314 and ux-interfaces.md D-372: the passkey's relying party is
 * the extension's own origin. The `rp.id` of the ceremony is the origin's host,
 * the extension id; the hash the config commits is `sha256` of the full origin
 * string `chrome-extension://<id>`, never of the bare id (delta after the proof
 * of concept, 2026-09-23); the wallet hands the SDK that origin string as the
 * relying party id. The lane reads the id at runtime and commits to none (brief,
 * open question 13), so the page here is served from the proof's extension id.
 */
import {
  EXTENSION_ID,
  EXTENSION_ORIGIN,
  fakeAssertion,
  fakeAttestation,
  fakeMethod,
  fakeOrchestrator,
  generatePoint,
  hosts,
  installCredentials,
  ORIGIN_HASH,
  P256Point,
  relyingParty,
  stringsIn,
  SYNCED_FLAGS,
  bytesToHex
} from './harness'

type ChromeGlobal = { chrome?: unknown }

let point: P256Point
let bareIdHash: string
let creds: ReturnType<typeof installCredentials>

beforeAll(async () => {
  point = await generatePoint()
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(EXTENSION_ID)
  )
  bareIdHash = bytesToHex(new Uint8Array(digest))
  // The extension's runtime, as Chrome serves it to this page.
  ;(globalThis as ChromeGlobal).chrome = {
    runtime: {
      id: EXTENSION_ID,
      getURL: (path: string) => `${EXTENSION_ORIGIN}/${path.replace(/^\//, '')}`
    }
  }
})

afterAll(() => {
  delete (globalThis as ChromeGlobal).chrome
})

beforeEach(() => {
  creds = installCredentials({
    create: async () => fakeAttestation({ flags: SYNCED_FLAGS, point }).credential,
    get: async () => fakeAssertion({ r: BigInt(5), s: BigInt(6) }).credential
  })
})

afterEach(() => creds.restore())

describe('the relying party the lane reads', () => {
  it('serves this page from the proof of concept origin', () => {
    expect(window.location.protocol).toBe('chrome-extension:')
    expect(window.location.host).toBe(EXTENSION_ID)
  })

  it('has the extension origin host as its id', () => {
    expect(relyingParty().id).toBe(EXTENSION_ID)
  })

  it('has the full origin string as its origin', () => {
    expect(relyingParty().origin).toBe(EXTENSION_ORIGIN)
  })

  it('commits sha256 of the full origin string', () => {
    expect(relyingParty().idHash.toLowerCase()).toBe(ORIGIN_HASH)
  })

  it('never commits sha256 of the bare id', () => {
    expect(bareIdHash).not.toBe(ORIGIN_HASH)
    expect(relyingParty().idHash.toLowerCase()).not.toBe(bareIdHash)
  })
})

describe('the ceremonies', () => {
  it('create a credential under rp.id = the extension origin host', async () => {
    const method = fakeMethod()
    await hosts.enroll({ method, orchestrator: fakeOrchestrator(method) })
    const options = creds.create.mock.calls[0][0] as CredentialCreationOptions
    expect(options.publicKey?.rp.id).toBe(EXTENSION_ID)
  })

  it.each(['testAccess', 'createClaim'] as const)(
    'assert at %s under rpId = the extension origin host',
    async (host) => {
      const method = fakeMethod()
      await hosts[host]({ method, orchestrator: fakeOrchestrator(method) })
      const options = creds.get.mock.calls[0][0] as CredentialRequestOptions
      expect(options.publicKey?.rpId).toBe(EXTENSION_ID)
    }
  )
})

describe('what the method is handed', () => {
  it('receives the full origin string as the relying party id at enrollment', async () => {
    const method = fakeMethod()
    const orchestrator = fakeOrchestrator(method)
    await hosts.enroll({ method, orchestrator })
    const params = [
      ...method.enrollInput.mock.calls.map((c) => c[0]),
      ...orchestrator.enrollInput.mock.calls.map((c) => c[1])
    ]
    expect(params.length).toBeGreaterThan(0)
    expect(stringsIn(params)).toContain(EXTENSION_ORIGIN)
  })

  it('receives the full origin string as the relying party id at a claim', async () => {
    const method = fakeMethod()
    const orchestrator = fakeOrchestrator(method)
    await hosts.createClaim({ method, orchestrator })
    const params = [
      ...method.signingInput.mock.calls.map((c) => c[1]),
      ...orchestrator.signingInput.mock.calls.map((c) => c[1])
    ]
    expect(params.length).toBeGreaterThan(0)
    expect(stringsIn(params)).toContain(EXTENSION_ORIGIN)
  })

  it('is never handed the hash of the bare id', async () => {
    const method = fakeMethod()
    const orchestrator = fakeOrchestrator(method)
    const outcome = await hosts.enroll({ method, orchestrator })
    const everything = [
      outcome.raw,
      ...method.enrollInput.mock.calls,
      ...method.configFrom.mock.calls,
      ...orchestrator.enrollInput.mock.calls,
      ...orchestrator.configFrom.mock.calls
    ]
    const strings = stringsIn(everything).map((s) => s.toLowerCase())
    expect(strings).not.toContain(bareIdHash)
    expect(strings).not.toContain(bareIdHash.slice(2))
  })
})
