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
import type { Address, Gathering } from '@web/modules/social-recovery/sdk-interfaces'

import {
  ABSENT,
  ChainId,
  CountdownRecord,
  DecryptedSetupCacheRecord,
  DirectWipeEvent,
  ListedRecord,
  LiveRecoverySession,
  RECOVERY_WIPE_EVENTS,
  RecordRead,
  RecordStorage,
  RecoverySessionRecord,
  RecoveryWipeEvent,
  SETUP_RECORD_NAMES,
  SetupRecordName,
  SetupRecordValues,
  StoredRecord,
  WipedRecoverySession
} from './types'

/** The prefix of every storage key this lane writes. */
export const RECORDS_KEY_PREFIX = 'socialRecovery'

const chainPart = (chainId: ChainId | string): string => {
  const text = typeof chainId === 'bigint' ? chainId.toString(10) : String(chainId)
  if (!/^[0-9]+$/.test(text)) throw new Error(`Invalid chain id: ${text}`)
  return text
}

const accountPart = (account: Address): string => {
  if (typeof account !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(account)) {
    throw new Error(`Invalid account address: ${String(account)}`)
  }
  return account.toLowerCase()
}

const sameAddress = (a: Address, b: Address): boolean => a.toLowerCase() === b.toLowerCase()

/**
 * The storage keys. Every record that belongs to an account is keyed by chain
 * and account: the setup records, the recovery session, the countdown and the
 * setup cache. Two index records list the accounts that hold a session or a
 * countdown on a chain, for the home surface.
 */
export const recordKeys = {
  setup: (name: SetupRecordName, chainId: ChainId, account: Address): string =>
    `${RECORDS_KEY_PREFIX}:${name}:${chainPart(chainId)}:${accountPart(account)}`,
  recoverySession: (chainId: ChainId, account: Address): string =>
    `${RECORDS_KEY_PREFIX}:recoverySession:${chainPart(chainId)}:${accountPart(account)}`,
  countdown: (chainId: ChainId, account: Address): string =>
    `${RECORDS_KEY_PREFIX}:countdown:${chainPart(chainId)}:${accountPart(account)}`,
  recoverySessionIndex: (chainId: ChainId): string =>
    `${RECORDS_KEY_PREFIX}:recoverySessionIndex:${chainPart(chainId)}`,
  countdownIndex: (chainId: ChainId): string =>
    `${RECORDS_KEY_PREFIX}:countdownIndex:${chainPart(chainId)}`,
  decryptedSetupCache: (chainId: ChainId, account: Address): string =>
    `${RECORDS_KEY_PREFIX}:decryptedSetupCache:${chainPart(chainId)}:${accountPart(account)}`
}

/** The value of an index record: the accounts that hold a record of its kind on a chain. */
interface AccountIndex {
  accounts: Address[]
}

const isStoredRecord = (stored: unknown): stored is StoredRecord<unknown> => {
  if (typeof stored !== 'object' || stored === null || !('value' in stored)) return false
  const { savedAt } = stored as { savedAt?: unknown }
  return typeof savedAt === 'number' && Number.isFinite(savedAt)
}

/** The age of a read record in milliseconds at `at`, or `null` for an absent record. */
export const recordAge = <T>(read: RecordRead<T>, at: number): number | null =>
  read.status === 'present' ? at - read.savedAt : null

export const isRecoveryWipeEvent = (event: unknown): event is RecoveryWipeEvent =>
  typeof event === 'string' && (RECOVERY_WIPE_EVENTS as readonly string[]).includes(event)

/** The account a session record names, live or wiped. */
export const sessionAccount = (session: RecoverySessionRecord): Address =>
  session.state === 'live' ? session.gathering.request.account : session.account

/** The attempt id the live session's request was built against (the predicted attempt id). */
export const predictedAttemptId = (session: LiveRecoverySession): bigint =>
  BigInt(session.gathering.request.attemptId)

/**
 * Whether two gatherings carry the same request: a write may update the replies
 * of a live session but never replace its request, which would wipe it without
 * one of the five reasons.
 */
