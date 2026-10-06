/**
 * The done screen's words over the summary: a row's name (a guardian by its
 * address, a passkey by its own name where it carries one, any other method
 * by its kind's name) and the list of the methods the recovery used.
 */
import type { Translate } from '@web/modules/social-recovery/shared/display'
import { ellipsizeName, renderShortAddress } from '@web/modules/social-recovery/shared/display'
import { guardianAddressOf } from '@web/modules/social-recovery/setup/editor'
import { kindNameOf } from '@web/modules/social-recovery/setup/review'

import type { PathRow, RecoverySummary } from './types'

export const rowNameOf = (row: PathRow, t: Translate): string => {
  if (row.kind === 'ecdsa') {
    const address = guardianAddressOf(row.credential)
    const guardian = t('socialRecovery.display.nouns.guardian')
    return address ? `${guardian} ${renderShortAddress(address)}` : guardian
  }
  if (row.kind === 'passkey' && row.credential.label) {
    return ellipsizeName(row.credential.label)
  }
  return row.kind ? kindNameOf(row.kind, t) : t('socialRecovery.display.nouns.method')
}

/** The methods the recovery used, by row where the path is on this device, else by kind. */
export const usedMethodsOf = (summary: RecoverySummary, t: Translate): string[] =>
  summary.used.length > 0
    ? summary.used.map((row) => rowNameOf(row, t))
    : summary.usedKinds.map((kind) => kindNameOf(kind, t))
