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
  StoredRecord
} from './types'

/** The prefix of every storage key this lane writes. */
export const RECORDS_KEY_PREFIX = 'socialRecovery'

const ACCOUNT_PATTERN = /^0x[0-9a-fA-F]{40}$/

const chainPart = (chainId: ChainId | string): string => {
  const text = typeof chainId === 'bigint' ? chainId.toString(10) : String(chainId)
  if (!/^[0-9]+$/.test(text)) throw new Error(`Invalid chain id: ${text}`)
  return text
}

const accountPart = (account: Address): string => {
  if (typeof account !== 'string' || !ACCOUNT_PATTERN.test(account)) {
    throw new Error(`Invalid account address: ${String(account)}`)
  }
  return account.toLowerCase()
}

const sameAddress = (a: Address, b: Address): boolean => a.toLowerCase() === b.toLowerCase()

/** The key prefix every recovery session on one chain shares. */
const recoverySessionPrefix = (chainId: ChainId): string =>
  `${RECORDS_KEY_PREFIX}:recoverySession:${chainPart(chainId)}:`

/**
 * The storage keys. Every record belongs to an account and is keyed by chain
 * and account: the six setup records, the recovery session (whose landed state
 * is the countdown's record) and the setup cache.
 */
export const recordKeys = {
  setup: (name: SetupRecordName, chainId: ChainId, account: Address): string =>
    `${RECORDS_KEY_PREFIX}:${name}:${chainPart(chainId)}:${accountPart(account)}`,
  recoverySession: (chainId: ChainId, account: Address): string =>
    `${recoverySessionPrefix(chainId)}${accountPart(account)}`,
  decryptedSetupCache: (chainId: ChainId, account: Address): string =>
    `${RECORDS_KEY_PREFIX}:decryptedSetupCache:${chainPart(chainId)}:${accountPart(account)}`
}

const isStoredRecord = (stored: unknown): stored is StoredRecord<unknown> => {
  if (typeof stored !== 'object' || stored === null || !('value' in stored)) return false
  const { savedAt } = stored as { savedAt?: unknown }
  return typeof savedAt === 'number' && Number.isFinite(savedAt)
}

const SESSION_STATES = ['live', 'wiped', 'landed']

const isSessionRecord = (value: unknown): value is RecoverySessionRecord =>
  typeof value === 'object' &&
  value !== null &&
  SESSION_STATES.includes((value as { state?: unknown }).state as string)

/**
 * Deep equality over the JSON-like values a gathering holds. A key whose value
 * is `undefined` counts as absent, as it does once stored.
 */
const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => sameValue(item, b[i]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined)
  const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => right[key] !== undefined && sameValue(left[key], right[key]))
  )
}

/** The age of a read record in milliseconds at `at`, or `null` for an absent record. */
export const recordAge = <T>(read: RecordRead<T>, at: number): number | null =>
  read.status === 'present' ? at - read.savedAt : null

export const isRecoveryWipeEvent = (event: unknown): event is RecoveryWipeEvent =>
  typeof event === 'string' && (RECOVERY_WIPE_EVENTS as readonly string[]).includes(event)

/** The account a session record names, in any state. */
export const sessionAccount = (session: RecoverySessionRecord): Address =>
  session.state === 'live' ? session.gathering.request.account : session.account

/** The attempt id the live session's request was built against (the predicted attempt id). */
export const predictedAttemptId = (session: LiveRecoverySession): bigint =>
  BigInt(session.gathering.request.attemptId)

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
   * Writes the live session from the SDK's gathering. Refuses a cancellation
   * gathering, a gathering whose request names another account or chain, a
   * landed session, and over a live session a gathering whose request differs
   * in any field or that leaves a filled place without a reply.
   */
  write(gathering: Gathering): Promise<StoredRecord<RecoverySessionRecord>>
  age(at?: number): Promise<number | null>
}

