/**
 * The closed vocabulary every ceremony host returns (ux-interfaces.md D-372):
 * four verdicts and one dismissal that is not a verdict.
 *
 * - passed: the method produced its config or its reply, and the local check
 *   (where the call runs one) answered satisfied.
 * - failed: the method or the check refused, with the cause it reported.
 *   UXC-13: a failed test reads "test failed" with its cause, never "not tested".
 * - unavailable: a node, a service or a phone did not answer; retry is offered.
 * - notSupported: the method cannot serve this document; no retry, since the
 *   answer will not change.
 * - dismissed: the holder cancelled the prompt or the browser refused it, read
 *   from the browser's own error BEFORE the method runs (D-372). The row keeps
 *   its chip and shows the cancelled or refused note.
 *
 * Every function here is pure and runs under Jest's node environment.
 */
import type {
  EnrollFailure,
  MethodFailureCause,
  ReplyFailure,
  Verdict
} from '@web/modules/social-recovery/sdk-interfaces'
import type { CollectionChip, MethodChip } from '@web/modules/social-recovery/shared/display'

/** The four calls of a method's lifecycle (D-372). */
export const CEREMONY_CALLS = ['enroll', 'testAccess', 'createClaim', 'healthCheck'] as const
export type CeremonyCall = typeof CEREMONY_CALLS[number]

export const isCeremonyCall = (value: unknown): value is CeremonyCall =>
  typeof value === 'string' && (CEREMONY_CALLS as readonly string[]).includes(value)

/** The four verdicts, a closed set (D-372, D-305). */
export const CEREMONY_VERDICTS = ['passed', 'failed', 'unavailable', 'notSupported'] as const
export type CeremonyVerdict = typeof CEREMONY_VERDICTS[number]

export const isCeremonyVerdict = (value: unknown): value is CeremonyVerdict =>
  typeof value === 'string' && (CEREMONY_VERDICTS as readonly string[]).includes(value)

/** The two notes a ceremony returns before the method runs (D-372, D-305). */
export const DISMISSAL_NOTES = ['cancelled', 'refused'] as const
export type DismissalNote = typeof DISMISSAL_NOTES[number]

/**
 * The causes a verdict other than passed names: the method's own five
 * (sdk.md D-206) and the host's own eight.
 *
 * - `thrown`: the method threw a refusal (enrollInput and signingInput throw, D-201).
 * - `check-rejected`: the local check answered rejected.
 * - `relying-party-mismatch`: the credential or the assertion was minted under a
 *   relying party other than the extension's own origin (D-314). At enrollment
 *   this is the provider that refused Kohaku (the 1Password case).
 * - `unreachable`: a phone hand-off that never connected (D-392).
 * - `service-unanswered`: a node or a service did not answer.
 * - `not-judged`: the local check needs a contract's own word (sdk.md D-206).
 * - `no-implementation`: this build holds no implementation for the method, or
 *   no device call for its binding.
 * - `browser-error`: the browser's own error at a test or a claim, its name in
 *   `detail` (the coordinator's ruling on `NotAllowedError`, frame C-05).
 */
export const HOST_CAUSES = [
  'thrown',
  'check-rejected',
  'relying-party-mismatch',
  'unreachable',
  'service-unanswered',
  'not-judged',
  'no-implementation',
  'browser-error'
] as const
export type HostCause = typeof HOST_CAUSES[number]
export type CeremonyCause = MethodFailureCause | HostCause

export type PassedOutcome<T> = { kind: 'verdict'; verdict: 'passed'; retry: false; value: T }
export type FailedOutcome = {
  kind: 'verdict'
  verdict: 'failed'
  retry: true
  cause: CeremonyCause
  detail?: string
}
export type UnavailableOutcome = {
  kind: 'verdict'
  verdict: 'unavailable'
  retry: true
  cause: CeremonyCause
  detail?: string
}
export type NotSupportedOutcome = {
  kind: 'verdict'
  verdict: 'notSupported'
  retry: false
  cause: CeremonyCause
}
export type DismissedOutcome = { kind: 'dismissed'; note: DismissalNote; detail?: string }

/** What every host returns: exactly one of the four verdicts, or the dismissal. */
export type CeremonyOutcome<T = unknown> =
  | PassedOutcome<T>
  | FailedOutcome
  | UnavailableOutcome
  | NotSupportedOutcome
  | DismissedOutcome

/** Every outcome but passed, the shape a host returns before it has a value. */
export type CeremonyStop = Exclude<CeremonyOutcome<never>, PassedOutcome<never>>

export const passed = <T>(value: T): PassedOutcome<T> => ({
  kind: 'verdict',
  verdict: 'passed',
  retry: false,
  value
})

