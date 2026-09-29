/**
 * The send port sends one transaction from a key the keystore holds. It signs
 * and broadcasts nothing itself: it adds a transaction request to the request
 * queue, which lands in the action window, and answers the transaction hash of
 * its own call once the activity lists the operation the wallet broadcast.
 * The queue and the activity are the fakes of harness.ts, driven by hand.
 *
 * Where the wallet sends nothing, the port rejects with a `SendRefusal` naming
 * why: the request left the queue unsent, the action window closed on it, the
 * wallet's operation was rejected with no hash, no answer came in time, or the
 * key is not one the queue can send from.
 */
import { Wallet } from 'ethers'

import { AccountOpStatus } from '@ambire-common/libs/accountOp/types'
import eventBus from '@web/extension-services/event/eventBus'
import { addressOf } from '@web/modules/social-recovery/sdk-doubles'
import type { Address, Hex } from '@web/modules/social-recovery/sdk-interfaces'

import {
  ABSENCE_GRACE_MS,
  accountFor,
  activityListing,
  addedRequest,
  advance,
  basicAccount,
  createSendPort,
  DEFAULT_SEND_TIMEOUT_MS,
  dispatched,
  flush,
  KeyHandle,
  operationFor,
  queuedWith,
  queueOver,
  SendRefusal,
  SendRequestAction,
  sendQueueOver,
  sendRequestPort,
  SendWorld,
  SEPOLIA,
  smartAccount,
  thrownBy,
  track,
  WINDOW_ID
} from './harness'

const WALLET = new Wallet(`0x${'11'.repeat(32)}`)
/** The sending key, a basic account the wallet lists. */
const KEY = WALLET.address as Address
const HANDLE: KeyHandle = { addr: KEY, type: 'internal' }
const OTHER_KEY = new Wallet(`0x${'22'.repeat(32)}`).address as Address

const MANAGER = addressOf('manager')
const TRANSACTION = { from: KEY, to: MANAGER, data: '0x1a2b3c4d' as Hex }

const HASH: Hex = `0x${'ab'.repeat(32)}`
const OTHER_HASH: Hex = `0x${'cd'.repeat(32)}`

const ADD = 'REQUESTS_CONTROLLER_ADD_USER_REQUEST'
const REMOVE = 'REQUESTS_CONTROLLER_REMOVE_USER_REQUEST'
const OPEN_SESSION = 'MAIN_CONTROLLER_ACTIVITY_SET_ACC_OPS_FILTERS'
const CLOSE_SESSION = 'MAIN_CONTROLLER_ACTIVITY_RESET_ACC_OPS_FILTERS'

const actionsOf = (dispatch: jest.Mock) => dispatched<SendRequestAction>(dispatch)
const typesOf = (dispatch: jest.Mock) => actionsOf(dispatch).map((a) => a.type)

/** Sends TRANSACTION from HANDLE over a queue listing KEY, and answers the request id the port queued. */
const sending = (options: Parameters<typeof sendQueueOver>[1] = {}) => {
  const q = sendQueueOver([basicAccount(KEY)], options)
  const send = track(q.sender.send(HANDLE, TRANSACTION))
  const { id } = addedRequest(q.dispatch).userRequest
  return { q, send, id }
}

const reasonOf = (value: unknown) => (value as SendRefusal).reason

/** The port settled with a refusal for `reason`, for the key it was asked to send from. */
const expectRefusal = (seen: { status: string; value?: unknown }, reason: string) => {
  expect(seen.status).toBe('rejected')
  expect(seen.value).toBeInstanceOf(Error)
  expect((seen.value as SendRefusal).name).toBe('SendRefusal')
  expect(reasonOf(seen.value)).toBe(reason)
  expect((seen.value as SendRefusal).key).toEqual(HANDLE)
}

