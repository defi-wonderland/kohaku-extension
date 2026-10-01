import type {
  Address,
  Hex,
  ISetupClient,
  PreparedBatch,
  PreparedCall,
  SetupConfirmation,
  SetupDraft
} from '@web/modules/social-recovery/sdk-interfaces'
import type {
  AccountFactsReading,
  AuditedAction,
  ChainReads,
  KeyHandle,
  ListedAccountFacts,
  ReceiptWait,
  RecoveryChain,
  RecoveryKitClient,
  SendPort,
  UnknownAction
} from '@web/modules/social-recovery/shared/client'
import type {
  ChainId,
  Enrollment,
  SetupRecords,
  WalletRecords
} from '@web/modules/social-recovery/shared/records'
import type {
  GasCheck,
  WriteEvent,
  WriteMachineState
} from '@web/modules/social-recovery/shared/writes'
import type { CardLevel } from '@web/modules/social-recovery/setup/card'
import type { SaveBlock, SaveGate } from '@web/modules/social-recovery/setup/review'

// ---------------------------------------------------------------------------
// The check after the batch lands
// ---------------------------------------------------------------------------

/** The check that disagreed after a landed save: the commitment, or the module's authorization. */
export type DisagreedCheck = 'mismatch' | 'authorization'

/**
 * What the check after a landed save reads: the setup agrees and the module
 * recognizes the account's authorization; one of the two disagrees; or the
 * check itself did not answer.
 */
export type ConfirmOutcome =
  | { kind: 'agreed' }
  | { kind: 'disagreed'; check: DisagreedCheck }
  | { kind: 'unread' }

