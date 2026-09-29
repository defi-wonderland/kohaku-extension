import type { Clause } from '@web/modules/social-recovery/sdk-interfaces'
import { sameAddress } from '@web/modules/social-recovery/shared/client'
import type { AddressBook } from '@web/modules/social-recovery/shared/client'
import { DEADLINE_LOCALE, renderChip } from '@web/modules/social-recovery/shared/display'
import type { Chip, Translate } from '@web/modules/social-recovery/shared/display'
import type { Enrollment, EnrollmentTestVerdict } from '@web/modules/social-recovery/shared/records'

import { slotKindOf } from './slots'
import type { ResumeRow, SlotKind } from './types'

const VERDICT_CHIPS: Record<EnrollmentTestVerdict, Chip<'method'>> = {
  passed: 'tested',
  'not-tested': 'notTested',
  failed: 'testFailed',
  unavailable: 'testUnavailable',
  'not-supported': 'notSupported'
}

const METHOD_NAME_KEYS: Partial<Record<SlotKind, string>> = {
  passkey: 'socialRecovery.methodNames.passkey',
  zkpassport: 'socialRecovery.methodNames.passport',
  aadhaar: 'socialRecovery.methodNames.aadhaar'
}

const kindOf = (enrollment: Enrollment, book: AddressBook): SlotKind | undefined => {
  const kinds = Object.keys(book.methods) as SlotKind[]
  return kinds.find((kind) => sameAddress(book.methods[kind], enrollment.credential.method))
}

const nameOf = (enrollment: Enrollment, kind: SlotKind | undefined, t: Translate): string => {
  if (kind === 'passkey' && enrollment.backup === 'device-bound') {
    return t('socialRecovery.methodNames.passkeyOnThisDevice')
  }
  const key = kind && METHOD_NAME_KEYS[kind]
  return t(key || 'socialRecovery.display.nouns.method')
}

/**
 * The resume block's rows: each enrolled method with the chip of its access
 * test, and the guardians as one row, not yet active until the path is saved.
 */
export const resumeRowsOf = (
  enrollments: readonly Enrollment[],
  book: AddressBook,
  t: Translate
): ResumeRow[] => {
  const rows: ResumeRow[] = []
  let guardians = 0
  enrollments.forEach((enrollment, index) => {
    const kind = kindOf(enrollment, book)
    if (kind === 'ecdsa') {
      guardians += 1
      return
    }
    rows.push({
      id: `${index}`,
      name: nameOf(enrollment, kind, t),
      chip: renderChip('method', VERDICT_CHIPS[enrollment.test], t)
    })
  })
  if (guardians > 0) {
    rows.push({
      id: 'guardians',
      name: t('socialRecovery.methodNames.guardians'),
      chip: renderChip('method', 'notYetActive', t),
      note: t('socialRecovery.presets.resume.addedNotSaved', { count: guardians })
    })
  }
  return rows
}

const NOT_STARTED_NAME_KEYS: Record<SlotKind, string> = {
  passkey: 'socialRecovery.methodNames.passkeyOnThisDevice',
  zkpassport: 'socialRecovery.methodNames.passport',
  ecdsa: 'socialRecovery.methodNames.guardians',
  aadhaar: 'socialRecovery.methodNames.aadhaar'
}

/**
 * The draft's unfilled slots as rows, one per kind, the guardians as one row.
 * A kind the holder already enrolled a method of has no row here.
 */
export const notStartedRowsOf = (
  clauses: readonly Clause[],
  enrollments: readonly Enrollment[],
  book: AddressBook,
  t: Translate
): ResumeRow[] => {
  const enrolled = new Set(enrollments.map((enrollment) => kindOf(enrollment, book)))
  const kinds = new Set<SlotKind>()
  clauses.forEach(({ credentials }) =>
    credentials.forEach((credential) => {
      const kind = slotKindOf(credential)
      if (kind && !enrolled.has(kind)) kinds.add(kind)
    })
  )
  return [...kinds].map((kind) => ({
    id: `not-started-${kind}`,
    name: t(NOT_STARTED_NAME_KEYS[kind]),
    chip: renderChip('method', 'notStarted', t)
  }))
}

/**
 * The line that dates the unfinished draft by its day and month alone, in the
 * holder's own time zone.
 */
export const draftAgeLine = (savedAt: number, t: Translate): string => {
  const { timeZone } = Intl.DateTimeFormat().resolvedOptions()
  const date = new Intl.DateTimeFormat(DEADLINE_LOCALE, {
    day: 'numeric',
    month: 'short',
    timeZone
  }).format(new Date(savedAt))
  return t('socialRecovery.records.draftAge', { date })
}
