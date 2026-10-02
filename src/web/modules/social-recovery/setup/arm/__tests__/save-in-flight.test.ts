/**
 * The save in flight stored on this device, over the records lane's own
 * record on an in-memory storage that several saves share as the pages of one
 * device: the claim before the send and its loser, the hash written at the
 * send, each way a run ends against the record after it, and a page that
 * finds the record, with its hash or with none, following it to its end with
 * nothing sent. Every wait runs on Jest's fake clock.
 */
import type { Account } from '@ambire-common/interfaces/account'
import { AccountOpStatus } from '@ambire-common/libs/accountOp/types'
import { shapeNoteOf } from '@web/modules/social-recovery/shared/client'
import { canRetry, mayStillLand } from '@web/modules/social-recovery/shared/writes'

import {
  armScreenOf,
  checkReceiptAgain,
  checkSetupAgain,
  committedDraftOf,
  createArmStore,
  FOLLOW_REREAD_MS,
  GONE_GRACE_MS,
  isSaved,
  lookForSave,
  RECEIPT_WAIT_MS,
  startSave
} from '@web/modules/social-recovery/setup/arm'
import type { ArmStore, SaveSteps } from '@web/modules/social-recovery/setup/arm'
import { attachSteps, detachSteps } from '@web/modules/social-recovery/setup/arm/run'

import {
  advanceTimers,
  draftOf,
  ENDINGS,
  HAPPY,
  landedReceipt,
  memoryStorage,
  nodeError,
  operationFor,
  pending,
  requestsFake,
  setupStateOf,
  SHORT_TIMEOUT_MS,
  smartAccount,
  START_BLOCK,
  TX_HASH,
  unawaited,
  wireSave
} from '@web/modules/social-recovery/setup/arm/__tests__/harness'
import type {
  MemoryStorage,
  RequestsFake,
  SaveScript,
  WiredSave
} from '@web/modules/social-recovery/setup/arm/__tests__/harness'

const OPTIONS = { timeoutMs: SHORT_TIMEOUT_MS }

let account: Account

beforeAll(async () => {
  account = await smartAccount()
})

