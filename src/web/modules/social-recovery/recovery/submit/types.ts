import type { ReactNode } from 'react'

import type {
  Address,
  Assessment,
  Configuration,
  Gathering,
  Hex,
  PreparedCall,
  RecoveryState
} from '@web/modules/social-recovery/sdk-interfaces'
import type {
  ChainReads,
  KeyHandle,
  ListedAccountFacts,
  ReceiptReads,
  RecoveryKitClient,
  SendPort
} from '@web/modules/social-recovery/shared/client'
import type {
  ChainId,
  LiveRecoverySession,
  RecoveryEntryRecord,
  RecoveryRoute,
  SessionRead,
  SessionRevision,
  SubmissionClaimResult,
  SubmissionInFlightClaim,
  SubmissionInFlightRecord,
  WalletRecords
} from '@web/modules/social-recovery/shared/records'
import type {
  GasCheck,
  GasNetwork,
  WriteEvent,
  WriteMachineState
} from '@web/modules/social-recovery/shared/writes'
import type {
  ChecklistLayout,
  ChecklistRow,
  Navigate,
  RemovedKeyRead
} from '@web/modules/social-recovery/recovery/checklist'
import type { ProviderKind } from '@web/modules/social-recovery/setup/review'

import type { ALREADY_RUNNING_CAUSES, ALREADY_RUNNING_FINDINGS } from './constants'

// ---------------------------------------------------------------------------
// The client and the page
// ---------------------------------------------------------------------------

export type SubmitKitClient = Pick<
  RecoveryKitClient,
  'recovery' | 'setup' | 'walletReads' | 'action'
>

/** The recovery client of the account being recovered, as the screen reads it. */
export type SubmitClient =
  | { status: 'loading' }
  | { status: 'ready'; client: SubmitKitClient; reads: ChainReads; receipts: ReceiptReads }
  | { status: 'update-the-wallet' }
  | { status: 'failed' }

/** The recovery entry record of the account being recovered, as the screen reads it. */
export type SubmitEntryReading =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'absent' }
  | { status: 'present'; entry: RecoveryEntryRecord }

export type AlreadyRunningCause = typeof ALREADY_RUNNING_CAUSES[number]

export type AlreadyRunningFinding = typeof ALREADY_RUNNING_FINDINGS[number]

// ---------------------------------------------------------------------------
// The confirmation's load
// ---------------------------------------------------------------------------

/** What the confirmation renders from: the live session, the setup's configuration and the set the submission carries. */
export interface SubmitReady {
  phase: 'ready'
  session: LiveRecoverySession
  revision: SessionRevision
  configuration: Configuration
  layout: ChecklistLayout
  assessment: Assessment
  /** The places of the smallest set the client chose for the submission. */
  chosen: ReadonlySet<number>
}

export type SubmitLoadFailure = 'records' | 'setup' | 'client'

export type SubmitLoad =
  | { phase: 'loading' }
  | { phase: 'update-the-wallet' }
  | { phase: 'failed'; cause: SubmitLoadFailure }
  | SubmitReady

export interface SubmitLoadInput {
  records: WalletRecords
  chainId: ChainId
  account: Address
  client: SubmitClient
  navigate: Navigate
  readPassword: (chainId: ChainId, account: Address) => string | undefined
  /** Milliseconds since epoch. */
  now: () => number
}

export interface SubmitLoadHook {
  load: SubmitLoad
  retry: () => void
}

// ---------------------------------------------------------------------------
// The verify again
// ---------------------------------------------------------------------------

/**
 * The verify of every approval of the set before the confirmation: running,
 * every one satisfied (`checked` false where the client serves no verify),
 * one rejected, or a read that failed.
 */
export type VerifyReading =
  | { status: 'checking' }
  | { status: 'verified'; checked: boolean }
  | { status: 'rejected'; place: number }
  | { status: 'failed' }

export type VerifyStepResult = 'satisfied' | 'not-served' | 'rejected' | 'failed'

export interface VerifyHook {
  verify: VerifyReading
  retry: () => void
}

// ---------------------------------------------------------------------------
// The sending key
// ---------------------------------------------------------------------------

/**
 * How the submission is sent: from one key as its own transaction (the fast
 * track's ordinary key, or a basic account's own key), or as a smart
 * account's own batch, with its controlling key as the payer.
 */
export type SendingPlan =
  | { kind: 'key'; key: KeyHandle }
  | { kind: 'account-batch'; key: KeyHandle; facts: ListedAccountFacts }

export type SendingReading =
  | { status: 'loading' }
  | { status: 'ready'; plan: SendingPlan; network: GasNetwork }
  | { status: 'unavailable' }

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** After a landed receipt: the attempt read, its failure, and the landing of the session. */
export type AfterLanding = 'none' | 'confirming' | 'unread' | 'landed'

/** The read of a claim stored before anything ran: reading, none stored, or a read that failed. */
export type ClaimLookup = 'reading' | 'none' | 'failed'

/** A claim with no hash that the run follows, sent from another page or before a reload. */
export type FollowedClaim = Omit<SubmissionInFlightRecord, 'transactionHash'>

