/**
 * The shapes this wallet refuses to save, judged on the draft as it stands
 * before the SDK's path check runs. An empty slot is not a member: it stands
 * for a method the holder has yet to enroll, so a clause counts only its
 * enrolled credentials against its threshold.
 */
import type { Clause, SetupDraft } from '@web/modules/social-recovery/sdk-interfaces'

import { isEmptySlot, methodCountOf } from './operations'
import { PICKER_CEILING_HOURS } from './types'
import type { Refusal } from './types'

/** The most a clause's threshold field counts. */
export const THRESHOLD_FIELD_MAX = 255

/** The most members this wallet lets one clause list. */
export const MEMBER_CEILING = 255

/** The waiting period's field is 48 bits wide, so a wait of 2^48 seconds no longer fits. */
// A shift, since the build compiles `**` to `Math.pow`, which throws on a bigint.
// eslint-disable-next-line no-bitwise
export const WAIT_FIELD_LIMIT = 1n << 48n

export const PICKER_CEILING_SECONDS = BigInt(PICKER_CEILING_HOURS * 60 * 60)

/**
 * A threshold below one: on a path of one clause the chain refuses it too,
 * and beside a second clause the refusal is this wallet's alone, since the
 * chain refuses only a rule whose every clause is zero.
 */
const clauseRefusals = (clause: Clause, index: number, clauseCount: number): Refusal[] => {
  const refusals: Refusal[] = []
  const members = clause.credentials.filter((credential) => !isEmptySlot(credential)).length
  if (members === 0) refusals.push({ key: 'emptyGroup', clause: index })
  else if (clause.threshold > members) {
    refusals.push({ key: 'thresholdAboveMembers', clause: index })
  }
  if (clause.threshold < 1) {
    refusals.push({
      key: clauseCount > 1 ? 'thresholdBelowOneOwnRule' : 'thresholdBelowOne',
      clause: index
    })
  }
  if (clause.threshold > THRESHOLD_FIELD_MAX) {
    refusals.push({ key: 'thresholdAboveField', clause: index })
  }
  if (clause.credentials.length > MEMBER_CEILING) {
    refusals.push({ key: 'memberCeiling', clause: index })
  }
  return refusals
}

/**
 * A wait past the field's width refuses with the width's sentence alone; the
 * picker's ceiling refuses every longer wait that still fits the field.
 */
const waitRefusals = (wait: bigint): Refusal[] => {
  if (wait < 0n || wait >= WAIT_FIELD_LIMIT) return [{ key: 'waitFieldWidth' }]
  if (wait > PICKER_CEILING_SECONDS) return [{ key: 'waitCeiling' }]
  return []
}

/**
 * The refusals of the path's shape alone: the path's own first, then each
 * clause in order. The editor's continue applies these; the waiting period is
 * judged on its own screen. How wide a rule a block can check is the SDK's to
 * judge, so no refusal here stands for it.
 */
export const shapeRefusalsOf = (draft: SetupDraft): Refusal[] => {
  const pathRefusals: Refusal[] = methodCountOf(draft.clauses) === 0 ? [{ key: 'noMethod' }] : []
  return [
    ...pathRefusals,
    ...draft.clauses.flatMap((clause, index) => clauseRefusals(clause, index, draft.clauses.length))
  ]
}

/**
 * Every refusal of the draft: the shape's, then the waiting period's. A path
 * this wallet can save answers an empty list.
 */
export const refusalsOf = (draft: SetupDraft): Refusal[] => [
  ...shapeRefusalsOf(draft),
  ...waitRefusals(draft.wait)
]
