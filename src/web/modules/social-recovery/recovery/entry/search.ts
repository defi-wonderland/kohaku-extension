/**
 * The account step's search, `?route=<route>&to=<receiving account>`, and the
 * paths the entry leads to. A search is a URL the holder can edit, so it is
 * read here once and nowhere else.
 */
import { isAddress } from 'viem'

import { WEB_ROUTES } from '@common/modules/router/constants/common'
import { RECOVERY_ROUTES } from '@web/modules/social-recovery/shared/records'
import type { RecoveryRoute } from '@web/modules/social-recovery/shared/records'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

import { ENTRY_SEARCH_KEYS } from './constants'
import type { AccountStepSearch } from './types'

const isRecoveryRoute = (value: string | null): value is RecoveryRoute =>
  RECOVERY_ROUTES.some((route) => route === value)

/** The route a search names, or null where it names none of the two. */
export const routeOfSearch = (search: string): RecoveryRoute | null => {
  const route = new URLSearchParams(search).get(ENTRY_SEARCH_KEYS.route)
  return isRecoveryRoute(route) ? route : null
}

/** The route and the receiving account a search names, or null where either is missing or malformed. */
export const parseAccountStepSearch = (search: string): AccountStepSearch | null => {
  const query = new URLSearchParams(search)
  const route = query.get(ENTRY_SEARCH_KEYS.route)
  const receivingAccount = query.get(ENTRY_SEARCH_KEYS.receivingAccount)
  if (
    !isRecoveryRoute(route) ||
    receivingAccount === null ||
    !isAddress(receivingAccount, { strict: false })
  ) {
    return null
  }
  return { route, receivingAccount }
}

/** The account step's path for a route and a receiving account. */
export const accountStepPathOf = ({ route, receivingAccount }: AccountStepSearch): string => {
  const query = new URLSearchParams()
  query.set(ENTRY_SEARCH_KEYS.route, route)
  query.set(ENTRY_SEARCH_KEYS.receivingAccount, receivingAccount)
  return `/${WEB_ROUTES.socialRecoveryRecoveryAccount}?${query.toString()}`
}

/**
 * Where a route begins: the logged-in entry for the logged-in route, the
 * recover door for the fresh install.
 */
export const routeEntryPathOf = (route: RecoveryRoute): string =>
  `/${route === 'logged-in' ? WEB_ROUTES.socialRecoveryRecovery : WEB_ROUTES.socialRecoveryRecover}`

/** The readout's path for the account being recovered. */
export const readoutPathOf = (account: Address): string => {
  const query = new URLSearchParams()
  query.set(ENTRY_SEARCH_KEYS.account, account)
  return `/${WEB_ROUTES.socialRecoveryRecoveryReadout}?${query.toString()}`
}
