/**
 * PT-038 done entry 2: the signer facade signs typed data or raw bytes for a
 * key the keystore holds, addressed by the keystore's own handle of address and
 * key type, and exposes no key export (ux-interfaces.md D-370). It signs by
 * dispatching the extension's sign-message flow; the dispatch is mocked.
 */
import type { Address, Hex } from '@web/modules/social-recovery/sdk-interfaces'

import { dispatched, memberNamesOf, signerOver } from './harness'

const KEY = '0x3333333333333333333333333333333333333333' as Address
const KEY_TYPE = 'internal'
const SIGNATURE = `0x${'5a'.repeat(65)}` as Hex

const TYPED = {
  domain: { name: 'PolicyManager', version: '1', chainId: 11155111 },
  types: { Approval: [{ name: 'digest', type: 'bytes32' }] },
  primaryType: 'Approval',
  message: { digest: `0x${'11'.repeat(32)}` }
}
const BYTES = `0x${'22'.repeat(32)}` as Hex

/** Every value found anywhere in the dispatched actions. */
const flat = (value: unknown): unknown[] =>
  value && typeof value === 'object'
    ? Object.values(value as Record<string, unknown>).flatMap((v) => [v, ...flat(v)])
    : []

const handleOf = (actions: { params?: any }[]) =>
  actions.find((a) => a.params && 'keyAddr' in a.params && 'keyType' in a.params)?.params

describe('the signer facade', () => {
  it('signs typed data by dispatching the sign flow with the address and key type given', async () => {
    const s = signerOver()
    s.answer(SIGNATURE)
    const signature = await s.signer.signTypedData({ address: KEY, type: KEY_TYPE }, TYPED as never)
    expect(signature).toBe(SIGNATURE)
    const actions = dispatched(s.dispatch)
    expect(actions.length).toBeGreaterThan(0)
    expect(handleOf(actions)).toMatchObject({ keyAddr: KEY, keyType: KEY_TYPE })
    const values = actions.flatMap(flat)
    expect(values).toContain('typedMessage')
    expect(values).toContainEqual(TYPED.message)
  })

  it('signs raw bytes by dispatching the sign flow with the address and key type given', async () => {
    const s = signerOver()
    s.answer(SIGNATURE)
    const signature = await s.signer.signBytes({ address: KEY, type: KEY_TYPE }, BYTES)
    expect(signature).toBe(SIGNATURE)
    const actions = dispatched(s.dispatch)
    expect(handleOf(actions)).toMatchObject({ keyAddr: KEY, keyType: KEY_TYPE })
    const values = actions.flatMap(flat)
    expect(values).toContain('message')
    expect(values).toContain(BYTES)
  })

  it('addresses each signature by its own handle, never a default key', async () => {
    const s = signerOver()
    s.answer(SIGNATURE)
    const other = '0x4444444444444444444444444444444444444444' as Address
    await s.signer.signBytes({ address: other, type: 'trezor' }, BYTES)
    expect(handleOf(dispatched(s.dispatch))).toMatchObject({ keyAddr: other, keyType: 'trezor' })
  })

  it('exposes no member whose name contains export, private or seed', () => {
    const s = signerOver()
    const names = memberNamesOf(s.signer)
    expect(names.length).toBeGreaterThan(0)
    expect(names.filter((n) => /export|private|seed/i.test(n))).toEqual([])
  })

  it('dispatches no keystore action that sends a key or a seed to the UI', async () => {
    const s = signerOver()
    s.answer(SIGNATURE)
    await s.signer.signTypedData({ address: KEY, type: KEY_TYPE }, TYPED as never)
    await s.signer.signBytes({ address: KEY, type: KEY_TYPE }, BYTES)
    const types = dispatched(s.dispatch).map((a) => a.type)
    expect(types.filter((t) => /PRIVATE_KEY|SEED|EXPORT/.test(t))).toEqual([])
  })
})
