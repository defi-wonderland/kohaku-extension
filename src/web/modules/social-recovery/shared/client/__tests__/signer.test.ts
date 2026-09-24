/**
 * PT-038 done entry 2: the signer facade signs typed data or raw bytes for a
 * key the keystore holds, addressed by the keystore's own handle of address and
 * key type, and exposes no key export (ux-interfaces.md D-370). It signs by
 * adding its own request to the request queue, which lands in the action
 * window (ux.md D-316); the queue is a fake behind the lane's
 * `SignRequestPort` (harness.ts), driven by hand.
 *
 * Known limit, not a defect: the queue signs only for a key that is itself a
 * basic account the wallet lists. For any other key the facade refuses with
 * `SignerNotWired`, naming the missing background action
 * `KEYSTORE_CONTROLLER_SIGN_WITH_KEY` (brief "Dependencies and base").
 */
import { addressOf } from '@web/modules/social-recovery/sdk-doubles'
import type { Address, Hex } from '@web/modules/social-recovery/sdk-interfaces'

import {
  ABSENCE_GRACE_MS,
  addedRequest,
  advance,
  basicAccount,
  DEFAULT_SIGN_TIMEOUT_MS,
  dispatched,
  flush,
  isSignerNotWired,
  isSignFlowFailure,
  KeyHandle,
  memberNamesOf,
  MISSING_BACKGROUND_ACTION,
  queued,
  queueOver,
  SEPOLIA,
  SIGNER_MEMBERS,
  SignerNotWired,
  SignFlowFailure,
  signedFor,
  smartAccount,
  thrownBy,
  track,
  WINDOW_ID
} from './harness'

const KEY = '0x3333333333333333333333333333333333333333' as Address
const HANDLE: KeyHandle = { addr: KEY, type: 'internal' }
const SIGNATURE = `0x${'5a'.repeat(65)}` as Hex
const FOREIGN = `0x${'f0'.repeat(65)}` as Hex

const TYPED = {
  domain: { name: 'PolicyManager', version: '1', chainId: SEPOLIA },
  types: { Approval: [{ name: 'digest', type: 'bytes32' }] },
  primaryType: 'Approval',
  message: { digest: `0x${'11'.repeat(32)}` }
}
const BYTES = `0x${'22'.repeat(32)}` as Hex

const ADD = 'REQUESTS_CONTROLLER_ADD_USER_REQUEST'
const REMOVE = 'REQUESTS_CONTROLLER_REMOVE_USER_REQUEST'

// Every test runs on fake timers, so a request a test leaves pending never keeps
// the facade's ten-minute wait alive after the test.
beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
})

