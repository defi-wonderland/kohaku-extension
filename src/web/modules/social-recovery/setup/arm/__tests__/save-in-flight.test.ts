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
import { canRetry, mayStillLand } from '@web/modules/social-recovery/shared/writes'

import {
  armScreenOf,
  checkReceiptAgain,
  checkSetupAgain,
  createArmStore,
  FOLLOW_REREAD_MS,
  GONE_GRACE_MS,
  isSaved,
  lookForSave,
  RECEIPT_WAIT_MS,
  startSave
} from '@web/modules/social-recovery/setup/arm'
import type { ArmStore } from '@web/modules/social-recovery/setup/arm'

import {
  advanceTimers,
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