export interface ConfirmReadOptions {
  /** How long one read may take before it reads as unanswered, in ms. */
  timeoutMs?: number
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** The save as prepared: the draft it commits, the prepared write and the batch's calls in order. */
export interface PreparedSave {
  draft: SetupDraft
  prepared: PreparedCall | PreparedBatch
  calls: readonly PreparedCall[]
}

/**
 * Where the save stands after its batch landed: not there yet, the check
 * running, the records being wiped after the check agreed, saved, the check
 * disagreed, or the check did not answer.
 */
export type AfterLanding =
  | { stage: 'none' }
  | { stage: 'confirming' }
  | { stage: 'saving' }
  | { stage: 'saved' }
  | { stage: 'disagreed'; check: DisagreedCheck }
  | { stage: 'unread' }

/** The save's state: the shared write's state, the prepared save of its run, and what follows the landing. */
export interface ArmState {
  write: WriteMachineState
  /** The save the run prepared; absent until the prepare answered in this run. */
  prepared?: PreparedSave
  after: AfterLanding
}

/** What moves the save. Every event but `write` carries the run it answers. */
export type ArmEvent =
  | { type: 'write'; event: WriteEvent }
  | { type: 'prepared'; run: number; prepared: PreparedSave }
  | { type: 'confirming'; run: number }
  | { type: 'confirmed'; run: number; outcome: ConfirmOutcome }
  | { type: 'wiped'; run: number }

/** The save's state held outside React, so the run reads where it stands between its steps. */
export interface ArmStore {
  state(): ArmState
  dispatch(event: ArmEvent): void
  /** Calls the listener after each change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
}

/** The steps of one save, each over the wallet's own seams. */
export interface SaveSteps {
  /** The draft as it is committed, the prepared write and its calls. */
  prepare(): Promise<PreparedSave>
  /** The gas check of the batch the controlling key sends. */
  checkGas(save: PreparedSave): Promise<GasCheck>
  /** Sends the batch and follows its receipt, feeding the write's events to `dispatch`. */
  send(save: PreparedSave, dispatch: (event: WriteEvent) => void, run: number): Promise<void>
  /** The check after the batch lands. */
  confirm(save: PreparedSave): Promise<SetupConfirmation>
  /** Wipes the six setup records. */
  wipe(): Promise<void>
}

/** The part of the recovery client the save runs on. */
export type ArmKitClient = Pick<RecoveryKitClient, 'descriptor'> & {
  setup: Pick<ISetupClient, 'prepareCommitSetup' | 'confirmSetup'>
}

/** What the save's steps are built from. */
export interface SaveStepsInput {
  client: ArmKitClient
  reads: ChainReads
  receipts: ReceiptWait
  port: SendPort
  records: Pick<WalletRecords, 'saveSetup'>
  setup: Pick<SetupRecords, 'writeDraftAndPath'>
  chainId: ChainId
  account: Address
  /** The account's facts; the account library builds the batch's transaction from them. */
  facts: ListedAccountFacts
  /** The account's controlling key, which sends the batch and pays its gas. */
  key: KeyHandle
  /** The setup draft as the records hold it. */
  draft: SetupDraft
  /** The recovery password in memory, for an encrypted backup. */
  password: string | undefined
}

// ---------------------------------------------------------------------------
// Arrival
// ---------------------------------------------------------------------------

/** The client as the save takes it. */
export type ArmClientStatus = 'loading' | 'ready' | 'update-the-wallet' | 'failed'

/** The setup records the save reads on arrival. */
export type ArmLoad =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'loaded'; draft: SetupDraft; enrollments: Enrollment[]; passwordSet: boolean }

/** The setup records as read, with a retry of a read that failed. */
export interface SaveLoad {
  load: ArmLoad
  retry: () => void
}

/** What decides the save on arrival. */
export interface ArrivalInput {
  facts: AccountFactsReading
  client: ArmClientStatus
  load: ArmLoad
  /** The review's gate, run again over the same reads. */
  gate: SaveGate
  /** Whether the recovery password is in memory. */
  passwordHeld: boolean
}

/** Which retry clears an unavailable arrival, where one does. */
export type ArrivalRetry = 'facts' | 'client' | null

/**
 * The save on arrival: still reading, unavailable, a wallet that must update,
 * records that could not be read, a block the review's gate (or the missing
 * recovery password) raises, or ready to send.
 */
export type Arrival =
  | { kind: 'loading' }
  | { kind: 'unavailable'; retry: ArrivalRetry }
  | { kind: 'update-the-wallet' }
  | { kind: 'load-failed' }
  | { kind: 'blocked'; block: SaveBlock }
  | { kind: 'ready' }

/** What the screen shows: the arrival, the run, the check running, saved, disagreed or the check unanswered. */
export type ArmScreenKind = 'arrival' | 'run' | 'confirming' | 'saved' | 'disagreed' | 'unread'

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** The keys of the save's own title and sentence over a shared write state. */
export interface SaveWriteKeys {
  title?: string
  note?: string
}

/** The account the save writes to and the key a recovery would remove, as the view shows them. */
export interface ArmAccount {
  address: Address
  /** The label the wallet holds for the account, where it holds one. */
  label?: string
  /** The key a recovery would remove, as the reads named it. */
  removedKey?: Address
  /** Whether the account has code on the chain; undefined until the facts are read. */
  deployed?: boolean
}

export interface ArmViewProps {
  arrival: Arrival
  state: ArmState
  account: ArmAccount
  /** The action that will hold the account's authority, where the client named it. */
  action?: AuditedAction | UnknownAction
  chain: RecoveryChain
  /** The level the Recovery Card shows. */
  level: CardLevel
  /** Retries the arrival's reads that did not answer. */
  onRetryReads: () => void
  /** Retries the arrival's unavailable read. */
  onRetryArrival: () => void
  /** Runs the save again from its prepare. */
  onRetry: () => void
  /** Runs the gas check again from the deposit blocker. */
  onRecheck: () => void
  /** Reads the check after the landing again. */
  onReread: () => void
  navigate: (to: string) => void
  openUrl: (url: string) => void
}

export interface SavedViewProps {
  transactionHash: Hex
  chain: RecoveryChain
  account: ArmAccount
  level: CardLevel
  navigate: (to: string) => void
  openUrl: (url: string) => void
}

export interface DisagreedViewProps {
  transactionHash: Hex
  chain: RecoveryChain
  /** The check that disagreed; absent where the check did not answer. */
  check?: DisagreedCheck
  onReread: () => void
  navigate: (to: string) => void
  openUrl: (url: string) => void
}

export interface ArmRun {
  state: ArmState
  /** Starts the save, or runs it again from a state that offers the retry. */
  start: () => void
  /** Runs the gas check again from the deposit blocker. */
  recheck: () => void
  /** Reads the check after the landing again, where it did not answer. */
  reread: () => void
}
