import type { KeystoreSeed } from '@ambire-common/interfaces/keystore'
import type useKeyStoreSetup from '@web/modules/keystore/components/KeyStoreSetupForm/hooks/useKeyStoreSetup'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import type { ChainReads } from '@web/modules/social-recovery/shared/client'
import type { RecoveryEntryRecord } from '@web/modules/social-recovery/shared/records'
import type { DepositStep, GasNetwork } from '@web/modules/social-recovery/shared/writes'

/** The router state the warning hands the fast track once the holder acknowledged it. */
export interface FastTrackNavigationState {
  acknowledged: true
}

/** The recovery phrase the keystore holds before the accounts are added, as it sends it to the page. */
export type TempSeed = Omit<KeystoreSeed, 'id' | 'label'>

/**
 * The two keys of one slot of a recovery phrase: the ordinary key at the
 * slot's index, which the wallet lists as a basic account, and the key at the
 * index plus the smart-account offset, which controls the slot's smart account.
 */
export interface SlotKeys {
  ordinaryKey: Address
  controllingKey: Address
}

/** The slot's two accounts once the wallet lists them and the keystore holds both keys. */
export interface ListedSlot {
  basicAccount: Address
  smartAccount: Address
}

// ---------------------------------------------------------------------------
// Step 2, the extension password
// ---------------------------------------------------------------------------

/** What the wallet's keystore setup hook hands the form. */
export type KeyStoreSetup = ReturnType<typeof useKeyStoreSetup>

export interface PasswordStepViewProps {
  setup: KeyStoreSetup
  /** Goes back to the warning. */
  onBack: () => void
}

// ---------------------------------------------------------------------------
// Step 3, the key and its recovery phrase
// ---------------------------------------------------------------------------

/**
 * Where the key step stands:
 * - `creating`: the keystore has not confirmed the new recovery phrase yet;
 * - `createFailed`: it did not within the limit;
 * - `words`: the words are on screen, waiting for the acknowledgment and continue;
 * - `adding`: the wallet is adding the slot's accounts;
 * - `addFailed`: the picker is idle again and added nothing, so nothing was saved;
 * - `listed`: the wallet lists both accounts and the keystore holds both keys.
 */
export type KeyStepPhase = 'creating' | 'createFailed' | 'words' | 'adding' | 'addFailed' | 'listed'

export interface FastTrackKey {
  phase: KeyStepPhase
  /** The recovery phrase's words, in order; empty until the keystore confirmed the phrase. */
  words: readonly string[]
  /** The key that will control the account, derived from the phrase; null until derived. */
  controllingKey: Address | null
  /** The slot's accounts once listed. */
  listed: ListedSlot | null
  /** Adds the slot's accounts; runs only from `words` or `addFailed`. */
  add: () => void
  /** Starts the failed part again: the phrase from `createFailed`, the add from `addFailed`. */
  retry: () => void
}

export interface KeyStepViewProps {
  phase: KeyStepPhase
  words: readonly string[]
  controllingKey: Address | null
  acknowledged: boolean
  onAcknowledge: (acknowledged: boolean) => void
  onContinue: () => void
  onRetry: () => void
  /** Goes back to the warning; disabled while the wallet adds the accounts. */
  onBack: () => void
}

/** The phrase this mount made, with the run that made it. */
export interface MadePhrase {
  run: number
  phrase: string
}

/** What the picker went through since the last add started. */
export interface AddProgress {
  started: boolean
  loading: boolean
  success: boolean
}

// ---------------------------------------------------------------------------
// The gas step
// ---------------------------------------------------------------------------

/** The recovery entry's read, as the gas step holds it. */
export type EntryReading =
  | { status: 'loading' }
  | { status: 'absent' }
  | { status: 'present'; entry: RecoveryEntryRecord }
  | { status: 'failed' }

/** What the submission's gas check takes on the fast track. */
export interface SubmissionCheckInput {
  reads: Pick<ChainReads, 'gasPrice' | 'nativeBalance'>
  /** The sending key: the ordinary key of the seed slot whose smart account receives control. */
  key: Address
  network: GasNetwork
  /** The gas the check assumes for the submission. */
  gas?: bigint
}

/**
 * Where the gas step stands: reading, a failed read with retry, no key in this
 * wallet that can send the recovery (no retry), the deposit step while the key
 * holds too little, or enough, so the step moves on.
 */
export type GasStepState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'noSendingKey' }
  | { kind: 'deposit'; step: DepositStep }
  | { kind: 'enough' }

export interface SubmissionGas {
  state: GasStepState
  retry: () => void
}

export interface GasStepViewProps {
  state: GasStepState
  onRetry: () => void
  /** Goes back to the readout. */
  onBack: () => void
  /** Goes back to the account step, where no key in this wallet can send the recovery. */
  onBackToAccount: () => void
}
