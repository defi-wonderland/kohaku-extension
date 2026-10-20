import type { ReactNode } from 'react'

import type { OverviewReads } from '@web/modules/social-recovery/management/overview/types'
import type { EntryRead } from '@web/modules/social-recovery/recovery/entry/types'
import type {
  Address,
  Clause,
  Configuration,
  Credential,
  Hex,
  PrivacyLevel,
  SetupDraft,
  SetupState
} from '@web/modules/social-recovery/sdk-interfaces'
import type {
  AddressBook,
  ChainReads,
  KeyHandle,
  ListedAccountFacts,
  ReceiptReads,
  RecoveryKitClient,
  SendPort,
  SendRequestPort
} from '@web/modules/social-recovery/shared/client'
import type {
  ChainId,
  Enrollment,
  RecordStorage,
  SetupRecords,
  WalletRecords
} from '@web/modules/social-recovery/shared/records'
import type { ManageIntent, OwnerWrite } from '@web/modules/social-recovery/shared/writes'
import type { ArmRun } from '@web/modules/social-recovery/setup/arm'
import type {
  AccountReads,
  SaveGate,
  UntestedCredential
} from '@web/modules/social-recovery/setup/review'

// ---------------------------------------------------------------------------
// The edit session
// ---------------------------------------------------------------------------

/** Whether the holder typed a new recovery password in this edit. Never a boolean. */
export type PasswordMark = 'kept' | 'changed'

/**
 * The edit session: the committed configuration the edit started from, the
 * setup nonce and commitment it was read under, the committed privacy level,
 * and whether a new recovery password was typed. The password itself lives in
 * memory alone.
 */
export interface EditSession {
  configuration: Configuration
  setupNonce: bigint
  setupCommitment: Hex
  level: PrivacyLevel
  password: PasswordMark
}

/** The edit session of one account on one chain. */
export interface EditSessionAccessor {
  read(): Promise<EditSession | undefined>
  write(session: EditSession): Promise<void>
  wipe(): Promise<void>
}

/** The storage the edit session sits on. */
export type EditSessionStorage = Pick<RecordStorage, 'get' | 'set' | 'remove'>

// ---------------------------------------------------------------------------
// The load into the setup records
// ---------------------------------------------------------------------------

/** The setup records a committed configuration loads into. */
export interface LoadedRecords {
  setupDraft: SetupDraft
  enrollments: Enrollment[]
  waitingPeriod: SetupDraft['wait']
  /** Whether the level hides the setup behind the recovery password. */
  hidden: boolean
}

/** What opening the edit reads: the setup records, the session, and the committed setup as read. */
export interface OpenEditInput {
  setup: SetupRecords
  session: EditSessionAccessor
  state: SetupState
  configuration: Configuration
  level: PrivacyLevel
}

// ---------------------------------------------------------------------------
// The changes
// ---------------------------------------------------------------------------

/** One committed value the edit changes. */
export type ChangeRow =
  | { kind: 'members'; added: number; removed: number }
  /** Members the path keeps, in other groups than before. */
  | { kind: 'pathChanged' }
  | { kind: 'rule'; before: string; after: string }
  | { kind: 'waitingPeriod'; before: SetupDraft['wait']; after: SetupDraft['wait'] }
  | { kind: 'privacy'; before: PrivacyLevel; after: PrivacyLevel }
  | { kind: 'password' }

export interface ChangesInput {
  baseline: EditSession
  draft: SetupDraft
  passwordChanged: boolean
  /** The rule a path reads as, in words. */
  ruleOf: (clauses: readonly Clause[]) => string
}

// ---------------------------------------------------------------------------
// The writes
// ---------------------------------------------------------------------------

/** Which write the account's stored write in flight belongs to. */
export type HeldWrite =
  | { status: 'pending' }
  | { status: 'failed' }
  | { status: 'none' }
  | { status: 'held'; write: ManageIntent }
  /** A write another screen stored. */
  | { status: 'other' }