export interface SubmitState {
  write: WriteMachineState
  lookup?: ClaimLookup
  /** The claim this run wrote and sends under. */
  requestId?: string
  /** A claim with no hash this run follows instead of sending. */
  follow?: FollowedClaim
  /** The claim whose hash this run follows. */
  followed?: string
  prepared?: PreparedCall
  /** The sending key's latest balance while the deposit step shows. */
  balance?: bigint
  /** The manager refuses the start because another attempt runs on the account. */
  refusal?: 'already-running'
  /** The attempt this run would start was found started while no page followed its hash. */
  landedUnseen?: boolean
  after: AfterLanding
}

export type SubmitEvent =
  | { type: 'write'; event: WriteEvent }
  | { type: 'lookup'; run: number; reading: ClaimLookup }
  | { type: 'prepared'; run: number; prepared: PreparedCall }
  | { type: 'claimed'; run: number; requestId: string }
  | { type: 'released'; run: number }
  | { type: 'follow'; run: number; claim: SubmissionInFlightRecord }
  | { type: 'voided'; run: number }
  | { type: 'refused'; run: number }
  | { type: 'balance'; run: number; balance: bigint }
  | { type: 'landedUnseen'; run: number }
  | { type: 'confirming'; run: number }
  | { type: 'unread'; run: number }
  | { type: 'landed'; run: number }

export interface SubmitStore {
  state(): SubmitState
  dispatch(event: SubmitEvent): void
  subscribe(listener: () => void): () => void
}

/** What the attempt read says of the attempt this request would start. */
export type AttemptReading = 'ours' | 'other' | 'none'

/** The submission's steps over the wallet's seams. */
export interface SubmitSteps {
  readSession(): Promise<SessionRead>
  attemptRead(): Promise<RecoveryState>
  /** The attempt this request would start, as one attempt read names it. */
  attemptOf(state: RecoveryState): AttemptReading
  /** The request from the smallest set, and the start call it prepares. */
  prepare(): Promise<PreparedCall>
  checkGas(prepared: PreparedCall): Promise<GasCheck>
  blockNumber(): Promise<number>
  newRequestId(): string
  /** Milliseconds since epoch. */
  now(): number
  /** The claim on the live session, read again after another tab moved it. */
  claim(claim: SubmissionInFlightClaim): Promise<SubmissionClaimResult>
  markSent(requestId: string, transactionHash: Hex): Promise<void>
  release(requestId: string): Promise<void>
  send(
    prepared: PreparedCall,
    dispatch: (event: WriteEvent) => void,
    run: number,
    startBlock: number,
    requestId: string
  ): Promise<void>
  waitAgain(
    transactionHash: Hex,
    startBlock: number | undefined,
    dispatch: (event: WriteEvent) => void,
    run: number
  ): Promise<void>
  /** Whether the manager's events name this request's attempt started since the claim's block. */
  startedSince(claim: FollowedClaim): Promise<boolean>
  /** The session landed as the countdown's record, read again after another tab moved it. */
  land(): Promise<void>
}

export interface SubmitStepsInput {
  client: SubmitKitClient
  reads: ChainReads
  receipts: ReceiptReads
  port: SendPort
  records: WalletRecords
  chainId: ChainId
  account: Address
  gathering: Gathering
  plan: SendingPlan
  network: GasNetwork
  now: () => number
}

export interface SubmitRun {
  state: SubmitState
  start: () => void
  /** Waits for a hash's receipt again, or reads a followed claim again at once. */
  checkAgain: () => void
  /** Reads the attempt again after a landing it did not confirm. */
  reread: () => void
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** The three values of the lead and what their lines need. */
export interface LeadInput {
  account: Address
  /** The name the public name service resolves for the account, where one does. */
  name?: string
  newKey?: Address
  /** The receiving account's name in this wallet, for the logged-in route's new-key line. */
  receivingName?: string
  removed: RemovedKeyRead
}

/** One row of the path block: its kind's name, its label and whether the submission carries it. */
export interface PathRowView {
  row: ChecklistRow
  title: string
  label?: string
  carried: boolean
}

export interface SubmitViewProps {
  route: RecoveryRoute
  load: SubmitLoad
  lead: LeadInput
  providerKind?: ProviderKind
  verify: VerifyReading
  run: SubmitState
  sending: SendingReading
  onStart: () => void
  onCheckAgain: () => void
  onReread: () => void
  onRetryVerify: () => void
  onRetryLoad: () => void
  onRetryRemoved: () => void
  onRetrySending: () => void
  onBack: () => void
}

export interface SubmitChromeProps {
  route: RecoveryRoute
  children: ReactNode
  testID?: string
}

export interface SubmitBodyProps {
  records: WalletRecords
  account: Address
  entry: RecoveryEntryRecord
}

export interface LeadBlockProps {
  route: RecoveryRoute
  lead: LeadInput
  onRetryRemoved: () => void
}

export interface DetailsBlockProps {
  route: RecoveryRoute
  ready: SubmitReady
  providerKind?: ProviderKind
}

export interface RunBlockProps {
  run: SubmitState
  onStart: () => void
  onCheckAgain: () => void
  onReread: () => void
  onBack: () => void
}