beforeEach(() => {
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

const script = (overrides: Partial<SaveScript> = {}): SaveScript => ({
  ...HAPPY,
  authorized: false,
  deployed: true,
  ...overrides
})

/** A promise the test settles by hand. */
const held = <T>() => {
  let release: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const stored = async (wired: WiredSave) => {
  const read = await wired.inFlight.read()
  return read.status === 'present' ? read.value : undefined
}

/** Whether the page offers the Save button now: an idle run that holds nothing and read no stored save. */
const offersSave = (store: ArmStore) => {
  const state = store.state()
  return (
    armScreenOf(state) === 'arrival' &&
    state.write.status === 'idle' &&
    state.lookup === 'none' &&
    state.requestId === undefined
  )
}

/**
 * The first page: it claims and sends, then goes away, before the wallet
 * answered the hash or after the hash was written. Its run is never driven
 * again. Answers the record it left.
 */
const firstPageLeaves = async (
  storage: MemoryStorage,
  requests: RequestsFake,
  { withHash }: { withHash: boolean }
) => {
  const first = wireSave(account, script(), { storage, requests })
  if (withHash) {
    first.receipts.wait.mockImplementation(() => pending())
  } else {
    first.port.sendAccountBatch.mockImplementation(() => pending())
  }
  unawaited(startSave(createArmStore(), first.steps, OPTIONS))
  await advanceTimers(0)
  const record = await stored(first)
  expect(record).toBeDefined()
  expect(record?.transactionHash).toBe(withHash ? TX_HASH : undefined)
  expect(first.port.sendAccountBatch).toHaveBeenCalledTimes(1)
  return { first, record: record! }
}

/** A second page over the same storage, as a reload or a second tab has: a new store, its own edges. */
const secondPage = (storage: MemoryStorage, requests: RequestsFake) => {
  const wired = wireSave(account, script(), { storage, requests })
  const store = createArmStore()
  return { wired, store, arrive: () => lookForSave(store, wired.steps, OPTIONS) }
}

describe('the claim before the send', () => {
  it('stores the prepared save under a new request id once the gas check reads enough, and sends under that id', async () => {
    const wired = wireSave(account, script())
    const sign = held<typeof TX_HASH>()
    wired.port.sendAccountBatch.mockImplementationOnce(() => sign.promise)
    const writes = jest.spyOn(wired.storage, 'set')
    unawaited(startSave(createArmStore(), wired.steps, OPTIONS))
    await advanceTimers(0)

    const record = await stored(wired)
    expect(record?.prepared).toEqual(wired.prepared)
    expect(record?.requestId).toEqual(expect.any(String))
    expect(record?.claimedAt).toEqual(expect.any(Number))
    expect(record?.transactionHash).toBeUndefined()
    expect(wired.port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(wired.port.sendAccountBatch.mock.calls[0][4]).toBe(record?.requestId)
    const claimedAt = writes.mock.invocationCallOrder[0]
    expect(Math.max(...wired.reads.nativeBalance.mock.invocationCallOrder)).toBeLessThan(claimedAt)
    expect(wired.port.sendAccountBatch.mock.invocationCallOrder[0]).toBeGreaterThan(claimedAt)
    sign.release(TX_HASH)
  })

  it('writes the hash and the start block into the stored save when the wallet answers the hash', async () => {
    const wired = wireSave(account, script())
    const receipt = held<ReturnType<typeof landedReceipt>>()
    wired.receipts.wait.mockImplementationOnce(() => receipt.promise)
    const store = createArmStore()
    const running = startSave(store, wired.steps, OPTIONS)
    await advanceTimers(0)

    const record = await stored(wired)
    expect(record?.transactionHash).toBe(TX_HASH)
    expect(record?.startBlock).toBe(START_BLOCK)
    expect(store.state().requestId).toBe(record?.requestId)

    receipt.release(landedReceipt())
    await advanceTimers(SHORT_TIMEOUT_MS)
    await running
    expect(isSaved(store.state())).toBe(true)
    expect(await stored(wired)).toBeUndefined()
  })

  it('reads a claim that throws as never sent, with the retry, and sends nothing', async () => {
    const wired = wireSave(account, script())
    jest.spyOn(wired.storage, 'get').mockRejectedValueOnce(new Error('storage unavailable'))
    const store = createArmStore()
    await startSave(store, wired.steps, OPTIONS)

    expect(store.state().write.status).toBe('failedNotSent')
    expect(canRetry(store.state().write)).toBe(true)
    expect(wired.port.sendAccountBatch).not.toHaveBeenCalled()
    expect(await stored(wired)).toBeUndefined()

    const retry = startSave(store, wired.steps, OPTIONS)
    await advanceTimers(SHORT_TIMEOUT_MS)
    await retry
    expect(wired.port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(isSaved(store.state())).toBe(true)
  })

  it('sends once where two pages press Save together over one storage; the other follows the first to saved', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    const one = wireSave(account, script(), { storage, requests })
    const two = wireSave(account, script(), { storage, requests })
    const signs = [one, two].map((page) => {
      const sign = held<typeof TX_HASH>()
      page.port.sendAccountBatch.mockImplementationOnce(() => sign.promise)
      return sign
    })
    const stores = [createArmStore(), createArmStore()]
    const runs = [
      startSave(stores[0], one.steps, OPTIONS),
      startSave(stores[1], two.steps, OPTIONS)
    ]
    await advanceTimers(0)

    const sends =
      one.port.sendAccountBatch.mock.calls.length + two.port.sendAccountBatch.mock.calls.length
    expect(sends).toBe(1)
    const winner = one.port.sendAccountBatch.mock.calls.length === 1 ? 0 : 1
    const loser = 1 - winner
    const record = await stored(one)
    expect(stores[loser].state().requestId).toBe(record?.requestId)
    expect(stores[loser].state().write.status).toBe('submitting')

    // The winner's request waits in the wallet's window, then the wallet broadcasts it.
    requests.queued = [record!.requestId]
    await advanceTimers(FOLLOW_REREAD_MS)
    expect(stores[loser].state().follow).toBe('queued')
    signs[winner].release(TX_HASH)
    requests.queued = []
    requests.activity = [operationFor(record!.requestId, { hash: TX_HASH })]
    requests.pushQueue()
    await advanceTimers(SHORT_TIMEOUT_MS)
    await Promise.all(runs)

    expect(stores.map((store) => isSaved(store.state()))).toEqual([true, true])
    expect(
      one.port.sendAccountBatch.mock.calls.length + two.port.sendAccountBatch.mock.calls.length
    ).toBe(1)
    expect([one, two][loser].prepareCommitSetup).toHaveBeenCalledTimes(1)
    expect(await stored(one)).toBeUndefined()
  })

  it('sends nothing on a start that loses the claim to a save another page stored, and follows that save under its hash', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    const { record } = await firstPageLeaves(storage, requests, { withHash: true })
    const page = wireSave(account, script(), { storage, requests })
    const store = createArmStore()

    const running = startSave(store, page.steps, OPTIONS)
    await advanceTimers(SHORT_TIMEOUT_MS)
    await running

    expect(page.port.sendAccountBatch).not.toHaveBeenCalled()
    expect(page.receipts.wait).toHaveBeenCalledWith(TX_HASH, record.startBlock)
    expect(isSaved(store.state())).toBe(true)
    expect(page.confirmSetup).toHaveBeenCalledTimes(1)
    expect(page.saveSetup).toHaveBeenCalledTimes(1)
  })
})

describe('each way a run ends, against the stored save after it', () => {
  ENDINGS.forEach(({ named, overrides, record, arrange }) =>
    it(`${
      record === 'kept' ? 'keeps the' : record === 'absent' ? 'leaves no' : 'removes the'
    } stored save after ${named}`, async () => {
      const wired = wireSave(account, script(overrides))
      arrange?.(wired)
      const store = createArmStore()
      const claimed = jest.spyOn(wired.storage, 'set')
      const running = startSave(store, wired.steps, OPTIONS)
      await advanceTimers(RECEIPT_WAIT_MS + SHORT_TIMEOUT_MS)
      if (record !== 'kept') {
        await running
      }

      const after = await stored(wired)
      expect(after !== undefined).toBe(record === 'kept')
      expect(claimed.mock.calls.length > 0).toBe(record !== 'absent')
      expect(wired.port.sendAccountBatch.mock.calls.length).toBeLessThanOrEqual(1)
    })
  )
})

describe('the read of a stored save before the save is offered', () => {
  it('offers no Save after a read that failed, and a second read follows the stored save', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    await firstPageLeaves(storage, requests, { withHash: true })
    const page = secondPage(storage, requests)
    jest.spyOn(storage, 'get').mockRejectedValueOnce(new Error('storage unavailable'))

    await page.arrive()
    expect(page.store.state().lookup).toBe('failed')
    expect(offersSave(page.store)).toBe(false)

    unawaited(page.arrive())
    await advanceTimers(SHORT_TIMEOUT_MS)
    expect(isSaved(page.store.state())).toBe(true)
    expect(page.wired.port.sendAccountBatch).not.toHaveBeenCalled()
  })

  it('reads once per run held: a page that read none does not read again by itself', async () => {
    const page = secondPage(memoryStorage(), requestsFake())
    const reads = jest.spyOn(page.wired.storage, 'get')
    await page.arrive()
    await page.arrive()

    expect(offersSave(page.store)).toBe(true)
    expect(reads).toHaveBeenCalledTimes(1)
  })
})

describe('a page that finds a save stored under its hash', () => {
  it('offers no Save, sends nothing, waits for the same hash and reaches saved with one check and one wipe', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    const { record, first } = await firstPageLeaves(storage, requests, { withHash: true })
    const page = secondPage(storage, requests)
    const receipt = held<ReturnType<typeof landedReceipt>>()
    page.wired.receipts.wait.mockImplementationOnce(() => receipt.promise)

    const arriving = page.arrive()
    await advanceTimers(0)
    const { write } = page.store.state()
    expect(write.status === 'submitting' && write.transactionHash).toBe(TX_HASH)
    expect(armScreenOf(page.store.state())).toBe('run')
    expect(offersSave(page.store)).toBe(false)
    expect(page.wired.receipts.wait).toHaveBeenCalledWith(TX_HASH, record.startBlock)

    receipt.release(landedReceipt())
    await advanceTimers(SHORT_TIMEOUT_MS)
    await arriving

    expect(isSaved(page.store.state())).toBe(true)
    expect(page.wired.confirmSetup).toHaveBeenCalledTimes(1)
    expect(page.wired.confirmSetup).toHaveBeenCalledWith(page.wired.draft, record.prepared)
    expect(page.wired.saveSetup).toHaveBeenCalledTimes(1)
    expect(await stored(page.wired)).toBeUndefined()
    expect(page.wired.port.sendAccountBatch).not.toHaveBeenCalled()
    expect(page.wired.prepareCommitSetup).not.toHaveBeenCalled()
    expect(first.port.sendAccountBatch).toHaveBeenCalledTimes(1)
  })

  it('reads stalled past the wait limit, and check again takes up the same wait with no other opened', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    await firstPageLeaves(storage, requests, { withHash: true })
    const page = secondPage(storage, requests)
    const receipt = held<ReturnType<typeof landedReceipt>>()
    page.wired.receipts.wait.mockImplementationOnce(() => receipt.promise)

    unawaited(page.arrive())
    await advanceTimers(RECEIPT_WAIT_MS - 1)
    expect(page.store.state().stalled).toBeFalsy()
    await advanceTimers(1)
    expect(page.store.state().stalled).toBe(true)
    expect(await stored(page.wired)).toBeDefined()

    unawaited(checkReceiptAgain(page.store, page.wired.steps, OPTIONS))
    unawaited(checkReceiptAgain(page.store, page.wired.steps, OPTIONS))
    await advanceTimers(0)
    expect(page.wired.receipts.wait).toHaveBeenCalledTimes(1)
    receipt.release(landedReceipt())
    await advanceTimers(SHORT_TIMEOUT_MS)

    expect(isSaved(page.store.state())).toBe(true)
    expect(page.wired.confirmSetup).toHaveBeenCalledTimes(1)
    expect(page.wired.saveSetup).toHaveBeenCalledTimes(1)
    expect(page.wired.port.sendAccountBatch).not.toHaveBeenCalled()
  })

  it('releases the stored save where the followed transaction reverted, and then offers the retry', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    await firstPageLeaves(storage, requests, { withHash: true })
    const page = secondPage(storage, requests)
    page.wired.receipts.wait.mockRejectedValueOnce(
      Object.assign(new Error('reverted'), {
        code: 'CALL_EXCEPTION',
        receipt: { hash: TX_HASH, status: 0, blockNumber: START_BLOCK + 1 }
      })
    )

    await page.arrive()

    expect(page.store.state().write.status).toBe('failedReverted')
    expect(canRetry(page.store.state().write)).toBe(true)
    expect(await stored(page.wired)).toBeUndefined()
    expect(page.wired.saveSetup).not.toHaveBeenCalled()
  })
})