// Every test runs on fake timers, so a send a test leaves pending never keeps
// the port's ten-minute wait alive after the test.
beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('the send port over the request queue', () => {
  it("adds one transaction request for the key's listed account, carrying the transaction", () => {
    const q = sendQueueOver([basicAccount(KEY)])
    q.sender.send(HANDLE, { ...TRANSACTION, value: 5n }).catch(() => undefined)
    const { userRequest, allowAccountSwitch } = addedRequest(q.dispatch)
    expect(allowAccountSwitch).toBe(true)
    expect(userRequest.meta).toEqual({
      isSignAction: true,
      accountAddr: KEY,
      keyType: 'internal',
      chainId: BigInt(SEPOLIA)
    })
    expect(userRequest.action).toEqual({
      kind: 'calls',
      calls: [{ to: MANAGER, value: 5n, data: TRANSACTION.data }]
    })
    expect(userRequest.session.windowId).toBe(WINDOW_ID)
  })

  it('sends no value where the transaction names none', () => {
    const q = sendQueueOver([basicAccount(KEY)])
    q.sender.send(HANDLE, TRANSACTION).catch(() => undefined)
    expect(addedRequest(q.dispatch).userRequest.action).toEqual({
      kind: 'calls',
      calls: [{ to: MANAGER, value: 0n, data: TRANSACTION.data }]
    })
  })

  it("follows the key's account on the chain in an activity session of the request's own id", () => {
    const { q, id } = sending()
    const [open] = actionsOf(q.dispatch)
    expect(open).toEqual({
      type: OPEN_SESSION,
      params: {
        sessionId: id,
        filters: { account: KEY, chainId: BigInt(SEPOLIA) },
        pagination: expect.objectContaining({ fromPage: 0 })
      }
    })
    expect(typesOf(q.dispatch)).toEqual([OPEN_SESSION, ADD])
  })

  it('answers the hash of its call once the activity lists the operation the wallet broadcast', async () => {
    const { q, send, id } = sending()
    q.push(queuedWith('open', id))
    q.push(queuedWith('closed'))
    q.push(activityListing(id, operationFor(id, { hash: HASH, callHash: HASH })))
    await flush()
    expect(send).toEqual({ status: 'resolved', value: HASH })
    expect(actionsOf(q.dispatch)).toEqual([
      expect.objectContaining({ type: OPEN_SESSION }),
      expect.objectContaining({ type: ADD }),
      { type: CLOSE_SESSION, params: { sessionId: id } }
    ])
    expect(q.listeners()).toBe(0)
  })

  it("names the listed account's checksum address for a key given in lower case", async () => {
    const q = sendQueueOver([basicAccount(KEY)])
    const lower = KEY.toLowerCase() as Address
    expect(lower).not.toBe(KEY)
    const send = track(q.sender.send({ addr: lower, type: 'internal' }, TRANSACTION))
    const { userRequest } = addedRequest(q.dispatch)
    expect(userRequest.meta.accountAddr).toBe(KEY)
    const [open] = actionsOf(q.dispatch)
    expect(open.type === OPEN_SESSION && open.params.filters.account).toBe(KEY)
    q.push(activityListing(userRequest.id, operationFor(userRequest.id, { callHash: HASH })))
    await flush()
    expect(send).toEqual({ status: 'resolved', value: HASH })
  })

  it("answers its own call's hash over the operation's where the two differ", async () => {
    const { q, send, id } = sending()
    q.push(activityListing(id, operationFor(id, { hash: OTHER_HASH, callHash: HASH })))
    await flush()
    expect(send).toEqual({ status: 'resolved', value: HASH })
  })

  it("answers the operation's hash where its call carries none", async () => {
    const { q, send, id } = sending()
    q.push(activityListing(id, operationFor(id, { hash: HASH })))
    await flush()
    expect(send).toEqual({ status: 'resolved', value: HASH })
  })

  it('ignores the operations of other requests and of other sessions', async () => {
    const { q, send, id } = sending()
    q.push(activityListing(id, operationFor('dapp-request', { hash: OTHER_HASH })))
    q.push(activityListing('another-page', operationFor(id, { hash: OTHER_HASH })))
    await flush()
    expect(send.status).toBe('pending')
    q.push(
      activityListing(
        id,
        operationFor('dapp-request', { hash: OTHER_HASH }),
        operationFor(id, { hash: HASH })
      )
    )
    await flush()
    expect(send).toEqual({ status: 'resolved', value: HASH })
  })

  it('keeps waiting while its listed operation carries no transaction hash yet', async () => {
    const { q, send, id } = sending()
    q.push(activityListing(id, operationFor(id, { status: AccountOpStatus.Pending })))
    q.push(activityListing(id, operationFor(id, { hash: 'not-a-hash' })))
    await flush()
    expect(send.status).toBe('pending')
    q.push(activityListing(id, operationFor(id, { hash: HASH })))
    await flush()
    expect(send).toEqual({ status: 'resolved', value: HASH })
  })

  it('settles once: a later update changes nothing, and it unsubscribes', async () => {
    const { q, send, id } = sending()
    q.push(activityListing(id, operationFor(id, { hash: HASH })))
    await flush()
    expect(q.listeners()).toBe(0)
    q.push(activityListing(id, operationFor(id, { hash: OTHER_HASH })))
    q.push(queuedWith('closed'))
    await advance(DEFAULT_SEND_TIMEOUT_MS * 2)
    expect(send).toEqual({ status: 'resolved', value: HASH })
    expect(typesOf(q.dispatch)).toEqual([OPEN_SESSION, ADD, CLOSE_SESSION])
  })

  it('gives each request an id of its own', () => {
    const q = sendQueueOver([basicAccount(KEY)])
    q.sender.send(HANDLE, TRANSACTION).catch(() => undefined)
    q.sender.send(HANDLE, TRANSACTION).catch(() => undefined)
    const ids = actionsOf(q.dispatch).flatMap((a) =>
      a.type === ADD ? [String(a.params.userRequest.id)] : []
    )
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('refuses a transaction from another address than the key, before it queues anything', async () => {
    const q = sendQueueOver([basicAccount(KEY), basicAccount(OTHER_KEY)])
    const caught = await thrownBy(q.sender.send(HANDLE, { ...TRANSACTION, from: OTHER_KEY }))
    expect(caught).toBeInstanceOf(TypeError)
    expect(q.dispatch).not.toHaveBeenCalled()
    expect(q.listeners()).toBe(0)
  })
})

describe('the refusals', () => {
  it('refuses as refused once its request stays out of the queue for the grace, and withdraws nothing', async () => {
    const { q, send, id } = sending()
    q.push(queuedWith('open', id))
    q.push(queuedWith('closed'))
    await advance(ABSENCE_GRACE_MS - 1)
    expect(send.status).toBe('pending')
    await advance(1)
    expectRefusal(send, 'refused')
    expect(typesOf(q.dispatch)).toEqual([OPEN_SESSION, ADD, CLOSE_SESSION])
    expect(q.listeners()).toBe(0)
  })

  it('does not refuse a request that moves to the account-switch list within the grace', async () => {
    const { q, send, id } = sending()
    q.push(queuedWith('none', id))
    q.push(queuedWith('none'))
    await advance(ABSENCE_GRACE_MS - 1)
    q.push({
      controller: 'requests',
      state: { userRequests: [], userRequestsWaitingAccountSwitch: [{ id }] }
    })
    await advance(ABSENCE_GRACE_MS * 2)
    expect(send.status).toBe('pending')
  })

  it('does not refuse a request no queue state has held yet', async () => {
    const { q, send } = sending()
    q.push(queuedWith('open', 'dapp-request'))
    await advance(ABSENCE_GRACE_MS * 2)
    expect(send.status).toBe('pending')
  })

  it('refuses as window-closed and withdraws its request once the window stays closed for the grace', async () => {
    const { q, send, id } = sending()
    q.push(queuedWith('open', id))
    q.push(queuedWith('closed', id))
    await advance(ABSENCE_GRACE_MS - 1)
    expect(send.status).toBe('pending')
    await advance(1)
    expectRefusal(send, 'window-closed')
    expect(actionsOf(q.dispatch)).toContainEqual({ type: REMOVE, params: { id } })
    expect(actionsOf(q.dispatch)).toContainEqual({ type: CLOSE_SESSION, params: { sessionId: id } })
    expect(q.listeners()).toBe(0)
  })

  it('withdraws nothing when the window opens again within the grace', async () => {
    const { q, send, id } = sending()
    q.push(queuedWith('open', id))
    q.push(queuedWith('closed', id))
    await advance(ABSENCE_GRACE_MS - 1)
    q.push(queuedWith('open', id))
    await advance(ABSENCE_GRACE_MS * 2)
    expect(send.status).toBe('pending')
    expect(typesOf(q.dispatch)).not.toContain(REMOVE)
  })

  it('does not read a window that never opened as closed', async () => {
    const { q, send, id } = sending()
    q.push(queuedWith('none', id))
    q.push(queuedWith('closed', id))
    await advance(ABSENCE_GRACE_MS * 2)
    expect(send.status).toBe('pending')
    expect(typesOf(q.dispatch)).not.toContain(REMOVE)
  })

  it('refuses as not-broadcast when the activity lists its operation rejected with no hash', async () => {
    const { q, send, id } = sending()
    q.push(queuedWith('open', id))
    q.push(activityListing(id, operationFor(id, { status: AccountOpStatus.Rejected })))
    await flush()
    expectRefusal(send, 'not-broadcast')
    expect(typesOf(q.dispatch)).toEqual([OPEN_SESSION, ADD, CLOSE_SESSION])
    expect(q.listeners()).toBe(0)
  })

  it('refuses as timeout and withdraws its request once the wait passes with no answer', async () => {
    const { q, send, id } = sending()
    q.push(queuedWith('open', id))
    await advance(DEFAULT_SEND_TIMEOUT_MS - 1)
    expect(send.status).toBe('pending')
    await advance(1)
    expectRefusal(send, 'timeout')
    expect(actionsOf(q.dispatch)).toContainEqual({ type: REMOVE, params: { id } })
    expect(actionsOf(q.dispatch)).toContainEqual({ type: CLOSE_SESSION, params: { sessionId: id } })
    expect(q.listeners()).toBe(0)
  })

  it('takes a shorter wait from its options', async () => {
    const { send } = sending({ timeoutMs: 1000 })
    await advance(1000)
    expectRefusal(send, 'timeout')
  })

  describe('a key that is not itself a basic account the wallet lists', () => {
    const controllingKey = addressOf('controlling-key-at-index-plus-100000')
    const KEYS: [string, SendWorld['accounts']][] = [
      [
        'the controlling key of a smart account',
        [smartAccount(addressOf('smart-account'), controllingKey)]
      ],
      ['a key the wallet does not list', [basicAccount(KEY)]]
    ]
    KEYS.forEach(([title, accounts]) =>
      it(`refuses ${title} as not-wired, naming the missing background action, and dispatches nothing`, async () => {
        const q = sendQueueOver(accounts)
        const key: KeyHandle = { addr: controllingKey, type: 'internal' }
        const caught = await thrownBy(q.sender.send(key, { ...TRANSACTION, from: controllingKey }))
        const refusal = caught as SendRefusal
        expect(refusal).toBeInstanceOf(Error)
        expect(refusal.name).toBe('SendRefusal')
        expect(refusal.reason).toBe('not-wired')
        expect(refusal.missingAction).toBe('KEYSTORE_CONTROLLER_SEND_WITH_KEY')
        expect(refusal.message).toContain('KEYSTORE_CONTROLLER_SEND_WITH_KEY')
        expect(refusal.key).toEqual(key)
        expect(q.dispatch).not.toHaveBeenCalled()
        expect(q.listeners()).toBe(0)
      })
    )
  })
})

describe('once the activity lists the broadcast operation', () => {
  it('stops the timeout and waits for its hash with no limit', async () => {
    const { q, send, id } = sending()
    q.push(queuedWith('open', id))
    await advance(DEFAULT_SEND_TIMEOUT_MS - 1)
    q.push(activityListing(id, operationFor(id)))
    await advance(DEFAULT_SEND_TIMEOUT_MS * 3)
    expect(send.status).toBe('pending')
    expect(typesOf(q.dispatch)).not.toContain(REMOVE)
    q.push(activityListing(id, operationFor(id, { hash: HASH })))
    await flush()
    expect(send).toEqual({ status: 'resolved', value: HASH })
  })

  it('reads neither the request leaving the queue nor the window closing as a refusal', async () => {
    const { q, send, id } = sending()
    q.push(queuedWith('open', id))
    q.push(activityListing(id, operationFor(id)))
    q.push(queuedWith('closed', id))
    q.push(queuedWith('closed'))
    await advance(ABSENCE_GRACE_MS * 3)
    expect(send.status).toBe('pending')
    expect(typesOf(q.dispatch)).not.toContain(REMOVE)
    q.push(activityListing(id, operationFor(id, { callHash: HASH })))
    await flush()
    expect(send).toEqual({ status: 'resolved', value: HASH })
  })

  it('still refuses as not-broadcast when the wallet later marks the operation rejected with no hash', async () => {
    const { q, send, id } = sending()
    q.push(activityListing(id, operationFor(id)))
    await flush()
    expect(send.status).toBe('pending')
    q.push(activityListing(id, operationFor(id, { status: AccountOpStatus.Rejected })))
    await flush()
    expectRefusal(send, 'not-broadcast')
  })

  it('does not refuse a request the queue dropped just before the activity listed its operation', async () => {
    const { q, send, id } = sending()
    q.push(queuedWith('open', id))
    q.push(queuedWith('closed'))
    await advance(ABSENCE_GRACE_MS - 1)
    q.push(activityListing(id, operationFor(id)))
    await advance(ABSENCE_GRACE_MS * 2)
    expect(send.status).toBe('pending')
    q.push(activityListing(id, operationFor(id, { hash: HASH })))
    await flush()
    expect(send).toEqual({ status: 'resolved', value: HASH })
  })
})

describe('what the port asks of the wallet', () => {
  it('signs nothing itself: it dispatches only the queue and activity actions, and the viem account still refuses a transaction', async () => {
    const { q, send, id } = sending()
    q.push(activityListing(id, operationFor(id, { hash: HASH })))
    await flush()
    expect(send.status).toBe('resolved')
    const types = typesOf(q.dispatch) as string[]
    types.forEach((t) => expect([ADD, REMOVE, OPEN_SESSION, CLOSE_SESSION]).toContain(t))
    expect(types.filter((t) => /KEYSTORE|SIGN|BROADCAST|PRIVATE_KEY|SEED/.test(t))).toEqual([])

    const signQueue = queueOver([basicAccount(KEY)])
    const account = accountFor(signQueue.signer, HANDLE)
    const caught = await thrownBy(
      account.signTransaction({ chainId: SEPOLIA, to: MANAGER, value: 0n, data: TRANSACTION.data })
    )
    expect(caught).toBeInstanceOf(Error)
    expect(signQueue.dispatch).not.toHaveBeenCalled()
  })
})

describe("the UI's own port over the event bus", () => {
  it('answers the hash from the activity the background pushes, and leaves no listener behind', async () => {
    const before = ['requests', 'activity'].map((type) => eventBus.events[type]?.length ?? 0)
    const dispatch = jest.fn()
    const sender = createSendPort(
      sendRequestPort(dispatch, () => [basicAccount(KEY)], WINDOW_ID),
      {
        chainId: SEPOLIA
      }
    )
    const send = track(sender.send(HANDLE, TRANSACTION))
    const { userRequest } = addedRequest(dispatch)
    expect(userRequest.session.windowId).toBe(WINDOW_ID)
    eventBus.emit('requests', queuedWith('open', userRequest.id).state)
    eventBus.emit('requests')
    eventBus.emit('activity')
    await flush()
    expect(send.status).toBe('pending')
    eventBus.emit(
      'activity',
      activityListing(userRequest.id, operationFor(userRequest.id, { hash: HASH })).state
    )
    await flush()
    expect(send).toEqual({ status: 'resolved', value: HASH })
    expect(['requests', 'activity'].map((type) => eventBus.events[type]?.length ?? 0)).toEqual(
      before
    )
  })

  it('refuses a key while the wallet lists no accounts yet', async () => {
    const dispatch = jest.fn()
    const sender = createSendPort(
      sendRequestPort(dispatch, () => undefined),
      { chainId: SEPOLIA }
    )
    const caught = await thrownBy(sender.send(HANDLE, TRANSACTION))
    expect(reasonOf(caught)).toBe('not-wired')
    expect(dispatch).not.toHaveBeenCalled()
  })
})
