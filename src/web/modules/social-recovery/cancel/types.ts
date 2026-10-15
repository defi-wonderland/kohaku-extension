import type { ReactNode } from 'react'

import type { Account } from '@ambire-common/interfaces/account'
import type { Network } from '@ambire-common/interfaces/network'
import type {
  Address,
  CancelledBy,
  DeploymentDescriptor,
  Hex,
  PreparedCall
} from '@web/modules/social-recovery/sdk-interfaces'
import type {
  AddGate,
  ChainReads,
  KeyHandle,
  ListedAccountFacts,
  ProviderTransactionReceipt,
  ReceiptReads,
  RecoveryKitClient,
  SendPort,
  SendRequestPort,
  WatcherConnection,
  WatcherReads
} from '@web/modules/social-recovery/shared/client/types'
import type { ChainId } from '@web/modules/social-recovery/shared/records/types'
import type {
  GasCheck,
  RequestHold,
  WriteEvent,
  WriteMachineState
} from '@web/modules/social-recovery/shared/writes'
import type {
  AttemptEnding,
  PollFailure,
  WatchedAttempt,
  WatchedAttemptState,
  WatcherReading,
  WatcherStorage
} from '@web/modules/social-recovery/watcher/types'

// ---------------------------------------------------------------------------
// The banner
// ---------------------------------------------------------------------------

/** An open attempt as the banner shows it, with the block of the reading that holds it. */
export interface OpenAttempt {
  attempt: WatchedAttempt
  /** The account no longer authorizes the action, so the attempt cannot execute until it does. */
  dormant: boolean
  block: WatcherReading['block']
}

export type ExecutedEnding = Extract<AttemptEnding, { road: 'executed' }>

/**
 * What the banner of one account shows: nothing, an open attempt, a failed
 * poll with the open attempt the last good reading holds, or the notice that a
 * recovery executed.
 */
export type BannerReading =
  | { kind: 'none' }
  | { kind: 'open'; open: OpenAttempt }
  | {
      kind: 'failed'
      failed: PollFailure
      /** The time of the last good reading's block, in ms, where the record holds one. */
      lastReadAt?: number
      open?: OpenAttempt
    }
  | { kind: 'executed'; ending: ExecutedEnding }

/** Reads the watcher's record of one account for a page; `useWatchedAttempt` by default. */
export type WatchedAttemptHook = (account: Address) => WatchedAttemptState

/** The attempt ids the holder dismissed for one account, undefined while the record is read. */
export type DismissedHook = (account: Address, state: WatchedAttemptState) => bigint[] | undefined

export interface RecoveryAttemptBannerViewProps {
  /** The accounts the wallet lists. */
  accounts: readonly Account[]
  useAttempt: WatchedAttemptHook
  useDismissed: DismissedHook
  /** Opens the cancel of one account in a full tab. */
  onCancel: (account: Address) => void
  /** Hides the warning for one attempt of one account. */
  onDismiss: (account: Address, attemptId: bigint) => Promise<unknown>
  /** Runs one poll of one account and writes its record. */
  onRetry: (account: Address) => Promise<unknown>
  timeZone: string
}

export interface AccountAttemptBannerProps {
  account: Address
  /** The wallet's label for the account, shown with its truncated address where the wallet lists several accounts. */
  name?: string
  useAttempt: WatchedAttemptHook
  useDismissed: DismissedHook
  onCancel: (account: Address) => void
  onDismiss: (account: Address, attemptId: bigint) => Promise<unknown>
  onRetry: (account: Address) => Promise<unknown>
  timeZone: string
}

export interface AttemptLinesProps {
  open: OpenAttempt
  account: Address
  timeZone: string
  onCancel: (account: Address) => void
  onDismiss: (account: Address, attemptId: bigint) => Promise<unknown>
}

export interface BannerFrameProps {
  type: 'warning' | 'error'
  testID: string
  children: ReactNode
}

/** What one poll of one account from a page takes; the extension's own by default. */
export interface PollOnceInput {
  account: Address
  /** The network record of the recovery chain. */
  network: Network | undefined
  deployment?: () => DeploymentDescriptor | undefined
  connect?: (network: Network, deployment: DeploymentDescriptor) => WatcherConnection
  storage?: WatcherStorage
  now?: () => number
  limitMs?: number
}

// ---------------------------------------------------------------------------
// The attempt read
// ---------------------------------------------------------------------------

/** One fresh reading of an account's attempt, written to its watcher record. */
export interface AttemptReaderInput {
  reads: WatcherReads
  account: Address
  chainId: ChainId
  storage: WatcherStorage
  now?: () => number
  limitMs?: number
}

export type AttemptReader = () => Promise<WatcherReading>

/** The cancel screen's read of the attempt on arrival. */
export type AttemptRead =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'read'; arrival: Arrival }

/**
 * The arrival's read: the fresh reading, and the attempt the holder came to
 * cancel, the one the watcher's record held before that read, else the one the
 * fresh reading holds open.
 */
export interface Arrival {
  reading: WatcherReading
  target?: bigint
}

export type ArrivalReader = () => Promise<Arrival>

export interface AttemptReadResult {
  read: AttemptRead
  retry: () => void
}