describe('a page that finds a save stored with no hash', () => {
  /** The first page went away before the wallet answered the hash; a second page arrives. */
  const arriveWithNoHash = async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    const { record } = await firstPageLeaves(storage, requests, { withHash: false })
    const page = secondPage(storage, requests)
    return { ...page, requests, record }
  }

  /** How many times the page read the account's activity. */
  const activityReads = (requests: RequestsFake) =>
    requests.dispatch.mock.calls.filter(
      ([action]) => action.type === 'MAIN_CONTROLLER_ACTIVITY_SET_ACC_OPS_FILTERS'
    ).length

  it('shows the save waiting while the wallet queue holds the request, offers no Save, and reads again when the queue changes', async () => {
    const { store, wired, arrive, requests, record } = await arriveWithNoHash()
    requests.queued = [record.requestId]

    unawaited(arrive())
    await advanceTimers(0)
    expect(store.state().write.status).toBe('submitting')
    expect(store.state().follow).toBe('queued')
    expect(offersSave(store)).toBe(false)

    requests.queued = []
    requests.activity = [operationFor(record.requestId, { hash: TX_HASH })]
    requests.pushQueue()
    await advanceTimers(SHORT_TIMEOUT_MS)

    expect(isSaved(store.state())).toBe(true)
    expect(wired.confirmSetup).toHaveBeenCalledTimes(1)
    expect(wired.saveSetup).toHaveBeenCalledTimes(1)
    expect(wired.port.sendAccountBatch).not.toHaveBeenCalled()
  })

  it('reads a queued request again after its rest where the queue does not change', async () => {
    const { store, wired, arrive, requests, record } = await arriveWithNoHash()
    requests.queued = [record.requestId]
    unawaited(arrive())
    await advanceTimers(0)
    requests.queued = []
    requests.activity = [operationFor(record.requestId, { hash: TX_HASH })]

    await advanceTimers(FOLLOW_REREAD_MS - 1)
    expect(store.state().follow).toBe('queued')
    await advanceTimers(1 + SHORT_TIMEOUT_MS)

    expect(isSaved(store.state())).toBe(true)
    expect(wired.port.sendAccountBatch).not.toHaveBeenCalled()
  })

  it('stores the hash of a broadcast request, follows it, and reaches saved with one check and one wipe', async () => {
    const { store, wired, arrive, requests, record } = await arriveWithNoHash()
    requests.activity = [
      operationFor(record.requestId, { hash: TX_HASH, status: AccountOpStatus.BroadcastButStuck })
    ]
    const receipt = held<ReturnType<typeof landedReceipt>>()
    wired.receipts.wait.mockImplementationOnce(() => receipt.promise)

    const arriving = arrive()
    await advanceTimers(0)
    const marked = await stored(wired)
    expect(marked?.transactionHash).toBe(TX_HASH)
    expect(marked?.startBlock).toBe(START_BLOCK)
    expect(wired.receipts.wait).toHaveBeenCalledWith(TX_HASH, START_BLOCK)

    receipt.release(landedReceipt())
    await advanceTimers(SHORT_TIMEOUT_MS)
    await arriving
    expect(isSaved(store.state())).toBe(true)
    expect(wired.confirmSetup).toHaveBeenCalledTimes(1)
    expect(wired.saveSetup).toHaveBeenCalledTimes(1)
    expect(wired.port.sendAccountBatch).not.toHaveBeenCalled()
  })

  it('reads a request the wallet cannot follow as a save that may still land: no retry, the record kept, and check again leads to the check', async () => {
    const { store, wired, arrive, requests, record } = await arriveWithNoHash()
    requests.activity = [operationFor(record.requestId, { untracked: true })]

    await arrive()
    expect(mayStillLand(store.state().write)).toBe(true)
    expect(canRetry(store.state().write)).toBe(false)
    expect(await stored(wired)).toBeDefined()

    await startSave(store, wired.steps, OPTIONS)
    expect(wired.port.sendAccountBatch).not.toHaveBeenCalled()

    wired.setupState.mockResolvedValue(setupStateOf(true))
    const checking = checkSetupAgain(store, wired.steps, OPTIONS)
    await advanceTimers(SHORT_TIMEOUT_MS)
    await checking
    expect(isSaved(store.state())).toBe(true)
    expect(wired.confirmSetup).toHaveBeenCalledWith(wired.draft, record.prepared)
    expect(await stored(wired)).toBeUndefined()
  })

  it('keeps the record and offers no Save while the activity does not answer, never reading it as gone, and check again reads at once', async () => {
    const { store, wired, arrive, requests } = await arriveWithNoHash()
    requests.activity = null

    unawaited(arrive())
    await advanceTimers(0)
    expect(store.state().follow).toBeUndefined()
    await advanceTimers(10_000)
    expect(store.state().follow).toBe('unread')

    await advanceTimers(10 * GONE_GRACE_MS)
    expect(store.state().follow).toBe('unread')
    expect(store.state().write.status).toBe('submitting')
    expect(offersSave(store)).toBe(false)
    expect(await stored(wired)).toBeDefined()
    expect(wired.setupState).not.toHaveBeenCalled()

    const reads = activityReads(requests)
    unawaited(checkReceiptAgain(store, wired.steps, OPTIONS))
    await advanceTimers(0)
    expect(activityReads(requests)).toBe(reads + 1)
    expect(wired.port.sendAccountBatch).not.toHaveBeenCalled()
  })

  it('runs the check as after a receipt where the request is gone and the account holds a setup, and reads saved with no hash', async () => {
    const { store, wired, arrive, record } = await arriveWithNoHash()
    wired.setupState.mockResolvedValue(setupStateOf(true))

    const arriving = arrive()
    await advanceTimers(SHORT_TIMEOUT_MS)
    await arriving

    expect(isSaved(store.state())).toBe(true)
    expect(store.state().write.status).toBe('submitting')
    expect(store.state().landedUnseen).toBe(true)
    expect(wired.confirmSetup).toHaveBeenCalledTimes(1)
    expect(wired.confirmSetup).toHaveBeenCalledWith(wired.draft, record.prepared)
    expect(wired.saveSetup).toHaveBeenCalledTimes(1)
    expect(await stored(wired)).toBeUndefined()
    expect(wired.port.sendAccountBatch).not.toHaveBeenCalled()
  })

  it('keeps reading a gone request with no setup until the grace period, then releases it and offers Save again', async () => {
    const { store, wired, arrive } = await arriveWithNoHash()

    const arriving = arrive()
    await advanceTimers(GONE_GRACE_MS - 1)
    expect(store.state().follow).toBe('gone')
    expect(store.state().write.status).toBe('submitting')
    expect(offersSave(store)).toBe(false)
    expect(await stored(wired)).toBeDefined()

    await advanceTimers(1)
    await arriving
    expect(offersSave(store)).toBe(true)
    expect(armScreenOf(store.state())).toBe('arrival')
    expect(await stored(wired)).toBeUndefined()
    expect(wired.port.sendAccountBatch).not.toHaveBeenCalled()

    // Save is a fresh start: it reads the setup, prepares and sends once.
    const saving = startSave(store, wired.steps, OPTIONS)
    await advanceTimers(SHORT_TIMEOUT_MS)
    await saving
    expect(wired.port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(isSaved(store.state())).toBe(true)
  })

  it('counts the grace from the first gone reading again after the queue held the request between two', async () => {
    const { store, wired, arrive, requests, record } = await arriveWithNoHash()

    unawaited(arrive())
    await advanceTimers(0)
    expect(store.state().follow).toBe('gone')
    requests.queued = [record.requestId]
    await advanceTimers(GONE_GRACE_MS + FOLLOW_REREAD_MS)
    expect(store.state().follow).toBe('queued')

    requests.queued = []
    requests.pushQueue()
    await advanceTimers(0)
    expect(store.state().follow).toBe('gone')
    await advanceTimers(GONE_GRACE_MS - FOLLOW_REREAD_MS)
    expect(store.state().follow).toBe('gone')
    expect(await stored(wired)).toBeDefined()

    await advanceTimers(FOLLOW_REREAD_MS)
    expect(offersSave(store)).toBe(true)
    expect(await stored(wired)).toBeUndefined()
  })

  it('does not void on a gone reading between two readings that did not answer', async () => {
    const { store, wired, arrive, requests } = await arriveWithNoHash()
    requests.activity = null
    unawaited(arrive())
    await advanceTimers(10_000)
    expect(store.state().follow).toBe('unread')

    requests.activity = []
    await advanceTimers(FOLLOW_REREAD_MS)
    expect(store.state().follow).toBe('gone')
    requests.activity = null
    await advanceTimers(FOLLOW_REREAD_MS + 10_000)
    expect(store.state().follow).toBe('unread')

    await advanceTimers(GONE_GRACE_MS)
    expect(offersSave(store)).toBe(false)
    expect(await stored(wired)).toBeDefined()
  })

  it('keeps the record where the setup read of a gone request fails, and never voids on it', async () => {
    const { store, wired, arrive } = await arriveWithNoHash()
    wired.setupState.mockRejectedValue(nodeError())

    unawaited(arrive())
    await advanceTimers(3 * GONE_GRACE_MS)

    expect(offersSave(store)).toBe(false)
    expect(store.state().write.status).toBe('submitting')
    expect(await stored(wired)).toBeDefined()
  })
})

