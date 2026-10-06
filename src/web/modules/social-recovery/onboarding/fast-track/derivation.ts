import { isAddress, isAddressEqual } from 'viem'

import {
  DERIVATION_OPTIONS,
  SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
} from '@ambire-common/consts/derivation'
import type { Account } from '@ambire-common/interfaces/account'
import type { Key } from '@ambire-common/interfaces/keystore'
import { isSmartAccount } from '@ambire-common/libs/account/account'
import { KeyIterator } from '@ambire-common/libs/keyIterator/keyIterator'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

import { SLOT_INDEX } from './constants'
import type { ListedSlot, SlotKeys, TempSeed } from './types'

/**
 * The recovery phrase in a one-time message the keystore sent to the page;
 * null for any other message. The message crosses the event bus, so its shape
 * is checked here.
 */
export const tempSeedOf = (data: unknown): TempSeed | null => {
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const { tempSeed } = data as { tempSeed?: unknown }
  if (typeof tempSeed !== 'object' || tempSeed === null) {
    return null
  }
  const { seed, seedPassphrase, hdPathTemplate } = tempSeed as Record<string, unknown>
  const template = DERIVATION_OPTIONS.find((option) => option.value === hdPathTemplate)
  if (typeof seed !== 'string' || !seed || !template) {
    return null
  }
  return {
    seed,
    seedPassphrase: typeof seedPassphrase === 'string' ? seedPassphrase : null,
    hdPathTemplate: template.value
  }
}

/**
 * The two keys of a slot, derived from the recovery phrase through the
 * library's key iterator: the ordinary key at the slot's index, and the key at
 * the index plus the smart-account offset, the one that controls the slot's
 * smart account and that a recovery installs.
 */
export const slotKeysOf = async (seed: TempSeed, index: number = SLOT_INDEX): Promise<SlotKeys> => {
  const iterator = new KeyIterator(seed.seed, seed.seedPassphrase)
  const controlling = index + SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
  const [ordinaryKey, controllingKey] = await iterator.retrieve(
    [
      { from: index, to: index },
      { from: controlling, to: controlling }
    ],
    seed.hdPathTemplate
  )
  if (!ordinaryKey || !controllingKey || !isAddress(ordinaryKey) || !isAddress(controllingKey)) {
    throw new Error(`The key iterator derived no keys for slot index ${index}.`)
  }
  return { ordinaryKey, controllingKey }
}

const sameAs = (address: Address) => (candidate: string) =>
  isAddress(candidate) && isAddressEqual(candidate, address)

/**
 * The slot's two accounts, once the wallet lists them and the keystore holds
 * both keys: the basic account at the ordinary key, and the smart account
 * whose associated keys name the controlling key. The picker's account and
 * the local derivation must agree on that key; null until both accounts are
 * listed that way.
 */
export const listedSlotOf = (
  slot: SlotKeys,
  accounts: readonly Account[],
  keys: readonly Key[]
): ListedSlot | null => {
  const basic = accounts.find(
    (account) => !isSmartAccount(account) && sameAs(slot.ordinaryKey)(account.addr)
  )
  const smart = accounts.find(
    (account) => isSmartAccount(account) && account.associatedKeys.some(sameAs(slot.controllingKey))
  )
  const holds = (address: Address) =>
    keys.some((key) => key.type === 'internal' && sameAs(address)(key.addr))
  if (
    !basic ||
    !smart ||
    !isAddress(basic.addr) ||
    !isAddress(smart.addr) ||
    !holds(slot.ordinaryKey) ||
    !holds(slot.controllingKey)
  ) {
    return null
  }
  return { basicAccount: basic.addr, smartAccount: smart.addr }
}
