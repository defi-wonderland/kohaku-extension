import type { ReactNode } from 'react'

import type {
  EntryRead,
  HiddenLevel,
  ReadoutRowContext,
  ShapeNote,
  UnlockState
} from '@web/modules/social-recovery/recovery/entry/types'
import type {
  Address,
  Configuration,
  LogPosition,
  PrivacyLevel,
  SetupDraft,
  SetupState
} from '@web/modules/social-recovery/sdk-interfaces'
import type {
  ChainReads,
  KeyHandle,
  ListedAccountFacts,
  ReceiptReads,
  RecoveryKitClient,
  SendPort,
  SendRequestPort
} from '@web/modules/social-recovery/shared/client'
import type { RecoveryClientState } from '@web/modules/social-recovery/shared/client/useRecoveryClient'
import type { ChainId, WalletRecords } from '@web/modules/social-recovery/shared/records'
import type { OverviewIntent } from '@web/modules/social-recovery/shared/writes'
import type { AttemptEnding } from '@web/modules/social-recovery/watcher'

// ---------------------------------------------------------------------------
// The chain's reading of the account
// ---------------------------------------------------------------------------

/**
 * What the overview draws from the setup and the authorization: no setup and
 * no authorization, both, a setup the account no longer authorizes, or an
 * authorization with no setup behind it.
 */
export type OverviewKind = 'not-set-up' | 'set-up' | 'dormant' | 'mirror'

/** The setup state and whether an attempt is open on the account, pending or ready. */
export interface OverviewFacts {
  setup: SetupState
  attemptOpen: boolean
}

/** The chain read of the overview, with the client's own state where it cannot read. */
export type OverviewFactsRead =
  | EntryRead<OverviewFacts>
  /** This wallet version cannot read the setup; only an update of the wallet helps. */
  | { status: 'update-the-wallet' }

// ---------------------------------------------------------------------------
// The path
// ---------------------------------------------------------------------------

/** How the overview stands with the path of the committed setup. */
export type PathStep =
  | { kind: 'none' }
  | { kind: 'reading' }
  | { kind: 'read-failed' }
  | { kind: 'update-the-wallet' }
  | { kind: 'no-details' }
  | { kind: 'mismatch' }
  /** This device cannot read the path until the recovery password opens it. */
  | { kind: 'locked'; level: HiddenLevel; shape?: ShapeNote }
  | { kind: 'readable'; configuration: Configuration }

// ---------------------------------------------------------------------------
// The notices
// ---------------------------------------------------------------------------

/** A method whose trusted keys moved since the setup was committed, at its latest update. */
export interface MovedKeys {
  method: Address
  at: LogPosition
}

/** What the logs since the commit hold: the moved keys and the attempts a cancel ended. */
export interface OverviewNotices {
  moved: MovedKeys[]
  cancelledAttempts: bigint[]
}

/** The notice after an ended attempt: the road that ended it and when, in seconds. */
export interface EndedNotice {
  road: 'ownerCancel' | 'setupWrite'
  at: number
}

// ---------------------------------------------------------------------------
// The reads hook
// ---------------------------------------------------------------------------

export interface OverviewReadsInput {
  client: RecoveryClientState & { retry: () => void }
  records: Pick<WalletRecords, 'decryptedSetupCache'>
  chainId: ChainId
  account: Address
}

export interface OverviewReads {
  facts: OverviewFactsRead
  path: PathStep
  /** The password ask, shared by the locked path and the re-authorize step. */
  ask: UnlockState
  notices: EntryRead<OverviewNotices>
  /** Reads the setup state and the attempt again, and everything that follows from them. */
  retry: () => void
  retryPath: () => void
  retryNotices: () => void
  /** Opens the setup with the recovery password and keeps it on this device. */
  unlock: (password: string) => void
  /** Leaves the wrong password's line for the password field. */
  askAgain: () => void
}

// ---------------------------------------------------------------------------
// The writes
// ---------------------------------------------------------------------------

/** The three writes the overview sends. */
export type { OverviewIntent }

/** The privacy level the committed setup reads at, or a setup this build cannot read. */
export type LevelRead = EntryRead<PrivacyLevel> | { status: 'unreadable' }

export interface OverviewStepsInput {
  intent: OverviewIntent
  client: RecoveryKitClient
  reads: ChainReads
  receipts: ReceiptReads
  port: SendPort
  requests: SendRequestPort
  records: Pick<WalletRecords, 'saveSetup' | 'saveInFlight' | 'setup' | 'decryptedSetupCache'>
  chainId: ChainId
  account: Address
  facts: ListedAccountFacts
  key: KeyHandle
  /** The re-authorize's rebuilt draft; a removal carries the removal's stand-in. */
  draft: SetupDraft
  password: string | undefined
  /** The re-authorize found an attempt open before it prepared, and sent nothing. */
  onAttemptOpen: () => void
}

/** The keys of a write step's title, lead and action. */
export interface StepHeadings {
  title: string
  lead: string
  action: string
}

// ---------------------------------------------------------------------------
// The views
// ---------------------------------------------------------------------------

export interface PathLockedAskProps {
  ask: UnlockState
  onUnlock: (password: string) => void
  onAskAgain: () => void
  onRetry: () => void
  /** Leaves out the title and the line, where the step around the ask carries its own. */
  bare?: boolean
  testID: string
}

export interface OverviewViewProps {
  reads: OverviewReads
  context: ReadoutRowContext
  /** The recovery chain's name, as the wallet lists its network. */
  networkName: string
  timeZone: string
  /** The last ending the watcher read for the account, where it read one. */
  ending: AttemptEnding | undefined
  /** The wallet's name of a method, for the moved-keys notice. */
  methodNameOf: (method: Address) => string
  /** The admin a moved method's declaration names, where its read answered. */
  adminOf: (method: Address) => Address | undefined
  /** The cancel lane's banner of the account, drawn while an attempt is open. */
  banner: ReactNode
  /** The open write step, drawn in place of the overview's body. */
  step: ReactNode
  onOpen: (intent: OverviewIntent) => void
  navigate: (to: string) => void
}

export interface OverviewWriteStepProps {
  intent: OverviewIntent
  client: RecoveryKitClient
  chainReads: ChainReads
  receipts: ReceiptReads
  records: OverviewStepsInput['records']
  chainId: ChainId
  account: Address
  facts: OverviewFacts
  reads: OverviewReads
  /** Starts the write once it can, where the press that opened the step was the holder's confirmation. */
  autoStart: boolean
  /** The run ended where the overview reads the chain again. */
  onFinished: () => void
  onClose: () => void
  navigate: (to: string) => void
}

export interface OverviewStageProps {
  records: WalletRecords
  chainId: ChainId
  account: Address
  navigate: (to: string) => void
}

/** The step the overview has open, and whether it starts by itself. */
export interface OpenStep {
  intent: OverviewIntent
  autoStart: boolean
}
