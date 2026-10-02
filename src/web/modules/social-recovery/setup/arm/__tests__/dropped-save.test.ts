/**
 * A save broadcast under its hash that the network dropped: an hour after
 * its broadcast, the node knows none of its transactions and the account
 * holds no setup. The page then reads dropped, and "save again" releases the
 * stored save and starts a new save through the ordinary start. Before the
 * hour, with a node that does not answer, or a stored save of another
 * request, nothing reads dropped and the stall and "check again" stay. Every
 * wait runs on Jest's fake clock, whose `Date.now` the records and the check
 * both read.
 */
import type { Account } from '@ambire-common/interfaces/account'
import type { Hex } from '@web/modules/social-recovery/sdk-interfaces'
import { recordKeys } from '@web/modules/social-recovery/shared/records'
import type { SaveInFlightRecord } from '@web/modules/social-recovery/shared/records'

import {
  armScreenOf,
  checkReceiptAgain,
  createArmStore,
  DROPPED_AFTER_MS,
  DROPPED_READ_MS,
  isLive,
  isSaved,
  lookForSave,
  outlivesScreen,
  RECEIPT_WAIT_MS,
  saveAgain,
  startSave
} from '@web/modules/social-recovery/setup/arm'
import type { ArmStore } from '@web/modules/social-recovery/setup/arm'
import { attachSteps, detachSteps } from '@web/modules/social-recovery/setup/arm/run'

import {
  advanceTimers,
  CHAIN_ID,
  HAPPY,
  landedReceipt,
  memoryStorage,
  nodeError,
  pending,
  requestsFake,
  SECOND_HASH,
  setupStateOf,
  SHORT_TIMEOUT_MS,
  smartAccount,
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
const MINUTE = 60 * 1000

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
  let fail: (error: unknown) => void = () => {}
  const promise = new Promise<T>((resolve, reject) => {
    release = resolve
    fail = reject
  })
  return { promise, release, fail }
}

const stored = async (wired: WiredSave) => {
  const read = await wired.inFlight.read()
  return read.status === 'present' ? read.value : undefined
}

/** Moves the clock without running a timer, as a tab that slept does. */
const passTime = (ms: number) => jest.setSystemTime(Date.now() + ms)

/** Writes the stored save in flight as another page or an older build of the wallet left it. */
const storeRecord = (storage: MemoryStorage, value: SaveInFlightRecord) =>
  storage.set(recordKeys.saveInFlight(CHAIN_ID, account.addr as Hex), {
    value,
    savedAt: Date.now()
  })

/**
 * The first page: it claims, sends and writes the hash, then goes away with
 * its receipt wait never answered. Answers the record it left.
 */
const firstPageSent = async (storage: MemoryStorage, requests: RequestsFake) => {
  const first = wireSave(account, script(), { storage, requests })
  first.receipts.wait.mockImplementation(() => pending())
  unawaited(startSave(createArmStore(), first.steps, OPTIONS))
  await advanceTimers(0)
  const record = await stored(first)
  expect(record?.transactionHash).toBe(TX_HASH)
  expect(record?.sentAt).toBe(Date.now())
  return { first, record: record! }
}

/** A page over the same storage whose node knows no transaction and whose account holds no setup. */
const pageOf = (storage: MemoryStorage, requests: RequestsFake) => {
  const wired = wireSave(account, script(), { storage, requests })
  wired.receipts.transactionKnown.mockResolvedValue('unknown')
  const store = createArmStore()
  return { wired, store, arrive: () => lookForSave(store, wired.steps, OPTIONS) }
}

type Page = ReturnType<typeof pageOf>

/** The first page sent and left; the hour may pass; then a second page arrives. */
const arriveAfter = async (ms: number) => {
  const storage = memoryStorage()
  const requests = requestsFake()
  const { record, first } = await firstPageSent(storage, requests)
  passTime(ms)
  const page = pageOf(storage, requests)
  return { storage, requests, record, first, page }
}

