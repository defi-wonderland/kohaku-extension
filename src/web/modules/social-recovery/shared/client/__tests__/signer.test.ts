/**
 * PT-038 done entry 2: the signer facade signs typed data or raw bytes for a
 * key the keystore holds, addressed by the keystore's own handle of address and
 * key type, and exposes no key export (ux-interfaces.md D-370). It signs by
 * dispatching the extension's sign-message flow; the background is a fake
 * behind the lane's `SignMessageFlowPort` (harness.ts).
 *
 * Known limit, not a defect: the existing flow signs only for a key that is
 * itself a basic account the wallet lists. For any other key the facade
 * refuses with `SignerNotWired`, naming the missing background action
 * `KEYSTORE_CONTROLLER_SIGN_WITH_KEY` (brief "Open questions", ux owner).
 */
import { addressOf } from '@web/modules/social-recovery/sdk-doubles'
import type { Address, Hex } from '@web/modules/social-recovery/sdk-interfaces'

import {
  basicAccount,
  dispatched,
  isSignerNotWired,
  isSignFlowFailure,
  KeyHandle,
  memberNamesOf,
  MISSING_BACKGROUND_ACTION,
  SEPOLIA,
  SIGNER_MEMBERS,
  SignerNotWired,
  SignFlowFailure,
  signFlowOver,
  smartAccount,
  thrownBy
} from './harness'

const KEY = '0x3333333333333333333333333333333333333333' as Address
const HANDLE: KeyHandle = { addr: KEY, type: 'internal' }
const SIGNATURE = `0x${'5a'.repeat(65)}` as Hex

const TYPED = {
  domain: { name: 'PolicyManager', version: '1', chainId: SEPOLIA },
  types: { Approval: [{ name: 'digest', type: 'bytes32' }] },
  primaryType: 'Approval',
  message: { digest: `0x${'11'.repeat(32)}` }
}
const BYTES = `0x${'22'.repeat(32)}` as Hex

const INIT = 'MAIN_CONTROLLER_SIGN_MESSAGE_INIT'
const HANDLE_SIGN = 'MAIN_CONTROLLER_HANDLE_SIGN_MESSAGE'
const RESET = 'MAIN_CONTROLLER_SIGN_MESSAGE_RESET'

const initOf = (flow: ReturnType<typeof signFlowOver>) =>
  dispatched(flow.dispatch).find((a) => a.type === INIT) as Extract<
    ReturnType<typeof dispatched>[number],
    { type: typeof INIT }
  >

const handleOf = (flow: ReturnType<typeof signFlowOver>) =>
  dispatched(flow.dispatch).find((a) => a.type === HANDLE_SIGN) as Extract<
    ReturnType<typeof dispatched>[number],
    { type: typeof HANDLE_SIGN }
  >