describe('the signer facade over the request queue', () => {
  it('signs typed data by adding its own sign request for the key given', async () => {
    const q = queueOver([basicAccount(KEY)])
    const signing = q.signer.signTypedData(HANDLE, TYPED)
    const { userRequest, allowAccountSwitch } = addedRequest(q.dispatch)
    expect(allowAccountSwitch).toBe(true)
    expect(userRequest.meta).toMatchObject({
      isSignAction: true,
      accountAddr: KEY,
      chainId: BigInt(SEPOLIA)
    })
    expect(userRequest.action).toMatchObject({
      kind: 'typedMessage',
      domain: TYPED.domain,
      primaryType: TYPED.primaryType,
      message: TYPED.message
    })
    expect(userRequest.session.windowId).toBe(WINDOW_ID)

    q.push(queued(userRequest.id))
    q.push(signedFor(userRequest.id, SIGNATURE))
    await expect(signing).resolves.toBe(SIGNATURE)
    expect(dispatched(q.dispatch).map((a) => a.type)).toEqual([ADD])
  })

  it('signs raw bytes by adding its own sign request for the key given', async () => {
    const q = queueOver([basicAccount(KEY)])
    const signing = q.signer.signBytes(HANDLE, BYTES)
    const { userRequest } = addedRequest(q.dispatch)
    expect(userRequest.meta.accountAddr).toBe(KEY)
    expect(userRequest.action).toEqual({ kind: 'message', message: BYTES })
    q.push(signedFor(userRequest.id, SIGNATURE))
    await expect(signing).resolves.toBe(SIGNATURE)
  })

  it('addresses each request by the address of its own handle, never a default key', async () => {
    const other = '0x4444444444444444444444444444444444444444' as Address
    const q = queueOver([basicAccount(KEY), basicAccount(other)])
    const signing = q.signer.signBytes({ addr: other, type: 'internal' }, BYTES)
    const { userRequest } = addedRequest(q.dispatch)
    expect(userRequest.meta.accountAddr).toBe(other)
    q.push(signedFor(userRequest.id, SIGNATURE))
    await signing
  })

  it("carries the key type of the handle in the added request's meta, beside the address and chain (D-370)", () => {
    const q = queueOver([basicAccount(KEY)])
    q.signer.signBytes({ addr: KEY, type: 'trezor' }, BYTES).catch(() => undefined)
    q.signer.signTypedData({ addr: KEY, type: 'internal' }, TYPED).catch(() => undefined)
    const requests = dispatched(q.dispatch).flatMap((a) =>
      a.type === ADD ? [a.params.userRequest] : []
    )
    expect(requests).toHaveLength(2)
    const [bytesRequest, typedRequest] = requests
    expect(bytesRequest.meta).toEqual({
      isSignAction: true,
      accountAddr: KEY,
      keyType: 'trezor',
      chainId: BigInt(SEPOLIA)
    })
    expect(typedRequest.meta).toEqual({
      isSignAction: true,
      accountAddr: KEY,
      keyType: 'internal',
      chainId: BigInt(SEPOLIA)
    })
  })

  it('gives each request an id of its own', () => {
    const q = queueOver([basicAccount(KEY)])
    q.signer.signBytes(HANDLE, BYTES).catch(() => undefined)
    q.signer.signBytes(HANDLE, BYTES).catch(() => undefined)
    const ids = dispatched(q.dispatch)
      .filter((a) => a.type === ADD)
      .map((a) => (a.type === ADD ? String(a.params.userRequest.id) : ''))
    expect(new Set(ids).size).toBe(2)
  })

  describe('a foreign message between the request and its result', () => {
    it('never yields a foreign signature to the facade', async () => {
      const q = queueOver([basicAccount(KEY)])
      const signing = track(q.signer.signTypedData(HANDLE, TYPED))
      const { userRequest } = addedRequest(q.dispatch)
      q.push(queued('dapp-request', userRequest.id))
      // A dApp request is signed in between, under its own id.
      q.push(signedFor('dapp-request', FOREIGN))
      q.push(signedFor(Number(userRequest.id) + 1, FOREIGN))
      await flush()
      expect(signing.status).toBe('pending')
      q.push(signedFor(userRequest.id, SIGNATURE))
      await flush()
      expect(signing).toEqual({ status: 'resolved', value: SIGNATURE })
    })

    it('refuses rather than take a foreign signature when its own request leaves the queue unsigned', async () => {
      const q = queueOver([basicAccount(KEY)])
      const signing = track(q.signer.signBytes(HANDLE, BYTES))
      const { userRequest } = addedRequest(q.dispatch)
      q.push(queued('dapp-request', userRequest.id))
      q.push(signedFor('dapp-request', FOREIGN))
      q.push(queued())
      await advance(ABSENCE_GRACE_MS)
      expect(signing.status).toBe('rejected')
      expect(isSignFlowFailure(signing.value)).toBe(true)
      expect((signing.value as SignFlowFailure).reason).toBe('refused')
    })

    it('ignores every update once it has its answer, and unsubscribes', async () => {
      const q = queueOver([basicAccount(KEY)])
      const signing = q.signer.signBytes(HANDLE, BYTES)
      const { userRequest } = addedRequest(q.dispatch)
      expect(q.listeners()).toBe(1)
      q.push(signedFor(userRequest.id, SIGNATURE))
      await expect(signing).resolves.toBe(SIGNATURE)
      expect(q.listeners()).toBe(0)
      q.push(signedFor(userRequest.id, FOREIGN))
      await expect(signing).resolves.toBe(SIGNATURE)
    })
  })

  describe('the queue guard', () => {
    it('does not refuse a request a queue state never held, before it was queued', async () => {
      const q = queueOver([basicAccount(KEY)])
      const signing = track(q.signer.signBytes(HANDLE, BYTES))
      const { userRequest } = addedRequest(q.dispatch)
      q.push(queued('dapp-request'))
      await advance(ABSENCE_GRACE_MS * 2)
      expect(signing.status).toBe('pending')
      q.push(signedFor(userRequest.id, SIGNATURE))
      await flush()
      expect(signing).toEqual({ status: 'resolved', value: SIGNATURE })
    })

    it('does not refuse a request that leaves the queue for less than the grace, as an account switch moves it', async () => {
      const q = queueOver([basicAccount(KEY)])
      const signing = track(q.signer.signBytes(HANDLE, BYTES))
      const { userRequest } = addedRequest(q.dispatch)
      q.push(queued(userRequest.id))
      q.push(queued())
      await advance(ABSENCE_GRACE_MS - 1)
      q.push({
        controller: 'requests',
        state: { userRequests: [], userRequestsWaitingAccountSwitch: [{ id: userRequest.id }] }
      })
      await advance(ABSENCE_GRACE_MS * 2)
      expect(signing.status).toBe('pending')
      q.push(signedFor(userRequest.id, SIGNATURE))
      await flush()
      expect(signing).toEqual({ status: 'resolved', value: SIGNATURE })
    })

    it('refuses a request the holder rejected, once it stays out of the queue, and withdraws nothing', async () => {
      const q = queueOver([basicAccount(KEY)])
      const signing = track(q.signer.signTypedData(HANDLE, TYPED))
      const { userRequest } = addedRequest(q.dispatch)
      q.push(queued(userRequest.id))
      q.push(queued())
      await advance(ABSENCE_GRACE_MS - 1)
      expect(signing.status).toBe('pending')
      await advance(1)
      expect(signing.status).toBe('rejected')
      expect((signing.value as SignFlowFailure).reason).toBe('refused')
      expect(dispatched(q.dispatch).map((a) => a.type)).toEqual([ADD])
    })
  })

  describe('the timeout', () => {
    it('withdraws its request and rejects once the default wait passes with no answer', async () => {
      const q = queueOver([basicAccount(KEY)])
      const signing = track(q.signer.signBytes(HANDLE, BYTES))
      const { userRequest } = addedRequest(q.dispatch)
      q.push(queued(userRequest.id))
      await advance(DEFAULT_SIGN_TIMEOUT_MS - 1)
      expect(signing.status).toBe('pending')
      await advance(1)
      expect(signing.status).toBe('rejected')
      expect(isSignFlowFailure(signing.value)).toBe(true)
      expect((signing.value as SignFlowFailure).reason).toBe('timeout')
      expect(dispatched(q.dispatch)).toEqual([
        expect.objectContaining({ type: ADD }),
        { type: REMOVE, params: { id: userRequest.id } }
      ])
      expect(q.listeners()).toBe(0)
    })

    it('takes a shorter wait from its options', async () => {
      const q = queueOver([basicAccount(KEY)], { timeoutMs: 1000 })
      const signing = track(q.signer.signTypedData(HANDLE, TYPED))
      await advance(1000)
      expect((signing.value as SignFlowFailure).reason).toBe('timeout')
    })

    it('does not time out after its answer came', async () => {
      const q = queueOver([basicAccount(KEY)])
      const signing = track(q.signer.signBytes(HANDLE, BYTES))
      const { userRequest } = addedRequest(q.dispatch)
      q.push(signedFor(userRequest.id, SIGNATURE))
      await advance(DEFAULT_SIGN_TIMEOUT_MS * 2)
      expect(signing).toEqual({ status: 'resolved', value: SIGNATURE })
      expect(dispatched(q.dispatch).map((a) => a.type)).toEqual([ADD])
    })
  })

  it('rejects an answer that is not a hex signature', async () => {
    const q = queueOver([basicAccount(KEY)])
    const signing = q.signer.signTypedData(HANDLE, TYPED)
    const { userRequest } = addedRequest(q.dispatch)
    q.push(signedFor(userRequest.id, 'not a signature'))
    const caught = await thrownBy(signing)
    expect(isSignFlowFailure(caught)).toBe(true)
    expect((caught as SignFlowFailure).reason).toBe('malformed-signature')
  })

  it('refuses bytes that are not hex and adds no request', async () => {
    const q = queueOver([basicAccount(KEY)])
    await expect(q.signer.signBytes(HANDLE, 'plain text' as Hex)).rejects.toBeDefined()
    expect(q.dispatch).not.toHaveBeenCalled()
  })

  it('exposes exactly its two signing members and none whose name contains export, private or seed', () => {
    const { signer } = queueOver()
    const names = memberNamesOf(signer)
    expect(names.sort()).toEqual([...SIGNER_MEMBERS].sort())
    expect(names.filter((n) => /export|private|seed/i.test(n))).toEqual([])
    expect(Object.isFrozen(signer)).toBe(true)
  })

  it('dispatches only the queue actions, and none that sends a key or a seed to the UI', async () => {
    const q = queueOver([basicAccount(KEY)])
    const first = q.signer.signTypedData(HANDLE, TYPED)
    q.push(signedFor(addedRequest(q.dispatch).userRequest.id, SIGNATURE))
    await first
    const types = dispatched(q.dispatch).map((a) => a.type as string)
    types.forEach((t) => expect([ADD, REMOVE]).toContain(t))
    expect(types.filter((t) => /KEYSTORE|PRIVATE_KEY|SEED|EXPORT/.test(t))).toEqual([])
  })
})

