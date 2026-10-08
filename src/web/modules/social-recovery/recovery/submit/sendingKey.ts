/**
 * The key that sends the submission and pays its gas, by route. On the fresh
 * install it is the receiving basic account's own key, the key the recovery
 * installs, so the key that receives control is the key that pays; on the
 * logged-in route it is the chosen account's own key, a smart account sending
 * the call as its own batch with its controlling key as the payer.
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
 * The fast track's sending key: the receiving account itself, where the
 * wallet lists it as a basic account and the keystore holds its key as an
 * ordinary key of a recovery phrase, not a key held for one smart account.
 * Null where the receiving account is not such a basic account.
 */
export const fastTrackSendingKeyOf = (
  receivingAccount: Address,
  accounts: readonly Account[],
  keys: readonly Key[]
): Address | null => {
  const basic = accounts.find(
    (account) => !isSmartAccount(account) && sameAddress(account.addr, receivingAccount)
  )
  const held = keys.some(
    (key) =>
      key.type === 'internal' &&
      !key.dedicatedToOneSA &&
      typeof key.meta.fromSeedId === 'string' &&
      sameAddress(key.addr, receivingAccount)
  )
  return basic && held && isAddress(basic.addr) ? basic.addr : null
}

/**
 * How the logged-in route sends: a smart account runs the call as its own
 * batch, paid by the controlling key the keystore holds for it; a basic
 * account sends it from its own key. A basic account has no account apart
 * from its key to transfer from, so its deposit step offers the deposit from
 * outside alone. `account` is the chosen account's address as the recovery
 * entry holds it. Null where the keystore holds no key of the account.
 */
export const loggedInPlanOf = (facts: ListedAccountFacts, account: Address): SendingPlan | null => {
  const { key } = facts
  if (!key) {
    return null
  }
  if (facts.creation) {
    return { kind: 'account-batch', key, facts, account }
  }
  return { kind: 'key', key }
}
