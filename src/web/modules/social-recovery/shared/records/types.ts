/**
 * The record types of the wallet's records (PT-040), docs/social-recovery/design/ux.md
 * D-310 and ux-interfaces.md D-370.
 *
 * The setup draft is the SDK's own `SetupDraft` (sdk-interfaces, sdk.md D-202) and
 * the path is the `clauses` it holds, the record PT-037's rule lines read. The
 * other records are this lane's own types. No record is a bare boolean or zero,
 * since the storage read returns the default for either: every stored record is
 * a `StoredRecord`, an object carrying its value and `savedAt`.
 */
import type {
  Address,
  ApproverReply,
  Configuration,
  Credential,
  SetupDraft
} from '@web/modules/social-recovery/sdk-interfaces'

/**
 * The storage the records sit on: the extension's own helper
 * (`src/web/extension-services/background/webapi/storage.ts`) or, in a test, an
 * in-memory double. `get` may return the default for a falsy stored value.
 */
export interface RecordStorage {
  get(key: string, defaultValue?: unknown): Promise<unknown>
  set(key: string, value: unknown): Promise<unknown>
  remove(key: string): Promise<unknown>
}

/** The chain a record belongs to, as the network's chain id. */
export type ChainId = bigint | number

/** What the storage holds for every record: its value and when it was written (ms since epoch). */
export interface StoredRecord<T> {
  value: T
  savedAt: number
}

/** The explicit reading of a record that is not stored, never `false` or `0`. */
export interface AbsentRecord {
  status: 'absent'
}

/** A record read from storage. */
export type RecordRead<T> = AbsentRecord | ({ status: 'present' } & StoredRecord<T>)

/** The one absent reading every read returns for a record that is not stored. */
export const ABSENT: AbsentRecord = Object.freeze({ status: 'absent' as const })

// ---------------------------------------------------------------------------
// The six setup records (D-310, D-305)
// ---------------------------------------------------------------------------

/** 1. The setup draft: the SDK's own record (sdk.md D-202). */
export type SetupDraftRecord = SetupDraft

/**
 * 2. The inventory, the answer to "What do you have" (D-305): another device,
 * guardians with wallets, a passport, an Aadhaar identity, and keys the holder
 * keeps on paper or hardware. The second-release wizard's step, kept as a record
 * since D-310 lists it.
 */
export const INVENTORY_ITEMS = [
  'another-device',
  'guardian-wallets',
  'passport',
  'aadhaar',
  'own-keys'
] as const
export type InventoryItem = typeof INVENTORY_ITEMS[number]
export type InventoryRecord = InventoryItem[]

/** 3. The path: the clauses the setup draft holds, the record PT-037's rule lines read. */
export type PathRecord = SetupDraft['clauses']

/** The access test verdicts an enrollment carries (D-305): passed, or one of the four verdict states. */
export const ENROLLMENT_TEST_VERDICTS = [
  'passed',
  'not-tested',
  'failed',
  'unavailable',
  'not-supported'
] as const
export type EnrollmentTestVerdict = typeof ENROLLMENT_TEST_VERDICTS[number]

/**
 * One enrollment not yet saved on chain (D-305): the credential it produced and
 * its access test verdict, with the cause a failed test reported.
 */
export interface Enrollment {
  credential: Credential
  test: EnrollmentTestVerdict
  cause?: string
}

/** 4. The enrollments. */
export type EnrollmentsRecord = Enrollment[]

/** 5. The waiting period, in seconds, the type the setup draft's `wait` carries. */
export type WaitingPeriodRecord = SetupDraft['wait']

/**
 * 6. The password-set flag. Never a boolean: the record's presence says the
 * holder set the recovery password, and its value is this one marker.
 */
export const PASSWORD_SET = 'password-set' as const
export type PasswordSetRecord = typeof PASSWORD_SET

/** The six setup records by name, the keys save and start over wipe. */
export const SETUP_RECORD_NAMES = [
  'setupDraft',
  'inventory',
  'path',
  'enrollments',
  'waitingPeriod',
  'passwordSet'
] as const
export type SetupRecordName = typeof SETUP_RECORD_NAMES[number]

export interface SetupRecordValues {
  setupDraft: SetupDraftRecord
  inventory: InventoryRecord
  path: PathRecord
  enrollments: EnrollmentsRecord
  waitingPeriod: WaitingPeriodRecord
  passwordSet: PasswordSetRecord
}

// ---------------------------------------------------------------------------
// The recovery session, the five wipe events and the countdown (D-310, I-38)
// ---------------------------------------------------------------------------

/**
 * The five events that wipe the recovery session (D-310): the submission lands,
 * the request's deadline passes, another attempt opens, the setup changes, or
 * the recoverer abandons. A closed vocabulary: a security stop or a pause is not
 * one of them and wipes nothing (I-38).
 */
export const RECOVERY_WIPE_EVENTS = [
  'submission-landed',
  'deadline-passed',
  'another-attempt-opened',
  'setup-changed',
  'recoverer-abandoned'
] as const
export type RecoveryWipeEvent = typeof RECOVERY_WIPE_EVENTS[number]

/** The one line of reason a wipe keeps: the event that wiped the session. */
export type WipeReason = RecoveryWipeEvent

/**
 * The live recovery session: the account being recovered, the attempt id the
 * wallet built the request against, and the approvals gathered so far.
 */
export interface LiveRecoverySession {
  state: 'live'
  account: Address
  predictedAttemptId: bigint
  approvals: ApproverReply[]
}

/** What a wipe leaves: one reason code and nothing else (I-38). */
export interface WipedRecoverySession {
  state: 'wiped'
  reason: WipeReason
}

export type RecoverySessionRecord = LiveRecoverySession | WipedRecoverySession

/** The fields a caller writes into a live session. */
export type RecoverySessionInput = Omit<LiveRecoverySession, 'state'>

/**
 * The countdown's record after the submission lands: the account address alone.
 * The attempt id comes from the attempt read (D-371).
 */
export interface CountdownRecord {
  account: Address
}

/**
 * The decrypted setup cache: the setup the recovery password unlocked on this
 * device, kept after the recovery executes (D-310).
 */
export type DecryptedSetupCacheRecord = Configuration

/**
 * The strings a death state renders from its reason code, keys under
 * `socialRecovery.records` in en.json (D-392, D-393). The submission landing
 * renders the countdown and the recoverer's own abandon renders no death state.
 */
export const WIPE_REASON_STRING_KEYS: Record<WipeReason, { title: string; body: string } | null> = {
  'submission-landed': null,
  'deadline-passed': {
    title: 'socialRecovery.records.expiredTitle',
    body: 'socialRecovery.records.expiredBody'
  },
  'another-attempt-opened': {
    title: 'socialRecovery.records.voidTitle',
    body: 'socialRecovery.records.voidBody'
  },
  'setup-changed': {
    title: 'socialRecovery.records.setupChangedTitle',
    body: 'socialRecovery.records.setupChangedBody'
  },
  'recoverer-abandoned': null
}