export const failed = (cause: CeremonyCause, detail?: string): FailedOutcome => ({
  kind: 'verdict',
  verdict: 'failed',
  retry: true,
  cause,
  ...(detail ? { detail } : {})
})

export const unavailable = (cause: CeremonyCause, detail?: string): UnavailableOutcome => ({
  kind: 'verdict',
  verdict: 'unavailable',
  retry: true,
  cause,
  ...(detail ? { detail } : {})
})

export const notSupported = (cause: CeremonyCause): NotSupportedOutcome => ({
  kind: 'verdict',
  verdict: 'notSupported',
  retry: false,
  cause
})

export const dismissed = (note: DismissalNote, detail?: string): DismissedOutcome => ({
  kind: 'dismissed',
  note,
  ...(detail ? { detail } : {})
})

// ---------------------------------------------------------------------------
// What a row renders
// ---------------------------------------------------------------------------

/**
 * The method chip of PT-036's vocabulary each verdict selects on a TEST
 * ACCESS (D-302, D-305). The test chips apply to test access alone: an
 * enrollment is not a test, and a claim reads the checklist's chips.
 */
export const VERDICT_CHIP: { readonly [V in CeremonyVerdict]: MethodChip } = {
  passed: 'tested',
  failed: 'testFailed',
  unavailable: 'testUnavailable',
  notSupported: 'notSupported'
}

/** A chip a row shows: a method chip in setup, a collection chip on the checklist (D-302). */
export type RowChip =
  | { set: 'method'; chip: MethodChip }
  | { set: 'collection'; chip: CollectionChip }

/**
 * The chip an outcome of `call` selects, or null where the row keeps its chip.
 *
 * - testAccess: the four test chips (tested, test failed, test unavailable,
 *   not supported).
 * - enroll: a passed enrollment reads not tested, since a row reads not tested
 *   until its test runs (D-305, frame C-05h); any other outcome keeps the row's
 *   chip and shows its note.
 * - createClaim: a passed claim reads complete, the checklist's chip (D-302,
 *   D-392); any other outcome keeps the row's chip and shows its note (frame
 *   D-07b).
 * - healthCheck: the shell selects no chip.
 * - A dismissal keeps the row's chip on every call.
 */
export const chipOfOutcome = (
  outcome: CeremonyOutcome<unknown>,
  call: CeremonyCall
): RowChip | null => {
  if (outcome.kind === 'dismissed') return null
  switch (call) {
    case 'testAccess':
      return { set: 'method', chip: VERDICT_CHIP[outcome.verdict] }
    case 'enroll':
      return outcome.verdict === 'passed' ? { set: 'method', chip: 'notTested' } : null
    case 'createClaim':
      return outcome.verdict === 'passed' ? { set: 'collection', chip: 'complete' } : null
    case 'healthCheck':
    default:
      return null
  }
}

/**
 * The note under `socialRecovery.ceremony` an outcome of `call` renders on its
 * row (D-305, D-392), or null where the chip and the line say it all.
 *
 * - Dismissed: the cancelled or the refused note.
 * - Passed: a test or a claim reads the passed note with its hash; a passed
 *   enrollment reads no note, the kind line takes its place.
 * - Not supported: the not-supported note.
 * - Unavailable: a hand-off that never connected reads unreachable; any other
 *   cause reads the test-unavailable line here, once, and `lineKeyOfOutcome`
 *   adds none.
 * - Failed: a relying-party mismatch reads the provider's refusal at
 *   enrollment and the mismatch note at a test or a claim; a failed test reads
 *   no note (frame C-05: the chip, the browser's error name and the line); an
 *   enrollment or a claim reads the failed note (frame D-07b).
 */
export const noteKeyOfOutcome = (
  outcome: CeremonyOutcome<unknown>,
  call: CeremonyCall
): string | null => {
  if (outcome.kind === 'dismissed') {
    return outcome.note === 'cancelled'
      ? 'socialRecovery.ceremony.cancelledNote'
      : 'socialRecovery.ceremony.refusedNote'
  }
  switch (outcome.verdict) {
    case 'passed':
      return call === 'testAccess' || call === 'createClaim'
        ? 'socialRecovery.ceremony.passedNote'
        : null
    case 'notSupported':
      return 'socialRecovery.ceremony.notSupportedNote'
    case 'unavailable':
      return outcome.cause === 'unreachable'
        ? 'socialRecovery.ceremony.unreachableNote'
        : 'socialRecovery.ceremony.testUnavailableLine'
    case 'failed':
    default:
      if (outcome.cause === 'relying-party-mismatch') {
        return call === 'enroll'
          ? 'socialRecovery.ceremony.providerRefused'
          : 'socialRecovery.ceremony.relyingPartyMismatch'
      }
      return call === 'testAccess' ? null : 'socialRecovery.ceremony.failedNote'
  }
}

