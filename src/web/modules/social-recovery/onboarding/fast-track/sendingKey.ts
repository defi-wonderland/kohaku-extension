import type { Account } from '@ambire-common/interfaces/account'
import type { Key } from '@ambire-common/interfaces/keystore'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

import { listedSlotOf } from './derivation'

/**
 * The key that sends the fast track's recovery and pays its gas: the slot's
 * basic account, the account that receives control. Its key is the one the
 * recovery installs on the recovered account, so the key that receives
 * control is the key that pays. The wallet lists that account at its own key,
 * which the keystore holds as an ordinary key of the recovery phrase the fast
 * track made. Null where the receiving account is not such a basic account.
 */
export const fastTrackSendingKeyOf = (
  receivingAccount: Address,
  accounts: readonly Account[],
  keys: readonly Key[]
): Address | null => listedSlotOf(receivingAccount, accounts, keys)