describe('the known limit: a key that is not itself a listed basic account', () => {
  const controllingKey = addressOf('controlling-key-at-index-plus-100000')
  const smart = smartAccount(addressOf('smart-account'), controllingKey)

  SIGNER_MEMBERS.forEach((member) =>
    it(`${member} throws SignerNotWired naming KEYSTORE_CONTROLLER_SIGN_WITH_KEY and dispatches nothing`, async () => {
      const q = queueOver([smart])
      const key: KeyHandle = { addr: controllingKey, type: 'internal' }
      const caught = await thrownBy(
        member === 'signTypedData'
          ? q.signer.signTypedData(key, TYPED)
          : q.signer.signBytes(key, BYTES)
      )
      expect(isSignerNotWired(caught)).toBe(true)
      const refusal = caught as SignerNotWired
      expect(MISSING_BACKGROUND_ACTION).toBe('KEYSTORE_CONTROLLER_SIGN_WITH_KEY')
      expect(refusal.missingAction).toBe('KEYSTORE_CONTROLLER_SIGN_WITH_KEY')
      expect(refusal.message).toContain('KEYSTORE_CONTROLLER_SIGN_WITH_KEY')
      expect(refusal.member).toBe(member)
      expect(refusal.key).toEqual(key)
      expect(q.dispatch).not.toHaveBeenCalled()
      expect(q.listeners()).toBe(0)
    })
  )

  it('refuses a key whose account the wallet does not list the same way', async () => {
    const q = queueOver([])
    const caught = await thrownBy(q.signer.signBytes(HANDLE, BYTES))
    expect(isSignerNotWired(caught)).toBe(true)
    expect(q.dispatch).not.toHaveBeenCalled()
  })
})
