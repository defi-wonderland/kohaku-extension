/**
 * The wait for a new block before the check after a landed save reads a
 * second time: it ends once the chain's block number moved past the first one
 * it read, or once its limit passed, and never rejects. Over fake timers, so
 * each poll and each limit is a step of the clock.
 */
import type { Account } from '@ambire-common/interfaces/account'

import {
  BLOCK_POLL_MS,
  CONFIRM_READ_TIMEOUT_MS,
  confirmOutcomeOf,
  createArmStore,
  isSaved,
  NEW_BLOCK_WAIT_MS,
  startSave,
  waitForNewBlock
} from '@web/modules/social-recovery/setup/arm'

import { advanceTimers, confirmation, HAPPY, smartAccount, START_BLOCK, wireSave } from './harness'

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

/** A promise's settlement as a flag the test reads between steps of the clock. */
const track = (promise: Promise<unknown>) => {
  const seen = { settled: false, rejected: false }
  promise.then(
    () => {
      seen.settled = true
    },
    () => {
      seen.settled = true
      seen.rejected = true
    }
  )
  return seen
}

/** Block numbers read in turn; the last repeats. */
const blocks = (...numbers: (number | Error | 'never')[]) => {
  let index = 0
  return jest.fn(() => {
    const answer = numbers[Math.min(index, numbers.length - 1)]
    index += 1
    if (answer === 'never') {
      return new Promise<number>(() => {})
    }
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
  })
}

