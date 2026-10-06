import { isAddress } from 'viem'

import type { Account } from '@ambire-common/interfaces/account'
import { isSmartAccount } from '@ambire-common/libs/account/account'
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

import { FRESH_INSTALL_ROUTE } from './constants'

/**
 * Whether the router state carries the warning's acknowledgment. The state
 * comes from the history entry, so anything may stand there: only the exact
 * flag counts.
 */
export const acknowledgedOf = (state: unknown): boolean =>
  typeof state === 'object' &&
  state !== null &&
  (state as { acknowledged?: unknown }).acknowledged === true

/**
 * The account step on the fresh install's route, with the account that
 * receives control where it is known.
 */
export const accountStepPathOf = (receivingAccount?: Address): string => {
  const search = new URLSearchParams({ route: FRESH_INSTALL_ROUTE })
  if (receivingAccount) {
    search.set('to', receivingAccount)
  }
  return `${WEB_ROUTES.socialRecoveryRecoveryAccount}?${search.toString()}`
}

/** The checklist of the account being recovered. */
export const checklistPathOf = (account: Address): string =>
  `${WEB_ROUTES.socialRecoveryRecoveryChecklist}?${new URLSearchParams({ account }).toString()}`

/** The readout of the account being recovered. */
export const readoutPathOf = (account: Address): string =>
  `${WEB_ROUTES.socialRecoveryRecoveryReadout}?${new URLSearchParams({ account }).toString()}`

/** The account being recovered, from the URL's `account` parameter; undefined where it is no address. */
export const accountParamOf = (search: URLSearchParams): Address | undefined => {
  const value = search.get('account')
  return value && isAddress(value) ? value : undefined
}

/**
 * The selected account where it is a smart account: on the fast track the
 * wallet selects the slot's smart account once it lists it, the account that
 * receives control.
 */
export const selectedSmartAccountOf = (selected: Account | null | undefined): Address | undefined =>
  selected && isSmartAccount(selected) && isAddress(selected.addr) ? selected.addr : undefined
