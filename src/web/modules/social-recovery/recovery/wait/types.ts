import type { ReactNode } from 'react'

import type {
  Address,
  Attempt,
  BlockHeader,
  CancelledBy,
  Configuration,
  Hex,
  Notification,
  PreparedCall
} from '@web/modules/social-recovery/sdk-interfaces'
import type { VisibilitySource } from '@web/modules/social-recovery/shared/ceremony'
import type {
  ChainReads,
  ReceiptReads,
  RecoveryKitClient,
  SendPort,
  TransactionKnown
} from '@web/modules/social-recovery/shared/client'
import type {
  RecoveryEntryRecord,
  RecoveryRoute,
  SessionRevision,
  WalletRecords
} from '@web/modules/social-recovery/shared/records'
import type {
  GasCheck,
  GasNetwork,
  WriteEvent,
  WriteMachineState
} from '@web/modules/social-recovery/shared/writes'
import type { SendingPlan, SendingReading } from '@web/modules/social-recovery/recovery/submit'

import type { CANNOT_EXECUTE_CAUSES } from './constants'

// ---------------------------------------------------------------------------
// The client and the page
// ---------------------------------------------------------------------------

export type WaitKitClient = Pick<
  RecoveryKitClient,
  'chain' | 'account' | 'descriptor' | 'recovery' | 'setup' | 'walletReads' | 'action'
>

/** The recovery client of the account being recovered, as the wait reads it. */
export type WaitClient =
  | { status: 'loading' }
  | { status: 'ready'; client: WaitKitClient; reads: ChainReads; receipts: ReceiptReads }
  | { status: 'update-the-wallet' }
  | { status: 'failed' }

/** The recovery entry record of the account being recovered, as the wait reads it. */
export type WaitEntryReading =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'absent' }
  | { status: 'present'; entry: RecoveryEntryRecord }

/** The countdown's record: the landed session, with its revision and when it landed. */
export type CountdownReading =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'present'; revision: SessionRevision; savedAt: number }

// ---------------------------------------------------------------------------
// The poll
// ---------------------------------------------------------------------------

/**
 * The two keys of the handover the wait checks the account against: the key
 * the recovery installs, and the key it removes as this wallet read it, null
 * where the wallet no longer finds that key holding anything on the account.
 */
export interface HandoverKeys {
  newKey: Address
  removedKey: Address | null
}

/** The key being removed as this wallet read it: null where it names none holding on the account. */
export type RemovedKeyReading =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'named'; key: Address | null }

export type HandoverKeysReading =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; keys: HandoverKeys }

/** One poll's reads: the attempt with the block it is pinned to, and the account's four checks. */
export interface WaitFacts {
  attempt: Attempt
  block: BlockHeader
  /** The account still authorizes the action. */
  authorized: boolean
  /** The action still fits the account. */
  supported: boolean
  /** The key being removed still holds a key value on the account. */
  removedHolds: boolean
  /** The new key already holds a privilege on the account. */
  newKeyHolds: boolean
}

export type StartedNotice = Extract<Notification, { kind: 'attempt-started' }>
export type CancelledNotice = Extract<Notification, { kind: 'attempt-cancelled' }>

/**
 * What the manager's events tell of the recovery's attempt: its id, its
 * opening (the payload the execution sends, the transaction that started it),
 * and how it ended where it ended.
 */
export interface AttemptStory {
  attemptId?: bigint
  started?: StartedNotice
  cancelled?: CancelledNotice
  consumed: boolean
}

export type CannotExecuteCause = typeof CANNOT_EXECUTE_CAUSES[number]

/** Where the recovery stands after one poll. */
export type WaitPhase =
  | { kind: 'waiting'; attempt: Attempt }
  | { kind: 'executionDue'; attempt: Attempt }
  | { kind: 'cannotExecute'; attempt: Attempt; cause: CannotExecuteCause }
  /** `by` is null where the attempt read says cancelled and no event names who cancelled it. */
  | { kind: 'cancelled'; by: CancelledBy | null }
  | { kind: 'consumed' }

/** A poll that answered: its reads, the events read with them, the phase, and its round's number. */
export interface WaitRound {
  facts: WaitFacts
  story: AttemptStory
  phase: WaitPhase
  round: number
}

export type WaitPoll =
  | { status: 'pending' }
  | { status: 'failed' }
  | ({ status: 'answered' } & WaitRound)

export interface WaitPollInput {
  kit: WaitKitClient | null
  keys: HandoverKeys | null
  visibility?: VisibilitySource
}

export interface WaitPollHook {
  poll: WaitPoll
  retry: () => void
}

/** The countdown's anchor from one poll: the attempt's end and the pinned block's time, in ms. */
export interface CountdownAnchor {
  endMs: number
  blockMs: number
  round: number
}