/** A page that follows the hash with its receipt wait held, stalled past the wait's limit. */
const stalledFollower = async (storage: MemoryStorage, requests: RequestsFake) => {
  const page = pageOf(storage, requests)
  const receipt = held<ReturnType<typeof landedReceipt>>()
  page.wired.receipts.wait.mockImplementationOnce(() => receipt.promise)
  unawaited(page.arrive())
  await advanceTimers(RECEIPT_WAIT_MS)
  expect(page.store.state().stalled).toBe(true)
  return { page, receipt }
}

const isDropped = (store: ArmStore) => store.state().dropped === true

const expectSubmittingUnder = (store: ArmStore, hash: Hex) => {
  const { write } = store.state()
  expect(write.status === 'submitting' && write.transactionHash).toBe(hash)
}

describe('a page that finds a save stored under its hash', () => {
  it('reads dropped at once an hour after the broadcast, with no receipt wait, the stored save kept and nothing sent', async () => {
    const { record, page } = await arriveAfter(DROPPED_AFTER_MS)

    await page.arrive()

    expect(isDropped(page.store)).toBe(true)
    expectSubmittingUnder(page.store, TX_HASH)
    expect(armScreenOf(page.store.state())).toBe('run')
    expect(page.wired.receipts.wait).not.toHaveBeenCalled()
    expect(page.wired.receipts.transactionKnown).toHaveBeenCalledWith(TX_HASH)
    expect(page.wired.setupState).toHaveBeenCalledTimes(1)
    expect(await stored(page.wired)).toEqual(record)
    expect(page.wired.port.sendAccountBatch).not.toHaveBeenCalled()
    expect(page.wired.prepareCommitSetup).not.toHaveBeenCalled()
    // A dropped save holds nothing in flight: the screen drops the run when it leaves.
    expect(isLive(page.store.state())).toBe(false)
    expect(outlivesScreen(page.store.state())).toBe(false)
  })

  it('reads nothing of the node or the setup before the hour, and waits for the receipt as before', async () => {
    const { page } = await arriveAfter(DROPPED_AFTER_MS - 1)
    page.wired.receipts.wait.mockImplementationOnce(() => pending())

    unawaited(page.arrive())
    await advanceTimers(0)

    expect(isDropped(page.store)).toBe(false)
    expect(page.wired.receipts.transactionKnown).not.toHaveBeenCalled()
    expect(page.wired.setupState).not.toHaveBeenCalled()
    expect(page.wired.receipts.wait).toHaveBeenCalledWith(TX_HASH, expect.any(Number))
  })

  it('never reads dropped where the node knows the transaction, however old the broadcast, and reads no setup', async () => {
    const { page } = await arriveAfter(100 * DROPPED_AFTER_MS)
    page.wired.receipts.transactionKnown.mockResolvedValue('known')
    page.wired.receipts.wait.mockImplementationOnce(() => pending())

    unawaited(page.arrive())
    await advanceTimers(RECEIPT_WAIT_MS)

    expect(isDropped(page.store)).toBe(false)
    expect(page.wired.receipts.transactionKnown).toHaveBeenCalledWith(TX_HASH)
    expect(page.wired.setupState).not.toHaveBeenCalled()
    expect(page.wired.receipts.wait).toHaveBeenCalledTimes(1)
    expect(page.store.state().stalled).toBe(true)
  })

  it('goes the landed way where the setup read finds a setup: one check, one wipe, saved, nothing sent', async () => {
    const { record, page } = await arriveAfter(DROPPED_AFTER_MS)
    page.wired.setupState.mockResolvedValue(setupStateOf(true))

    const arriving = page.arrive()
    await advanceTimers(SHORT_TIMEOUT_MS)
    await arriving

    expect(isSaved(page.store.state())).toBe(true)
    expect(isDropped(page.store)).toBe(false)
    expect(page.wired.confirmSetup).toHaveBeenCalledTimes(1)
    expect(page.wired.confirmSetup).toHaveBeenCalledWith(page.wired.draft, record.prepared)
    expect(page.wired.saveSetup).toHaveBeenCalledTimes(1)
    expect(await stored(page.wired)).toBeUndefined()
    expect(page.wired.receipts.wait).not.toHaveBeenCalled()
    expect(page.wired.port.sendAccountBatch).not.toHaveBeenCalled()
  })

  const FAILING_READS: [string, (page: Page) => void, number][] = [
    [
      'the node read rejects',
      ({ wired }) => wired.receipts.transactionKnown.mockRejectedValue(nodeError()),
      0
    ],
    [
      'the node read passes its limit',
      ({ wired }) => wired.receipts.transactionKnown.mockImplementation(() => pending()),
      DROPPED_READ_MS
    ],
    [
      'the setup read rejects',
      ({ wired }) => wired.setupState.mockRejectedValue(new Error('the node did not answer')),
      0
    ],
    [
      'the setup read passes its limit',
      ({ wired }) => wired.setupState.mockImplementation(() => pending()),
      DROPPED_READ_MS
    ]
  ]

  FAILING_READS.forEach(([named, arrange, limit]) =>
    it(`leaves the save submitting under its hash, waiting and then stalled with check again, where ${named}`, async () => {
      const { record, page } = await arriveAfter(DROPPED_AFTER_MS)
      arrange(page)
      page.wired.receipts.wait.mockImplementation(() => pending())

      unawaited(page.arrive())
      await advanceTimers(limit)
      expect(isDropped(page.store)).toBe(false)
      expectSubmittingUnder(page.store, TX_HASH)
      expect(page.wired.receipts.wait).toHaveBeenCalledTimes(1)

      await advanceTimers(RECEIPT_WAIT_MS)
      expect(page.store.state().stalled).toBe(true)
      expect(isDropped(page.store)).toBe(false)
      expect(await stored(page.wired)).toEqual(record)
      expect(page.wired.port.sendAccountBatch).not.toHaveBeenCalled()
    })
  )

  it('takes nothing from a node read that answers unknown after its limit', async () => {
    const { page } = await arriveAfter(DROPPED_AFTER_MS)
    const late = held<'unknown'>()
    page.wired.receipts.transactionKnown.mockImplementationOnce(() => late.promise)
    page.wired.receipts.wait.mockImplementation(() => pending())

    unawaited(page.arrive())
    await advanceTimers(DROPPED_READ_MS)
    late.release('unknown')
    await advanceTimers(0)

    expect(isDropped(page.store)).toBe(false)
    expect(page.wired.setupState).not.toHaveBeenCalled()
  })
})