describe('the setup read after the claim', () => {
  it("sends nothing where another page's save landed, and its stored save left, during this page's gas check: the claim is released and the run ends as already set up", async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    let onChain = false
    const first = wireSave(account, script(), { storage, requests })
    const second = wireSave(account, script(), { storage, requests })
    ;[first, second].forEach((page) =>
      page.setupState.mockImplementation(async () => setupStateOf(onChain))
    )
    first.receipts.wait.mockImplementation(async (hash) => {
      onChain = true
      return landedReceipt(hash)
    })
    const gas = held<bigint>()
    second.reads.nativeBalance.mockImplementationOnce(() => gas.promise)

    // The second page reads no stored save and no setup, and offers Save; Save starts its run.
    const store = createArmStore()
    await lookForSave(store, second.steps, OPTIONS)
    expect(offersSave(store)).toBe(true)
    const running = startSave(store, second.steps, OPTIONS)
    await advanceTimers(0)
    expect(store.state().write.status).toBe('checkingGas')
    expect(second.setupState).toHaveBeenCalledTimes(1)

    // Meanwhile the first page's save lands, its check agrees, and its wipe takes the stored save.
    const firstStore = createArmStore()
    const firstRun = startSave(firstStore, first.steps, OPTIONS)
    await advanceTimers(SHORT_TIMEOUT_MS)
    await firstRun
    expect(isSaved(firstStore.state())).toBe(true)
    expect(await stored(first)).toBeUndefined()
    const writes = jest.spyOn(storage, 'set')
    const removals = jest.spyOn(storage, 'remove')

    gas.release(10n ** 18n)
    await advanceTimers(SHORT_TIMEOUT_MS)
    await running

    // The second page's claim found no record and was written, then released.
    expect(writes).toHaveBeenCalledTimes(1)
    expect(removals).toHaveBeenCalledTimes(1)
    expect(second.setupState).toHaveBeenCalledTimes(2)
    expect(second.setupState.mock.invocationCallOrder[1]).toBeGreaterThan(
      writes.mock.invocationCallOrder[0]
    )
    expect(store.state().stop).toBe('already-set-up')
    expect(armScreenOf(store.state())).toBe('already-set-up')
    expect(store.state().requestId).toBeUndefined()
    expect(second.port.sendAccountBatch).not.toHaveBeenCalled()
    expect(first.port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(second.confirmSetup).not.toHaveBeenCalled()
    expect(second.saveSetup).not.toHaveBeenCalled()
    expect(await stored(second)).toBeUndefined()
  })

  it('reads a setup read after the claim that throws as never sent, with the claim released and nothing sent, and the retry sends once', async () => {
    const wired = wireSave(account, script())
    wired.setupState
      .mockResolvedValueOnce(setupStateOf(false))
      .mockRejectedValueOnce(new Error('the node did not answer the setup read'))
    const removals = jest.spyOn(wired.storage, 'remove')
    const store = createArmStore()

    await startSave(store, wired.steps, OPTIONS)

    expect(store.state().write.status).toBe('failedNotSent')
    expect(canRetry(store.state().write)).toBe(true)
    expect(mayStillLand(store.state().write)).toBe(false)
    expect(store.state().requestId).toBeUndefined()
    expect(wired.port.sendAccountBatch).not.toHaveBeenCalled()
    expect(removals).toHaveBeenCalledTimes(1)
    expect(await stored(wired)).toBeUndefined()

    const retry = startSave(store, wired.steps, OPTIONS)
    await advanceTimers(SHORT_TIMEOUT_MS)
    await retry
    expect(wired.port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(isSaved(store.state())).toBe(true)
    expect(await stored(wired)).toBeUndefined()
  })
})

/** The first page went away before the wallet answered the hash; another page's screen follows the save it stored. */
const followWithNoHash = async () => {
  const storage = memoryStorage()
  const { record } = await firstPageLeaves(storage, requestsFake(), { withHash: false })
  return { storage, record }
}

/** A screen's steps over the device's storage and the wallet's queue and activity as that screen reads them. */
const screenOver = (storage: MemoryStorage, requests: RequestsFake) =>
  wireSave(account, script(), { storage, requests })

/** Counts the subscriptions to the wallet's pushes that are still open. */
const openSubscriptions = (requests: RequestsFake) => {
  let open = 0
  const subscribe = requests.subscribe.bind(requests)
  jest.spyOn(requests, 'subscribe').mockImplementation((listener) => {
    open += 1
    const unsubscribe = subscribe(listener)
    let closed = false
    return () => {
      if (!closed) {
        closed = true
        open -= 1
      }
      unsubscribe()
    }
  })
  return () => open
}

describe('a follow with no hash whose screen went away', () => {
  it('pauses while the request was queued at the unmount, reads, voids and releases nothing far past the grace, and on the next screen reads the live queue to saved', async () => {
    const { storage, record } = await followWithNoHash()
    const gone = requestsFake()
    gone.queued = [record.requestId]
    const subscriptions = openSubscriptions(gone)
    const before = screenOver(storage, gone)
    const reads = jest.spyOn(before.steps, 'requestState')
    const store = createArmStore()
    unawaited(lookForSave(store, before.steps, OPTIONS))
    await advanceTimers(0)
    expect(store.state().follow).toBe('queued')

    // The screen unmounts: its queue stays as it was, the request in it.
    detachSteps(before.steps)
    const readsAtUnmount = reads.mock.calls.length
    const removals = jest.spyOn(storage, 'remove')
    await advanceTimers(10 * GONE_GRACE_MS)

    expect(reads).toHaveBeenCalledTimes(readsAtUnmount)
    expect(store.state().write.status).toBe('submitting')
    expect(store.state().requestId).toBe(record.requestId)
    expect(store.state().landedUnseen).toBeUndefined()
    expect(removals).not.toHaveBeenCalled()
    expect((await stored(before))?.transactionHash).toBeUndefined()
    expect(before.setupState).not.toHaveBeenCalled()
    // Nothing of the paused follow is left running.
    expect(jest.getTimerCount()).toBe(0)
    expect(subscriptions()).toBe(0)

    // The wallet broadcast it meanwhile; the next screen reads its own live queue and activity.
    const live = requestsFake()
    live.activity = [operationFor(record.requestId, { hash: TX_HASH })]
    const after = screenOver(storage, live)
    unawaited(attachSteps(store, after.steps, OPTIONS))
    await advanceTimers(SHORT_TIMEOUT_MS)

    expect(isSaved(store.state())).toBe(true)
    expect(after.receipts.wait).toHaveBeenCalledWith(TX_HASH, START_BLOCK)
    expect(after.confirmSetup).toHaveBeenCalledTimes(1)
    expect(after.saveSetup).toHaveBeenCalledTimes(1)
    expect(before.confirmSetup).not.toHaveBeenCalled()
    expect(before.saveSetup).not.toHaveBeenCalled()
    expect(reads).toHaveBeenCalledTimes(readsAtUnmount)
    expect(await stored(after)).toBeUndefined()
    expect(after.port.sendAccountBatch).not.toHaveBeenCalled()
    expect(before.port.sendAccountBatch).not.toHaveBeenCalled()
  })

  it('pauses while the request was not yet queued at the unmount, voids nothing far past the grace, and on the next screen follows it queued, then broadcast, to saved', async () => {
    const { storage, record } = await followWithNoHash()
    const gone = requestsFake()
    const subscriptions = openSubscriptions(gone)
    const before = screenOver(storage, gone)
    const reads = jest.spyOn(before.steps, 'requestState')
    const store = createArmStore()
    unawaited(lookForSave(store, before.steps, OPTIONS))
    await advanceTimers(0)
    expect(store.state().follow).toBe('gone')

    detachSteps(before.steps)
    const readsAtUnmount = reads.mock.calls.length
    const setupReadsAtUnmount = before.setupState.mock.calls.length
    const removals = jest.spyOn(storage, 'remove')
    await advanceTimers(10 * GONE_GRACE_MS)

    expect(reads).toHaveBeenCalledTimes(readsAtUnmount)
    expect(before.setupState).toHaveBeenCalledTimes(setupReadsAtUnmount)
    expect(store.state().write.status).toBe('submitting')
    expect(store.state().requestId).toBe(record.requestId)
    expect(offersSave(store)).toBe(false)
    expect(removals).not.toHaveBeenCalled()
    expect(await stored(before)).toBeDefined()
    expect(jest.getTimerCount()).toBe(0)
    expect(subscriptions()).toBe(0)

    // The wallet took the request in late; the next screen finds it queued, then broadcast.
    const live = requestsFake()
    live.queued = [record.requestId]
    const after = screenOver(storage, live)
    unawaited(attachSteps(store, after.steps, OPTIONS))
    await advanceTimers(0)
    expect(store.state().follow).toBe('queued')

    live.queued = []
    live.activity = [operationFor(record.requestId, { hash: TX_HASH })]
    live.pushQueue()
    await advanceTimers(SHORT_TIMEOUT_MS)

    expect(isSaved(store.state())).toBe(true)
    expect(after.confirmSetup).toHaveBeenCalledTimes(1)
    expect(after.saveSetup).toHaveBeenCalledTimes(1)
    expect(before.confirmSetup).not.toHaveBeenCalled()
    expect(after.port.sendAccountBatch).not.toHaveBeenCalled()
  })

  it('counts the grace again from the first gone reading after the next screen took the follow up', async () => {
    const { storage, record } = await followWithNoHash()
    const before = screenOver(storage, requestsFake())
    const store = createArmStore()
    unawaited(lookForSave(store, before.steps, OPTIONS))
    await advanceTimers(0)
    expect(store.state().follow).toBe('gone')
    detachSteps(before.steps)
    await advanceTimers(10 * GONE_GRACE_MS)

    const after = screenOver(storage, requestsFake())
    unawaited(attachSteps(store, after.steps, OPTIONS))
    await advanceTimers(GONE_GRACE_MS - 1)
    expect(store.state().follow).toBe('gone')
    expect(store.state().requestId).toBe(record.requestId)
    expect(await stored(after)).toBeDefined()

    await advanceTimers(1)
    expect(offersSave(store)).toBe(true)
    expect(await stored(after)).toBeUndefined()
    expect(after.port.sendAccountBatch).not.toHaveBeenCalled()
  })
})

describe('a follower checks with the draft the stored save sent', () => {
  /** A second page whose own setup records now hold another draft than the one the first page sent. */
  const pageWithAnotherDraft = (storage: MemoryStorage, requests: RequestsFake) => {
    const page = wireSave(account, script({ backup: 'clear' }), { storage, requests })
    expect(page.draft).not.toEqual(draftOf('encrypted'))
    return page
  }

  const FOLLOWS: {
    named: string
    withHash: boolean
    arrange: (requestId: string, page: WiredSave, requests: RequestsFake) => void
  }[] = [
    { named: 'under its hash', withHash: true, arrange: () => {} },
    {
      named: 'with no hash, broadcast',
      withHash: false,
      arrange: (requestId, _page, requests) => {
        // eslint-disable-next-line no-param-reassign
        requests.activity = [operationFor(requestId, { hash: TX_HASH })]
      }
    },
    {
      named: 'with no hash, gone with a setup on the account',
      withHash: false,
      arrange: (_requestId, page) => {
        page.setupState.mockResolvedValue(setupStateOf(true))
      }
    }
  ]

  FOLLOWS.forEach(({ named, withHash, arrange }) =>
    it(`checks ${named} with the sent draft and prepared write, reads agreed and wipes`, async () => {
      const storage = memoryStorage()
      const requests = requestsFake()
      const { record } = await firstPageLeaves(storage, requests, { withHash })
      expect(record.draft).toEqual(draftOf('encrypted'))
      const page = pageWithAnotherDraft(storage, requests)
      arrange(record.requestId, page, requests)
      const store = createArmStore()

      const arriving = lookForSave(store, page.steps, OPTIONS)
      await advanceTimers(SHORT_TIMEOUT_MS)
      await arriving

      expect(page.confirmSetup).toHaveBeenCalledTimes(1)
      expect(page.confirmSetup).toHaveBeenCalledWith(record.draft, record.prepared)
      expect(isSaved(store.state())).toBe(true)
      expect(page.saveSetup).toHaveBeenCalledTimes(1)
      expect(await stored(page)).toBeUndefined()
      expect(page.port.sendAccountBatch).not.toHaveBeenCalled()
    })
  )

  it('stores at the claim the draft the save commits, with its shape note rebuilt, and a follower checks with that draft', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    const stale = shapeNoteOf({ clauses: [], wait: 1n, ignoresPause: true })
    const first = wireSave(account, script({ publicMetadata: stale }), { storage, requests })
    first.receipts.wait.mockImplementation(() => pending())
    unawaited(startSave(createArmStore(), first.steps, OPTIONS))
    await advanceTimers(0)
    const record = await stored(first)
    const committed = committedDraftOf(first.draft)
    expect(committed).not.toEqual(first.draft)
    expect(record?.draft).toEqual(committed)

    const page = secondPage(storage, requests)
    const arriving = page.arrive()
    await advanceTimers(SHORT_TIMEOUT_MS)
    await arriving
    expect(page.wired.confirmSetup).toHaveBeenCalledWith(committed, record?.prepared)
    expect(isSaved(page.store.state())).toBe(true)
  })

  it('checks with the sent draft on a start that lost the claim, not with the draft it prepared itself', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    const { record } = await firstPageLeaves(storage, requests, { withHash: true })
    const page = pageWithAnotherDraft(storage, requests)
    const store = createArmStore()

    const running = startSave(store, page.steps, OPTIONS)
    await advanceTimers(SHORT_TIMEOUT_MS)
    await running

    expect(page.prepareCommitSetup).toHaveBeenCalledWith(page.draft, undefined)
    expect(page.confirmSetup).toHaveBeenCalledTimes(1)
    expect(page.confirmSetup).toHaveBeenCalledWith(record.draft, record.prepared)
    expect(isSaved(store.state())).toBe(true)
    expect(page.saveSetup).toHaveBeenCalledTimes(1)
    expect(page.port.sendAccountBatch).not.toHaveBeenCalled()
  })
})

