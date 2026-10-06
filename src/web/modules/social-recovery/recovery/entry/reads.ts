/**
 * The reads the account step makes on the looked-up account's client. The fit
 * reads run together; the removed key, once named, is asked whether it holds
 * control of the account.
 *
 * A client built for an account the wallet does not list carries no creation
 * record, so its removed-key read cannot answer yet; that answer counts as a
 * read that failed, with its retry, never as a refusal of the account.
 */
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

import type { DestinationAnswers, EntryKitClient, FitAnswers } from './types'

export const readFit = async (client: EntryKitClient): Promise<FitAnswers> => {
  const [supportsAccount, fitCheck, removedKey] = await Promise.all([
    client.action.supportsAccount(),
    // The wallet reads carry the account implementation of the client
    // configuration, so the check judges the code the account will carry.
    client.walletReads.fitCheck(),
    client.walletReads.removedKey()
  ])
  if (removedKey.kind === 'unavailable' && removedKey.cause === 'no-creation-record') {
    throw new Error("The removed key cannot be read without the account's creation record.")
  }
  if (removedKey.kind !== 'named') {
    return { supportsAccount, fitCheck, removedKey }
  }
  const removedKeyIsAuthority = await client.action.isAuthority(removedKey.key)
  return { supportsAccount, fitCheck, removedKey, removedKeyIsAuthority }
}

export const readDestination = async (
  client: EntryKitClient,
  destination: Address
): Promise<DestinationAnswers> => {
  const [isAuthority, holdsAnyPrivilege] = await Promise.all([
    client.action.isAuthority(destination),
    client.action.holdsAnyPrivilege(destination)
  ])
  return { isAuthority, holdsAnyPrivilege }
}
