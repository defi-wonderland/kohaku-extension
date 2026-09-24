/**
 * The closed vocabularies of D-302: the status chips, the screen words of the
 * kit's nouns, the two password names and the names of the values a guardian
 * checks.
 *
 * Sources: docs/social-recovery/design/ux.md D-302, ux-copy.md UXC-6, UXC-9,
 * UXC-10 and UXC-14, invariants.yaml I-26. Every word here is a key of the
 * `socialRecovery.status` or `socialRecovery.display` block of en.json; no
 * screen spells one on its own. No chip names the account as safe, I-26.
 */
import { appTranslate, Translate } from './translate'

// ---------------------------------------------------------------------------
// Status chips
// ---------------------------------------------------------------------------

/**
 * A method in setup (D-302). Each test outcome keeps its own chip: a skipped
 * test reads not tested, a failed one test failed, one that could not run
 * test unavailable, a document the method cannot serve not supported.
 */
export const METHOD_CHIPS = [
  'notStarted',
  'inProgress',
  'tested',
  'notTested',
  'testFailed',
  'testUnavailable',
  'notSupported',
  'notYetActive',
  'saved',
  'live'
] as const
export type MethodChip = typeof METHOD_CHIPS[number]

/**
 * A row in collection (D-302). `didNotAnswer` and `stopped` are second-release
 * words (D-393): they stay in the set, and a first-release screen never selects
 * them. Unanswered and did not answer never share a row.
 */
export const COLLECTION_CHIPS = [
  'notAsked',
  'waiting',
  'declined',
  'unanswered',
  'complete',
  'notNeeded',
  'didNotAnswer',
  'stopped'
] as const
export type CollectionChip = typeof COLLECTION_CHIPS[number]

/**
 * A running attempt and its terminal (D-302). `stopped` is a second-release
 * word. A session before submission is no attempt and reads `SESSION_CHIPS`.
 */
export const ATTEMPT_CHIPS = [
  'recoveryInProgress',
  'waiting',
  'executionDue',
  'stopped',
  'cancelled'
] as const
export type AttemptChip = typeof ATTEMPT_CHIPS[number]

/** The recovery status on the overview in the first releases (D-302). */
export const RECOVERY_STATES = ['setUp', 'notSetUp'] as const
export type RecoveryState = typeof RECOVERY_STATES[number]

/**
 * The three chips that render beside the recovery status (D-302): path locked
 * beside set up where this device cannot read the path, not active where the
 * account no longer authorizes the setup, cannot recover where the wallet
 * refuses to recover the account.
 */
export const RECOVERY_ASIDE_CHIPS = ['pathLocked', 'notActive', 'cannotRecover'] as const
export type RecoveryAsideChip = typeof RECOVERY_ASIDE_CHIPS[number]

/** The recovery status set whole: the two states and the three chips beside them. */
export const RECOVERY_STATUS_CHIPS = [...RECOVERY_STATES, ...RECOVERY_ASIDE_CHIPS] as const
export type RecoveryStatusChip = typeof RECOVERY_STATUS_CHIPS[number]

/** A session before submission (D-302). Recovery in progress never renders for it. */
export const SESSION_CHIPS = ['notSubmitted'] as const
export type SessionChip = typeof SESSION_CHIPS[number]

/** The three chips that end a whole request and drop every row to not asked (D-302, D-392). */
export const REQUEST_CHIPS = ['expired', 'void', 'setupChanged'] as const
export type RequestChip = typeof REQUEST_CHIPS[number]

/** The editor's chip on a member the path cannot lose (D-302, D-309). */
export const EDITOR_CHIPS = ['stillNeeded'] as const
export type EditorChip = typeof EDITOR_CHIPS[number]

/** Every chip set by name. */
export const CHIP_SETS = {
  method: METHOD_CHIPS,
  collection: COLLECTION_CHIPS,
  attempt: ATTEMPT_CHIPS,
  recovery: RECOVERY_STATUS_CHIPS,
  session: SESSION_CHIPS,
  request: REQUEST_CHIPS,
  editor: EDITOR_CHIPS
} as const
export type ChipSetName = keyof typeof CHIP_SETS
export type Chip<S extends ChipSetName> = typeof CHIP_SETS[S][number]

// The en.json block under `socialRecovery.status` each set reads. A session's
// one chip sits in the attempt block of en.json.
const CHIP_SET_BLOCK: { readonly [S in ChipSetName]: string } = {
  method: 'method',
  collection: 'collection',
  attempt: 'attempt',
  recovery: 'recovery',
  session: 'attempt',
  request: 'request',
  editor: 'editor'
}

/** Tells whether `value` is a chip of `set`. */
export const isChip = <S extends ChipSetName>(set: S, value: string): value is Chip<S> =>
  (CHIP_SETS[set] as readonly string[]).includes(value)

/** The i18n key of one chip, `socialRecovery.status.<block>.<chip>`. */
export const chipKey = <S extends ChipSetName>(set: S, chip: Chip<S>): string =>
  `socialRecovery.status.${CHIP_SET_BLOCK[set]}.${chip}`