describe('the read of the stored save after a void', () => {
  it('releases the void save before it reads again, and follows the save another page claimed meanwhile, with no Save offered', async () => {
    const { storage, record } = await followWithNoHash()
    const requests = requestsFake()
    const page = screenOver(storage, requests)
    const other = screenOver(storage, requests)
    const store = createArmStore()
    const seen: string[] = []
    const steps: SaveSteps = {
      ...page.steps,
      readInFlight: () => {
        seen.push('read')
        return page.steps.readInFlight()
      },
      release: async (requestId) => {
        const { write, lookup, requestId: claim } = store.state()
        seen.push(`release while ${write.status}, lookup ${lookup}, claim ${claim}`)
        await page.steps.release(requestId)
        // Another page claims under a new id between the release and the next read.
        requests.queued = ['claimed meanwhile']
        await other.steps.claim(
          { draft: other.draft, prepared: other.prepared, calls: [] },
          'claimed meanwhile',
          START_BLOCK
        )
      }
    }

    unawaited(lookForSave(store, steps, OPTIONS))
    await advanceTimers(GONE_GRACE_MS)

    expect(seen).toEqual(['read', 'release while idle, lookup undefined, claim undefined', 'read'])
    expect(store.state().requestId).toBe('claimed meanwhile')
    expect(store.state().write.status).toBe('submitting')
    expect(store.state().follow).toBe('queued')
    expect(offersSave(store)).toBe(false)
    expect((await stored(page))?.requestId).toBe('claimed meanwhile')
    expect(record.requestId).not.toBe('claimed meanwhile')
    expect(page.port.sendAccountBatch).not.toHaveBeenCalled()
  })

  it('offers no Save between the void and the read that answers none, then offers it', async () => {
    const { storage } = await followWithNoHash()
    const page = screenOver(storage, requestsFake())
    const second = held<Awaited<ReturnType<SaveSteps['readInFlight']>>>()
    let readsMade = 0
    const steps: SaveSteps = {
      ...page.steps,
      readInFlight: () => {
        readsMade += 1
        return readsMade === 1 ? page.steps.readInFlight() : second.promise
      }
    }
    const store = createArmStore()

    unawaited(lookForSave(store, steps, OPTIONS))
    await advanceTimers(GONE_GRACE_MS)

    expect(readsMade).toBe(2)
    expect(store.state().write.status).toBe('idle')
    expect(store.state().lookup).toBe('reading')
    expect(offersSave(store)).toBe(false)
    expect(await stored(page)).toBeUndefined()

    second.release(await page.steps.readInFlight())
    await advanceTimers(0)
    expect(offersSave(store)).toBe(true)
  })
})

