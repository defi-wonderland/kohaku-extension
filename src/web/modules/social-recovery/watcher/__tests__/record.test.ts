import type { WatcherRecord } from '@web/modules/social-recovery/watcher'
import {
  dismissAttempt,
  readWatcherRecord,
  storedWatcherRecordOf,
  updateWatcherRecord,
  watcherKeyOf,
  watcherRecordFrom
} from '@web/modules/social-recovery/watcher'
import {
  ACCOUNT,
  HEAD,
  HEAD_TIME,
  memoryStorage,
  NEW_KEY,
  SEPOLIA
} from '@web/modules/social-recovery/watcher/__fixtures__/harness'

const RECORD: WatcherRecord = {
  reading: {
    account: ACCOUNT,
    block: { number: HEAD, timestamp: HEAD_TIME },
    hasSetup: true,
    dormant: true,
    attempt: {
      attemptId: 12345678901234567890n,
      setupNonce: 3n,
      payloadHash: `0x${'11'.repeat(32)}`,
      consumableAfter: HEAD_TIME + 3600,
      executionDue: false,
      openedAt: HEAD_TIME - 60,
      newKey: NEW_KEY
    },
    ended: { attemptId: 2n, road: 'cancelled', cancelledBy: 'setupWrite', at: HEAD_TIME - 600 }
  },
  failed: { at: 5, message: 'node down' },
  dismissed: [2n]
}

describe('the watcher record', () => {
  it('lives under the account in lowercase on its chain', () => {
    expect(watcherKeyOf(SEPOLIA, ACCOUNT)).toBe(
      `socialRecovery:watcher:11155111:${ACCOUNT.toLowerCase()}`
    )
  })

  it('reads back what it wrote, every bigint whole', async () => {
    const storage = memoryStorage()
    await updateWatcherRecord(
      storage,
      SEPOLIA,
      ACCOUNT,
      () => RECORD,
      () => 9
    )

    expect(await readWatcherRecord(storage, SEPOLIA, ACCOUNT)).toEqual(RECORD)
    expect(JSON.parse(storage.entries.get(watcherKeyOf(SEPOLIA, ACCOUNT)) ?? '')).toMatchObject({
      savedAt: 9,
      value: { dismissed: ['2'] }
    })
  })

  it('reads a stored value that is not a watcher record as none', () => {
    const stored = { value: storedWatcherRecordOf(RECORD), savedAt: 1 }
    const malformed = [
      undefined,
      false,
      { value: stored.value },
      { ...stored, value: { ...stored.value, dismissed: [2] } },
      { ...stored, value: { ...stored.value, failed: { at: 'now' } } },
      {
        ...stored,
        value: {
          ...stored.value,
          reading: { ...stored.value.reading, attempt: { attemptId: '1' } }
        }
      },
      {
        ...stored,
        value: { ...stored.value, reading: { ...stored.value.reading, ended: { road: 'lost' } } }
      }
    ]
    malformed.forEach((value) => expect(watcherRecordFrom(value)).toBeUndefined())
    expect(watcherRecordFrom(stored)).toEqual(RECORD)
  })

  it('dismisses an attempt once, keeping the reading', async () => {
    const storage = memoryStorage()
    await updateWatcherRecord(storage, SEPOLIA, ACCOUNT, () => RECORD)

    await dismissAttempt(SEPOLIA, ACCOUNT, 7n, storage)
    await dismissAttempt(SEPOLIA, ACCOUNT, 7n, storage)

    const read = await readWatcherRecord(storage, SEPOLIA, ACCOUNT)
    expect(read?.dismissed).toEqual([2n, 7n])
    expect(read?.reading).toEqual(RECORD.reading)
  })

  it('dismisses an attempt of an account with no record yet', async () => {
    const storage = memoryStorage()
    await dismissAttempt(SEPOLIA, ACCOUNT, 7n, storage)

    expect(await readWatcherRecord(storage, SEPOLIA, ACCOUNT)).toEqual({ dismissed: [7n] })
  })
})
