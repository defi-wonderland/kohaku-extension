/**
 * The wallet's records (PT-040): the extension's storage of every record
 * docs/social-recovery/design/ux.md D-310 names, in the extension's local storage
 * and never in a background controller, since the worker restarts and clears its
 * controllers. The SDK stores nothing (ux-interfaces.md D-370), so the setup
 * draft, the recovery session and the setup cache live here and the SDK sees
 * them only as arguments.
 *
 * Every record is stored as `{ value, savedAt }`, never as a bare boolean or zero,
 * since the storage helper's read returns the default for a falsy stored value.
 * A read of a record that is not stored returns `ABSENT`.
 */
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import {
  ABSENT,
  ChainId,
  CountdownRecord,
  DecryptedSetupCacheRecord,
  RECOVERY_WIPE_EVENTS,
  RecordRead,
  RecordStorage,
  RecoverySessionInput,
  RecoverySessionRecord,
  RecoveryWipeEvent,
  SETUP_RECORD_NAMES,
  SetupRecordName,
  SetupRecordValues,
  StoredRecord
} from './types'

/** The prefix of every storage key this lane writes. */
export const RECORDS_KEY_PREFIX = 'socialRecovery'

const chainPart = (chainId: ChainId): string => {
  const text = typeof chainId === 'bigint' ? chainId.toString(10) : String(chainId)
  if (!/^[0-9]+$/.test(text)) throw new Error(`Invalid chain id: ${text}`)
  return text
}

const accountPart = (account: Address): string => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) throw new Error(`Invalid account address: ${account}`)
  return account.toLowerCase()
}

/**
 * The storage keys. The setup records and the setup cache belong to an account
 * and are keyed by chain and account; the recovery session and the countdown
 * are this device's one recovery on a chain and carry the account as a field.
 */
export const recordKeys = {
  setup: (name: SetupRecordName, chainId: ChainId, account: Address): string =>
    `${RECORDS_KEY_PREFIX}:${name}:${chainPart(chainId)}:${accountPart(account)}`,
  recoverySession: (chainId: ChainId): string =>
    `${RECORDS_KEY_PREFIX}:recoverySession:${chainPart(chainId)}`,
  countdown: (chainId: ChainId): string => `${RECORDS_KEY_PREFIX}:countdown:${chainPart(chainId)}`,
  decryptedSetupCache: (chainId: ChainId, account: Address): string =>
    `${RECORDS_KEY_PREFIX}:decryptedSetupCache:${chainPart(chainId)}:${accountPart(account)}`
}

const isStoredRecord = (stored: unknown): stored is StoredRecord<unknown> => {
  if (typeof stored !== 'object' || stored === null || !('value' in stored)) return false
  const { savedAt } = stored as { savedAt?: unknown }
  return typeof savedAt === 'number' && Number.isFinite(savedAt)
}

/** The age of a read record in milliseconds at `at`, or `null` for an absent record. */
export const recordAge = <T>(read: RecordRead<T>, at: number): number | null =>
  read.status === 'present' ? at - read.savedAt : null

/** One record's typed read, write, wipe and age. */
export interface RecordAccessor<T> {
  read(): Promise<RecordRead<T>>
  write(value: T): Promise<StoredRecord<T>>
  wipe(): Promise<void>
  /** Milliseconds since the record was written, or `null` when it is absent. */
  age(at?: number): Promise<number | null>
}

export type SetupRecords = {
  [N in SetupRecordName]: RecordAccessor<SetupRecordValues[N]>
}

export interface RecoverySessionAccessor {
  read(): Promise<RecordRead<RecoverySessionRecord>>
  /** Writes the live session: the account, the predicted attempt id and the approvals. */
  write(session: RecoverySessionInput): Promise<StoredRecord<RecoverySessionRecord>>
  age(at?: number): Promise<number | null>
}

export interface CountdownAccessor {
  read(): Promise<RecordRead<CountdownRecord>>
  write(account: Address): Promise<StoredRecord<CountdownRecord>>
  wipe(): Promise<void>
  age(at?: number): Promise<number | null>
}

export interface WalletRecordsOptions {
  /** The extension's storage helper, or an in-memory double in a test. */
  storage: RecordStorage
  /** The clock `savedAt` and the default `age` read from, in ms since epoch. */
  now?: () => number
}

export const isRecoveryWipeEvent = (event: unknown): event is RecoveryWipeEvent =>
  typeof event === 'string' && (RECOVERY_WIPE_EVENTS as readonly string[]).includes(event)

