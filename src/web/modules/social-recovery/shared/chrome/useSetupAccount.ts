/**
 * The account a setup visit works on. A visit starts when the holder arrives at
 * the setup from outside it, and the tab latches the wallet's selected account
 * then. The latch holds across a selection change in the wallet, the navigation
 * inside the setup and a reload, so a draft stays with its account. The latch
 * lives in the tab's session storage.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import { isAddress, isAddressEqual } from 'viem'
import type { Address } from 'viem'

import { WEB_ROUTES } from '@common/modules/router/constants/common'
import useSelectedAccountControllerState from '@web/hooks/useSelectedAccountControllerState'

import type { SetupAccount } from './types'

const LATCH_KEY = 'socialRecovery.setupAccount'
// The history entry that started the visit, so a reload of it keeps the latch.
const ARRIVAL_KEY = 'socialRecovery.setupArrival'
// The router gives this key to every entry it did not push, such as a typed URL.
const UNPUSHED_KEY = 'default'

const SETUP_PATH = `/${WEB_ROUTES.socialRecoverySetup}`

const listeners = new Set<() => void>()

// The location this page already decided on, so the chrome and the screen that
// both read it, and a view that remounts on it, decide once.
let settledLocation: Location | null = null

const sessionStore = (): Storage | undefined => {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

const readStored = (key: string): string | null => {
  try {
    return sessionStore()?.getItem(key) ?? null
  } catch {
    return null
  }
}

const store = (key: string, value: string) => {
  try {
    sessionStore()?.setItem(key, value)
  } catch {
    // Without session storage the tab follows the wallet's selection.
  }
}

// The stored value comes back from storage, so only an address counts as a latch.
const readLatch = (): Address | null => {
  const stored = readStored(LATCH_KEY)
  return stored !== null && isAddress(stored) ? stored : null
}

const latch = (account: Address) => {
  store(LATCH_KEY, account)
  listeners.forEach((listener) => listener())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const isSettled = (location: Location) =>
  location === settledLocation ||
  (location.key !== UNPUSHED_KEY && location.key === readStored(ARRIVAL_KEY))

const settle = (location: Location) => {
  settledLocation = location
  store(ARRIVAL_KEY, location.key)
}

// The holder arrives from outside the setup when the history entry names no
// previous route (a typed URL or a plain link) or a previous route that is not
// a setup route. The entry's state is whatever the history holds, so it is checked.
const arrivesFromOutside = (state: unknown): boolean => {
  const prevRoute =
    typeof state === 'object' && state !== null && 'prevRoute' in state
      ? state.prevRoute
      : undefined
  const pathname =
    typeof prevRoute === 'object' && prevRoute !== null && 'pathname' in prevRoute
      ? prevRoute.pathname
      : undefined
  return (
    typeof pathname !== 'string' ||
    (pathname !== SETUP_PATH && !pathname.startsWith(`${SETUP_PATH}/`))
  )
}

const useSetupAccount = (): SetupAccount => {
  const location = useLocation()
  const { account: selectedAccount } = useSelectedAccountControllerState()
  // The controller's account address is a plain string; only a real address counts.
  const selected =
    selectedAccount?.addr && isAddress(selectedAccount.addr) ? selectedAccount.addr : undefined
  const stored = useSyncExternalStore(subscribe, readLatch)
  // On an arrival the earlier visit's latch no longer counts, even before the
  // new one is stored.
  const arriving = !isSettled(location) && arrivesFromOutside(location.state)
  const latched = arriving ? null : stored

  useEffect(() => {
    if (!selected) {
      return
    }
    if (!isSettled(location)) {
      const arrived = arrivesFromOutside(location.state)
      settle(location)
      if (arrived) {
        latch(selected)
        return
      }
    }
    if (!stored) {
      latch(selected)
    }
  }, [location, selected, stored])

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
