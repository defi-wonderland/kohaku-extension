/**
 * The hook that hands a screen the facts the wallet holds for one listed
 * account on the recovery chain (`accountFactsOf`), read from the accounts,
 * keystore and networks controller states, so no screen reads those itself.
 */
import { useMemo } from 'react'

import useAccountsControllerState from '@web/hooks/useAccountsControllerState'
import useKeystoreControllerState from '@web/hooks/useKeystoreControllerState'
import useNetworksControllerState from '@web/hooks/useNetworksControllerState'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

import { accountFactsOf } from './account-facts'
import type { AccountFactsReading } from './types'

export const useAccountFacts = (account: Address | undefined): AccountFactsReading => {
  const { accounts, accountStates } = useAccountsControllerState()
  const { keys } = useKeystoreControllerState()
  const { networks } = useNetworksControllerState()
  return useMemo(
    () => accountFactsOf(account, { accounts, accountStates, keys, networks }),
    [account, accounts, accountStates, keys, networks]
  )
}