/**
 * The line a TEST ACCESS verdict carries under its chip (D-305, UXC-13): a
 * failed test reads test failed with its line and never the not-tested line.
 * Every other call carries no test line. An unavailable test carries none
 * either, since its note already reads the test-unavailable line.
 */
export const lineKeyOfOutcome = (
  outcome: CeremonyOutcome<unknown>,
  call: CeremonyCall
): string | null => {
  if (outcome.kind === 'dismissed' || call !== 'testAccess') return null
  switch (outcome.verdict) {
    case 'failed':
      return outcome.cause === 'check-rejected'
        ? 'socialRecovery.ceremony.testFailedNoMatch'
        : 'socialRecovery.ceremony.testFailedLine'
    case 'notSupported':
      return 'socialRecovery.ceremony.notSupportedLine'
    case 'unavailable':
    case 'passed':
    default:
      return null
  }
}

/** A DOMException name such as `NotAllowedError`: the one cause text a screen shows raw. */
export const isBrowserErrorName = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Z][A-Za-z]*Error$/.test(value)

/**
 * The browser's own error name an outcome carries, or null. A screen shows
 * this name beside the note (frame C-05) and no other raw cause text: every
 * other cause renders through its en.json key.
 */
export const browserErrorNameOf = (outcome: CeremonyOutcome<unknown>): string | null =>
  outcome.kind === 'verdict' &&
  outcome.verdict === 'failed' &&
  outcome.cause === 'browser-error' &&
  isBrowserErrorName(outcome.detail)
    ? outcome.detail
    : null

// ---------------------------------------------------------------------------
// A method's answer as an outcome
// ---------------------------------------------------------------------------

export const isMethodFailure = (value: unknown): value is EnrollFailure | ReplyFailure =>
  typeof value === 'object' &&
  value !== null &&
  ((value as { kind?: unknown }).kind === 'enroll-failure' ||
    (value as { kind?: unknown }).kind === 'reply-failure')

/**
 * One typed failure of the method (sdk.md D-206) as an outcome.
 *
 * - device-refused: the approver's device declined, the refused note.
 * - device-unavailable: the device did not answer, unavailable with retry; a
 *   phone hand-off that never connected reads unreachable.
 * - material-rejected: the material was not a config or a proof, failed.
 * - method-unsupported, version-unread: not supported, with no retry.
 */
export const outcomeOfMethodFailure = (
  failure: EnrollFailure | ReplyFailure,
  options: { handOff?: boolean } = {}
): CeremonyStop => {
  switch (failure.cause) {
    case 'device-refused':
      return dismissed('refused', failure.cause)
    case 'device-unavailable':
      return unavailable(options.handOff ? 'unreachable' : 'device-unavailable')
    case 'method-unsupported':
    case 'version-unread':
      return notSupported(failure.cause)
    case 'material-rejected':
    default:
      return failed(failure.cause)
  }
}

const UNANSWERED_ERROR_NAMES = ['TimeoutError', 'NetworkError']

/**
 * Whether a thrown error says a node or a service did not answer: a timeout,
 * a network error, a failed fetch, or an error that says so itself through
 * `unavailable: true` or `code: 'UNAVAILABLE'`.
 */
export const isUnansweredError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const e = error as { name?: unknown; message?: unknown; code?: unknown; unavailable?: unknown }
  if (e.unavailable === true || e.code === 'UNAVAILABLE') return true
  if (typeof e.name === 'string' && UNANSWERED_ERROR_NAMES.includes(e.name)) return true
  return e.name === 'TypeError' && typeof e.message === 'string' && /fetch/i.test(e.message)
}

const messageOf = (error: unknown): string | undefined => {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  if (typeof error === 'string' && error) return error
  return undefined
}

/**
 * An error the method threw as an outcome. A method that throws a cause yields
 * failed with that cause, never not tested (UXC-13). One that says a node or a
 * service did not answer yields unavailable with retry.
 */
export const outcomeOfThrown = (error: unknown): CeremonyStop =>
  isUnansweredError(error)
    ? unavailable('service-unanswered', messageOf(error))
    : failed('thrown', messageOf(error))

/**
 * The local check's verdict (sdk.md D-206) as an outcome: satisfied passes,
 * rejected fails with its cause, and not judged, a check that needs a
 * contract's own word, reads unavailable with retry, since no local answer
 * exists and no failure was found.
 */
export const outcomeOfCheck = <T>(verdict: Verdict, value: T): CeremonyOutcome<T> => {
  switch (verdict) {
    case 'satisfied':
      return passed(value)
    case 'rejected':
      return failed('check-rejected')
    case 'not-judged':
    default:
      return unavailable('not-judged')
  }
}