describe('the age of the claim before a void', () => {
  it('does not void a claim younger than the grace, though the gone readings since an earlier first reading ran past it', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    const owner = screenOver(storage, requests)
    // A claim whose time reads later than this page's first gone reading.
    const claimedAt = Date.now() + GONE_GRACE_MS / 2
    await owner.inFlight.claim({
      draft: owner.draft,
      prepared: owner.prepared,
      requestId: 'younger claim',
      claimedAt
    })
    const page = secondPage(storage, requests)

    unawaited(page.arrive())
    await advanceTimers(0)
    expect(page.store.state().follow).toBe('gone')
    await advanceTimers(GONE_GRACE_MS)

    expect(page.store.state().requestId).toBe('younger claim')
    expect(offersSave(page.store)).toBe(false)
    expect(await stored(page.wired)).toBeDefined()

    await advanceTimers(claimedAt + GONE_GRACE_MS - Date.now() - 1)
    expect(await stored(page.wired)).toBeDefined()
    await advanceTimers(FOLLOW_REREAD_MS)
    expect(offersSave(page.store)).toBe(true)
    expect(await stored(page.wired)).toBeUndefined()
  })

  it('counts the grace again from the first gone reading after a reading that did not answer', async () => {
    const { storage } = await followWithNoHash()
    const requests = requestsFake()
    const page = secondPage(storage, requests)
    unawaited(page.arrive())
    await advanceTimers(0)
    expect(page.store.state().follow).toBe('gone')

    // Gone for most of the grace, then one reading that does not answer.
    await advanceTimers(GONE_GRACE_MS - 2 * FOLLOW_REREAD_MS)
    requests.activity = null
    while (page.store.state().follow !== 'unread') {
      // eslint-disable-next-line no-await-in-loop
      await advanceTimers(1_000)
    }
    requests.activity = []
    while (page.store.state().follow !== 'gone') {
      // eslint-disable-next-line no-await-in-loop
      await advanceTimers(1_000)
    }
    const countFrom = Date.now()

    await advanceTimers(GONE_GRACE_MS - 1_000)
    expect(page.store.state().follow).toBe('gone')
    expect(offersSave(page.store)).toBe(false)
    expect(await stored(page.wired)).toBeDefined()

    await advanceTimers(countFrom + GONE_GRACE_MS + FOLLOW_REREAD_MS - Date.now())
    expect(offersSave(page.store)).toBe(true)
    expect(await stored(page.wired)).toBeUndefined()
  })
})

