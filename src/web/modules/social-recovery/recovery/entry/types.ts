import type { ReactNode } from 'react'

import type { Account } from '@ambire-common/interfaces/account'
import type { Key } from '@ambire-common/interfaces/keystore'
import type {
  Address,
  IRecoveryActionInteractor,
  ISetupClient,
  SetupState
} from '@web/modules/social-recovery/sdk-interfaces'
import type {
  FitCheckReading,
  KeyHandle,
  RecoveryKitClient,
  RemovedKeyReading,
  WalletReads
} from '@web/modules/social-recovery/shared/client'
import type {
  ChainId,
  RecoveryRoute,
  WalletRecords
} from '@web/modules/social-recovery/shared/records'

// ---------------------------------------------------------------------------
// The search the account step reads
// ---------------------------------------------------------------------------

/** The account step's search: the route the holder came by and the account that receives control. */
export interface AccountStepSearch {
  route: RecoveryRoute
  receivingAccount: Address
}

// ---------------------------------------------------------------------------
// The receiving account
// ---------------------------------------------------------------------------

/** The account record the owner stage reads, as the wallet lists it. */
export type ReceivingAccountSource = Account

/** The keystore fields the owner stage reads. */
export type HeldKeySource = Pick<Key, 'addr' | 'type'>

/** One of the wallet's accounts that can receive control, with the key a recovery installs. */
export interface ReceivingChoice {
  account: ReceivingAccountSource
  address: Address
  /** The key the wallet holds for the account. */
  key: KeyHandle
  smart: boolean
}

// ---------------------------------------------------------------------------
// The lookup
// ---------------------------------------------------------------------------

/** What the holder typed in the account field. */
export type LookupInput =
  | { kind: 'empty' }
  | { kind: 'address'; address: Address }
  | { kind: 'name'; name: string }
  | { kind: 'malformed' }

/** The account the step looks up, with the name it resolved from where one did. */
export interface LookupTarget {
  address: Address
  name?: string
}

/** Why the field refuses what the holder typed, or why its name lookup failed. */
export type FieldError = 'malformed' | 'name' | 'read-failed'

/** The part of the recovery client the account step reads. */
export type EntryKitClient = Pick<RecoveryKitClient, 'descriptor'> & {
  setup: Pick<ISetupClient, 'setupState'>
  action: Pick<
    IRecoveryActionInteractor,
    'isAuthorized' | 'supportsAccount' | 'isAuthority' | 'holdsAnyPrivilege'
  >
  walletReads: Pick<WalletReads, 'removedKey' | 'fitCheck'>
}

/** The recovery client for the looked-up account, as the view takes it. */
export type EntryClient =
  | { status: 'loading' }
  | { status: 'ready'; client: EntryKitClient }
  /** This wallet version cannot read the setup; only an update of the wallet helps. */
  | { status: 'update-the-wallet' }
  | { status: 'failed'; retry: () => void }

// ---------------------------------------------------------------------------
// The reads after the confirmation
// ---------------------------------------------------------------------------

/** One read: still running, answered, or thrown. */
export type EntryRead<T> =
  | { status: 'pending' }
  | { status: 'answered'; value: T }
  | { status: 'failed' }

/** What the fit reads answer: the action's own verdict, the wallet's fit check and the removed key. */
export interface FitAnswers {
  supportsAccount: boolean
  fitCheck: FitCheckReading
  removedKey: RemovedKeyReading
  /** Whether the named removed key holds control of the account; absent where no key is named. */
  removedKeyIsAuthority?: boolean
}

/** What the destination reads answer about the key a recovery installs. */
export interface DestinationAnswers {
  isAuthority: boolean
  holdsAnyPrivilege: boolean
}

/** The reads after the confirmation, in the order they run. */
export type ConfirmedStage = 'authorization' | 'fit' | 'destination'

/** Each read after the confirmation; a read that has not started yet is absent. */
export interface ConfirmedReads {
  authorization?: EntryRead<boolean>
  fit?: EntryRead<FitAnswers>
  destination?: EntryRead<DestinationAnswers>
}

export interface ConfirmedReadsState extends ConfirmedReads {
  /** Runs again the first read that failed, and the ones after it. */
  retry: () => void
}

/** Why this release cannot recover the account, by the code the wallet writes its reason from. */
export type RecoverRefusal =
  | 'not-supported'
  | 'several-keys'
  | 'removed-unknown'
  | 'removed-not-authority'

/** Why the key a recovery installs cannot be installed on the account. */
export type DestinationRefusal = 'already-a-key' | 'holds-privilege'

/** Where the account step stands after the confirmation, the first that applies. */
export type ConfirmedStep =
  | { kind: 'reading'; stage: ConfirmedStage }
  | { kind: 'failed'; stage: ConfirmedStage }
  | { kind: 'dormant' }
  | { kind: 'cannot-recover'; refusal: RecoverRefusal }
  | { kind: 'destination'; refusal: DestinationRefusal }
  | { kind: 'ready' }

// ---------------------------------------------------------------------------
// The views
// ---------------------------------------------------------------------------

export interface EntryChromeProps {
  route: RecoveryRoute
  /** The stage the counter shows on the logged-in route. */
  stage: number
  children: ReactNode
  testID?: string
}

export interface OwnerStageViewProps {
  choices: readonly ReceivingChoice[]
  /** False while the wallet has not pushed its accounts and keys yet. */
  loaded: boolean
  onContinue: (receivingAccount: Address) => void
}

export interface ReceivingRowProps {
  choice: ReceivingChoice
  selected: boolean
  disabled: boolean
  onSelect: (address: Address) => void
}

export interface AccountStepViewProps {
  records: Pick<WalletRecords, 'recoveryEntry' | 'recoverySession'>
  chainId: ChainId
  search: AccountStepSearch
  /** The key a recovery installs: the receiving account's own key. */
  destination: Address
  networkName: string
  /** The account being looked up, or null while the field shows. */
  target: LookupTarget | null
  onTarget: (target: LookupTarget | null) => void
  /** The recovery client for the target. */
  client: EntryClient
  /** Resolves a name to an address; an empty answer is a name that does not resolve. */
  resolveName: (name: string) => Promise<string>
  navigate: (to: string) => void
}

export interface LookupFieldProps {
  networkName: string
  onTarget: (target: LookupTarget) => void
  resolveName: (name: string) => Promise<string>
}

export interface LookupStateProps {
  target: LookupTarget
  networkName: string
  client: EntryClient
  setupState: EntryRead<SetupState>
  onRetrySetup: () => void
  onAnotherAddress: () => void
  /** Leaves the recovery; absent where the route has nowhere to leave to. */
  onClose?: () => void
}

export interface ConfirmAccountProps {
  target: LookupTarget
  networkName: string
  /** True while the entry record is being written. */
  writing: boolean
  writeFailed: boolean
  onConfirm: () => void
  onNotMine: () => void
}

export interface ConfirmedReadsViewProps {
  step: ConfirmedStep
  route: RecoveryRoute
  networkName: string
  /** Whether the setup read reported an attempt running against the account. */
  attemptActive: boolean
  onRetry: () => void
  /** Leaves a blocked state for the account field. */
  onBack: () => void
  /** Leaves a refusal about the installed key for the choice of another account. */
  onChooseAnother: () => void
  onContinue: () => void
}

export interface CondensedGateProps {
  /** Runs once the holder ticked the acknowledgment and pressed continue. */
  onPass: () => void
}

export interface ReadFailedBlockProps {
  title: string
  body: string
  onRetry: () => void
  testID: string
}
