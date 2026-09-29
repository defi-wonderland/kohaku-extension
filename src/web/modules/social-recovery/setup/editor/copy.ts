/**
 * The editor's words: each method kind's name and picker header, the chip a
 * row carries, the sentence of each refusal this wallet applies, the rules
 * panel, and the line a path check finding renders as. Every setup error
 * renders a sentence; any other finding renders its code.
 */
import type {
  Credential,
  Finding,
  FindingCode,
  SetupErrorCode
} from '@web/modules/social-recovery/sdk-interfaces'
import { renderChip } from '@web/modules/social-recovery/shared/display'
import type { MethodChip, Translate } from '@web/modules/social-recovery/shared/display'
import type {
  Enrollment,
  EnrollmentTestVerdict,
  PasskeyBackupKind
} from '@web/modules/social-recovery/shared/records'

import { enrollmentOf, isEmptySlot } from './operations'
import type { ClientRefusal, MethodKind, Refusal, RefusalKey, RulesPanelLine } from './types'

const KIND_NAME_KEYS: Record<MethodKind, string> = {
  passkey: 'socialRecovery.methodNames.passkey',
  ecdsa: 'socialRecovery.display.nouns.guardian',
  zkpassport: 'socialRecovery.methodNames.passport',
  aadhaar: 'socialRecovery.methodNames.aadhaar'
}

const KIND_HEADER_KEYS: Record<MethodKind, string> = {
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

const REFUSAL_KEYS: Record<RefusalKey, string> = {
  emptyGroup: 'socialRecovery.editor.refusals.emptyGroup',
  thresholdAboveMembers: 'socialRecovery.editor.refusals.thresholdAboveMembers',
  thresholdBelowOne: 'socialRecovery.editor.refusals.thresholdBelowOne',
  thresholdBelowOneOwnRule: 'socialRecovery.editor.refusals.thresholdBelowOneOwnRule',
  thresholdAboveField: 'socialRecovery.editor.refusals.thresholdAboveField',
  memberCeiling: 'socialRecovery.editor.refusals.memberCeiling',
  noMethod: 'socialRecovery.editor.refusals.noMethod',
  waitFieldWidth: 'socialRecovery.editor.refusals.waitFieldWidth',
  waitCeiling: 'socialRecovery.editor.refusals.waitCeiling',
  tooLarge: 'socialRecovery.editor.refusals.tooLarge'
}

// A plaintext too wide for the backup's padding is cured the way a rule too
// wide for a block is, by fewer members; an action that cannot serve the
// account has no sentence of its own yet and reads as the module's refusal.
const SETUP_ERROR_KEYS: Record<SetupErrorCode, string> = {
  'rule.empty': REFUSAL_KEYS.noMethod,
  'clause.empty': REFUSAL_KEYS.emptyGroup,
  'rule.all-thresholds-zero': REFUSAL_KEYS.thresholdBelowOne,
  'clause.threshold-above-count': REFUSAL_KEYS.thresholdAboveMembers,
  'clause.threshold-too-wide': REFUSAL_KEYS.thresholdAboveField,
  'rule.too-wide': REFUSAL_KEYS.tooLarge,
  'credential.duplicate': 'socialRecovery.editor.duplicate',
  'wait.field-width': REFUSAL_KEYS.waitFieldWidth,
  'wait.above-maximum': REFUSAL_KEYS.waitCeiling,
  'action.unsupported': 'socialRecovery.review.blocked.cannotRecover.reasonNotSupported',
  'backup.too-wide': REFUSAL_KEYS.tooLarge
}

const FINDING_KEYS: Partial<Record<FindingCode, string>> = SETUP_ERROR_KEYS

/** The rules panel's lines, the zero threshold's own-rule line last. */
const RULES_PANEL_LINES: readonly RulesPanelLine[] = [
  'requiredAnswers',
  'enoughMembers',
  'thresholdAtLeastOne',
  'thresholdCeiling',
  'memberCeiling',
  'oneRowPerMethod',
  'atLeastOneMethod',
  'smallEnough',
  'zeroThresholdOwnRule'
]

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
  kind: MethodKind | undefined,
  t: Translate,
  backup?: PasskeyBackupKind
): string | null => {
  if (!kind) return null
  if (kind === 'passkey' && backup === 'device-bound') {
    return t('socialRecovery.methodNames.passkeyOnThisDevice')
  }
  return t(KIND_NAME_KEYS[kind])
}

export const renderKindHeader = (kind: MethodKind, t: Translate): string =>
  t(KIND_HEADER_KEYS[kind])

/**
 * The chip of a row: "Not yet active" for an empty slot, the access test's
 * verdict for an enrolled credential whose enrollment the records hold.
 */
export const renderRowChip = (
  credential: Credential,
  enrollments: readonly Enrollment[],
  t: Translate
): string | null => {
  if (isEmptySlot(credential)) return renderChip('method', 'notYetActive', t)
  const enrollment = enrollmentOf(credential, enrollments)
  return enrollment ? renderChip('method', VERDICT_CHIPS[enrollment.test], t) : null
}

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

export const renderRefusal = (refusal: Refusal, t: Translate): string =>
  t(REFUSAL_KEYS[refusal.key])

export const renderRulesPanel = (t: Translate): { header: string; lines: string[] } => ({
  header: t('socialRecovery.editor.rules.header'),
  lines: RULES_PANEL_LINES.map((line) => t(`socialRecovery.editor.rules.${line}`))
})
