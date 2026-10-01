/**
 * The editor's words: each method kind's name and picker header, the chip a
 * row carries with a failed test's lines, the line under a threshold that is
 * not a whole number, and the line a path check finding renders as. A finding whose
 * code has a refusal sentence renders that sentence; any other finding renders
 * its code.
 */
import type { Credential, Finding, FindingCode } from '@web/modules/social-recovery/sdk-interfaces'
import { isBrowserErrorName } from '@web/modules/social-recovery/shared/ceremony/verdicts'
import { renderChip } from '@web/modules/social-recovery/shared/display'
import type { MethodChip, Translate } from '@web/modules/social-recovery/shared/display'
import type {
  Enrollment,
  EnrollmentTestVerdict,
  PasskeyBackupKind,
  SlotKind
} from '@web/modules/social-recovery/shared/records'

import { enrollmentOf, isEmptySlot } from './operations'
import type { ClientRefusal } from './types'

const KIND_NAME_KEYS: Record<SlotKind, string> = {
  passkey: 'socialRecovery.methodNames.passkey',
  ecdsa: 'socialRecovery.display.nouns.guardian',
  zkpassport: 'socialRecovery.methodNames.passport',
  aadhaar: 'socialRecovery.methodNames.aadhaar'
}

const KIND_HEADER_KEYS: Record<SlotKind, string> = {
  passkey: 'socialRecovery.editor.picker.passkeysHeader',
  ecdsa: 'socialRecovery.methodNames.guardians',
  zkpassport: 'socialRecovery.methodNames.passport',
  aadhaar: 'socialRecovery.methodNames.aadhaar'
}

const VERDICT_CHIPS: Record<EnrollmentTestVerdict, MethodChip> = {
  passed: 'tested',
  'not-tested': 'notTested',
  failed: 'testFailed',
  unavailable: 'testUnavailable',
  'not-supported': 'notSupported'
}

const FINDING_KEYS: Partial<Record<FindingCode, string>> = {
  'rule.empty': 'socialRecovery.editor.refusals.noMethod',
  'clause.empty': 'socialRecovery.editor.refusals.emptyGroup',
  'rule.all-thresholds-zero': 'socialRecovery.editor.refusals.thresholdBelowOne',
  'clause.threshold-above-count': 'socialRecovery.editor.refusals.thresholdAboveMembers',
  'clause.threshold-too-wide': 'socialRecovery.editor.refusals.thresholdAboveField',
  'rule.too-wide': 'socialRecovery.editor.refusals.tooLarge',
  'credential.duplicate': 'socialRecovery.editor.duplicate',
  'wait.field-width': 'socialRecovery.editor.refusals.waitFieldWidth',
  'wait.above-maximum': 'socialRecovery.editor.refusals.waitCeiling'
}

const CLIENT_REFUSAL_KEYS: Record<ClientRefusal, { title: string; body: string }> = {
  'update-the-wallet': {
    title: 'socialRecovery.client.updateTheWalletTitle',
    body: 'socialRecovery.client.updateTheWalletBody'
  },
  unavailable: {
    title: 'socialRecovery.client.unavailableTitle',
    body: 'socialRecovery.client.unavailableBody'
  }
}

/**
 * A kind's name; a passkey its enrollment reports as device-bound reads as a
 * passkey on this device.
 */
export const renderKindName = (
  kind: SlotKind | undefined,
  t: Translate,
  backup?: PasskeyBackupKind
): string | null => {
  if (!kind) {
    return null
  }
  if (kind === 'passkey' && backup === 'device-bound') {
    return t('socialRecovery.methodNames.passkeyOnThisDevice')
  }
  return t(KIND_NAME_KEYS[kind])
}

export const renderKindHeader = (kind: SlotKind, t: Translate): string => t(KIND_HEADER_KEYS[kind])

/**
 * The chip of a row: "Not yet active" for an empty slot, the access test's
 * verdict for an enrolled credential whose enrollment the records hold.
 */
export const renderRowChip = (
  credential: Credential,
  enrollments: readonly Enrollment[],
  t: Translate
): string | null => {
  if (isEmptySlot(credential)) {
    return renderChip('method', 'notYetActive', t)
  }
  const enrollment = enrollmentOf(credential, enrollments)
  return enrollment ? renderChip('method', VERDICT_CHIPS[enrollment.test], t) : null
}

/**
 * The lines a failed access test carries beside its chip: the cause the test
 * reported where the wallet has words for it, a check that did not match, a
 * passkey made under another origin or the browser's own error name, then
 * that the method may never work. Any other cause renders no words of its own.
 */
export const renderFailedTestLines = (enrollment: Enrollment, t: Translate): string[] => {
  if (enrollment.test !== 'failed') {
    return []
  }
  const [slug, detail] = (enrollment.cause ?? '').split(': ', 2)
  let cause: string | null = null
  if (slug === 'check-rejected') {
    cause = t('socialRecovery.ceremony.testFailedNoMatch')
  } else if (slug === 'relying-party-mismatch') {
    cause = t('socialRecovery.ceremony.relyingPartyMismatch')
  } else if (slug === 'browser-error' && isBrowserErrorName(detail)) {
    cause = detail
  }
  return [...(cause ? [cause] : []), t('socialRecovery.ceremony.testFailedLine')]
}

/** The line under a threshold field whose text is not a whole number. */
export const renderHeldThreshold = (t: Translate): string =>
  t('socialRecovery.editor.refusals.thresholdWholeNumber')

export const renderClientRefusal = (
  refusal: ClientRefusal,
  t: Translate
): { title: string; body: string } => ({
  title: t(CLIENT_REFUSAL_KEYS[refusal].title),
  body: t(CLIENT_REFUSAL_KEYS[refusal].body)
})

export const renderFinding = (finding: Finding, t: Translate): string => {
  const key = FINDING_KEYS[finding.code]
  return key ? t(key) : finding.code
}
