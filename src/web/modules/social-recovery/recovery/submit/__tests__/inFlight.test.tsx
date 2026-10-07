/**
 * @jest-environment jsdom
 *
 * A submission on its way to the chain, as the pages of one device read it:
 * a claim that takes its hash while a follower judges it, a hash the wallet
 * answers after another page released the claim, a claim whose request the
 * wallet still holds, a hash the node lost, a revert that names an attempt
 * already running, and a landing another page made first. Each page has its
 * own records over the device's one storage. The clock is Jest's.
 */
import type { Attempt, Hex } from '@web/modules/social-recovery/sdk-interfaces'
import type { WriteEvent } from '@web/modules/social-recovery/shared/writes'
import type { SubmitStore } from '@web/modules/social-recovery/recovery/submit'

import type { Device } from '@web/modules/social-recovery/recovery/submit/__tests__/harness'
import {
  advanceTimers,
  attemptOf,
  batchPlan,
  CHAIN_ID,
  CLAIM_NOW as NOW,
  claimOf,
  DEVICE_PLAN,
  flushTimers as flush,
  held,
  kitError,
  landedReceipt,
  leaveClaim,
  LEFT_CLAIM,
  minedAndReverted,
  openDevice,
  pageOf,
  pageOn,
  requestQueue,
  sendPort,
  sessionOf,
  START_BLOCK,
  stepsOf,
  submit,
  TX_HASH
} from '@web/modules/social-recovery/recovery/submit/__tests__/harness'

const {
  DROPPED_AFTER_MS,
  FOLLOW_REREAD_MS,
  KEY_SEND_CLAIM_AGE_MS,
  SUBMISSION_CLAIM_AGE_MS,
  checkAgain,
  isLanded,
  lookForClaim,
  startSubmission
} = submit

const OTHER_HASH: Hex = '0x1111111111111111111111111111111111111111111111111111111111111111'

/** A receipt wait that never answers, so a run keeps waiting on its hash. */
const never = () => held<never>().promise

/** The device's session accessor over a fresh read, for a write another page makes. */
const otherPage = async (device: Device) => {
  const accessor = device.records().recoverySession(CHAIN_ID, device.account)
  const read = await accessor.read()
  if (read.status !== 'present') {
    throw new Error('no session stored')
  }
  return { accessor, revision: read.revision }
}

let planSeed = 0xc2000

