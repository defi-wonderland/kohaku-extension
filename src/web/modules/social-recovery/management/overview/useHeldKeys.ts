/**
 * The account's keys this wallet holds, from the wallet's accounts and its
 * keystore; undefined until the wallet has read both. The list is kept by
 * content, so a wallet update that names the same keys reads nothing again.
 */
import { useRef } from 'react'

import useAccountsControllerState from '@web/hooks/useAccountsControllerState'
import useKeystoreControllerState from '@web/hooks/useKeystoreControllerState'
import { ownKeysOf } from '@web/modules/social-recovery/recovery/entry/running'
import type { Address } from '@kohaku-eth/social-recovery'

export const useHeldKeys = (account: Address): readonly Address[] | undefined => {
  const { accounts } = useAccountsControllerState()
  const { keys } = useKeystoreControllerState()
  const held = accounts && keys ? ownKeysOf(accounts, keys, account) : undefined
  const kept = useRef(held)
  if (held?.join(',') !== kept.current?.join(',')) {
    kept.current = held
  }
  return kept.current
}
