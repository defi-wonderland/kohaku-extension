/**
 * The UI's own send port pulls the queue from the `requests` controller state
 * the screen holds, the value `useRequestsControllerState` answers, as it is.
 */
import useRequestsControllerState from '@web/hooks/useRequestsControllerState'
import {
  BATCH,
  CONTROLLING_KEY,
  createSendPort,
  flush,
  type HeldRequestQueue,
  newSendRequestId,
  queuedRequest,
  queueHolding,
  type SendRefusal,
  sendRequestPort,
  sendRequestStateOf,
  SEPOLIA,
  SMART_ACCOUNT,
  smartAccount,
  track
} from '@web/modules/social-recovery/shared/client/__tests__/harness'

let mockHeld: HeldRequestQueue = {}

jest.mock('@web/hooks/useRequestsControllerState', () => ({
  __esModule: true,
  default: () => mockHeld
}))

const portOverTheHook = () => {
  const dispatch = jest.fn()
  const port = sendRequestPort(
    dispatch,
    () => [smartAccount(SMART_ACCOUNT, CONTROLLING_KEY)],
    useRequestsControllerState
  )
  return { dispatch, port }
}

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  mockHeld = {}
})

describe('the send port over the requests state the hook answers', () => {
  it('reads a request the held queue keeps waiting for an account switch as queued, reading no activity', async () => {
    const id = newSendRequestId()
    mockHeld = queueHolding([], [queuedRequest(id, { account: SMART_ACCOUNT })])
    const { dispatch, port } = portOverTheHook()
    await expect(sendRequestStateOf(port, id, SMART_ACCOUNT, SEPOLIA)).resolves.toEqual({
      status: 'queued'
    })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("refuses a batch beside a calls request of the account on the chain in the held queue, by the request's own kind, account and chain", async () => {
    mockHeld = queueHolding([
      queuedRequest('dapp-request', { account: SMART_ACCOUNT.toLowerCase() })
    ])
    const { dispatch, port } = portOverTheHook()
    const send = track(
      createSendPort(port, { chainId: SEPOLIA }).sendAccountBatch(SMART_ACCOUNT, BATCH)
    )
    await flush()
    expect(send.status).toBe('rejected')
    expect((send.value as SendRefusal).reason).toBe('other-request-pending')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('queues a batch beside a request of the account that is not a calls request', async () => {
    mockHeld = queueHolding([
      queuedRequest('dapp-request', { account: SMART_ACCOUNT, kind: 'typedMessage' })
    ])
    const { dispatch, port } = portOverTheHook()
    const send = track(
      createSendPort(port, { chainId: SEPOLIA }).sendAccountBatch(SMART_ACCOUNT, BATCH)
    )
    await flush()
    expect(send.status).toBe('pending')
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'REQUESTS_CONTROLLER_ADD_USER_REQUEST' })
    )
  })
})
