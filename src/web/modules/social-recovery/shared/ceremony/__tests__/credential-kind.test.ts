/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "chrome-extension://cgjhdpkjghcgpplimocodhjgcceglpoj/tab.html#/social-recovery/ceremony"}
 */
/**
 * PT-041 done entry: the extension reads the synced or device-bound kind from
 * the ceremony's own flags (ux-interfaces.md D-372, D-305: the method answers a
 * kind alone through `deviceBinding`). The brief: the kind is read from the
 * flags of a fabricated authenticator data, both ways.
 *
 * Byte 32 of the authenticator data holds the flags; BE (0x08) says the
 * credential is backup eligible, a multi-device (synced) credential, BS (0x10)
 * that it is backed up. A credential with neither is device bound.
 */
/* eslint-disable no-bitwise -- the flags are bits */
import {
  authenticatorData,
  DEVICE_BOUND_FLAGS,
  enrolledKind,
  fakeAttestation,
  fakeMethod,
  fakeOrchestrator,
  FLAGS,
  generatePoint,
  hosts,
  installCredentials,
  kindFromAuthData,
  P256Point,
  SYNCED_FLAGS
} from './harness'

let point: P256Point

beforeAll(async () => {
  point = await generatePoint()
})

describe('the kind read from authenticator data flags', () => {
  it('reads BE and BS set as synced', () => {
    expect(kindFromAuthData(authenticatorData({ flags: SYNCED_FLAGS }))).toBe('synced')
  })

  it('reads BE and BS clear as device bound', () => {
    expect(kindFromAuthData(authenticatorData({ flags: DEVICE_BOUND_FLAGS }))).toBe('device-bound')
  })

  it('reads the same flags the same way with attested credential data after them', () => {
    const rawId = new Uint8Array([9, 8, 7, 6])
    const synced = authenticatorData({ flags: SYNCED_FLAGS | FLAGS.AT, credentialId: rawId, point })
    const bound = authenticatorData({
      flags: DEVICE_BOUND_FLAGS | FLAGS.AT,
      credentialId: rawId,
      point
    })
    expect(kindFromAuthData(synced)).toBe('synced')
    expect(kindFromAuthData(bound)).toBe('device-bound')
  })

  it('reads the kind from BE and BS alone, whatever the other bits say', () => {
    // UP and UV clear, the rp id hash all zero: only BE and BS decide.
    const zeroHash = `0x${'00'.repeat(32)}` as const
    expect(
      kindFromAuthData(authenticatorData({ flags: FLAGS.BE | FLAGS.BS, rpIdHash: zeroHash }))
    ).toBe('synced')
    expect(kindFromAuthData(authenticatorData({ flags: 0, rpIdHash: zeroHash }))).toBe(
      'device-bound'
    )
    expect(kindFromAuthData(authenticatorData({ flags: FLAGS.UV, rpIdHash: zeroHash }))).toBe(
      'device-bound'
    )
  })
})

describe('the kind an enrollment reports', () => {
  let creds: ReturnType<typeof installCredentials>

  afterEach(() => creds.restore())

  // The attachment is set against the flags each time: a phone's synced
  // passkey arrives cross-platform (Google Password Manager over hybrid in the
  // proof of concept), and a platform authenticator can be device bound. The
  // kind follows the flags, never the attachment.
  it('reports synced from the flags of a cross-platform credential', async () => {
    creds = installCredentials({
      create: async () =>
        fakeAttestation({ flags: SYNCED_FLAGS, point, attachment: 'cross-platform' }).credential
    })
    const method = fakeMethod()
    const outcome = await hosts.enroll({ method, orchestrator: fakeOrchestrator(method) })
    expect(outcome).toMatchObject({ type: 'verdict', verdict: 'passed' })
    expect(enrolledKind(outcome)).toBe('synced')
  })

  it('reports device bound from the flags of a platform credential', async () => {
    creds = installCredentials({
      create: async () =>
        fakeAttestation({ flags: DEVICE_BOUND_FLAGS, point, attachment: 'platform' }).credential
    })
    const method = fakeMethod()
    const outcome = await hosts.enroll({ method, orchestrator: fakeOrchestrator(method) })
    expect(outcome).toMatchObject({ type: 'verdict', verdict: 'passed' })
    expect(enrolledKind(outcome)).toBe('device-bound')
  })
})
