/**
 * A page that did not queue a request reads where it stands from the wallet's
 * queue and the selected account's unconfirmed operations, as the UI's own
 * port pulls them now: still queued, broadcast under a hash, sent on a route
 * the wallet cannot follow, or gone.
 */
import { AccountOpStatus } from '@ambire-common/libs/accountOp/types'
import type { Hex } from '@web/modules/social-recovery/sdk-interfaces'
import {
  newSendRequestId,
  operationFor,
  operationOf,
  queuedRequest,
  queueHolding,
  SendQueueState,
  sendRequestPort,
  sendRequestStateOf,
  SEPOLIA,
  SMART_ACCOUNT,
  SubmittedOperation
} from '@web/modules/social-recovery/shared/client/__tests__/harness'

const HASH: Hex = `0x${'ab'.repeat(32)}`
const CALL_HASH: Hex = `0x${'cd'.repeat(32)}`

/** The UI's own port over a queue and unconfirmed operations the test sets. */
const wallet = () => {
  const held: { queue?: SendQueueState; unconfirmed?: SubmittedOperation[] } = {}
  const dispatch = jest.fn()
  const port = sendRequestPort(
    dispatch,
    () => [],
    () => held.queue
  )
  return { held, dispatch, port }
}

const ID = newSendRequestId()
const OTHER_ID = newSendRequestId()

describe("a queued request's state, read by another page", () => {
  it('reads queued where the queue holds the request', () => {
    const { held, port } = wallet()
    held.queue = queueHolding([queuedRequest(OTHER_ID, { account: SMART_ACCOUNT })])
    expect(sendRequestStateOf(port, ID, SMART_ACCOUNT, SEPOLIA)).toEqual({ status: 'gone' })
    held.queue = queueHolding([
      queuedRequest(OTHER_ID, { account: SMART_ACCOUNT }),
      queuedRequest(ID, { account: SMART_ACCOUNT })
    ])
    expect(sendRequestStateOf(port, ID, SMART_ACCOUNT, SEPOLIA)).toEqual({ status: 'queued' })
  })

  it('reads queued where the request waits for an account switch', () => {
    const { held, port } = wallet()
    held.queue = queueHolding([], [queuedRequest(ID, { account: SMART_ACCOUNT })])
    expect(sendRequestStateOf(port, ID, SMART_ACCOUNT, SEPOLIA)).toEqual({ status: 'queued' })
  })

  it("reads broadcast with the operation's hash where a pending transaction carries the request", () => {
    const { held, port } = wallet()
    held.unconfirmed = [
      operationFor(OTHER_ID, { hash: CALL_HASH }),
      operationFor(ID, { hash: HASH, status: AccountOpStatus.BroadcastedButNotConfirmed })
    ]
    expect(sendRequestStateOf(port, ID, SMART_ACCOUNT, SEPOLIA)).toEqual({
      status: 'broadcast',
      transactionHash: HASH
    })
  })

  it("reads broadcast with the call's own hash where the wallet sent each call as its own transaction", () => {
    const { held, port } = wallet()
    held.unconfirmed = [
      operationOf(
        [
          { requestId: OTHER_ID, callHash: HASH },
          { requestId: ID, callHash: CALL_HASH }
        ],
        { kind: 'MultipleTxns', hash: HASH }
      )
    ]
    expect(sendRequestStateOf(port, ID, SMART_ACCOUNT, SEPOLIA)).toEqual({
      status: 'broadcast',
      transactionHash: CALL_HASH
    })
  })

  const OTHER_ROUTES = ['UserOperation', 'Relayer'] as const
  OTHER_ROUTES.forEach((kind) =>
    it(`reads untracked where the wallet submitted the request as a ${kind}, hash or none`, () => {
      const { held, port } = wallet()
      held.unconfirmed = [operationFor(ID, { kind, hash: HASH })]
      expect(sendRequestStateOf(port, ID, SMART_ACCOUNT, SEPOLIA)).toEqual({ status: 'untracked' })
      held.unconfirmed = [operationFor(ID, { kind })]
      expect(sendRequestStateOf(port, ID, SMART_ACCOUNT, SEPOLIA)).toEqual({ status: 'untracked' })
    })
  )

  it('reads gone where neither the queue nor the operations hold the request', () => {
    const { held, port } = wallet()
    held.queue = queueHolding(
      [queuedRequest(OTHER_ID, { account: SMART_ACCOUNT })],
      [queuedRequest(OTHER_ID, { account: SMART_ACCOUNT })]
    )
    held.unconfirmed = [operationFor(OTHER_ID, { hash: HASH })]
    expect(sendRequestStateOf(port, ID, SMART_ACCOUNT, SEPOLIA)).toEqual({ status: 'gone' })
  })

  it('reads gone where a transaction carries the request but names no hash', () => {
    const { held, port } = wallet()
    held.unconfirmed = [operationFor(ID)]
    expect(sendRequestStateOf(port, ID, SMART_ACCOUNT, SEPOLIA)).toEqual({ status: 'gone' })
  })

  it('reads gone while the screen holds neither state yet', () => {
    const { port } = wallet()
    expect(sendRequestStateOf(port, ID, SMART_ACCOUNT, SEPOLIA)).toEqual({ status: 'gone' })
  })

  it('reads the state the screen holds at each call, and asks nothing of the wallet', () => {
    const { held, dispatch, port } = wallet()
    held.queue = queueHolding([queuedRequest(ID, { account: SMART_ACCOUNT })])
    expect(sendRequestStateOf(port, ID, SMART_ACCOUNT, SEPOLIA)).toEqual({ status: 'queued' })
    held.queue = queueHolding([])
    held.unconfirmed = [operationFor(ID, { hash: HASH })]
    expect(sendRequestStateOf(port, ID, SMART_ACCOUNT, SEPOLIA)).toEqual({
      status: 'broadcast',
      transactionHash: HASH
    })
    held.unconfirmed = []
    expect(sendRequestStateOf(port, ID, SMART_ACCOUNT, SEPOLIA)).toEqual({ status: 'gone' })
    expect(dispatch).not.toHaveBeenCalled()
  })
})
