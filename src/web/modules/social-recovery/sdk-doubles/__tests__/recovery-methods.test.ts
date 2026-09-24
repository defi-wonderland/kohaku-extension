/**
 * The four method doubles (IRecoveryMethod, sdk.md D-206): one scripted double
 * per shipped kind, wallet, passkey, zkPassport and Aadhaar, ten members each.
 */
import {
  DEVICE_BINDINGS,
  DEVICE_KINDS,
  type Address
} from '@web/modules/social-recovery/sdk-interfaces'

import { METHOD_KINDS, MethodKind, createWorld, eachDescribe, isHex, membersOf } from './harness'

const MEMBERS = [
  'modules',
  'enrollInput',
  'configFrom',
  'signingInput',
  'replyFrom',
  'verify',
  'codec',
  'deviceBinding',
  'describe',
  'vector'
]

eachDescribe(METHOD_KINDS)('the %s method double', (kind) => {
  it('exposes the ten members of IRecoveryMethod', () => {
    const method = createWorld().methods[kind]
    const members = membersOf(method)
    MEMBERS.forEach((name) => expect(members).toContain(name))
    expect(DEVICE_BINDINGS).toContain(method.deviceBinding)
    expect(Array.isArray(method.vector)).toBe(true)
    ;['encodeConfig', 'decodeConfig', 'encodeProof', 'decodeProof'].forEach((name) =>
      expect(typeof (method.codec as unknown as Record<string, unknown>)[name]).toBe('function')
    )
  })

  it('serves the module the descriptor names for its kind', () => {
    const world = createWorld()
    const expected: Record<MethodKind, Address> = {
      wallet: world.descriptor.methodEcdsa,
      passkey: world.descriptor.methodPasskey,
      zkPassport: world.descriptor.methodZkpassport,
      aadhaar: world.descriptor.methodAadhaar
    }
    const modules = world.methods[kind].modules(world.descriptor)
    expect(modules.map((m) => m.toLowerCase())).toContain(expected[kind].toLowerCase())
  })

  it('states a device kind from a context alone', async () => {
    const world = createWorld()
    const ctx = {
      request: {} as never,
      place: 0,
      digest: `0x${'33'.repeat(32)}` as const,
      typedData: {}
    }
    const facts = world.methods[kind].describe(ctx)
    expect(DEVICE_KINDS).toContain(facts.kind)
    const proof = await world.methods[kind].replyFrom(ctx, {}, `0x${'ab'.repeat(65)}`)
    expect(isHex(proof) || (proof as { kind: string }).kind === 'reply-failure').toBe(true)
  })
})

it('binds the wallet and the passkey to different devices', () => {
  const { methods } = createWorld()
  expect(methods.wallet.deviceBinding).not.toBe(methods.passkey.deviceBinding)
})
