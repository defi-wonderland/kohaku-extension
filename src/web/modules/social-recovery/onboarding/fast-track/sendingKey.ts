import { isAddress, isAddressEqual } from 'viem'

import type { Account } from '@ambire-common/interfaces/account'
import type { Key } from '@ambire-common/interfaces/keystore'
import { isSmartAccount } from '@ambire-common/libs/account/account'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

const sameAs = (address: string) => (candidate: string) =>
  isAddress(candidate) && isAddress(address) && isAddressEqual(candidate, address)

/**
 * The key that sends the fast track's recovery and pays its gas: the ordinary
 * key of the seed slot whose smart account receives control, never the key
 * the recovery installs.
 *
 * The keystore keeps no slot index with a key, so the slot is found through
 * the recovery phrase both keys came from: the smart account's controlling key
 * is the phrase's key held for that one smart account, and the sending key is
 * the phrase's other key, the one the wallet lists as a basic account. The
 * fast track adds one slot of a new phrase, so exactly one such key exists.
 * Null where the receiving account is not a listed smart account, where its
 * controlling keys come from no single phrase, or where that phrase gives
 * other than one listed basic account.
 */
export const fastTrackSendingKeyOf = (
  receivingAccount: Address,
  accounts: readonly Account[],
  keys: readonly Key[]
): Address | null => {
  const smart = accounts.find(
    (account) => isSmartAccount(account) && sameAs(receivingAccount)(account.addr)
  )
  if (!smart) {
    return null
  }
  const seedIds = new Set(
    keys
      .filter(
        (key) =>
          key.type === 'internal' &&
          key.dedicatedToOneSA &&
          smart.associatedKeys.some(sameAs(key.addr))
      )
      .map((key) => key.meta.fromSeedId)
  )
  const [seedId] = [...seedIds]
  if (seedIds.size !== 1 || typeof seedId !== 'string') {
    return null
  }
  const ordinaryKeys = keys.filter(
    (key) => key.type === 'internal' && !key.dedicatedToOneSA && key.meta.fromSeedId === seedId
  )
  const basics = accounts.filter(
    (account) =>
      !isSmartAccount(account) && ordinaryKeys.some((key) => sameAs(key.addr)(account.addr))
  )
  const [basic] = basics
  return basics.length === 1 && basic && isAddress(basic.addr) ? basic.addr : null
}
