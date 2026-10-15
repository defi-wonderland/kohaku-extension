import { accountBatchRefusal, isSendRefusal } from '@web/modules/social-recovery/shared/client'
import {
  attachCancelSteps,
  CLAIM_SEND_LIMIT_MS,
  cancelClaimsOf,
  createCancelStore,
  detachCancelSteps,
  recheckCancel,
  startCancel
} from '@web/modules/social-recovery/cancel'
import type { CancelClaims, CancelStore } from '@web/modules/social-recovery/cancel'
import { readWatcherRecord } from '@web/modules/social-recovery/watcher'
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
  openOn,
  runWorld
} from '@web/modules/social-recovery/cancel/__fixtures__/run'
import { OLD_KEY, payloadTo } from '@web/modules/social-recovery/watcher/__fixtures__/harness'

const settled = async () => {
  for (let round = 0; round < 20; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
  }
}

const OWNED = { stage: 'cancelled', attemptId: ATTEMPT, newKey: NEW_KEY }

describe("the owner's cancel run", () => {
  let store: CancelStore

  beforeEach(() => {
    store = createCancelStore()
  })

  it('sends the cancel once, and reads cancelled only after the receipt landed and the read agrees', async () => {
    const world = runWorld()
    await startCancel(store, world.steps, ATTEMPT)

    expect(world.sendAccountBatch).toHaveBeenCalledTimes(1)
    const [account, calls, , kit, requestId] = world.sendAccountBatch.mock.calls[0]
    expect(account).toBe(ACCOUNT)
    expect(calls).toHaveLength(1)
    expect(kit).toBeUndefined()
    expect(requestId).toBe('request-1')
    expect(store.state().write.status).toBe('landed')
    expect(store.state().after).toEqual(OWNED)
    expect(await world.steps.claims.read()).toBeUndefined()
  })

  it('names the newer attempt the landed cancel ended, by its new key', async () => {
    const world = runWorld()
    world.wait.mockImplementation(async (hash) => {
      // Another road ended the meant attempt, a newer one opened, and the cancel ended that one.
      cancelOn(world.chain, 'cancelByProofs')
      cancelOn(world.chain, 'cancelByOwner', ATTEMPT + 1n, payloadTo(OLD_KEY))
      return landedReceipt(hash)
    })
    await startCancel(store, world.steps, ATTEMPT)

    expect(store.state().after).toEqual({
      stage: 'cancelled',
      attemptId: ATTEMPT + 1n,
      newKey: OLD_KEY
    })
  })

  it('names the attempt the cancel ended where a newer one opened after it, and the record holds the newer', async () => {
    const world = runWorld()
    world.wait.mockImplementation(async (hash) => {
      cancelOn(world.chain, 'cancelByOwner')
      openOn(world.chain, ATTEMPT + 1n, payloadTo(OLD_KEY))
      return landedReceipt(hash)
    })
    await startCancel(store, world.steps, ATTEMPT)

    expect(store.state().after).toEqual(OWNED)
    const record = await readWatcherRecord(world.storage, SEPOLIA, ACCOUNT)
    expect(record?.reading?.attempt?.attemptId).toBe(ATTEMPT + 1n)
  })

  it('reads another road where the read after the landing names one', async () => {
    const world = runWorld()
    world.wait.mockImplementation(async (hash) => {
      cancelOn(world.chain, 'cancelByProofs')
      return landedReceipt(hash)
    })
    await startCancel(store, world.steps, ATTEMPT)

    expect(store.state().after).toEqual({
      stage: 'otherRoad',
      attemptId: ATTEMPT,
      road: 'cancelByProofs'
    })
  })

  it('reads not sent, with the retry, where the wallet refused the cancel, and releases the claim', async () => {
    const world = runWorld()
    world.sendAccountBatch.mockRejectedValueOnce(accountBatchRefusal('refused', ACCOUNT))
    await startCancel(store, world.steps, ATTEMPT)

    const { write } = store.state()
    expect(write.status).toBe('failedNotSent')
    expect(world.wait).not.toHaveBeenCalled()
    expect(await world.steps.claims.read()).toBeUndefined()

    await startCancel(store, world.steps, ATTEMPT)
    expect(world.sendAccountBatch).toHaveBeenCalledTimes(2)
    expect(store.state().after).toEqual(OWNED)
  })

  it("adds nothing where the run's claim is no longer its own, and reads its gate's refusal", async () => {
    const world = runWorld()
    const original = world.sendAccountBatch.getMockImplementation()!
    world.sendAccountBatch.mockImplementationOnce(async (...args) => {
      const held = await world.steps.claims.read()
      await world.steps.claims.release(held!.requestId)
      return original(...args)
    })
    await startCancel(store, world.steps, ATTEMPT)

    const { write } = store.state()
    expect(write.status).toBe('failedNotSent')
    expect(
      write.status === 'failedNotSent' && isSendRefusal(write.error) && write.error.reason
    ).toBe('timeout')
    expect(world.wait).not.toHaveBeenCalled()
  })

  it('keeps the claim of a cancel that may still reach the chain, and sends no other', async () => {
    const world = runWorld()
    world.sendAccountBatch.mockRejectedValueOnce(accountBatchRefusal('not-a-transaction', ACCOUNT))
    await startCancel(store, world.steps, ATTEMPT)

    const { write } = store.state()
    expect(write.status === 'failedNotSent' && write.mayStillLand).toBe(true)
    expect(await world.steps.claims.read()).toMatchObject({ requestId: 'request-1' })

    // A second page follows the stored cancel and sends nothing.
    const second = createCancelStore()
    await startCancel(second, world.steps, ATTEMPT)
    expect(world.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(second.state().write.status).toBe('submitting')
  })

  it('releases the claim of a cancel that may still land once the attempt reads ended, and shows the terminal', async () => {
    const world = runWorld()
    world.sendAccountBatch.mockRejectedValueOnce(accountBatchRefusal('not-a-transaction', ACCOUNT))
    await startCancel(store, world.steps, ATTEMPT)
    // The operation another party sends lands later.
    cancelOn(world.chain, 'cancelByOwner')

    const second = createCancelStore()
    await attachCancelSteps(second, world.steps)
    await settled()

    expect(await world.steps.claims.read()).toBeUndefined()
    expect(second.state().write.status).toBe('idle')
    expect(second.state().after).toEqual({ stage: 'cancelled', attemptId: ATTEMPT })
    expect(world.sendAccountBatch).toHaveBeenCalledTimes(1)
    detachCancelSteps(world.steps)
  })

  it('releases a followed claim and offers the newer attempt where another one is open', async () => {
    const world = runWorld()
    await world.steps.claims.claim({
      attemptId: ATTEMPT,
      requestId: 'elsewhere',
      startBlock: START_BLOCK
    })
    cancelOn(world.chain, 'cancelByProofs')
    openOn(world.chain, ATTEMPT + 1n, payloadTo(OLD_KEY))

    await attachCancelSteps(store, world.steps)
    await settled()

    expect(await world.steps.claims.read()).toBeUndefined()
    expect(store.state().write.status).toBe('idle')
    expect(store.state().gone?.attempt?.attemptId).toBe(ATTEMPT + 1n)
    detachCancelSteps(world.steps)
  })

  it("never releases another tab's claim between its claim and its add", async () => {
    const world = runWorld()
    // The request is not in the wallet yet, so the second tab reads it held nowhere.
    world.requestHold.mockResolvedValue({ status: 'free' })
    const second = createCancelStore()
    const original = world.sendAccountBatch.getMockImplementation()!
    world.sendAccountBatch.mockImplementationOnce(async (...args) => {
      attachCancelSteps(second, world.steps).catch(() => undefined)
      await settled()
      return original(...args)
    })
    await startCancel(store, world.steps, ATTEMPT)

    expect(world.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(store.state().write.status).toBe('landed')
    expect(store.state().after).toEqual(OWNED)
    expect(second.state().write.status).toBe('submitting')
    expect(second.state().follow).toBe('held')
    detachCancelSteps(world.steps)
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
    expect(world.sendAccountBatch).not.toHaveBeenCalled()

    await recheckCancel(store, world.steps)
    expect(world.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(store.state().after).toEqual(OWNED)
  })

  it('sends nothing where the read before the send finds the attempt gone', async () => {
    const chain = openChain()
    executeOn(chain)
    const world = runWorld(chain)
    await startCancel(store, world.steps, ATTEMPT)

    expect(world.sendAccountBatch).not.toHaveBeenCalled()
    expect(store.state().write.status).toBe('idle')
    expect(store.state().gone?.ended).toMatchObject({ road: 'executed', controller: NEW_KEY })
  })

  it('sends nothing, and keeps the newer attempt to offer, where another attempt is open', async () => {
    const chain = openChain()
    openOn(chain, ATTEMPT + 1n, payloadTo(OLD_KEY))
    const world = runWorld(chain)
    await startCancel(store, world.steps, ATTEMPT)

    expect(world.sendAccountBatch).not.toHaveBeenCalled()
    expect(store.state().gone?.attempt?.attemptId).toBe(ATTEMPT + 1n)
  })

  it('sends nothing and releases its claim where the read after the claim finds the attempt gone', async () => {
    const world = runWorld()
    const claims: CancelClaims = world.steps.claims
    world.steps.claims = {
      ...claims,
      claim: async (claim) => {
        const answer = await claims.claim(claim)
        cancelOn(world.chain, 'cancelByProofs')
        return answer
      }
    }
    await startCancel(store, world.steps, ATTEMPT)

    expect(world.sendAccountBatch).not.toHaveBeenCalled()
    expect(store.state().write.status).toBe('idle')
    expect(store.state().gone?.ended).toMatchObject({
      road: 'cancelled',
      cancelledBy: 'cancelByProofs'
    })
    expect(await claims.read()).toBeUndefined()
  })

  it('reads the check as failed, with nothing sent, where the attempt read fails', async () => {
    const chain = openChain()
    chain.setState(ACCOUNT, new Error('node down'))
    const world = runWorld(chain)
    await startCancel(store, world.steps, ATTEMPT)

    expect(store.state().write.status).toBe('gasReadError')
    expect(world.sendAccountBatch).not.toHaveBeenCalled()
  })

  it('follows a cancel another page stored under its hash, sending nothing, to its terminal', async () => {
    const world = runWorld()
    const claims = cancelClaimsOf(world.storage, SEPOLIA, ACCOUNT)
    await claims.claim({ attemptId: ATTEMPT, requestId: 'elsewhere', startBlock: START_BLOCK })
    await claims.markSent('elsewhere', OTHER_HASH)
    await attachCancelSteps(store, world.steps)
    await settled()

    expect(world.sendAccountBatch).not.toHaveBeenCalled()
    expect(world.wait).toHaveBeenCalledWith(OTHER_HASH, START_BLOCK)
    expect(store.state().after).toEqual({ stage: 'cancelled', attemptId: ATTEMPT, newKey: NEW_KEY })
    detachCancelSteps(world.steps)
  })

  it('offers the start again where the wallet holds a stored request nowhere past its send limit', async () => {
    let clock = 1_000_000
    const world = runWorld(openChain(), () => clock)
    world.requestHold.mockResolvedValue({ status: 'free' })
    await world.steps.claims.claim({
      attemptId: ATTEMPT,
      requestId: 'elsewhere',
      startBlock: START_BLOCK
    })
    clock += CLAIM_SEND_LIMIT_MS + 1
    await attachCancelSteps(store, world.steps)
    await settled()

    expect(store.state().write.status).toBe('idle')
    expect(await world.steps.claims.read()).toBeUndefined()
    expect(world.sendAccountBatch).not.toHaveBeenCalled()

    await startCancel(store, world.steps, ATTEMPT)
    expect(world.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(world.wait).toHaveBeenCalledWith(TX_HASH, START_BLOCK)
    detachCancelSteps(world.steps)
  })

  it('follows a request the wallet broadcast meanwhile under its hash', async () => {
    const world = runWorld()
    world.requestHold.mockResolvedValue({ status: 'broadcast', transactionHash: OTHER_HASH })
    await world.steps.claims.claim({
      attemptId: ATTEMPT,
      requestId: 'elsewhere',
      startBlock: START_BLOCK
    })
    await attachCancelSteps(store, world.steps)
    await settled()

    expect(world.sendAccountBatch).not.toHaveBeenCalled()
    expect(world.wait).toHaveBeenCalledWith(OTHER_HASH, START_BLOCK)
    expect(store.state().after).toEqual({ stage: 'cancelled', attemptId: ATTEMPT, newKey: NEW_KEY })
    detachCancelSteps(world.steps)
  })
})
