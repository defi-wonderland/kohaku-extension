/**
 * The recovery password the privacy step collects, held in memory until the
 * setup it was typed for is saved or started over. It is never written to
 * storage: the storage keeps the password-set flag alone.
 *
 * The holder lives in this tab's JavaScript context, so a reload or a new tab
 * starts empty. A screen that finds no password while the level hides the
 * setup sends the user back to the privacy step to type it again.
 */
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

import type { ChainId } from './types'

const passwords = new Map<string, string>()

const holderKey = (chainId: ChainId, account: Address): string =>
  `${String(chainId)}:${account.toLowerCase()}`

export const setRecoveryPassword = (chainId: ChainId, account: Address, password: string): void => {
  passwords.set(holderKey(chainId, account), password)
}

export const readRecoveryPassword = (chainId: ChainId, account: Address): string | undefined =>
  passwords.get(holderKey(chainId, account))

export const wipeRecoveryPassword = (chainId: ChainId, account: Address): void => {
  passwords.delete(holderKey(chainId, account))
}