describe('the hour of a dropped save', () => {
  const recordAt = async (times: { claimedAgo: number; sentAgo?: number }) => {
    const storage = memoryStorage()
    const requests = requestsFake()
    const { record } = await firstPageSent(storage, requests)
    const { sentAt, ...withoutTime } = record
    await storeRecord(storage, {
      ...withoutTime,
      claimedAt: Date.now() - times.claimedAgo,
      ...(times.sentAgo === undefined ? {} : { sentAt: Date.now() - times.sentAgo })
    })
    const page = pageOf(storage, requests)
    page.wired.receipts.wait.mockImplementation(() => pending())
    return page
  }

  it('counts from the broadcast, not from an older claim', async () => {
    const page = await recordAt({ claimedAgo: 3 * DROPPED_AFTER_MS, sentAgo: 30 * MINUTE })

    unawaited(page.arrive())
    await advanceTimers(RECEIPT_WAIT_MS)
    expect(isDropped(page.store)).toBe(false)
    expect(page.wired.receipts.transactionKnown).not.toHaveBeenCalled()

    passTime(30 * MINUTE)
    unawaited(checkReceiptAgain(page.store, page.wired.steps, OPTIONS))
    await advanceTimers(0)
    expect(isDropped(page.store)).toBe(true)
  })

  it('counts from the claim where the stored save holds no time of its broadcast', async () => {
    const before = await recordAt({ claimedAgo: DROPPED_AFTER_MS - MINUTE })
    unawaited(before.arrive())
    await advanceTimers(0)
    expect(isDropped(before.store)).toBe(false)
    expect(before.wired.receipts.transactionKnown).not.toHaveBeenCalled()

    const after = await recordAt({ claimedAgo: DROPPED_AFTER_MS })
    await after.arrive()
    expect(isDropped(after.store)).toBe(true)
  })

  it('never reads dropped for a time of the broadcast in the future, whatever the claim time', async () => {
    const page = await recordAt({
      claimedAgo: 10 * DROPPED_AFTER_MS,
      sentAgo: -10 * DROPPED_AFTER_MS
    })

    unawaited(page.arrive())
    await advanceTimers(RECEIPT_WAIT_MS)
    passTime(5 * DROPPED_AFTER_MS)
    unawaited(checkReceiptAgain(page.store, page.wired.steps, OPTIONS))
    await advanceTimers(RECEIPT_WAIT_MS)

    expect(isDropped(page.store)).toBe(false)
    expect(page.wired.receipts.transactionKnown).not.toHaveBeenCalled()
    expect(page.store.state().stalled).toBe(true)
  })
})

