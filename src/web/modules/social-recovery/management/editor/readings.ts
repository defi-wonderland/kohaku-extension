/**
 * The review's pure readings: the trust list rows of the rows the edit adds,
 * the setup read as the save gate takes it, whether the save still lacks the
 * password it seals the backup under, the save's own gate, and whether a run
 * stands where nothing is on its way to the chain.
 */
import type { Credential, SetupDraft } from '@web/modules/social-recovery/sdk-interfaces'
import { sameAddress } from '@web/modules/social-recovery/shared/client'
import { sameCredential } from '@web/modules/social-recovery/shared/records'
import { mayStillLand } from '@web/modules/social-recovery/shared/writes'
import type { ArmState } from '@web/modules/social-recovery/setup/arm'
import type { AccountReads, SaveGate, TrustRow } from '@web/modules/social-recovery/setup/review'

import type { ChangeRow, EditSession } from './types'

/**
 * The trust list rows of the methods the added rows use, each headed by the
 * added rows alone. A method only committed rows use has no row here.
 */
export const addedTrustRowsOf = (
  rows: readonly TrustRow[],
  added: readonly Credential[]
): TrustRow[] =>
  rows.flatMap((row) => {
    const headings = row.headings.filter(({ credential }) =>
      added.some((held) => sameCredential(held, credential))
    )
    return headings.length > 0 && added.some(({ method }) => sameAddress(method, row.method))
      ? [{ ...row, headings }]
      : []
  })

/**
 * The setup read as the save gate takes it. The account holds the setup this
 * edit updates, so a setup found is the edit's subject and never its block.
 */
export const editedSetupRead = (read: AccountReads['setupState']): AccountReads['setupState'] =>
  read.status === 'answered'
    ? { status: 'answered', value: { ...read.value, hasSetup: false } }
    : read

/**
 * Whether the save lacks the password it seals the backup under: a new one
 * the holder typed and this tab no longer holds, or, with none typed, the
 * committed one.
 */
export const passwordMissingOf = (
  session: EditSession,
  draft: SetupDraft,
  password: string | undefined,
  newPassword: string | undefined
): boolean => {
  if (draft.privacy.backup !== 'encrypted') {
    return false
  }
  return session.password === 'changed' ? newPassword === undefined : password === undefined
}

/** The review's save gate: the setup review's own, and something to save. */
export const editGateOf = (gate: SaveGate, rows: readonly ChangeRow[]): SaveGate => ({
  ...gate,
  canSave: gate.canSave && rows.length > 0
})

/** Whether the run stands where nothing is on its way to the chain, so leaving loses nothing. */
export const nothingOnItsWay = ({ dropped, write }: ArmState): boolean =>
  !!dropped ||
  (write.status === 'failedNotSent' && !mayStillLand(write)) ||
  write.status === 'failedReverted' ||
  write.status === 'gasReadError' ||
  write.status === 'needsDeposit'
