/**
 * @jest-environment jsdom
 *
 * The claim of the submission on the live session across pages of one
 * device: two tabs, or a page and the one a reload opens, each with its own
 * records over the same storage and its own send port. A page that finds a
 * claim follows it and sends nothing; a claim that stays with no hash for
 * longer than the claim's age is judged by the manager's events. The clock is
 * Jest's.
 */
import type { SubmitStore } from '@web/modules/social-recovery/recovery/submit'

import {
  advanceTimers,
  attemptOf,
  attemptStarted,
  CLAIM_NOW as NOW,
  flushTimers as flush,
  held,
  landedReceipt,
  leaveClaim,
  NO_ATTEMPT,
  openDevice,
  pageOn,
  recoveryStateOf,
  RIVAL_PAYLOAD,
  sessionOf,
  START_BLOCK,
  stepsOf,
  submit,
  TX_HASH
} from '@web/modules/social-recovery/recovery/submit/__tests__/harness'

const { FOLLOW_REREAD_MS, KEY_SEND_CLAIM_AGE_MS, isLanded, lookForClaim, startSubmission } = submit

describe('the claim of the submission', () => {
  const pages: { store: SubmitStore; steps: ReturnType<typeof stepsOf> }[] = []

  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    pages.forEach(({ store, steps }) => submit.detachSteps(store, steps))
    pages.length = 0
    jest.useRealTimers()
  })

  const track = <P extends { store: SubmitStore; steps: ReturnType<typeof stepsOf> }>(page: P) => {
    pages.push(page)
    return page
  }

  it('lets a second tab follow the first tab’s hash and send nothing', async () => {
    const device = await openDevice()
    const receipt = held<ReturnType<typeof landedReceipt>>()
    device.kit.receipts.wait.mockImplementation(async () => {
      const landed = await receipt.promise
      device.kit.chain.attempt = attemptOf(device.gathering)
      return landed
    })
    const first = track(pageOn(device))
    startSubmission(first.store, first.steps).catch(() => undefined)
    await flush()
    expect(first.port.send).toHaveBeenCalledTimes(1)
    const stored = await sessionOf(device.records(), device.account)
    expect(stored?.state === 'live' && stored.submission?.transactionHash).toBe(TX_HASH)

    const second = track(pageOn(device))
    lookForClaim(second.store, second.steps).catch(() => undefined)
    startSubmission(second.store, second.steps).catch(() => undefined)
    await flush()
    expect(second.port.send).not.toHaveBeenCalled()
    expect(second.store.state().write).toEqual(
      expect.objectContaining({ status: 'submitting', transactionHash: TX_HASH })
    )

    receipt.release(landedReceipt())
    await flush()
    expect(isLanded(first.store.state())).toBe(true)
    expect(second.store.state().followed).toBe(first.store.state().requestId)
    expect(second.store.state().write.status).toBe('landed')
    expect(await sessionOf(device.records(), device.account)).toEqual({
      state: 'landed',
      account: device.account
    })
    expect(first.port.send).toHaveBeenCalledTimes(1)
    expect(second.port.send).not.toHaveBeenCalled()
  })

  it('lets a second tab wait on a claim with no hash yet, then follow the hash once it is stored', async () => {
    const device = await openDevice()
    const first = track(pageOn(device))
    const hash = held<`0x${string}`>()
    first.port.send.mockImplementation(() => hash.promise)
    startSubmission(first.store, first.steps).catch(() => undefined)
    await flush()

    const second = track(pageOn(device))
    lookForClaim(second.store, second.steps).catch(() => undefined)
    await flush()
    expect(second.store.state().follow).toEqual(
      expect.objectContaining({ startBlock: START_BLOCK })
    )
    expect(second.port.send).not.toHaveBeenCalled()

    hash.release(TX_HASH)
    await flush()
    await advanceTimers(FOLLOW_REREAD_MS)
    await flush()
    expect(isLanded(second.store.state())).toBe(true)
    expect(isLanded(first.store.state())).toBe(true)
    expect(first.port.send).toHaveBeenCalledTimes(1)
    expect(second.port.send).not.toHaveBeenCalled()
  })

  it('lets a reloaded page follow its own earlier claim instead of sending again', async () => {
    const device = await openDevice()
    const receipt = held<ReturnType<typeof landedReceipt>>()
    device.kit.receipts.wait.mockImplementation(() => receipt.promise)
    const before = track(pageOn(device))
    startSubmission(before.store, before.steps).catch(() => undefined)
    await flush()

    const reloaded = track(pageOn(device))
    lookForClaim(reloaded.store, reloaded.steps).catch(() => undefined)
    startSubmission(reloaded.store, reloaded.steps).catch(() => undefined)
    await flush()
    expect(reloaded.port.send).not.toHaveBeenCalled()
    expect(reloaded.store.state().write).toEqual(
      expect.objectContaining({ status: 'submitting', transactionHash: TX_HASH })
    )
  })

  it('waits on a claim with no hash younger than the claim’s age, and reads no events', async () => {
    const device = await openDevice()
    await leaveClaim(device, NOW - KEY_SEND_CLAIM_AGE_MS + 60_000)
    const page = track(pageOn(device))
    lookForClaim(page.store, page.steps).catch(() => undefined)
    await flush()
    await advanceTimers(FOLLOW_REREAD_MS)
    await flush()
    expect(device.kit.fetch).not.toHaveBeenCalled()
    expect(page.store.state().follow?.requestId).toBe('page-that-went')
    const stored = await sessionOf(device.records(), device.account)
    expect(stored?.state === 'live' && stored.submission?.requestId).toBe('page-that-went')
    expect(page.port.send).not.toHaveBeenCalled()
  })

  it('lands a claim with no hash older than the claim’s age where the manager’s events name its start', async () => {
    const device = await openDevice()
    await leaveClaim(device, NOW - KEY_SEND_CLAIM_AGE_MS - 1)
    // The node the first read reaches lags behind the start; the events hold it.
    device.kit.recoveryState.mockImplementationOnce(async () => {
      device.kit.chain.attempt = attemptOf(device.gathering)
      return recoveryStateOf(NO_ATTEMPT, START_BLOCK + 9)
    })
    device.kit.fetch.mockResolvedValue([attemptStarted(device.gathering)])
    const page = track(pageOn(device))
    lookForClaim(page.store, page.steps).catch(() => undefined)
    await flush()
    expect(device.kit.accountFilter).toHaveBeenCalled()
    expect(device.kit.fetch).toHaveBeenCalledWith(expect.anything(), {
      from: START_BLOCK,
      to: START_BLOCK + 9
    })
    expect(isLanded(page.store.state())).toBe(true)
    expect(await sessionOf(device.records(), device.account)).toEqual({
      state: 'landed',
      account: device.account
    })
    expect(page.port.send).not.toHaveBeenCalled()
  })

  it('releases a claim with no hash older than the claim’s age where no event names its start, and offers the start again', async () => {
    const device = await openDevice()
    await leaveClaim(device, NOW - KEY_SEND_CLAIM_AGE_MS - 1)
    device.kit.fetch.mockResolvedValue([])
    const page = track(pageOn(device))
    lookForClaim(page.store, page.steps).catch(() => undefined)
    await flush()
    expect(device.kit.fetch).toHaveBeenCalledTimes(1)
    const stored = await sessionOf(device.records(), device.account)
    expect(stored?.state).toBe('live')
    expect(stored?.state === 'live' && stored.submission).toBeFalsy()
    expect(page.store.state().write.status).toBe('idle')
    expect(page.port.send).not.toHaveBeenCalled()

    await startSubmission(page.store, page.steps)
    await flush()
    expect(page.port.send).toHaveBeenCalledTimes(1)
    expect(isLanded(page.store.state())).toBe(true)
  })

  it('takes no rival’s start with the same id for its own: the claim is released, nothing lands', async () => {
    const device = await openDevice()
    await leaveClaim(device, NOW - KEY_SEND_CLAIM_AGE_MS - 1)
    device.kit.fetch.mockResolvedValue([attemptStarted(device.gathering, RIVAL_PAYLOAD)])
    const page = track(pageOn(device))
    lookForClaim(page.store, page.steps).catch(() => undefined)
    await flush()
    expect(isLanded(page.store.state())).toBe(false)
    const stored = await sessionOf(device.records(), device.account)
    expect(stored?.state).toBe('live')
    expect(stored?.state === 'live' && stored.submission).toBeFalsy()
  })
})
