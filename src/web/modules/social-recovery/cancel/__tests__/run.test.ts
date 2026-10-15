import { accountBatchRefusal } from '@web/modules/social-recovery/shared/client'
import {
  attachCancelSteps,
  cancelClaimsOf,
  createCancelStore,
  detachCancelSteps,
  recheckCancel,
  startCancel
} from '@web/modules/social-recovery/cancel'
import type { CancelStore } from '@web/modules/social-recovery/cancel'
import {
  ACCOUNT,
  ATTEMPT,
  NEW_KEY,
  OTHER_HASH,
  SEPOLIA,
  SHORT,
  START_BLOCK,
  TX_HASH,
  cancelOn,
  executeOn,
  landedReceipt,
  minedAndReverted,
  openChain,
  runWorld
} from '@web/modules/social-recovery/cancel/__fixtures__/run'

const settled = async () => {
  for (let round = 0; round < 20; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
  }
}

describe("the owner's cancel run", () => {
  let store: CancelStore

  beforeEach(() => {
    store = createCancelStore()
  })

  it('sends the cancel once, and reads cancelled only after the receipt landed and the read agrees', async () => {
    const world = runWorld()
    await startCancel(store, world.steps, ATTEMPT)

    expect(world.port.sendAccountBatch).toHaveBeenCalledTimes(1)
    const [account, calls, , kit, requestId] = world.port.sendAccountBatch.mock.calls[0]
    expect(account).toBe(ACCOUNT)
    expect(calls).toHaveLength(1)
    expect(kit).toBeUndefined()
    expect(requestId).toBe('request-1')
    expect(store.state().write.status).toBe('landed')
    expect(store.state().after).toEqual({ stage: 'cancelled' })
    expect(await world.steps.claims.read()).toBeUndefined()
  })

  it('reads another road where the read after the landing names one', async () => {
    const world = runWorld()
    world.wait.mockImplementation(async (hash) => {
      cancelOn(world.chain, 'cancelByProofs')
      return landedReceipt(hash)
    })
    await startCancel(store, world.steps, ATTEMPT)

    expect(store.state().after).toEqual({ stage: 'otherRoad', road: 'cancelByProofs' })
  })

  it('reads not sent, with the retry, where the wallet refused the cancel, and releases the claim', async () => {
    const world = runWorld()
    world.port.sendAccountBatch.mockRejectedValueOnce(accountBatchRefusal('refused', ACCOUNT))
    await startCancel(store, world.steps, ATTEMPT)

    const { write } = store.state()
    expect(write.status).toBe('failedNotSent')
    expect(world.wait).not.toHaveBeenCalled()
    expect(await world.steps.claims.read()).toBeUndefined()

    await startCancel(store, world.steps, ATTEMPT)
    expect(world.port.sendAccountBatch).toHaveBeenCalledTimes(2)
    expect(store.state().after).toEqual({ stage: 'cancelled' })
  })

  it('keeps the claim of a cancel that may still reach the chain, and sends no other', async () => {
    const world = runWorld()
    world.port.sendAccountBatch.mockRejectedValueOnce(
      accountBatchRefusal('not-a-transaction', ACCOUNT)
    )
    await startCancel(store, world.steps, ATTEMPT)

    const { write } = store.state()
    expect(write.status === 'failedNotSent' && write.mayStillLand).toBe(true)
    expect(await world.steps.claims.read()).toMatchObject({ requestId: 'request-1' })

    // A second page follows the stored cancel and sends nothing.
    const second = createCancelStore()
    await startCancel(second, world.steps, ATTEMPT)
    expect(world.port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(second.state().write.status).toBe('submitting')
  })

  it('names the road where the cancel reverted because another road had ended the attempt', async () => {
    const world = runWorld()
    world.wait.mockImplementation(async (hash) => {
      cancelOn(world.chain, 'setupWrite')
      throw minedAndReverted(hash)
    })
    await startCancel(store, world.steps, ATTEMPT)

    const { write } = store.state()
    expect(write.status).toBe('failedReverted')
    if (write.status === 'failedReverted') {
      expect(write.cause).toEqual({ kind: 'attemptGone', ended: 'setupWrite' })
    }
    expect(await world.steps.claims.read()).toBeUndefined()
  })

  it("names the account's controller where the cancel reverted because the attempt executed", async () => {
    const world = runWorld()
    world.wait.mockImplementation(async (hash) => {
      executeOn(world.chain)
      throw minedAndReverted(hash)
    })
    await startCancel(store, world.steps, ATTEMPT)

    const { write } = store.state()
    expect(write.status === 'failedReverted' && write.cause).toEqual({
      kind: 'attemptGone',
      ended: 'executed',
      controller: NEW_KEY
    })
  })

  it('reads the plain revert, with the retry, where the attempt still runs after the revert', async () => {
    const world = runWorld()
    world.wait.mockImplementation(async (hash) => {
      throw minedAndReverted(hash)
    })
    await startCancel(store, world.steps, ATTEMPT)

    const { write } = store.state()
    expect(write.status === 'failedReverted' && write.cause.kind).toBe('unnamed')
  })

  it('shows the deposit step where the key holds too little, and sends after the funds arrive', async () => {
    const world = runWorld()
    world.checkGas.mockResolvedValueOnce(SHORT)
    await startCancel(store, world.steps, ATTEMPT)

    const { write } = store.state()
    expect(write.status).toBe('needsDeposit')
    expect(write.status === 'needsDeposit' && write.step.payer).toBe('accountKey')
    expect(world.port.sendAccountBatch).not.toHaveBeenCalled()

    await recheckCancel(store, world.steps)
    expect(world.port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(store.state().after).toEqual({ stage: 'cancelled' })
  })

  it('sends nothing where the read before the send finds the attempt gone', async () => {
    const chain = openChain()
    executeOn(chain)
    const world = runWorld(chain)
    await startCancel(store, world.steps, ATTEMPT)

    expect(world.port.sendAccountBatch).not.toHaveBeenCalled()
    expect(store.state().write.status).toBe('idle')
    expect(store.state().gone?.ended).toMatchObject({ road: 'executed', controller: NEW_KEY })
  })

  it('reads the check as failed, with nothing sent, where the attempt read fails', async () => {
    const chain = openChain()
    chain.setState(ACCOUNT, new Error('node down'))
    const world = runWorld(chain)
    await startCancel(store, world.steps, ATTEMPT)

    expect(store.state().write.status).toBe('gasReadError')
    expect(world.port.sendAccountBatch).not.toHaveBeenCalled()
  })

  it('follows a cancel another page stored under its hash, sending nothing, to its terminal', async () => {
    const world = runWorld()
    await cancelClaimsOf(world.storage, SEPOLIA, ACCOUNT).claim({
      attemptId: ATTEMPT,
      requestId: 'elsewhere',
      startBlock: START_BLOCK,
      transactionHash: OTHER_HASH
    })
    await attachCancelSteps(store, world.steps)
    await settled()

    expect(world.port.sendAccountBatch).not.toHaveBeenCalled()
    expect(world.wait).toHaveBeenCalledWith(OTHER_HASH, START_BLOCK)
    expect(store.state().after).toEqual({ stage: 'cancelled' })
    detachCancelSteps(world.steps)
  })

  it('offers the start again where the wallet holds a stored request nowhere', async () => {
    const world = runWorld()
    world.requestHold.mockResolvedValue({ status: 'free' })
    await cancelClaimsOf(world.storage, SEPOLIA, ACCOUNT).claim({
      attemptId: ATTEMPT,
      requestId: 'elsewhere',
      startBlock: START_BLOCK
    })
    await attachCancelSteps(store, world.steps)
    await settled()

    expect(store.state().write.status).toBe('idle')
    expect(await world.steps.claims.read()).toBeUndefined()
    expect(world.port.sendAccountBatch).not.toHaveBeenCalled()

    await startCancel(store, world.steps, ATTEMPT)
    expect(world.port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(world.wait).toHaveBeenCalledWith(TX_HASH, START_BLOCK)
    detachCancelSteps(world.steps)
  })

  it('follows a request the wallet broadcast meanwhile under its hash', async () => {
    const world = runWorld()
    world.requestHold.mockResolvedValue({ status: 'broadcast', transactionHash: OTHER_HASH })
    await cancelClaimsOf(world.storage, SEPOLIA, ACCOUNT).claim({
      attemptId: ATTEMPT,
      requestId: 'elsewhere',
      startBlock: START_BLOCK
    })
    await attachCancelSteps(store, world.steps)
    await settled()

    expect(world.port.sendAccountBatch).not.toHaveBeenCalled()
    expect(world.wait).toHaveBeenCalledWith(OTHER_HASH, START_BLOCK)
    expect(store.state().after).toEqual({ stage: 'cancelled' })
    detachCancelSteps(world.steps)
  })
})
