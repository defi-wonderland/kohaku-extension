/**
 * The key that sends the submission and pays its gas, by route. On the fresh
 * install it is the ordinary key of the seed slot whose smart account receives
 * control, never the key the recovery installs; on the logged-in route it is
 * the chosen account's own key, a smart account sending the call as its own
 * batch with its controlling key as the payer.
 */
import { isAddress } from 'viem'

import type { Account } from '@ambire-common/interfaces/account'
import type { Key } from '@ambire-common/interfaces/keystore'
import { isSmartAccount } from '@ambire-common/libs/account/account'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import { sameAddress } from '@web/modules/social-recovery/shared/client'
import type { ListedAccountFacts } from '@web/modules/social-recovery/shared/client'

import type { SendingPlan } from './types'

/**
 * The fast track's sending key. The keystore keeps no slot index with a key,
 * so the slot is found through the recovery phrase both keys came from: the
 * smart account's controlling key is the phrase's key held for that one smart
 * account, and the sending key is the phrase's other key, the one the wallet
 * lists as a basic account. Null where the receiving account is not a listed
 * smart account, where its controlling keys come from no single phrase, or
 * where that phrase gives other than one listed basic account.
 */
export const fastTrackSendingKeyOf = (
  receivingAccount: Address,
  accounts: readonly Account[],
  keys: readonly Key[]
): Address | null => {
  const smart = accounts.find(
    (account) => isSmartAccount(account) && sameAddress(account.addr, receivingAccount)
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
          smart.associatedKeys.some((associated) => sameAddress(associated, key.addr))
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
      !isSmartAccount(account) && ordinaryKeys.some((key) => sameAddress(key.addr, account.addr))
  )
  const [basic] = basics
  return basics.length === 1 && basic && isAddress(basic.addr) ? basic.addr : null
}

/**
 * How the logged-in route sends: a smart account runs the call as its own
 * batch, paid by the controlling key the keystore holds for it; a basic
 * account sends it from its own key. A basic account has no account apart
 * from its key to transfer from, so its deposit step offers the deposit from
 * outside alone. Null where the keystore holds no key of the account.
 */
export const loggedInPlanOf = (facts: ListedAccountFacts): SendingPlan | null => {
  const { key } = facts
  if (!key) {
    return null
  }
  if (facts.creation) {
    return { kind: 'account-batch', key, facts }
  }
  return { kind: 'key', key }
}
