import type { Account } from '@ambire-common/interfaces/account'
import type { Network } from '@ambire-common/interfaces/network'
import type {
  Address,
  CancelledBy,
  DeploymentDescriptor,
  Hex
} from '@web/modules/social-recovery/sdk-interfaces'
import type {
  WatcherConnection,
  WatcherReads
} from '@web/modules/social-recovery/shared/client/types'
import type { ChainId, RecordStorage } from '@web/modules/social-recovery/shared/records/types'

import type { OPENING_GAPS } from './constants'

/**
 * Why an open attempt names no key yet: the read of its opening failed, the
 * scan found no opening whose payload matches the attempt's hash, or the
 * payload is not in the action's layout.
 */
export type OpeningGap = typeof OPENING_GAPS[number]

/** An attempt the manager holds as waiting, as one poll read it. */
export interface WatchedAttempt {
  attemptId: bigint
  setupNonce: bigint
  /** The hash of the payload the attempt committed. */
  payloadHash: Hex
  /** When the attempt can execute, in seconds since epoch, from the manager's record. */
  consumableAfter: number
  /** The pinned block's time is at or past `consumableAfter`, and nobody has executed. */
  executionDue: boolean
  /** When the attempt opened: the time of the block of its opening log, in seconds, once read. */
  openedAt?: number
  /** The key the attempt hands the account to, once the opening's payload decoded. */
  newKey?: Address
  /** The key the attempt removes, once the opening's payload decoded. */
  removedKey?: Address
  /** Why no key is named yet; absent once the decode returned a key. */
  openingGap?: OpeningGap
}

/**
 * How the attempt the manager holds ended. A field left undefined is one
 * whose log is not read yet; the next poll reads it again.
 */
export type AttemptEnding =
  | {
      attemptId: bigint
      road: 'executed'
      /** The key that controls the account since: the new key of the attempt's payload. */
      controller?: Address
      /** The time of the block of the consume log, in seconds. */
      at?: number
    }
  | {
      attemptId: bigint
      road: 'cancelled'
      cancelledBy?: CancelledBy
      /** The time of the block of the cancel log, in seconds. */
      at?: number
    }

/** One account's reading at one block. */
export interface WatcherReading {
  account: Address
  /** The latest block the poll pinned every read to, its time in seconds. */
  block: { number: number; timestamp: number }
  /** The account holds a setup commitment at the manager. */
  hasSetup: boolean
  /** The account holds a setup and no longer authorizes the action. */
  dormant: boolean
  /** The attempt that is open; absent where none is. */
  attempt?: WatchedAttempt
  /** The ending of the last attempt, where the manager holds an ended one. */
  ended?: AttemptEnding
}

/** A poll that failed or did not answer in time; `at` in ms since epoch. */
export interface PollFailure {
  at: number
  message: string
}

/**
 * The watcher's record of one account: the last good reading, the failure of
 * the last poll where it failed, and the attempts the holder dismissed.
 */
export interface WatcherRecord {
  reading?: WatcherReading
  failed?: PollFailure
  dismissed: bigint[]
}

/** The open attempt as storage holds it, its two bigints as decimal strings. */
export type StoredWatchedAttempt = Omit<WatchedAttempt, 'attemptId' | 'setupNonce'> & {
  attemptId: string
  setupNonce: string
}

/** An ending as storage holds it, its attempt id as a decimal string. */
export type StoredAttemptEnding =
  | (Omit<Extract<AttemptEnding, { road: 'executed' }>, 'attemptId'> & { attemptId: string })
  | (Omit<Extract<AttemptEnding, { road: 'cancelled' }>, 'attemptId'> & { attemptId: string })

/** The record as storage holds it: every bigint as a decimal string. */
export interface StoredWatcherRecord {
  reading?: Omit<WatcherReading, 'attempt' | 'ended'> & {
    attempt?: StoredWatchedAttempt
    ended?: StoredAttemptEnding
  }
  failed?: PollFailure
  dismissed: string[]
}

/** The storage the watcher's records live in. */
export type WatcherStorage = Pick<RecordStorage, 'get' | 'set'>

/** The alarm API the watcher registers with: the extension's `alarms`. */
export interface WatcherAlarms {
  create(name: string, info: { periodInMinutes: number }): unknown
  clear(name: string): unknown
  onAlarm: {
    addListener(listener: (alarm: { name: string }) => void): void
    removeListener(listener: (alarm: { name: string }) => void): void
  }
}

/** What one poll over the watched accounts takes. */
export interface PollInput {
  reads: WatcherReads
  accounts: readonly Address[]
  chainId: ChainId
  storage: WatcherStorage
  /** The clock a failure is stamped with, in ms since epoch. */
  now: () => number
  /** How long the poll may run, in ms. */
  limitMs: number
}

/** What the background starts the watcher with. */
export interface RecoveryWatcherOptions {
  /** The accounts the wallet lists. */
  accounts: () => readonly Account[]
  /** The network record of the recovery chain. */
  network: () => Network | undefined
  /** Receives, after every poll, the number of accounts the badge counts. */
  onBadge: (count: number) => void
  /** The deployment the watcher reads; the build's deployed kit where none is given. */
  deployment?: () => DeploymentDescriptor | undefined
  alarms?: WatcherAlarms
  storage?: WatcherStorage
  connect?: (network: Network, deployment: DeploymentDescriptor) => WatcherConnection
  now?: () => number
  limitMs?: number
}

/** A started watcher. */
export interface RecoveryWatcher {
  /** Runs one poll, or nothing where a poll still runs. */
  tick(): Promise<void>
  /** Clears the alarm and releases the provider. */
  stop(): void
}

/** What the hook reads a record through. */
export interface WatchedAttemptSources {
  read(key: string): Promise<unknown>
  subscribe(key: string, onValue: (value: unknown) => void): () => void
}

/** The hook's state for one account. */
export type WatchedAttemptState =
  | { status: 'loading' }
  /** The watcher has not polled this account yet. */
  | { status: 'unwatched' }
  | {
      status: 'watched'
      /** The last good reading; absent where no poll has answered yet. */
      reading?: WatcherReading
      /** The failure of the last poll, beside the last good reading. */
      failed?: PollFailure
      /** The open attempt is one the holder dismissed. */
      attemptDismissed: boolean
    }
