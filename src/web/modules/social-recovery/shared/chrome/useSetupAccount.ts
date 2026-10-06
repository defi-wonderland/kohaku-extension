/**
 * The account a setup tab works on. The tab latches the wallet's selected
 * account on its first read and keeps it across a selection change in the
 * wallet, its own navigation and a reload, so a draft stays with its account.
 * The latch lives in the tab's session storage, under one key.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { isAddress, isAddressEqual } from 'viem'
import type { Address } from 'viem'

import useSelectedAccountControllerState from '@web/hooks/useSelectedAccountControllerState'

import type { SetupAccount } from './types'

const LATCH_KEY = 'socialRecovery.setupAccount'

const listeners = new Set<() => void>()

const sessionStore = (): Storage | undefined => {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

// The stored value comes back from storage, so only an address counts as a latch.
const readLatch = (): Address | null => {
  try {
    const stored = sessionStore()?.getItem(LATCH_KEY) ?? null
    return stored !== null && isAddress(stored) ? stored : null
  } catch {
    return null
  }
}

const latch = (account: Address) => {
  try {
    const store = sessionStore()
    store?.removeItem(LATCH_KEY)
    store?.setItem(LATCH_KEY, account)
  } catch {
    // Without session storage the tab follows the wallet's selection.
  }
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const useSetupAccount = (): SetupAccount => {
  const { account: selectedAccount } = useSelectedAccountControllerState()
  // The controller's account address is a plain string; only a real address counts.
  const selected =
    selectedAccount?.addr && isAddress(selectedAccount.addr) ? selectedAccount.addr : undefined
  const latched = useSyncExternalStore(subscribe, readLatch)

  useEffect(() => {
    if (!latched && selected) {
      latch(selected)
    }
  }, [latched, selected])

  const account = latched ?? selected
  const differs = !!account && !!selected && !isAddressEqual(account, selected)

  const switchToSelected = useCallback(() => {
    if (selected) {
      latch(selected)
    }
  }, [selected])

  return useMemo(
    () => ({
      account,
      differs,
      selected: differs ? selected : undefined,
      switchToSelected
    }),
    [account, differs, selected, switchToSelected]
  )
}

export default useSetupAccount