/** The countdown's record, read from the session in its landed state. */
export interface CountdownAccessor {
  read(): Promise<RecordRead<CountdownRecord>>
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
        if (current.status === 'present' && current.value.state === 'landed') {
          throw new Error(
            'A landed session holds the countdown: clear it once its attempt ends, then gather again'
          )
        }
        if (current.status === 'present' && current.value.state === 'live') {
          const stored = current.value.gathering
          // Any change to the request would replace it, a wipe without one of the five reasons.
          if (!sameValue(stored.request, request)) {
            throw new Error(
              'A live session holds another request: wipe it with one of the five events first'
            )
          }
          // A reply may be displaced by a later reply for the same place (sdk.md D-207),
          // never dropped.
          const places = new Set(gathering.replies.map((reply) => reply.place))
          const dropped = stored.replies.filter((reply) => !places.has(reply.place))
          if (dropped.length) {
            throw new Error(
              `The write drops the reply at place ${dropped.map((reply) => reply.place).join(', ')}`
            )
          }
        }
        return writeKey<RecoverySessionRecord>(key, { state: 'live', gathering })
      },
      age: async (at?: number) => recordAge(await readKey<RecoverySessionRecord>(key), at ?? now())
    }
  }

  /** Every session record stored on a chain, by a prefix scan over the storage's entries. */
  const scanSessions = async (chainId: ChainId): Promise<ListedRecord<RecoverySessionRecord>[]> => {
    if (!storage.getAll) {
      throw new Error('This storage cannot list its entries: it has no getAll')
    }
    const prefix = recoverySessionPrefix(chainId)
    const entries = Object.entries(await storage.getAll())
      .filter(([key]) => key.startsWith(prefix) && ACCOUNT_PATTERN.test(key.slice(prefix.length)))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return entries.flatMap(([, stored]) =>
      isStoredRecord(stored) && isSessionRecord(stored.value)
        ? [
            {
              account: sessionAccount(stored.value),
              record: { value: stored.value, savedAt: stored.savedAt }
            }
          ]
        : []
    )
  }

  /** Every recovery session stored on a chain, live, wiped or landed, for the home surface. */
  const listRecoverySessions = (chainId: ChainId) => scanSessions(chainId)

  /**
   * One of four events wipes a live recovery session: the deadline passed,
   * another attempt opened, the setup changed or the recoverer abandoned. The
   * gathering, with its replies and its attempt id, is deleted, and the session
   * keeps the reason, the account and, for `deadline-passed`, the deadline.
   * Returns whether it wiped anything: an absent, wiped or landed session is
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
    await writeKey<RecoverySessionRecord>(recordKeys.recoverySession(chainId, account), {
      state: 'wiped',
      reason: event,
      account: request.account,
      ...(event === 'deadline-passed' ? { deadline: request.validUntil } : {})
    })
    return true
  }

  /**
   * The submission landed: the live session survives as the countdown's record,
   * `{ state: 'landed', account }`, written in one set in place of the live
   * session, so the gathering, its replies and its attempt id are gone in the
   * same write. Refuses when no live session exists.
   */
  const landSubmission = async (
    chainId: ChainId,
    account: Address
  ): Promise<StoredRecord<CountdownRecord>> => {
    const current = await readSession(chainId, account)
    if (current.status !== 'present' || current.value.state !== 'live') {
      throw new Error(`No live recovery session for ${account} on chain ${chainPart(chainId)}`)
    }
    const landedAccount = current.value.gathering.request.account
    const written = await writeKey<RecoverySessionRecord>(
      recordKeys.recoverySession(chainId, account),
      { state: 'landed', account: landedAccount }
    )
    return { value: { account: landedAccount }, savedAt: written.savedAt }
  }

  /**
   * Removes a session record in its wiped or landed state, so old sessions do
   * not accumulate. Never removes a live session. Returns whether it removed one.
   */
  const clearWipedSession = async (chainId: ChainId, account: Address): Promise<boolean> => {
    const current = await readSession(chainId, account)
    if (current.status !== 'present' || current.value.state === 'live') return false
    await storage.remove(recordKeys.recoverySession(chainId, account))
    return true
  }

  // --- the countdown -------------------------------------------------------

  const asCountdown = (read: RecordRead<RecoverySessionRecord>): RecordRead<CountdownRecord> =>
    read.status === 'present' && read.value.state === 'landed'
      ? { status: 'present', value: { account: read.value.account }, savedAt: read.savedAt }
      : ABSENT

  /** The countdown's record of one account: the session in its landed state, the account alone. */
  const countdown = (chainId: ChainId, account: Address): CountdownAccessor => ({
    read: async () => asCountdown(await readSession(chainId, account)),
    age: async (at?: number) =>
      recordAge(asCountdown(await readSession(chainId, account)), at ?? now())
  })

  /** Every countdown on a chain, the landed sessions, for the home surface. */
  const listCountdowns = async (chainId: ChainId): Promise<ListedRecord<CountdownRecord>[]> =>
    (await scanSessions(chainId)).flatMap(({ record }) =>
      record.value.state === 'landed'
        ? [
            {
              account: record.value.account,
              record: { value: { account: record.value.account }, savedAt: record.savedAt }
            }
          ]
        : []
    )

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
    landSubmission,
    clearWipedSession,
    countdown,
    listCountdowns,
    decryptedSetupCache
  }
}

export type WalletRecords = ReturnType<typeof createWalletRecords>
