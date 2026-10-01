/**
 * The facts the wallet holds for one account it lists, read from its own
 * state: whether the account has code on the recovery chain, the account's key
 * the keystore holds, and the account's creation record.
 */
import type { Account } from '@ambire-common/interfaces/account'
import type { Address, CreationRecord, Hex } from '@web/modules/social-recovery/sdk-interfaces'

import { sameAddress } from './addresses'
import { CHAIN_IDS, WALLET_RECOVERY_CHAIN } from './chains'
import { networkOf } from './extension-provider'
import type { AccountFacts, AccountFactsReading, AccountFactsSources, KeyHandle } from './types'

/**
 * The block a creation record names. The wallet holds none: an account with
 * no code has no creation block yet, and the wallet does not read the block a
 * deployed account was created at. Zero, the lowest block, stands in, so a
 * read from it misses nothing.
 */
export const CREATION_BLOCK_STAND_IN = 0

/** The creation record of a listed account, or undefined for a basic account. */
export const creationRecordOf = (account: Pick<Account, 'creation'>): CreationRecord | undefined =>
  account.creation
    ? {
        factory: account.creation.factoryAddr as Address,
        bytecode: account.creation.bytecode as Hex,
        salt: account.creation.salt as Hex,
        block: CREATION_BLOCK_STAND_IN
      }
    : undefined

/**
 * The client facts of a listed account: its creation record and its
 * associated keys as the keys the client asks about. A basic account gives
 * none, so its client reads as one built with no facts.
 */
export const clientFactsOf = (
  account: Pick<Account, 'associatedKeys' | 'creation'>
): AccountFacts => {
  const creation = creationRecordOf(account)
  return creation
    ? { creation, candidateKeys: account.associatedKeys.map((key) => key as Address) }
    : {}
}

/**
 * The account's key the keystore holds: the first of the account's associated
 * keys the keystore has an entry for, with that entry's type. Undefined where
 * it holds none.
 */
const heldKeyOf = (
  account: Pick<Account, 'associatedKeys'>,
  keys: NonNullable<AccountFactsSources['keys']>
): KeyHandle | undefined => {
  const held = account.associatedKeys
    .map((associated) => keys.find((key) => sameAddress(key.addr, associated)))
    .find((key) => key !== undefined)
  return held ? { addr: held.addr as Address, type: held.type } : undefined
}

/** The facts of a listed account on the recovery chain, from the wallet's own state. */
export const accountFactsOf = (
  address: Address | undefined,
  sources: AccountFactsSources
): AccountFactsReading => {
  const { accounts, accountStates, keys, networks } = sources
  if (!address || !accounts || !accountStates || !keys || !networks) {
    return { status: 'loading' }
  }
  const account = accounts.find((candidate) => sameAddress(candidate.addr, address))
  if (!account) return { status: 'unavailable', cause: 'not-listed' }
  const network = networkOf(networks, WALLET_RECOVERY_CHAIN)
  if (!network) return { status: 'unavailable', cause: 'no-network' }
  const state = accountStates[account.addr]?.[String(CHAIN_IDS[WALLET_RECOVERY_CHAIN])]
  if (!state) return { status: 'loading' }
  const key = heldKeyOf(account, keys)
  const creation = creationRecordOf(account)
  return {
    status: 'ready',
    facts: {
      account,
      state,
      network,
      deployed: state.isDeployed,
      ...(key ? { key } : {}),
      ...(creation ? { creation } : {})
    }
  }
}
