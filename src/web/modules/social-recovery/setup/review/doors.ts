/**
 * The account's other doors, the informational read of the review: the keys
 * beside the one a recovery removes, from the setup description, and the
 * account's code entries. A description that could not be read renders that
 * the wallet could not read the doors; it never touches Save.
 */
import type { Address, SetupDescription } from '@web/modules/social-recovery/sdk-interfaces'
import { sameAddress } from '@web/modules/social-recovery/shared/client'

import type { AccountRead, CodeEntriesReading, Doors } from './types'

/**
 * The account's code entries. No read lists them yet, so they always read as
 * unavailable and the doors name the keys alone.
 */
export const codeEntriesOf = (): CodeEntriesReading => ({ status: 'unavailable' })

/** The candidate keys that hold authority over the account. */
export const authoritiesOf = (description: SetupDescription): Address[] =>
  description.candidateKeys.filter(({ isAuthority }) => isAuthority).map(({ address }) => address)

/** The keys that hold authority beside the one a recovery removes. */
export const keysBesideOf = (description: SetupDescription): number => {
  const { removedKey } = description
  return authoritiesOf(description).filter(
    (address) => removedKey === 'no-creation-triple' || !sameAddress(address, removedKey)
  ).length
}

export const doorsOf = (
  description: AccountRead<SetupDescription>,
  codeEntries: CodeEntriesReading
): Doors => {
  if (description.status === 'pending') return { kind: 'pending' }
  if (description.status === 'failed') return { kind: 'unreadable' }
  const keys = keysBesideOf(description.value)
  if (codeEntries.status === 'unavailable') {
    return keys === 0 ? { kind: 'none' } : { kind: 'keys', keys }
  }
  if (keys === 0 && codeEntries.count === 0) return { kind: 'none' }
  return { kind: 'pair', codeEntries: codeEntries.count, keys }
}
