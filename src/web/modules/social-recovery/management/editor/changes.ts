/**
 * What the edit changes against the configuration it started from: the
 * members added and removed, the rule, the waiting period, the privacy level
 * and the recovery password, each a row only where it differs. A changed
 * password or privacy level makes a printed Recovery Card stale.
 *
 * A member the rule still needs is a member of a group whose threshold equals
 * its members: removing it leaves the group below its threshold.
 */
import type { Clause, Credential, SetupDraft } from '@web/modules/social-recovery/sdk-interfaces'
import { privacyLevelOf } from '@web/modules/social-recovery/shared/client'
import { isEmptySlot, sameCredential } from '@web/modules/social-recovery/shared/records'

import type { ChangeRow, ChangesInput, EditSession, PasswordMark, StillNeededGroup } from './types'

const membersOf = (clauses: readonly Clause[]): Credential[] =>
  clauses.flatMap(({ credentials }) => credentials).filter((credential) => !isEmptySlot(credential))

const missingFrom = (from: readonly Credential[], other: readonly Credential[]): Credential[] =>
  from.filter((credential) => !other.some((held) => sameCredential(held, credential)))

/** The members the draft holds that the committed path does not. */
export const addedCredentialsOf = (
  committed: readonly Clause[],
  draft: readonly Clause[]
): Credential[] => missingFrom(membersOf(draft), membersOf(committed))

/**
 * Whether the save seals the backup under a new recovery password: the draft
 * hides the setup, and either the holder typed a new password or the committed
 * setup had none.
 */
export const passwordChangedOf = (
  baseline: EditSession,
  draft: SetupDraft,
  mark: PasswordMark
): boolean =>
  privacyLevelOf(draft.privacy) !== 'public' && (mark === 'changed' || baseline.level === 'public')

export const changesOf = ({
  baseline,
  draft,
  passwordChanged,
  ruleOf
}: ChangesInput): ChangeRow[] => {
  const rows: ChangeRow[] = []
  const committed = baseline.configuration
  const added = addedCredentialsOf(committed.clauses, draft.clauses).length
  const removed = missingFrom(membersOf(committed.clauses), membersOf(draft.clauses)).length
  if (added > 0 || removed > 0) {
    rows.push({ kind: 'members', added, removed })
  }
  const before = ruleOf(committed.clauses)
  const after = ruleOf(draft.clauses)
  if (before !== after) {
    rows.push({ kind: 'rule', before, after })
  }
  if (committed.wait !== draft.wait) {
    rows.push({ kind: 'waitingPeriod', before: committed.wait, after: draft.wait })
  }
  const level = privacyLevelOf(draft.privacy)
  if (level !== baseline.level) {
    rows.push({ kind: 'privacy', before: baseline.level, after: level })
  }
  if (passwordChanged) {
    rows.push({ kind: 'password' })
  }
  return rows
}

/** Whether the changes make a printed Recovery Card stale: a changed password or privacy level. */
export const makesCardStale = (rows: readonly ChangeRow[]): boolean =>
  rows.some(({ kind }) => kind === 'password' || kind === 'privacy')

/** The groups of the path whose every member the rule needs. */
export const stillNeededOf = (clauses: readonly Clause[]): StillNeededGroup[] =>
  clauses.flatMap((clause, index) => {
    const count = membersOf([clause]).length
    return count > 1 && clause.threshold === count
      ? [{ clause: index, required: clause.threshold, count }]
      : []
  })