describe('the wait for a new block', () => {
  it('ends at the first poll that reads a block past the first one, and not before', async () => {
    const read = blocks(10, 10, 11)
    const wait = track(waitForNewBlock(read, 30_000))

    await advanceTimers(BLOCK_POLL_MS)
    expect(wait.settled).toBe(false)
    await advanceTimers(BLOCK_POLL_MS - 1)
    expect(wait.settled).toBe(false)
    await advanceTimers(1)
    expect(wait.settled).toBe(true)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('ends at its limit where the block never moves, and never rejects', async () => {
    const read = blocks(10)
    const wait = track(waitForNewBlock(read, 9_000))

    await advanceTimers(9_000 - 1)
    expect(wait.settled).toBe(false)
    await advanceTimers(1)
    expect(wait.settled).toBe(true)
    expect(wait.rejected).toBe(false)
    const reads = read.mock.calls.length
    await advanceTimers(10 * BLOCK_POLL_MS)
    expect(read).toHaveBeenCalledTimes(reads)
  })

  it('ends at its limit, without rejecting, where every read fails', async () => {
    const wait = track(waitForNewBlock(blocks(new Error('node down')), 5_000))

    await advanceTimers(5_000)
    expect(wait.settled).toBe(true)
    expect(wait.rejected).toBe(false)
  })

  it('ends at its limit where a read never answers', async () => {
    const wait = track(waitForNewBlock(blocks(10, 'never'), 5_000))

    await advanceTimers(5_000 - 1)
    expect(wait.settled).toBe(false)
    await advanceTimers(1)
    expect(wait.settled).toBe(true)
    expect(wait.rejected).toBe(false)
  })

  it('takes the first block it could read as the one to move past, where the first read failed', async () => {
    const read = blocks(new Error('node down'), 10, 10, 11)
    const wait = track(waitForNewBlock(read, 30_000))

    await advanceTimers(2 * BLOCK_POLL_MS)
    expect(wait.settled).toBe(false)
    await advanceTimers(BLOCK_POLL_MS)
    expect(wait.settled).toBe(true)
  })
})

describe('the second read of the check', () => {
  it('runs only after the wait for a new block ended, and the wait is capped by the read limit', async () => {
    let moved: () => void = () => {}
    const newBlock = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          moved = resolve
        })
    )
    const confirm = jest
      .fn()
      .mockResolvedValueOnce(confirmation(false, true))
      .mockResolvedValueOnce(confirmation(true, true))
    const outcome = track(confirmOutcomeOf(confirm, { newBlock }))

    await advanceTimers(0)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(newBlock).toHaveBeenCalledWith(Math.min(NEW_BLOCK_WAIT_MS, CONFIRM_READ_TIMEOUT_MS))
    await advanceTimers(NEW_BLOCK_WAIT_MS - 1)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(outcome.settled).toBe(false)

    moved()
    await advanceTimers(0)
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(outcome.settled).toBe(true)
  })

  it('gives the wait no longer than a shorter read limit', async () => {
    const newBlock = jest.fn(async () => undefined)
    const confirm = jest.fn().mockResolvedValue(confirmation(false, true))
    const outcome = confirmOutcomeOf(confirm, { timeoutMs: 1_000, newBlock })
    await advanceTimers(0)

    expect(await outcome).toEqual({ kind: 'disagreed', check: 'mismatch' })
    expect(newBlock).toHaveBeenCalledWith(1_000)
  })

  it('waits for no block where the first read decides', async () => {
    const newBlock = jest.fn(async () => undefined)
    const outcome = confirmOutcomeOf(jest.fn().mockResolvedValue(confirmation(true, true)), {
      newBlock
    })
    await advanceTimers(0)

    expect(await outcome).toEqual({ kind: 'agreed' })
    expect(newBlock).not.toHaveBeenCalled()
  })

  it('reads a second time where the wait itself rejects', async () => {
    const newBlock = jest.fn(async () => {
      throw new Error('no block read')
    })
    const confirm = jest
      .fn()
      .mockResolvedValueOnce(confirmation(false, true))
      .mockResolvedValueOnce(confirmation(true, true))
    const outcome = confirmOutcomeOf(confirm, { newBlock })
    await advanceTimers(0)

    expect(await outcome).toEqual({ kind: 'agreed' })
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('saves a run whose first read did not find the setup, once the chain moved a block and the second read agreed', async () => {
    const wired = wireSave(account, { ...HAPPY, authorized: false, deployed: true })
    let head = START_BLOCK
    wired.receipts.blockNumber.mockImplementation(async () => head)
    wired.confirmSetup
      .mockResolvedValueOnce(confirmation(false, true))
      .mockResolvedValueOnce(confirmation(true, true))
    const store = createArmStore()
    const run = track(startSave(store, wired.steps))

    await advanceTimers(0)
    expect(wired.confirmSetup).toHaveBeenCalledTimes(1)
    await advanceTimers(3 * BLOCK_POLL_MS)
    expect(wired.confirmSetup).toHaveBeenCalledTimes(1)
    expect(isSaved(store.state())).toBe(false)
    expect(wired.saveSetup).not.toHaveBeenCalled()

    head = START_BLOCK + 1
    await advanceTimers(BLOCK_POLL_MS)
    expect(wired.confirmSetup).toHaveBeenCalledTimes(2)
    expect(run.settled).toBe(true)
    expect(isSaved(store.state())).toBe(true)
    expect(wired.saveSetup).toHaveBeenCalledTimes(1)
  })

  it('reads the second time at the limit where the chain never moves, and reads the mismatch where it still finds nothing', async () => {
    const wired = wireSave(account, {
      ...HAPPY,
      confirm: 'not-landed-twice',
      authorized: false,
      deployed: true
    })
    const store = createArmStore()
    const run = track(startSave(store, wired.steps))

    await advanceTimers(NEW_BLOCK_WAIT_MS - 1)
    expect(wired.confirmSetup).toHaveBeenCalledTimes(1)
    await advanceTimers(1)
    expect(wired.confirmSetup).toHaveBeenCalledTimes(2)
    expect(run.settled).toBe(true)
    expect(store.state().after).toEqual({ stage: 'disagreed', check: 'mismatch' })
    expect(wired.saveSetup).not.toHaveBeenCalled()
  })
})