export const createWalletRecords = ({ storage, now = Date.now }: WalletRecordsOptions) => {
  const readKey = async <T>(key: string): Promise<RecordRead<T>> => {
    const stored = await storage.get(key, undefined)
    if (!isStoredRecord(stored)) return ABSENT
    return { status: 'present', value: stored.value as T, savedAt: stored.savedAt }
  }

  const writeKey = async <T>(key: string, value: T): Promise<StoredRecord<T>> => {
    const record: StoredRecord<T> = { value, savedAt: now() }
    await storage.set(key, record)
    return record
  }

  const accessor = <T>(key: string): RecordAccessor<T> => ({
    read: () => readKey<T>(key),
    write: (value: T) => writeKey<T>(key, value),
    wipe: async () => {
      await storage.remove(key)
    },
    age: async (at?: number) => recordAge(await readKey<T>(key), at ?? now())
  })

  const wipeSetupRecords = async (chainId: ChainId, account: Address): Promise<void> => {
    await Promise.all(
      SETUP_RECORD_NAMES.map((name) => storage.remove(recordKeys.setup(name, chainId, account)))
    )
  }

  /**
   * The six setup records of an account: the setup draft, the inventory, the
   * path, the enrollments, the waiting period and the password-set flag.
   */
  const setup = (chainId: ChainId, account: Address): SetupRecords => ({
    setupDraft: accessor(recordKeys.setup('setupDraft', chainId, account)),
    inventory: accessor(recordKeys.setup('inventory', chainId, account)),
    path: accessor(recordKeys.setup('path', chainId, account)),
    enrollments: accessor(recordKeys.setup('enrollments', chainId, account)),
    waitingPeriod: accessor(recordKeys.setup('waitingPeriod', chainId, account)),
    passwordSet: accessor(recordKeys.setup('passwordSet', chainId, account))
  })

  /**
   * The latest `savedAt` of the six setup records, the draft's age a resumed
   * wizard shows, or `null` when none is stored.
   */
  const setupSavedAt = async (chainId: ChainId, account: Address): Promise<number | null> => {
    const reads = await Promise.all(
      SETUP_RECORD_NAMES.map((name) => readKey<unknown>(recordKeys.setup(name, chainId, account)))
    )
    const times = reads.flatMap((read) => (read.status === 'present' ? [read.savedAt] : []))
    return times.length ? Math.max(...times) : null
  }

  /** The setup landed on chain: wipes the six setup records. Platform credentials are untouched. */
  const saveSetup = (chainId: ChainId, account: Address) => wipeSetupRecords(chainId, account)

  /** The holder starts over: wipes the six setup records. Platform credentials are untouched. */
  const startOverSetup = (chainId: ChainId, account: Address) => wipeSetupRecords(chainId, account)

  const recoverySession = (chainId: ChainId): RecoverySessionAccessor => {
    const key = recordKeys.recoverySession(chainId)
    return {
      read: () => readKey<RecoverySessionRecord>(key),
      write: ({ account, predictedAttemptId, approvals }: RecoverySessionInput) =>
        writeKey<RecoverySessionRecord>(key, {
          state: 'live',
          account,
          predictedAttemptId,
          approvals
        }),
      age: async (at?: number) => recordAge(await readKey<RecoverySessionRecord>(key), at ?? now())
    }
  }

  /**
   * One of the five events wipes the recovery session: the approvals and the
   * predicted attempt id are deleted and the session keeps the event as its one
   * line of reason. Any other value, a security stop or a pause among them,
   * throws and wipes nothing (I-38).
   */
  const wipeRecoverySession = async (chainId: ChainId, event: RecoveryWipeEvent): Promise<void> => {
    if (!isRecoveryWipeEvent(event)) {
      throw new Error(`Not a recovery wipe event: ${String(event)}`)
    }
    await writeKey<RecoverySessionRecord>(recordKeys.recoverySession(chainId), {
      state: 'wiped',
      reason: event
    })
  }

  const countdown = (chainId: ChainId): CountdownAccessor => {
    const key = recordKeys.countdown(chainId)
    return {
      read: () => readKey<CountdownRecord>(key),
      write: (account: Address) => writeKey<CountdownRecord>(key, { account }),
      wipe: async () => {
        await storage.remove(key)
      },
      age: async (at?: number) => recordAge(await readKey<CountdownRecord>(key), at ?? now())
    }
  }

  /**
   * The submission landed: the session survives as the countdown's record, which
   * holds the account address alone, and the session's approvals and predicted
   * attempt id are wiped with the reason `submission-landed`. The countdown is
   * written first, so an interrupted call never loses the account.
   */
  const landSubmission = async (chainId: ChainId, account: Address): Promise<void> => {
    await countdown(chainId).write(account)
    await wipeRecoverySession(chainId, 'submission-landed')
  }

  /**
   * This device's cache of the setup the recovery password unlocked. It stays
   * after the recovery executes; no wipe of this lane touches it.
   */
  const decryptedSetupCache = (
    chainId: ChainId,
    account: Address
  ): RecordAccessor<DecryptedSetupCacheRecord> =>
    accessor<DecryptedSetupCacheRecord>(recordKeys.decryptedSetupCache(chainId, account))

  return {
    setup,
    setupSavedAt,
    saveSetup,
    startOverSetup,
    recoverySession,
    wipeRecoverySession,
    countdown,
    landSubmission,
    decryptedSetupCache
  }
}

export type WalletRecords = ReturnType<typeof createWalletRecords>