/** What the review's save gate reads beside the setup review's own gate. */
export interface EditGateInput {
  gate: SaveGate
  rows: readonly ChangeRow[]
  /** The members the edit adds. */
  added: readonly Credential[]
  reads: AccountReads
  clientReady: boolean
}

export interface HeldWriteRead {
  held: HeldWrite
  /** Reads it again from its pending state, after a read that failed. */
  retry: () => void
  /** Reads it again and keeps the last answer until the new one. */
  refresh: () => void
}

/** The attempt as a write read it, right before the send. */
export interface AttemptRead {
  open: boolean
  /** The setup no longer authorized on the account while the attempt is open. */
  dormant: boolean
}

export interface EditorStepsInput {
  client: RecoveryKitClient
  reads: ChainReads
  receipts: ReceiptReads
  port: SendPort
  requests: SendRequestPort
  records: Pick<WalletRecords, 'saveSetup' | 'saveInFlight' | 'setup' | 'decryptedSetupCache'>
  session: EditSessionAccessor
  chainId: ChainId
  account: Address
  facts: ListedAccountFacts
  key: KeyHandle
  /** Hears the attempt as the write read it right before the send. */
  onAttempt?: (read: AttemptRead) => void
  /** Whether the screen shows the line that the write cancels the attempt in progress. */
  showsCancelLine?: () => boolean
}

/** What the local wipe after a removal reaches. */
export interface RemovedWipeInput {
  records: Pick<WalletRecords, 'setup' | 'decryptedSetupCache'>
  session: EditSessionAccessor
  chainId: ChainId
  account: Address
}

export interface EditStepsInput extends EditorStepsInput {
  /** The configuration and the nonce the edit started from. */
  baseline: EditSession
  /** The setup draft as the records hold it. */
  draft: SetupDraft
  /** The committed recovery password in memory, where the level hides the setup. */
  password: string | undefined
  /** The new recovery password, where the holder typed one. */
  newPassword: string | undefined
}

/** The seams a write runs through, from the wallet's own states. */
export interface WriteSeams {
  requests: SendRequestPort
  port: SendPort
}

// ---------------------------------------------------------------------------
// The views
// ---------------------------------------------------------------------------

/** What the edit screen shows: the path, or one value's step. */
export type EditStage = 'path' | 'wait' | 'privacy' | 'password'

/** The committed level as read for the edit. */
export type CommittedLevel = EntryRead<PrivacyLevel> | { status: 'unreadable' }

/** The setup records and the session the review reads. */
export type ReviewLoad =
  | { status: 'pending' }
  | { status: 'failed' }
  /** No edit is open: no draft or no session. */
  | { status: 'none' }
  | { status: 'loaded'; draft: SetupDraft; enrollments: Enrollment[]; baseline: EditSession }

export interface EditStageProps {
  records: WalletRecords
  session: EditSessionAccessor
  chainId: ChainId
  account: Address
  navigate: (to: string) => void
}

export interface ReadsGateProps {
  reads: OverviewReads
  /** The committed level, where the screen needs the path. */
  level?: CommittedLevel
  onRetryLevel?: () => void
  /** Whether the recovery password is in memory, where the level hides the setup. */
  passwordHeld?: boolean
  /** Whether the screen needs the path read, or the setup read alone. */
  needsPath?: boolean
  testID: string
  children: ReactNode
}

export interface PasswordChangeProps {
  onDone: (password: string) => void
  onCancel: () => void
}

export interface NotTestedBlockProps {
  untested: readonly UntestedCredential[]
  enrollments: readonly Enrollment[]
  addressBook: AddressBook
}

export interface DetailsExpanderProps {
  expanded: boolean
  onToggle: () => void
  testID: string
}

export interface ChangesBlockProps {
  rows: readonly ChangeRow[]
  stale: boolean
}

export interface RunBlockProps {
  run: ArmRun
  /** The write whose copy the shared states read. */
  write: OwnerWrite
  testID: string
}

export interface ValuesBlockProps {
  draft: SetupDraft
  addressBook: AddressBook
  passwordChanged: boolean
  stale: boolean
  onStage: (stage: EditStage) => void
}