const sameRequest = (a: Gathering['request'], b: Gathering['request']): boolean =>
  a.chainId === b.chainId &&
  sameAddress(a.manager, b.manager) &&
  sameAddress(a.account, b.account) &&
  sameAddress(a.action, b.action) &&
  a.attemptId === b.attemptId &&
  a.setupNonce === b.setupNonce &&
  a.validUntil === b.validUntil

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
  /**
   * Writes the live session from the SDK's gathering. Refuses a gathering whose
   * request names another account or chain, a cancellation gathering, and a
   * gathering whose request differs from the live session's own.
   */
  write(gathering: Gathering): Promise<StoredRecord<RecoverySessionRecord>>
  age(at?: number): Promise<number | null>
}

export interface CountdownAccessor {
  read(): Promise<RecordRead<CountdownRecord>>
  /** Writes the countdown record, the account address alone. */
  write(): Promise<StoredRecord<CountdownRecord>>
  wipe(): Promise<void>
  age(at?: number): Promise<number | null>
}

export interface WalletRecordsOptions {
  /** The extension's storage helper, or an in-memory double in a test. */
  storage: RecordStorage
  /** The clock `savedAt` and the default `age` read from, in ms since epoch. */
  now?: () => number
}

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

  // --- the account indexes -------------------------------------------------

  const readIndex = async (indexKey: string): Promise<Address[]> => {
    const read = await readKey<AccountIndex>(indexKey)
    return read.status === 'present' && Array.isArray(read.value.accounts)
      ? read.value.accounts
      : []
  }

  // The index is written before the record it lists, so an interrupted write
  // leaves at worst an index entry whose record reads absent, which a listing skips.
  const addToIndex = async (indexKey: string, account: Address): Promise<void> => {
    const accounts = await readIndex(indexKey)
    if (accounts.some((listed) => sameAddress(listed, account))) return
    await writeKey<AccountIndex>(indexKey, { accounts: [...accounts, account] })
  }

  const removeFromIndex = async (indexKey: string, account: Address): Promise<void> => {
    const accounts = await readIndex(indexKey)
    const kept = accounts.filter((listed) => !sameAddress(listed, account))
    if (kept.length === accounts.length) return
    if (kept.length) await writeKey<AccountIndex>(indexKey, { accounts: kept })
    else await storage.remove(indexKey)
  }

  const listIndexed = async <T>(
    indexKey: string,
    recordKey: (account: Address) => string
  ): Promise<ListedRecord<T>[]> => {
    const accounts = await readIndex(indexKey)
    const reads = await Promise.all(accounts.map((account) => readKey<T>(recordKey(account))))
    return reads.flatMap((read, i) =>
      read.status === 'present'
        ? [{ account: accounts[i], record: { value: read.value, savedAt: read.savedAt } }]
        : []
    )
  }

  // --- the six setup records -----------------------------------------------

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

  // --- the recovery session ------------------------------------------------

  const readSession = (chainId: ChainId, account: Address) =>
    readKey<RecoverySessionRecord>(recordKeys.recoverySession(chainId, account))

  const writeWiped = (chainId: ChainId, account: Address, wiped: WipedRecoverySession) =>
    writeKey<RecoverySessionRecord>(recordKeys.recoverySession(chainId, account), wiped)

  /**
   * The recovery session of one account on one chain. Its live body is the
   * SDK's gathering (sdk.md D-207); a write for another account touches another
   * key and never wipes this one.
   */
  const recoverySession = (chainId: ChainId, account: Address): RecoverySessionAccessor => {
    const key = recordKeys.recoverySession(chainId, account)
    return {
      read: () => readKey<RecoverySessionRecord>(key),
      write: async (gathering: Gathering) => {
        const { request } = gathering
        if (gathering.purpose !== 'approval') {
          throw new Error(
            `A recovery session holds an approval gathering, not ${gathering.purpose}`
          )
        }
        if (!sameAddress(request.account, account)) {
          throw new Error(`The gathering names account ${request.account}, not ${account}`)
        }
        if (chainPart(request.chainId) !== chainPart(chainId)) {
          throw new Error(`The gathering names chain ${request.chainId}, not ${chainPart(chainId)}`)
        }
        const current = await readKey<RecoverySessionRecord>(key)
        if (
          current.status === 'present' &&
          current.value.state === 'live' &&
          !sameRequest(current.value.gathering.request, request)
        ) {
          throw new Error(
            'A live session holds another request: wipe it with one of the five events first'
          )
        }
        await addToIndex(recordKeys.recoverySessionIndex(chainId), request.account)
        return writeKey<RecoverySessionRecord>(key, { state: 'live', gathering })
      },
      age: async (at?: number) => recordAge(await readKey<RecoverySessionRecord>(key), at ?? now())
    }
  }

  /** Every recovery session stored on a chain, live or wiped, for the home surface. */
  const listRecoverySessions = (chainId: ChainId) =>
    listIndexed<RecoverySessionRecord>(recordKeys.recoverySessionIndex(chainId), (account) =>
      recordKeys.recoverySession(chainId, account)
    )

  /**
   * One of four events wipes a live recovery session: the deadline passed,
   * another attempt opened, the setup changed or the recoverer abandoned. The
   * gathering, with its replies and its attempt id, is deleted, and the session
   * keeps the reason, the account and, for `deadline-passed`, the deadline.
   * Returns whether it wiped anything: an absent or already wiped session is
   * left unchanged. `submission-landed` runs through `landSubmission`; it and
   * any value outside the vocabulary, a security stop or a pause among them,
   * throw and wipe nothing (I-38).
   */
  const wipeRecoverySession = async (
    chainId: ChainId,
    account: Address,
    event: DirectWipeEvent
  ): Promise<boolean> => {
    if (!isRecoveryWipeEvent(event)) {
      throw new Error(`Not a recovery wipe event: ${String(event)}`)
    }
    if ((event as RecoveryWipeEvent) === 'submission-landed') {
      throw new Error('The submission landing runs through landSubmission')
    }
    const current = await readSession(chainId, account)
    if (current.status !== 'present' || current.value.state !== 'live') return false
    const { request } = current.value.gathering
    await writeWiped(chainId, account, {
      state: 'wiped',
      reason: event,
      account: request.account,
      ...(event === 'deadline-passed' ? { deadline: request.validUntil } : {})
    })
    return true
  }

  // --- the countdown -------------------------------------------------------

  /** The countdown record of one account on one chain; its body is the account address alone. */
  const countdown = (chainId: ChainId, account: Address): CountdownAccessor => {
    const key = recordKeys.countdown(chainId, account)
    const indexKey = recordKeys.countdownIndex(chainId)
    return {
      read: () => readKey<CountdownRecord>(key),
      write: async () => {
        await addToIndex(indexKey, account)
        return writeKey<CountdownRecord>(key, { account })
      },
      wipe: async () => {
        await storage.remove(key)
        await removeFromIndex(indexKey, account)
      },
      age: async (at?: number) => recordAge(await readKey<CountdownRecord>(key), at ?? now())
    }
  }

  /** Every countdown record stored on a chain, for the home surface. */
  const listCountdowns = (chainId: ChainId) =>
    listIndexed<CountdownRecord>(recordKeys.countdownIndex(chainId), (account) =>
      recordKeys.countdown(chainId, account)
    )

  /**
   * The submission landed: the live session survives as the countdown's record,
   * which holds the account address alone, and the session is wiped with the
   * reason `submission-landed`. Refuses when no live session exists. The storage
   * helper's `set` writes one key, so the two records are two writes, the
   * countdown first: an interrupted call never loses the account, and the next
   * call finds the session still live and completes the wipe.
   */
  const landSubmission = async (
    chainId: ChainId,
    account: Address
  ): Promise<StoredRecord<CountdownRecord>> => {
    const current = await readSession(chainId, account)
    if (current.status !== 'present' || current.value.state !== 'live') {
      throw new Error(`No live recovery session for ${account} on chain ${chainPart(chainId)}`)
    }
    const sessionAddress = current.value.gathering.request.account
    const written = await countdown(chainId, sessionAddress).write()
    await writeWiped(chainId, account, {
      state: 'wiped',
      reason: 'submission-landed',
      account: sessionAddress
    })
    return written
  }

  // --- the decrypted setup cache -------------------------------------------

  /**
   * This device's cache of the setup the recovery password unlocked, with the
   * setup nonce it was read under. It stays after the recovery executes; no
   * wipe of this lane touches it.
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
    listRecoverySessions,
    wipeRecoverySession,
    countdown,
    listCountdowns,
    landSubmission,
    decryptedSetupCache
  }
}

export type WalletRecords = ReturnType<typeof createWalletRecords>
