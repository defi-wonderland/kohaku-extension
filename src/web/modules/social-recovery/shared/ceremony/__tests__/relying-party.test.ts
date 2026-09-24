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
import type { Hex } from '@web/modules/social-recovery/sdk-interfaces'

import {
  bytesToHex,
  EXTENSION_ID,
  EXTENSION_ORIGIN,
  fakeAssertion,
  fakeAttestation,
  fakeMethod,
  fakeOrchestrator,
  generatePoint,
  hosts,
  installCredentials,
  methodRunCount,
  ORIGIN_HASH,
  P256Point,
  relyingParty,
  stringsIn,
  SYNCED_FLAGS
} from './harness'

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
  ;(['testAccess', 'createClaim'] as const).forEach((host) =>
    it(`assert at ${host} under rpId = the extension origin host`, async () => {
      const method = fakeMethod()
      await hosts[host]({ method, orchestrator: fakeOrchestrator(method) })
      const options = creds.get.mock.calls[0][0] as CredentialRequestOptions
      expect(options.publicKey?.rpId).toBe(EXTENSION_ID)
    })
  )
})

describe('the origin string the method names', () => {
  // D-372: the wallet hands the SDK the full origin string as the relying
  // party id, so the method's options name `chrome-extension://<id>`. The
  // browser takes the host: the device replaces the id and keeps the rest.
  it('becomes the host in the creation options', async () => {
    const method = fakeMethod()
    await hosts.enroll({ method, orchestrator: fakeOrchestrator(method) })
    const asked = method.enrollInput.mock.results[0].value as { rp: { id: string } }
    expect(asked.rp.id).toBe(EXTENSION_ORIGIN)
    const options = creds.create.mock.calls[0][0] as CredentialCreationOptions
    expect(options.publicKey?.rp.id).toBe(EXTENSION_ID)
  })

  it('becomes the host in the request options', async () => {
    const method = fakeMethod()
    await hosts.createClaim({ method, orchestrator: fakeOrchestrator(method) })
    const asked = method.signingInput.mock.results[0].value as { rpId: string }
    expect(asked.rpId).toBe(EXTENSION_ORIGIN)
    const options = creds.get.mock.calls[0][0] as CredentialRequestOptions
    expect(options.publicKey?.rpId).toBe(EXTENSION_ID)
  })

  it('refuses a relying party other than the extension origin before any ceremony', async () => {
    const method = fakeMethod()
    const orchestrator = fakeOrchestrator(method)
    const outcome = await hosts.enroll({
      method,
      orchestrator,
      params: { relyingPartyId: 'https://example.com' }
    })
    expect(outcome).toMatchObject({ type: 'verdict', verdict: 'failed' })
    if (outcome.type === 'verdict') expect(outcome.cause).toContain('relying-party-mismatch')
    expect(creds.create).not.toHaveBeenCalled()
    expect(methodRunCount(method, orchestrator)).toBe(0)
  })
})

describe('a credential committed under the bare id', () => {
  // An authenticator that hashed the bare id (or a build under another id)
  // does not answer for this origin: the host reads it from the ceremony's own
  // authenticator data and never lets the method package it.
  it('is refused at enrollment before the method runs', async () => {
    creds.restore()
    creds = installCredentials({
      create: async () =>
        fakeAttestation({ flags: SYNCED_FLAGS, point, rpIdHash: bareIdHash as Hex }).credential
    })
    const method = fakeMethod()
    const orchestrator = fakeOrchestrator(method)
    const outcome = await hosts.enroll({ method, orchestrator })
    expect(outcome).toMatchObject({ type: 'verdict', verdict: 'failed' })
    if (outcome.type === 'verdict') expect(outcome.cause).toContain('relying-party-mismatch')
    expect(methodRunCount(method, orchestrator)).toBe(0)
  })

  it('is refused at a claim before the method runs', async () => {
    creds.restore()
    creds = installCredentials({
      get: async () =>
        fakeAssertion({ r: BigInt(5), s: BigInt(6), rpIdHash: bareIdHash as Hex }).credential
    })
    const method = fakeMethod()
    const orchestrator = fakeOrchestrator(method)
    const outcome = await hosts.createClaim({ method, orchestrator })
    expect(outcome).toMatchObject({ type: 'verdict', verdict: 'failed' })
    if (outcome.type === 'verdict') expect(outcome.cause).toContain('relying-party-mismatch')
    expect(methodRunCount(method, orchestrator)).toBe(0)
  })

  it('never reaches the method or the outcome of a passed enrollment', async () => {
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