/** How an attempt the holder meant to cancel stands in a reading. */
export type AttemptStanding =
  | { kind: 'open'; attempt: WatchedAttempt; dormant: boolean }
  | { kind: 'gone'; ending?: AttemptEnding }

// ---------------------------------------------------------------------------
// The cancel in flight on this device
// ---------------------------------------------------------------------------

/**
 * A cancel sent to the wallet and not yet settled, stored on this device so a
 * reloaded page or a second tab follows it instead of sending another one.
 */
export interface CancelClaim {
  /** The attempt the cancel meant to end. */
  attemptId: bigint
  /** The id the request is queued under. */
  requestId: string
  /** The block read before the send, from which the receipt wait scans. */
  startBlock: number
  /** The hash, once the wallet broadcast the cancel. */
  transactionHash?: Hex
}

/** The claim as storage holds it, its attempt id as a decimal string. */
export type StoredCancelClaim = Omit<CancelClaim, 'attemptId'> & { attemptId: string }

export type ClaimAnswer = { claimed: true } | { claimed: false; held: CancelClaim }

export interface CancelClaims {
  read(): Promise<CancelClaim | undefined>
  /** Stores the claim where none is stored, and answers the stored one otherwise. */
  claim(claim: CancelClaim): Promise<ClaimAnswer>
  /** Writes the hash on the claim of `requestId`. */
  markSent(requestId: string, transactionHash: Hex): Promise<void>
  /** Removes the claim of `requestId`; a claim of another request stays. */
  release(requestId: string): Promise<void>
}

// ---------------------------------------------------------------------------
// The cancel's run
// ---------------------------------------------------------------------------

/** What the send of one run takes. */
export interface CancelSendInput {
  prepared: PreparedCall
  dispatch: (event: WriteEvent) => void
  run: number
  requestId: string
  startBlock: number
  canAdd: AddGate
}

/** The run's seams over the wallet: the reads, the prepare, the gas check, the send and the stored claim. */
export interface CancelSteps {
  readAttempt: AttemptReader
  prepare(): Promise<PreparedCall>
  checkGas(prepared: PreparedCall): Promise<GasCheck>
  newRequestId(): string
  blockNumber(): Promise<number>
  claims: CancelClaims
  send(input: CancelSendInput): Promise<void>
  wait(transactionHash: Hex, startBlock: number): Promise<ProviderTransactionReceipt>
  /** Where the wallet holds a request; throws where it does not answer. */
  requestHold(requestId: string): Promise<RequestHold>
}

/** What the run reads after its cancel landed. */
export type AfterLanding =
  | { stage: 'none' }
  | { stage: 'reading' }
  /** The reads after the landing did not agree yet; check again reads once more. */
  | { stage: 'unread' }
  | { stage: 'cancelled' }
  | { stage: 'otherRoad'; road: Exclude<CancelledBy, 'cancelByOwner'> }

export interface CancelState {
  write: WriteMachineState
  /** The attempt the run cancels. */
  target?: bigint
  /** The reading in which the read before the send found the attempt gone; nothing was sent. */
  gone?: WatcherReading
  after: AfterLanding
  /** A stored cancel followed without sending: the wallet still holds its request, or did not answer. */
  follow?: 'held' | 'unread'
  /** The receipt wait of the sent cancel failed; check again waits once more. */
  stalled?: boolean
  /** The request the run's cancel is queued under, once the run claimed it or follows it. */
  requestId?: string
}

export interface CancelStore {
  state(): CancelState
  subscribe(listener: () => void): () => void
  update(change: (state: CancelState) => CancelState): void
}

export interface CancelRun {
  state: CancelState
  start: (target: bigint) => void
  recheck: () => void
  checkAgain: () => void
}

/** What the steps over the wallet's seams are built from. */
export interface CancelStepsInput {
  account: Address
  chainId: ChainId
  client: RecoveryKitClient
  /** The balance and gas reads over the extension's provider. */
  chainReads: ChainReads
  receipts: ReceiptReads
  port: SendPort
  requests: SendRequestPort
  /** The wallet's facts of the account, whose key sends the cancel and pays its gas. */
  facts: ListedAccountFacts
  key: KeyHandle
  readAttempt: AttemptReader
  storage: WatcherStorage
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

/**
 * Whether the page can send the cancel: the client and the account's facts
 * still load, are ready with the account's key, failed to load (with a retry),
 * or the keystore holds none of the account's keys.
 */
export type CancelReadiness = 'loading' | 'ready' | 'failed' | 'noKey'

export interface CancelBodyProps {
  account: Address
}

export interface CancelViewProps {
  read: AttemptRead
  run: CancelState
  readiness: CancelReadiness
  timeZone: string
  onRetryRead: () => void
  /** Builds the client and reads the account's facts again. */
  onRetryReady: () => void
  onSend: (target: bigint) => void
  onRecheck: () => void
  onCheckAgain: () => void
  onBack: () => void
  onDone: () => void
  onMoveFunds: () => void
}

export interface AttemptFactsProps {
  attempt: WatchedAttempt
  timeZone: string
}

export interface EndedBlockProps {
  reading: WatcherReading
  onBack: () => void
}

export interface CancelledBlockProps {
  after: Extract<AfterLanding, { stage: 'cancelled' } | { stage: 'otherRoad' }>
  onMoveFunds: () => void
  onDone: () => void
}