/** The screen word of one chip. */
export const renderChip = <S extends ChipSetName>(
  set: S,
  chip: Chip<S>,
  t: Translate = appTranslate
): string => t(chipKey(set, chip))

// ---------------------------------------------------------------------------
// Nouns
// ---------------------------------------------------------------------------

/**
 * The kit's nouns under the screen word D-302 fixes: the registry of setups is
 * the recovery registry, the action the recovery module, its author the
 * publisher, a method's pause a security stop, the setup version the setup
 * number and the attempt's id the attempt number.
 */
export const KIT_NOUNS = [
  'recoveryRegistry',
  'recoveryModule',
  'publisher',
  'securityStop',
  'setupNumber',
  'attemptNumber'
] as const
export type KitNoun = typeof KIT_NOUNS[number]

/** The feature's concept names (UXC-10) and the role in prose and help (D-302). */
export const CONCEPT_NOUNS = ['recoveryPath', 'method', 'waitingPeriod', 'guardian'] as const
export type ConceptNoun = typeof CONCEPT_NOUNS[number]

/** A method's key admin and a method's pause holder under their screen words (D-302). */
export const PARTY_NOUNS = ['methodAdmin', 'stopHolder'] as const
export type PartyNoun = typeof PARTY_NOUNS[number]

export type Noun = KitNoun | ConceptNoun | PartyNoun

/** The i18n key of one noun, `socialRecovery.display.nouns.<noun>`. */
export const nounKey = (noun: Noun): string => `socialRecovery.display.nouns.${noun}`

/** The screen word of one noun. */
export const renderNoun = (noun: Noun, t: Translate = appTranslate): string => t(nounKey(noun))

/**
 * The two passwords and their one name each (D-302, UXC-9): the extension
 * password unlocks the device, the recovery password decrypts the recovery
 * setup at the two hidden privacy levels. No screen takes both in one field.
 */
export const PASSWORD_NAMES = ['extensionPassword', 'recoveryPassword'] as const
export type PasswordName = typeof PASSWORD_NAMES[number]

/** The i18n key of one password name, `socialRecovery.display.passwords.<name>`. */
export const passwordKey = (name: PasswordName): string =>
  `socialRecovery.display.passwords.${name}`

/** The screen name of one password. */
export const renderPasswordName = (name: PasswordName, t: Translate = appTranslate): string =>
  t(passwordKey(name))

// ---------------------------------------------------------------------------
// Value names
// ---------------------------------------------------------------------------

/**
 * The four values a guardian's surfaces name, one name each on every screen
 * (D-302, UXC-14). The payment renders the words no payment where the request
 * names none, through `renderPaymentOrder`.
 */
export const APPROVAL_VALUES = ['newKey', 'keyBeingRemoved', 'payment', 'deadline'] as const
export type ApprovalValue = typeof APPROVAL_VALUES[number]

/**
 * The done screen's one exception to one name per value (D-302): the recovery
 * has run, so the new key reads controlled by and the removed key removed.
 */
export const DONE_VALUE_NAMES = {
  newKey: 'controlledBy',
  keyBeingRemoved: 'removed'
} as const

/** Every label of `socialRecovery.display.values`. */
export const VALUE_LABELS = [
  'account',
  'accountBeingRecovered',
  'newKey',
  'keyBeingRemoved',
  'payment',
  'noPayment',
  'deadline',
  'controlledBy',
  'removed'
] as const
export type ValueLabel = typeof VALUE_LABELS[number]

/** The i18n key of one value label, `socialRecovery.display.values.<label>`. */
export const valueLabelKey = (label: ValueLabel): string => `socialRecovery.display.values.${label}`

/** The screen name of one value label. */
export const renderValueLabel = (label: ValueLabel, t: Translate = appTranslate): string =>
  t(valueLabelKey(label))

/**
 * The name of one of the four approval values. On the done screen the two keys
 * read controlled by and removed; every other value keeps its one name there.
 */
export const renderApprovalValueName = (
  value: ApprovalValue,
  options: { doneScreen?: boolean } = {},
  t: Translate = appTranslate
): string => {
  if (options.doneScreen && (value === 'newKey' || value === 'keyBeingRemoved')) {
    return renderValueLabel(DONE_VALUE_NAMES[value], t)
  }
  return renderValueLabel(value, t)
}

/**
 * The wallet's words for what the SDK computed or read (D-302): a masked value
 * reads none this wallet can see, a returned value as this wallet read it.
 */
export const WALLET_WORDS = ['noneThisWalletCanSee', 'asThisWalletRead'] as const
export type WalletWord = typeof WALLET_WORDS[number]

/** The i18n key of one wallet word, `socialRecovery.display.<word>`. */
export const walletWordKey = (word: WalletWord): string => `socialRecovery.display.${word}`

/** The screen words of one wallet word. */
export const renderWalletWord = (word: WalletWord, t: Translate = appTranslate): string =>
  t(walletWordKey(word))