describe('the start block stored with the claim', () => {
  it('stores the block read just before the claim, and keeps it when the hash is written', async () => {
    const wired = wireSave(account, script())
    wired.receipts.blockNumber.mockResolvedValueOnce(START_BLOCK + 5)
    const sign = held<typeof TX_HASH>()
    wired.port.sendAccountBatch.mockImplementationOnce(() => sign.promise)
    wired.receipts.wait.mockImplementation(() => pending())
    const writes = jest.spyOn(wired.storage, 'set')
    unawaited(startSave(createArmStore(), wired.steps, OPTIONS))
    await advanceTimers(0)

    const claimed = await stored(wired)
    expect(claimed?.startBlock).toBe(START_BLOCK + 5)
    expect(claimed?.transactionHash).toBeUndefined()
    const [blockRead] = wired.receipts.blockNumber.mock.invocationCallOrder
    expect(blockRead).toBeGreaterThan(
      Math.max(...wired.reads.nativeBalance.mock.invocationCallOrder)
    )
    expect(blockRead).toBeLessThan(writes.mock.invocationCallOrder[0])

    // The send reads its own block; the stored save keeps the claim's.
    sign.release(TX_HASH)
    await advanceTimers(0)
    const marked = await stored(wired)
    expect(marked?.transactionHash).toBe(TX_HASH)
    expect(marked?.startBlock).toBe(START_BLOCK + 5)
  })

  it("stores a claim with no block where the block read fails, then the hash with the send's block", async () => {
    const wired = wireSave(account, script())
    wired.receipts.blockNumber.mockRejectedValueOnce(nodeError())
    const sign = held<typeof TX_HASH>()
    wired.port.sendAccountBatch.mockImplementationOnce(() => sign.promise)
    wired.receipts.wait.mockImplementation(() => pending())
    unawaited(startSave(createArmStore(), wired.steps, OPTIONS))
    await advanceTimers(0)

    const claimed = await stored(wired)
    expect(claimed).toBeDefined()
    expect(claimed?.startBlock).toBeUndefined()
    expect(wired.port.sendAccountBatch).toHaveBeenCalledTimes(1)

    sign.release(TX_HASH)
    await advanceTimers(0)
    const marked = await stored(wired)
    expect(marked?.transactionHash).toBe(TX_HASH)
    expect(marked?.startBlock).toBe(START_BLOCK)
  })

  it("waits, as a follower of a broadcast request, from the claim's block, which its hash write keeps", async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    const first = wireSave(account, script(), { storage, requests })
    first.receipts.blockNumber.mockResolvedValue(START_BLOCK - 7)
    first.port.sendAccountBatch.mockImplementation(() => pending())
    unawaited(startSave(createArmStore(), first.steps, OPTIONS))
    await advanceTimers(0)
    const record = await stored(first)
    expect(record?.startBlock).toBe(START_BLOCK - 7)

    requests.activity = [operationFor(record!.requestId, { hash: TX_HASH })]
    const page = secondPage(storage, requests)
    const receipt = held<ReturnType<typeof landedReceipt>>()
    page.wired.receipts.wait.mockImplementationOnce(() => receipt.promise)
    const arriving = page.arrive()
    await advanceTimers(0)

    const marked = await stored(page.wired)
    expect(marked?.transactionHash).toBe(TX_HASH)
    expect(marked?.startBlock).toBe(START_BLOCK - 7)
    expect(page.wired.receipts.wait).toHaveBeenCalledWith(TX_HASH, START_BLOCK - 7)

    receipt.release(landedReceipt())
    await advanceTimers(SHORT_TIMEOUT_MS)
    await arriving
    expect(isSaved(page.store.state())).toBe(true)
  })

  it('stores the hash a follower read where the claim holds no block and its own block read fails', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    const first = wireSave(account, script(), { storage, requests })
    first.receipts.blockNumber.mockRejectedValueOnce(nodeError())
    first.port.sendAccountBatch.mockImplementation(() => pending())
    unawaited(startSave(createArmStore(), first.steps, OPTIONS))
    await advanceTimers(0)
    const record = await stored(first)
    expect(record?.startBlock).toBeUndefined()

    requests.activity = [operationFor(record!.requestId, { hash: TX_HASH })]
    const page = secondPage(storage, requests)
    page.wired.receipts.blockNumber.mockRejectedValue(nodeError())
    page.wired.receipts.wait.mockImplementation(() => pending())
    unawaited(page.arrive())
    await advanceTimers(0)

    const marked = await stored(page.wired)
    expect(marked?.transactionHash).toBe(TX_HASH)
    expect(marked?.startBlock).toBeUndefined()
    expect(page.wired.port.sendAccountBatch).not.toHaveBeenCalled()
  })
})
