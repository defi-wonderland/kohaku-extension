/**
 * The recovered account as the wallet adds it on the fast track: its address,
 * the key the recovery granted as its associated key, and the creation the
 * wallet computes for a smart account from its original creation privilege,
 * the removed key at the value it held (where no privilege event names that
 * value, the one the wallet's picker gives a smart account's key). The
 * preferences are the ones the picker gives a new account.
 */
import { getDefaultAccountPreferences, getSmartAccount } from '@ambire-common/libs/account/account'
import { isAddressEqual } from 'viem'

import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

import { CREATION_STAND_IN } from './constants'
import type { RecoveredAccount, RecoveredAccountInput } from './types'

export const recoveredAccountOf = async ({
  account,
  granted,
  removed,
  removedPrivilege,
  existing
}: RecoveredAccountInput): Promise<RecoveredAccount> => {
  const computed = await getSmartAccount(
    [{ addr: removed, hash: removedPrivilege ?? CREATION_STAND_IN }],
    existing
  )
  return {
    account: {
      addr: account,
      associatedKeys: [granted],
      initialPrivileges: computed.initialPrivileges,
      creation: computed.creation,
      preferences: getDefaultAccountPreferences(account, existing),
      domainName: null
    },
    creation: isAddressEqual(computed.addr as Address, account) ? 'reproduced' : 'stand-in'
  }
}