describe('when the check for a dropped save runs', () => {
  it('runs when a receipt wait ends because the node does not know the transaction: before the hour it keeps the stall and check again', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    await firstPageSent(storage, requests)
    const page = pageOf(storage, requests)
    // The wait gives up on a hash the node does not know, past the wait's own limit.
    page.wired.receipts.wait.mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error('The node does not know the transaction.')),
            15 * MINUTE
          )
        })
    )

    unawaited(page.arrive())
    await advanceTimers(15 * MINUTE)
    expect(page.store.state().stalled).toBe(true)
    expect(isDropped(page.store)).toBe(false)
    expect(page.wired.receipts.transactionKnown).not.toHaveBeenCalled()

    unawaited(checkReceiptAgain(page.store, page.wired.steps, OPTIONS))
    await advanceTimers(0)
    expect(page.wired.receipts.wait).toHaveBeenCalledTimes(2)
    expect(isDropped(page.store)).toBe(false)
  })

  it('reads dropped when a receipt wait ends past its limit after the hour, with no press', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    await firstPageSent(storage, requests)
    passTime(50 * MINUTE)
    const page = pageOf(storage, requests)
    page.wired.receipts.wait.mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error('The node does not know the transaction.')),
            15 * MINUTE
          )
        })
    )

    unawaited(page.arrive())
    await advanceTimers(RECEIPT_WAIT_MS)
    expect(page.store.state().stalled).toBe(true)
    expect(isDropped(page.store)).toBe(false)
    await advanceTimers(15 * MINUTE - RECEIPT_WAIT_MS)

    expect(isDropped(page.store)).toBe(true)
    expect(page.wired.port.sendAccountBatch).not.toHaveBeenCalled()
  })

  it('reads dropped when a receipt wait fails within its limit after the hour', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    await firstPageSent(storage, requests)
    passTime(DROPPED_AFTER_MS - MINUTE)
    const page = pageOf(storage, requests)
    const wait = held<never>()
    page.wired.receipts.wait.mockImplementationOnce(() => wait.promise)

    unawaited(page.arrive())
    await advanceTimers(0)
    expect(isDropped(page.store)).toBe(false)
    await advanceTimers(MINUTE)
    wait.fail(nodeError())
    await advanceTimers(0)

    expect(isDropped(page.store)).toBe(true)
    expect(page.wired.receipts.wait).toHaveBeenCalledTimes(1)
  })

  it("reads dropped on the owner's own save when its first wait ends past its limit an hour after the broadcast", async () => {
    const wired = wireSave(account, script())
    wired.receipts.transactionKnown.mockResolvedValue('unknown')
    wired.receipts.wait.mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error('The node does not know the transaction.')),
            61 * MINUTE
          )
        })
    )
    const store = createArmStore()

    const running = startSave(store, wired.steps, OPTIONS)
    await advanceTimers(RECEIPT_WAIT_MS)
    expect(store.state().stalled).toBe(true)
    expect(isDropped(store)).toBe(false)
    await advanceTimers(61 * MINUTE - RECEIPT_WAIT_MS)
    await running

    expect(isDropped(store)).toBe(true)
    expect(await stored(wired)).toBeDefined()
    expect(wired.port.sendAccountBatch).toHaveBeenCalledTimes(1)
  })

  it('reads dropped on check again after the hour, and opens no other wait', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    await firstPageSent(storage, requests)
    const { page } = await stalledFollower(storage, requests)
    expect(isDropped(page.store)).toBe(false)

    passTime(DROPPED_AFTER_MS)
    await checkReceiptAgain(page.store, page.wired.steps, OPTIONS)

    expect(isDropped(page.store)).toBe(true)
    expect(page.store.state().stalled).toBe(false)
    expect(page.wired.receipts.wait).toHaveBeenCalledTimes(1)
  })

  it('makes one check and opens at most one wait on presses of check again and a screen that attaches while a slow check reads', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    await firstPageSent(storage, requests)
    const { page } = await stalledFollower(storage, requests)
    passTime(DROPPED_AFTER_MS)
    const known = held<'known' | 'unknown'>()
    page.wired.receipts.transactionKnown.mockImplementationOnce(() => known.promise)

    unawaited(checkReceiptAgain(page.store, page.wired.steps, OPTIONS))
    unawaited(checkReceiptAgain(page.store, page.wired.steps, OPTIONS))
    unawaited(attachSteps(page.store, page.wired.steps, OPTIONS))
    await advanceTimers(0)
    expect(page.wired.receipts.transactionKnown).toHaveBeenCalledTimes(1)

    known.release('known')
    await advanceTimers(0)
    expect(isDropped(page.store)).toBe(false)
    expect(page.wired.receipts.transactionKnown).toHaveBeenCalledTimes(1)
    expect(page.wired.receipts.wait).toHaveBeenCalledTimes(1)
  })

  it('asks the node for every hash the run sent: one known means not dropped, all unknown means dropped', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    await firstPageSent(storage, requests)
    const { page } = await stalledFollower(storage, requests)
    const { run } = page.store.state().write
    // The same batch sent again at another fee, under a second hash.
    page.store.dispatch({
      type: 'write',
      event: { type: 'sent', run, transactionHash: SECOND_HASH }
    })
    page.wired.receipts.wait.mockImplementation(() => pending())
    page.wired.receipts.transactionKnown.mockImplementation(async (hash: Hex) =>
      hash === TX_HASH ? 'known' : 'unknown'
    )
    passTime(DROPPED_AFTER_MS)

    unawaited(checkReceiptAgain(page.store, page.wired.steps, OPTIONS))
    await advanceTimers(0)
    expect(isDropped(page.store)).toBe(false)
    const asked = page.wired.receipts.transactionKnown.mock.calls.map(([hash]) => hash)
    expect(asked).toEqual(expect.arrayContaining([TX_HASH, SECOND_HASH]))

    await advanceTimers(RECEIPT_WAIT_MS)
    expect(page.store.state().stalled).toBe(true)
    page.wired.receipts.transactionKnown.mockResolvedValue('unknown')
    await checkReceiptAgain(page.store, page.wired.steps, OPTIONS)
    expect(isDropped(page.store)).toBe(true)
  })

  const ANOTHER_RECORD: [
    string,
    (storage: MemoryStorage, record: SaveInFlightRecord) => Promise<unknown>
  ][] = [
    [
      "another request's save stored in its place",
      (storage, record) =>
        storeRecord(storage, { ...record, requestId: 'another-page', transactionHash: SECOND_HASH })
    ],
    [
      'no save stored any more',
      (storage) => storage.remove(recordKeys.saveInFlight(CHAIN_ID, account.addr as Hex))
    ]
  ]

  ANOTHER_RECORD.forEach(([named, arrange]) =>
    it(`reads nothing dropped with ${named}, and asks the node nothing`, async () => {
      const storage = memoryStorage()
      const requests = requestsFake()
      const { record } = await firstPageSent(storage, requests)
      const { page } = await stalledFollower(storage, requests)
      await arrange(storage, record)
      passTime(DROPPED_AFTER_MS)

      unawaited(checkReceiptAgain(page.store, page.wired.steps, OPTIONS))
      await advanceTimers(0)

      expect(isDropped(page.store)).toBe(false)
      expect(page.wired.receipts.transactionKnown).not.toHaveBeenCalled()
      expect(page.wired.setupState).not.toHaveBeenCalled()
    })
  )

  it('stays quiet while no screen is attached, and reads dropped through the screen that attaches next', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    await firstPageSent(storage, requests)
    const page = pageOf(storage, requests)
    const wait = held<never>()
    page.wired.receipts.wait.mockImplementationOnce(() => wait.promise)
    unawaited(page.arrive())
    await advanceTimers(0)

    detachSteps(page.wired.steps)
    passTime(DROPPED_AFTER_MS)
    const storageReads = jest.spyOn(storage, 'get')
    wait.fail(nodeError())
    await advanceTimers(RECEIPT_WAIT_MS)

    expect(storageReads).not.toHaveBeenCalled()
    expect(isDropped(page.store)).toBe(false)
    expect(page.wired.receipts.transactionKnown).not.toHaveBeenCalled()
    expect(page.wired.setupState).not.toHaveBeenCalled()

    const next = pageOf(storage, requests)
    await attachSteps(page.store, next.wired.steps, OPTIONS)

    expect(isDropped(page.store)).toBe(true)
    expect(next.wired.receipts.transactionKnown).toHaveBeenCalledWith(TX_HASH)
    expect(page.wired.receipts.transactionKnown).not.toHaveBeenCalled()
  })

  it('takes a late receipt after dropped: no longer dropped, then the check and saved, nothing sent', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    await firstPageSent(storage, requests)
    const { page, receipt } = await stalledFollower(storage, requests)
    passTime(DROPPED_AFTER_MS)
    await checkReceiptAgain(page.store, page.wired.steps, OPTIONS)
    expect(isDropped(page.store)).toBe(true)

    receipt.release(landedReceipt())
    await advanceTimers(SHORT_TIMEOUT_MS)

    expect(isDropped(page.store)).toBe(false)
    expect(isSaved(page.store.state())).toBe(true)
    expect(page.wired.confirmSetup).toHaveBeenCalledTimes(1)
    expect(page.wired.saveSetup).toHaveBeenCalledTimes(1)
    expect(page.wired.port.sendAccountBatch).not.toHaveBeenCalled()
  })
})