describe('a submission on its way to the chain', () => {
  const stores: { store: SubmitStore; steps: ReturnType<typeof stepsOf> }[] = []

  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    stores.forEach(({ store, steps }) => submit.detachSteps(store, steps))
    stores.length = 0
    jest.useRealTimers()
  })

  const track = <P extends { store: SubmitStore; steps: ReturnType<typeof stepsOf> }>(page: P) => {
    stores.push(page)
    return page
  }

  describe('an old claim with no hash', () => {
    it('follows the hash the claim took while the events were read, and never removes it', async () => {
      const device = await openDevice()
      await leaveClaim(device, NOW - KEY_SEND_CLAIM_AGE_MS - 1)
      device.kit.fetch.mockImplementation(async () => {
        const { accessor, revision } = await otherPage(device)
        await accessor.setSubmissionHash(LEFT_CLAIM, TX_HASH, revision)
        return []
      })
      const receipt = held<ReturnType<typeof landedReceipt>>()
      device.kit.receipts.wait.mockImplementation(() => receipt.promise)
      const page = track(pageOn(device))
      lookForClaim(page.store, page.steps).catch(() => undefined)
      await flush()
      expect(device.kit.fetch).toHaveBeenCalledTimes(1)
      expect(await claimOf(device)).toEqual(
        expect.objectContaining({ requestId: LEFT_CLAIM, transactionHash: TX_HASH })
      )
      expect(page.store.state().write).toEqual(
        expect.objectContaining({ status: 'submitting', transactionHash: TX_HASH })
      )
      expect(device.kit.receipts.wait).toHaveBeenCalledWith(TX_HASH, START_BLOCK)

      device.kit.chain.attempt = attemptOf(device.gathering)
      receipt.release(landedReceipt())
      await flush()
      expect(isLanded(page.store.state())).toBe(true)
      expect(page.port.send).not.toHaveBeenCalled()
    })

    it('goes back to the checklist where the session it follows was wiped', async () => {
      const device = await openDevice()
      await leaveClaim(device, NOW - 1_000)
      const page = track(pageOn(device))
      lookForClaim(page.store, page.steps).catch(() => undefined)
      await flush()
      expect(page.store.state().follow?.requestId).toBe(LEFT_CLAIM)

      const { revision } = await otherPage(device)
      await device
        .records()
        .wipeRecoverySession(CHAIN_ID, device.account, 'another-attempt-opened', revision)
      await advanceTimers(FOLLOW_REREAD_MS)
      await flush()
      expect(page.store.state().toChecklist).toBe(true)
      expect(page.store.state().write.status).toBe('idle')
      expect(page.port.send).not.toHaveBeenCalled()
    })
  })

  describe('a hash the wallet answers after another page released the claim', () => {
    it('writes the claim back with its hash, so every page follows it', async () => {
      const device = await openDevice()
      const page = track(pageOn(device))
      const hash = held<Hex>()
      page.port.send.mockImplementation(() => hash.promise)
      device.kit.receipts.wait.mockImplementation(never)
      startSubmission(page.store, page.steps).catch(() => undefined)
      await flush()
      const { requestId } = page.store.state()
      expect((await claimOf(device))?.requestId).toBe(requestId)

      const { accessor, revision } = await otherPage(device)
      await accessor.releaseSubmission(requestId as string, revision)
      expect(await claimOf(device)).toBeNull()

      hash.release(TX_HASH)
      await flush()
      expect(await claimOf(device)).toEqual(
        expect.objectContaining({ requestId, transactionHash: TX_HASH, startBlock: START_BLOCK })
      )

      const second = track(pageOn(device))
      lookForClaim(second.store, second.steps).catch(() => undefined)
      startSubmission(second.store, second.steps).catch(() => undefined)
      await flush()
      expect(second.store.state().write).toEqual(
        expect.objectContaining({ status: 'submitting', transactionHash: TX_HASH })
      )
      expect(second.port.send).not.toHaveBeenCalled()
      expect(page.port.send).toHaveBeenCalledTimes(1)
    })

    it('leaves another page’s claim in its place untouched', async () => {
      const device = await openDevice()
      const page = track(pageOn(device))
      const hash = held<Hex>()
      page.port.send.mockImplementation(() => hash.promise)
      device.kit.receipts.wait.mockImplementation(never)
      startSubmission(page.store, page.steps).catch(() => undefined)
      await flush()
      const { accessor, revision } = await otherPage(device)
      await accessor.releaseSubmission(page.store.state().requestId as string, revision)
      await leaveClaim(device, NOW)

      hash.release(TX_HASH)
      await flush()
      const claim = await claimOf(device)
      expect(claim?.requestId).toBe(LEFT_CLAIM)
      expect(claim?.transactionHash).toBeUndefined()
    })
  })

  describe('the claim’s age by the sending route', () => {
    it('waits on an old claim while the wallet’s queue still holds its request, and reads no events', async () => {
      const device = await openDevice()
      const plan = await batchPlan((planSeed += 1))
      const { port: requests, queue } = requestQueue({ status: 'queued' })
      await leaveClaim(device, NOW - SUBMISSION_CLAIM_AGE_MS - 1)
      const page = track(pageOn(device, () => NOW, { plan, requests }))
      lookForClaim(page.store, page.steps).catch(() => undefined)
      await flush()
      await advanceTimers(FOLLOW_REREAD_MS)
      await flush()
      expect(device.kit.fetch).not.toHaveBeenCalled()
      expect((await claimOf(device))?.requestId).toBe(LEFT_CLAIM)
      expect(page.store.state().follow?.requestId).toBe(LEFT_CLAIM)

      queue.answer = { status: 'gone' }
      await advanceTimers(FOLLOW_REREAD_MS)
      await flush()
      expect(device.kit.fetch).toHaveBeenCalledTimes(1)
      expect(await claimOf(device)).toBeNull()
      expect(page.store.state().write.status).toBe('idle')
      expect(page.port.sendAccountBatch).not.toHaveBeenCalled()
    })

    it('writes the hash the wallet broadcast under the claim’s request on the claim, and follows it', async () => {
      const device = await openDevice()
      const plan = await batchPlan((planSeed += 1))
      const { port: requests } = requestQueue({ status: 'broadcast', hash: TX_HASH })
      await leaveClaim(device, NOW - SUBMISSION_CLAIM_AGE_MS - 1)
      const page = track(pageOn(device, () => NOW, { plan, requests }))
      lookForClaim(page.store, page.steps).catch(() => undefined)
      await flush()
      expect(device.kit.fetch).not.toHaveBeenCalled()
      expect(device.kit.receipts.wait).toHaveBeenCalledWith(TX_HASH, START_BLOCK)
      expect(isLanded(page.store.state())).toBe(true)
      expect(page.port.sendAccountBatch).not.toHaveBeenCalled()
    })

    it('judges a batch’s claim past ten minutes, and a key’s own claim of the same age not yet', async () => {
      const age = SUBMISSION_CLAIM_AGE_MS + 60_000
      expect(age).toBeLessThan(KEY_SEND_CLAIM_AGE_MS)

      const batched = await openDevice()
      const plan = await batchPlan((planSeed += 1))
      const { port: requests } = requestQueue({ status: 'gone' })
      await leaveClaim(batched, NOW - age)
      const batchPage = track(pageOn(batched, () => NOW, { plan, requests }))
      lookForClaim(batchPage.store, batchPage.steps).catch(() => undefined)
      await flush()
      expect(batched.kit.fetch).toHaveBeenCalledTimes(1)
      expect(await claimOf(batched)).toBeNull()

      const keyed = await openDevice()
      await leaveClaim(keyed, NOW - age)
      const keyPage = track(pageOn(keyed, () => NOW, { plan: DEVICE_PLAN }))
      lookForClaim(keyPage.store, keyPage.steps).catch(() => undefined)
      await flush()
      await advanceTimers(FOLLOW_REREAD_MS)
      await flush()
      expect(keyed.kit.fetch).not.toHaveBeenCalled()
      expect((await claimOf(keyed))?.requestId).toBe(LEFT_CLAIM)
      expect(keyPage.store.state().follow?.requestId).toBe(LEFT_CLAIM)
    })

    it('judges a key’s own claim once it is older than thirty minutes', async () => {
      const device = await openDevice()
      await leaveClaim(device, NOW - 1_000)
      let clock = NOW
      const page = track(pageOn(device, () => clock))
      lookForClaim(page.store, page.steps).catch(() => undefined)
      await flush()
      clock = NOW + KEY_SEND_CLAIM_AGE_MS - 2_000
      await advanceTimers(FOLLOW_REREAD_MS)
      await flush()
      expect(device.kit.fetch).not.toHaveBeenCalled()

      clock = NOW + KEY_SEND_CLAIM_AGE_MS
      await advanceTimers(FOLLOW_REREAD_MS)
      await flush()
      expect(device.kit.fetch).toHaveBeenCalledTimes(1)
      expect(await claimOf(device)).toBeNull()
    })
  })

  describe('a hash the node lost', () => {
    it('releases the claim on arrival and offers the start again', async () => {
      const device = await openDevice()
      await leaveClaim(device, NOW - DROPPED_AFTER_MS - 1, TX_HASH)
      device.kit.receipts.transactionKnown.mockResolvedValue('unknown')
      device.kit.receipts.wait.mockImplementation(never)
      const page = track(pageOn(device))
      lookForClaim(page.store, page.steps).catch(() => undefined)
      await flush()
      expect(device.kit.receipts.transactionKnown).toHaveBeenCalledWith(TX_HASH)
      expect(await claimOf(device)).toBeNull()
      expect(page.store.state().write.status).toBe('idle')
      expect(device.kit.receipts.wait).not.toHaveBeenCalled()

      device.kit.receipts.wait.mockImplementation(async (hash: Hex) => {
        device.kit.chain.attempt = attemptOf(device.gathering)
        return landedReceipt(hash)
      })
      await startSubmission(page.store, page.steps)
      await flush()
      expect(page.port.send).toHaveBeenCalledTimes(1)
      expect(isLanded(page.store.state())).toBe(true)
    })

    it('reads nothing as dropped until check again, and drops it then', async () => {
      const device = await openDevice()
      await leaveClaim(device, NOW - 1_000, TX_HASH)
      device.kit.receipts.wait.mockImplementation(never)
      let clock = NOW
      const page = track(pageOn(device, () => clock))
      lookForClaim(page.store, page.steps).catch(() => undefined)
      await flush()
      expect(page.store.state().write.status).toBe('submitting')

      clock = NOW + DROPPED_AFTER_MS
      device.kit.receipts.transactionKnown.mockResolvedValue('unknown')
      await advanceTimers(DROPPED_AFTER_MS)
      await flush()
      expect(page.store.state().write).toEqual(
        expect.objectContaining({ status: 'submitting', transactionHash: TX_HASH })
      )
      expect((await claimOf(device))?.transactionHash).toBe(TX_HASH)

      await checkAgain(page.store, page.steps)
      await flush()
      expect(page.store.state().write.status).toBe('idle')
      expect(await claimOf(device)).toBeNull()
      expect(page.port.send).not.toHaveBeenCalled()
    })

    it('keeps the claim while the node still knows the hash', async () => {
      const device = await openDevice()
      await leaveClaim(device, NOW - DROPPED_AFTER_MS - 1, TX_HASH)
      device.kit.receipts.wait.mockImplementation(never)
      const page = track(pageOn(device))
      lookForClaim(page.store, page.steps).catch(() => undefined)
      await flush()
      expect(device.kit.receipts.transactionKnown).toHaveBeenCalledWith(TX_HASH)
      expect((await claimOf(device))?.transactionHash).toBe(TX_HASH)
      expect(page.store.state().write.status).toBe('submitting')
    })

    it('keeps a claim younger than the dropped age, whatever the node says', async () => {
      const device = await openDevice()
      await leaveClaim(device, NOW - DROPPED_AFTER_MS + 60_000, TX_HASH)
      device.kit.receipts.transactionKnown.mockResolvedValue('unknown')
      device.kit.receipts.wait.mockImplementation(never)
      const page = track(pageOn(device))
      lookForClaim(page.store, page.steps).catch(() => undefined)
      await flush()
      expect((await claimOf(device))?.transactionHash).toBe(TX_HASH)
      expect(page.store.state().write.status).toBe('submitting')
    })

    it('lands the attempt the manager holds as this request’s own, with nothing released', async () => {
      const device = await openDevice()
      await leaveClaim(device, NOW - DROPPED_AFTER_MS - 1, TX_HASH)
      device.kit.receipts.transactionKnown.mockResolvedValue('unknown')
      device.kit.receipts.wait.mockImplementation(never)
      device.kit.chain.attempt = attemptOf(device.gathering)
      const page = track(pageOn(device))
      lookForClaim(page.store, page.steps).catch(() => undefined)
      await flush()
      expect(isLanded(page.store.state())).toBe(true)
      expect(await sessionOf(device.records(), device.account)).toEqual({
        state: 'landed',
        account: device.account
      })
    })
  })

  describe('a revert that names an attempt already running', () => {
    /**
     * Steps whose send answers a hash, then the revert the wallet decoded as
     * `cause`, with `attempt` the attempt the manager then holds.
     */
    const revertingSteps = (device: Device, cause: string, attempt: Attempt) => {
      const { chain } = device.kit
      const steps = stepsOf({
        kit: device.kit,
        port: sendPort(),
        records: device.records(),
        account: device.account,
        gathering: device.gathering,
        plan: DEVICE_PLAN,
        chosen: new Set([0, 1, 2, 3]),
        now: () => NOW
      })
      const send: typeof steps.send = async (_prepared, dispatch, run, startBlock) => {
        dispatch({ type: 'sent', run, transactionHash: TX_HASH, startBlock })
        chain.attempt = attempt
        dispatch({
          type: 'error',
          run,
          error: minedAndReverted(),
          cause: kitError(cause)
        } as WriteEvent)
      }
      return { ...steps, send }
    }

    it('lands where the attempt the manager holds is this request’s own', async () => {
      const device = await openDevice()
      const steps = revertingSteps(device, 'AttemptAlreadyActive', attemptOf(device.gathering))
      const store = track({ store: pageOf(steps), steps }).store
      await startSubmission(store, steps)
      await flush()
      expect(isLanded(store.state())).toBe(true)
      expect(await sessionOf(device.records(), device.account)).toEqual({
        state: 'landed',
        account: device.account
      })
    })

    it('keeps the refusal where the attempt running is another one', async () => {
      const device = await openDevice()
      const steps = revertingSteps(
        device,
        'AttemptAlreadyActive',
        attemptOf(device.gathering, { attemptId: 7n })
      )
      const store = track({ store: pageOf(steps), steps }).store
      await startSubmission(store, steps)
      await flush()
      expect(isLanded(store.state())).toBe(false)
      expect(submit.revertedRunning(store.state().write)).toBe(true)
      expect((await sessionOf(device.records(), device.account))?.state).toBe('live')
    })

    it('lands a followed hash whose revert names the attempt where the attempt is ours', async () => {
      const device = await openDevice()
      await leaveClaim(device, NOW - 1_000, OTHER_HASH)
      const base = stepsOf({
        kit: device.kit,
        port: sendPort(),
        records: device.records(),
        account: device.account,
        gathering: device.gathering,
        plan: DEVICE_PLAN,
        chosen: new Set([0, 1, 2, 3]),
        now: () => NOW
      })
      const steps = {
        ...base,
        waitAgain: (async (transactionHash, _startBlock, dispatch, run) => {
          device.kit.chain.attempt = attemptOf(device.gathering)
          dispatch({
            type: 'error',
            run,
            error: minedAndReverted(transactionHash),
            cause: kitError('WrongAttemptId')
          } as WriteEvent)
        }) as typeof base.waitAgain
      }
      const { store } = track({ store: pageOf(steps), steps })
      await lookForClaim(store, steps)
      await flush()
      expect(isLanded(store.state())).toBe(true)
    })
  })

  describe('a landing another page made first', () => {
    it('reads landed where the retried landing finds the session landed', async () => {
      const device = await openDevice()
      await leaveClaim(device, NOW - 1_000, TX_HASH)
      const records = device.records()
      const other = device.records()
      let raced = 0
      const racing = {
        ...records,
        landSubmission: (async (chainId, account, revision) => {
          if (raced === 0) {
            raced += 1
            const read = await other.recoverySession(CHAIN_ID, account).read()
            if (read.status === 'present') {
              await other.landSubmission(chainId, account, read.revision)
            }
          }
          return records.landSubmission(chainId, account, revision)
        }) as typeof records.landSubmission
      }
      const steps = stepsOf({
        kit: device.kit,
        port: sendPort(),
        records: racing,
        account: device.account,
        gathering: device.gathering,
        plan: DEVICE_PLAN,
        chosen: new Set([0, 1, 2, 3]),
        now: () => NOW
      })
      const { store } = track({ store: pageOf(steps), steps })
      await lookForClaim(store, steps)
      await flush()
      expect(raced).toBe(1)
      expect(isLanded(store.state())).toBe(true)
      expect(store.state().after).toBe('landed')
      expect(await sessionOf(device.records(), device.account)).toEqual({
        state: 'landed',
        account: device.account
      })
    })
  })
})
