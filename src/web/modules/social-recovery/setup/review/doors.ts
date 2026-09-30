/**
 * The account's other doors, the informational read of the review: the keys
 * beside the one a recovery removes, from the setup description, and the
 * account's code entries. A description that could not be read renders that
 * the wallet could not read the doors; it never touches Save.
 */
import type { Address, SetupDescription } from '@web/modules/social-recovery/sdk-interfaces'
import { sameAddress } from '@web/modules/social-recovery/shared/client'
import type { RemovedKeyReading } from '@web/modules/social-recovery/shared/client'

import type { AccountRead, CodeEntriesReading, Doors } from './types'

/**
 * The account's code entries. No read lists them yet, so they always read as
 * unavailable and the doors name the keys alone.
 */
export const codeEntriesOf = (): CodeEntriesReading => ({ status: 'unavailable' })

/** The candidate keys that hold authority over the account. */
export const authoritiesOf = (description: SetupDescription): Address[] =>
  description.candidateKeys.filter(({ isAuthority }) => isAuthority).map(({ address }) => address)

/** The keys that hold authority beside the one a recovery removes, where one is named. */
export const keysBesideOf = (description: SetupDescription, removed: Address | undefined): number =>
  authoritiesOf(description).filter((address) => !removed || !sameAddress(address, removed)).length

/**
 * The doors from the setup description, less the key the account block names
 * as the one a recovery removes. Where neither the description nor that read
 * names the removed key, the doors cannot be counted.
 */
export const doorsOf = (
  description: AccountRead<SetupDescription>,
  codeEntries: CodeEntriesReading,
  removedKey: AccountRead<RemovedKeyReading>
): Doors => {
  if (description.status === 'pending') {
    return { kind: 'pending' }
  }
  if (description.status === 'failed') {
    return { kind: 'unreadable' }
  }
  if (removedKey.status === 'pending') {
    return { kind: 'pending' }
  }
  const removed =
    removedKey.status === 'answered' && removedKey.value.kind === 'named'
      ? removedKey.value.key
      : undefined
  if (!removed && description.value.removedKey === 'no-creation-triple') {
    return { kind: 'unreadable' }
  }
  const keys = keysBesideOf(description.value, removed)
  if (codeEntries.status === 'unavailable') {
    return keys === 0 ? { kind: 'none' } : { kind: 'keys', keys }
  }
  if (keys === 0 && codeEntries.count === 0) {
    return { kind: 'none' }
  }
  return { kind: 'pair', codeEntries: codeEntries.count, keys }
}