describe('save again', () => {
  const droppedPage = async () => {
    const { record, page, storage } = await arriveAfter(DROPPED_AFTER_MS)
    await page.arrive()
    expect(isDropped(page.store)).toBe(true)
    page.wired.setupState.mockClear()
    return { record, page, storage }
  }

  it('releases the stored save first, then runs the whole ordinary start and sends once to saved', async () => {
    const { record, page, storage } = await droppedPage()
    const removals = jest.spyOn(storage, 'remove')

    const again = saveAgain(page.store, page.wired.steps, OPTIONS)
    await advanceTimers(SHORT_TIMEOUT_MS)
    await again

    expect(isSaved(page.store.state())).toBe(true)
    expect(page.wired.port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(page.wired.prepareCommitSetup).toHaveBeenCalledTimes(1)
    expect(page.wired.port.sendAccountBatch.mock.calls[0][4]).not.toBe(record.requestId)
    const released = removals.mock.invocationCallOrder[0]
    const [beforePrepare, afterClaim] = page.wired.setupState.mock.invocationCallOrder
    const sent = page.wired.port.sendAccountBatch.mock.invocationCallOrder[0]
    expect(page.wired.setupState).toHaveBeenCalledTimes(2)
    expect(released).toBeLessThan(beforePrepare)
    expect(beforePrepare).toBeLessThan(page.wired.prepareCommitSetup.mock.invocationCallOrder[0])
    expect(page.wired.prepareCommitSetup.mock.invocationCallOrder[0]).toBeLessThan(afterClaim)
    expect(afterClaim).toBeLessThan(sent)
    expect(await stored(page.wired)).toBeUndefined()
  })

  it('starts nothing where the release fails, and stays dropped; a later press saves once', async () => {
    const { record, page, storage } = await droppedPage()
    jest.spyOn(storage, 'remove').mockRejectedValueOnce(new Error('storage unavailable'))

    await saveAgain(page.store, page.wired.steps, OPTIONS)

    expect(isDropped(page.store)).toBe(true)
    expect(page.wired.setupState).not.toHaveBeenCalled()
    expect(page.wired.prepareCommitSetup).not.toHaveBeenCalled()
    expect(page.wired.port.sendAccountBatch).not.toHaveBeenCalled()
    expect(await stored(page.wired)).toEqual(record)

    const again = saveAgain(page.store, page.wired.steps, OPTIONS)
    await advanceTimers(SHORT_TIMEOUT_MS)
    await again
    expect(isSaved(page.store.state())).toBe(true)
    expect(page.wired.port.sendAccountBatch).toHaveBeenCalledTimes(1)
  })

  it('sends once on two presses', async () => {
    const { page, storage } = await droppedPage()
    const removals = jest.spyOn(storage, 'remove')
    const releases = jest.spyOn(page.wired.steps, 'release')

    const presses = [
      saveAgain(page.store, page.wired.steps, OPTIONS),
      saveAgain(page.store, page.wired.steps, OPTIONS)
    ]
    await advanceTimers(SHORT_TIMEOUT_MS)
    await Promise.all(presses)
    await saveAgain(page.store, page.wired.steps, OPTIONS)

    expect(isSaved(page.store.state())).toBe(true)
    expect(page.wired.port.sendAccountBatch).toHaveBeenCalledTimes(1)
    expect(page.wired.prepareCommitSetup).toHaveBeenCalledTimes(1)
    // One release of the dropped save; the agreed check's wipe removes the new one with the records.
    expect(releases).toHaveBeenCalledTimes(1)
    expect(removals).toHaveBeenCalledTimes(1)
  })

  const SET_UP_MEANWHILE: [string, (page: Page) => void][] = [
    ['before the prepare', ({ wired }) => wired.setupState.mockResolvedValue(setupStateOf(true))],
    [
      'after the claim',
      ({ wired }) =>
        wired.setupState
          .mockResolvedValueOnce(setupStateOf(false))
          .mockResolvedValue(setupStateOf(true))
    ]
  ]

  SET_UP_MEANWHILE.forEach(([named, arrange]) =>
    it(`ends the new run as already set up with nothing sent where a setup appeared ${named}`, async () => {
      const { page } = await droppedPage()
      arrange(page)

      const again = saveAgain(page.store, page.wired.steps, OPTIONS)
      await advanceTimers(SHORT_TIMEOUT_MS)
      await again

      expect(page.store.state().stop).toBe('already-set-up')
      expect(armScreenOf(page.store.state())).toBe('already-set-up')
      expect(page.wired.port.sendAccountBatch).not.toHaveBeenCalled()
      expect(await stored(page.wired)).toBeUndefined()
    })
  )

  it('starts nothing where a late receipt lands between the release and the new start, and the save goes on to saved', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    await firstPageSent(storage, requests)
    const { page, receipt } = await stalledFollower(storage, requests)
    passTime(DROPPED_AFTER_MS)
    await checkReceiptAgain(page.store, page.wired.steps, OPTIONS)
    expect(isDropped(page.store)).toBe(true)
    const removal = held<null>()
    const remove = storage.remove.bind(storage)
    jest.spyOn(storage, 'remove').mockImplementationOnce(async (key) => {
      await removal.promise
      return remove(key)
    })

    const again = saveAgain(page.store, page.wired.steps, OPTIONS)
    await advanceTimers(0)
    receipt.release(landedReceipt())
    await advanceTimers(0)
    expect(page.store.state().write.status).toBe('landed')
    removal.release(null)
    await advanceTimers(SHORT_TIMEOUT_MS)
    await again

    expect(isSaved(page.store.state())).toBe(true)
    expect(page.store.state().write.run).toBe(1)
    expect(page.wired.prepareCommitSetup).not.toHaveBeenCalled()
    expect(page.wired.port.sendAccountBatch).not.toHaveBeenCalled()
    expect(page.wired.confirmSetup).toHaveBeenCalledTimes(1)
  })

  it('does nothing on a save that is not dropped', async () => {
    const storage = memoryStorage()
    const requests = requestsFake()
    const { record } = await firstPageSent(storage, requests)
    const { page } = await stalledFollower(storage, requests)
    const removals = jest.spyOn(storage, 'remove')

    await saveAgain(page.store, page.wired.steps, OPTIONS)

    expect(removals).not.toHaveBeenCalled()
    expect(page.wired.prepareCommitSetup).not.toHaveBeenCalled()
    expect(await stored(page.wired)).toEqual(record)
  })
})