describe('the signer facade', () => {
  it('signs typed data by dispatching the sign flow with the address and key type given', async () => {
    const flow = signFlowOver([basicAccount(KEY)], { signature: SIGNATURE })
    const signature = await flow.signer.signTypedData(HANDLE, TYPED)
    expect(signature).toBe(SIGNATURE)

    expect(dispatched(flow.dispatch).map((a) => a.type)).toEqual([INIT, HANDLE_SIGN, RESET])
    const init = initOf(flow)
    expect(init.params.messageToSign.accountAddr).toBe(KEY)
    expect(init.params.messageToSign.chainId).toBe(BigInt(SEPOLIA))
    expect(init.params.messageToSign.content).toMatchObject({
      kind: 'typedMessage',
      domain: TYPED.domain,
      primaryType: TYPED.primaryType,
      message: TYPED.message
    })
    expect(handleOf(flow).params).toEqual({ keyAddr: KEY, keyType: 'internal' })
  })

  it('signs raw bytes by dispatching the sign flow with the address and key type given', async () => {
    const flow = signFlowOver([basicAccount(KEY)], { signature: SIGNATURE })
    const signature = await flow.signer.signBytes(HANDLE, BYTES)
    expect(signature).toBe(SIGNATURE)

    expect(dispatched(flow.dispatch).map((a) => a.type)).toEqual([INIT, HANDLE_SIGN, RESET])
    expect(initOf(flow).params.messageToSign.content).toEqual({ kind: 'message', message: BYTES })
    expect(handleOf(flow).params).toEqual({ keyAddr: KEY, keyType: 'internal' })
  })

  it('addresses each signature by its own handle, never a default key', async () => {
    const other = '0x4444444444444444444444444444444444444444' as Address
    const flow = signFlowOver([basicAccount(KEY), basicAccount(other)], { signature: SIGNATURE })
    await flow.signer.signBytes({ addr: other, type: 'trezor' }, BYTES)
    expect(handleOf(flow).params).toEqual({ keyAddr: other, keyType: 'trezor' })
    expect(initOf(flow).params.messageToSign.accountAddr).toBe(other)
  })

  it('returns the signature of its own request, not an empty answer, and rejects a refused flow', async () => {
    const flow = signFlowOver([basicAccount(KEY)], { refuse: true })
    const caught = await thrownBy(flow.signer.signBytes(HANDLE, BYTES))
    expect(isSignFlowFailure(caught)).toBe(true)
    expect((caught as SignFlowFailure).reason).toBe('refused')
  })

  it('rejects a flow that answers no hex signature', async () => {
    const flow = signFlowOver([basicAccount(KEY)], { signature: 'not a signature' })
    const caught = await thrownBy(flow.signer.signTypedData(HANDLE, TYPED))
    expect(isSignFlowFailure(caught)).toBe(true)
    expect((caught as SignFlowFailure).reason).toBe('malformed-signature')
  })

  it('exposes exactly its two signing members and none whose name contains export, private or seed', () => {
    const { signer } = signFlowOver()
    const names = memberNamesOf(signer)
    expect(names.sort()).toEqual([...SIGNER_MEMBERS].sort())
    expect(names.filter((n) => /export|private|seed/i.test(n))).toEqual([])
    expect(Object.isFrozen(signer)).toBe(true)
  })

  it('dispatches no keystore action that sends a key or a seed to the UI', async () => {
    const flow = signFlowOver([basicAccount(KEY)], { signature: SIGNATURE })
    await flow.signer.signTypedData(HANDLE, TYPED)
    await flow.signer.signBytes(HANDLE, BYTES)
    const types = dispatched(flow.dispatch).map((a) => a.type as string)
    expect(types.filter((t) => /KEYSTORE|PRIVATE_KEY|SEED|EXPORT/.test(t))).toEqual([])
  })
})

describe('the known limit: a key that is not itself a listed basic account', () => {
  const controllingKey = addressOf('controlling-key-at-index-plus-100000')
  const smart = smartAccount(addressOf('smart-account'), controllingKey)

  SIGNER_MEMBERS.forEach((member) =>
    it(`${member} throws SignerNotWired naming KEYSTORE_CONTROLLER_SIGN_WITH_KEY and dispatches nothing`, async () => {
      const flow = signFlowOver([smart], { signature: SIGNATURE })
      const key: KeyHandle = { addr: controllingKey, type: 'internal' }
      const caught = await thrownBy(
        member === 'signTypedData'
          ? flow.signer.signTypedData(key, TYPED)
          : flow.signer.signBytes(key, BYTES)
      )
      expect(isSignerNotWired(caught)).toBe(true)
      const refusal = caught as SignerNotWired
      expect(MISSING_BACKGROUND_ACTION).toBe('KEYSTORE_CONTROLLER_SIGN_WITH_KEY')
      expect(refusal.missingAction).toBe('KEYSTORE_CONTROLLER_SIGN_WITH_KEY')
      expect(refusal.message).toContain('KEYSTORE_CONTROLLER_SIGN_WITH_KEY')
      expect(refusal.member).toBe(member)
      expect(refusal.key).toEqual(key)
      expect(flow.dispatch).not.toHaveBeenCalled()
    })
  )

  it('refuses a key whose account the wallet does not list the same way', async () => {
    const flow = signFlowOver([], { signature: SIGNATURE })
    const caught = await thrownBy(flow.signer.signBytes(HANDLE, BYTES))
    expect(isSignerNotWired(caught)).toBe(true)
    expect(flow.dispatch).not.toHaveBeenCalled()
  })
})