/** The seconds the view's clock counted since the poll of one round. */
export interface CountdownTicks {
  round: number | null
  ticks: number
}

// ---------------------------------------------------------------------------
// The execution
// ---------------------------------------------------------------------------

export interface ExecuteState {
  write: WriteMachineState
  prepared?: PreparedCall
  /** The sending key's latest balance while the deposit step shows. */
  balance?: bigint
  /** When the run's first hash came back, in ms since epoch, for the dropped reading. */
  sentAt?: number
}

export type ExecuteEvent =
  | { type: 'write'; event: WriteEvent }
  | { type: 'prepared'; run: number; prepared: PreparedCall }
  | { type: 'balance'; run: number; balance: bigint }
  | { type: 'sentAt'; run: number; at: number }

export interface ExecuteStore {
  state(): ExecuteState
  dispatch(event: ExecuteEvent): void
  subscribe(listener: () => void): () => void
}

/** The execution's steps over the wallet's seams. */
export interface ExecuteSteps {
  /** The execution call for the attempt and the payload that started it. */
  prepare(): Promise<PreparedCall>
  checkGas(prepared: PreparedCall): Promise<GasCheck>
  send(prepared: PreparedCall, dispatch: (event: WriteEvent) => void, run: number): Promise<void>
  transactionKnown(transactionHash: Hex): Promise<TransactionKnown>
  /** Milliseconds since epoch. */
  now(): number
}

export interface ExecuteStepsInput {
  client: WaitKitClient
  reads: ChainReads
  receipts: ReceiptReads
  port: SendPort
  plan: SendingPlan
  network: GasNetwork
  attempt: Attempt
  payload: Hex
  now: () => number
}

export interface ExecuteRun {
  state: ExecuteState
  start: () => void
  /** Reads the run's hashes once the attempt read disagrees with a send past the dropped age. */
  checkDropped: () => void
}

// ---------------------------------------------------------------------------
// The home surface
// ---------------------------------------------------------------------------

/** One landed recovery on the home surface, as one attempt read gives it. */
export type CountdownHeadline =
  | { kind: 'waiting'; anchor: CountdownAnchor }
  | { kind: 'executionDue' }
  | { kind: 'other' }

/** The headline of one countdown, null while it loads or where it cannot be read; a hook. */
export type CountdownHeadlineHook = (account: Address) => CountdownHeadline | null

export interface WaitHomeLineProps {
  account: Address
  useHeadline?: CountdownHeadlineHook
  onOpen: () => void
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** Leaving a terminal: the countdown ended and the entry cleared, then the route's entry. */
export type LeaveState = 'idle' | 'leaving' | 'failed'

export interface WaitViewProps {
  account: Address
  client: WaitClient
  keys: HandoverKeysReading
  poll: WaitPoll
  /** The time left from the last poll's anchor, by the view's own clock; null with no answered poll. */
  remainingMs: number | null
  /** When the submission landed on this device, in ms since epoch. */
  startedAt: number
  timeZone: string
  /** The setup's configuration where this device holds it, for the path line and the cancel's threshold. */
  configuration: Configuration | null
  execute: ExecuteState
  sending: SendingReading
  /** Whether this wallet holds the account's own key, so moving the funds is the holder's to take. */
  holdsAccountKey: boolean
  leave: LeaveState
  onExecute: () => void
  onRetryPoll: () => void
  onRetryKeys: () => void
  onRetryClient: () => void
  onRetrySending: () => void
  onLeave: () => void
  onMoveFunds: () => void
  onOpenExplorer: (transactionHash: Hex) => void
}

export interface WaitChromeProps {
  route: RecoveryRoute
  children: ReactNode
  testID?: string
}

export interface WaitBodyProps {
  records: WalletRecords
  account: Address
  entry: RecoveryEntryRecord
  revision: SessionRevision
  savedAt: number
}

export type WaitGateProps = Omit<WaitBodyProps, 'revision' | 'savedAt'>

export interface CountdownBlockProps {
  round: WaitRound
  account: Address
  newKey?: Address
  remainingMs: number | null
  startedAt: number
  timeZone: string
  configuration: Configuration | null
  onOpenExplorer: (transactionHash: Hex) => void
}

export interface ExecuteBlockProps {
  execute: ExecuteState
  sending: SendingReading
  /** Whether the events named the payload the execution sends. */
  ready: boolean
  onExecute: () => void
  onRetrySending: () => void
}

export interface CannotExecuteBlockProps {
  cause: CannotExecuteCause
  holdsAccountKey: boolean
  onMoveFunds: () => void
}

export interface CancelledBlockProps {
  account: Address
  by: CancelledBy | null
  /** Whether one approval satisfies the rule, so the same credential can cancel again. */
  thresholdOne: boolean
  leave: LeaveState
  onLeave: () => void
}

export interface PollFailedBlockProps {
  onRetry: () => void
}
