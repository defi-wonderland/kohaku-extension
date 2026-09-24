/**
 * The extension's own table of the kit's audited actions and their publishers.
 *
 * ux.md D-302 names the action the recovery module and its author the
 * publisher. ux.md D-317 (the trust list) and D-319 (the arming step) say the
 * wallet names the action with its author "read from the wallet's own table of
 * the kit's audited actions" and "offers the kit's audited actions and nothing
 * else". This table is that one source: a screen offers, names or judges an
 * action only through `auditedActionsOn` and `auditedActionOf`, and the
 * descriptors' `auditedActions` sets (sdk.md D-208) are read from it.
 *
 * The action addresses are cut-q-7 placeholders (addresses.ts).
 */
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

import { PLACEHOLDER_ADDRESSES, sameAddress } from './addresses'
import type { RecoveryChain } from './chains'

/**
 * The publishers of the audited actions, as slugs. A slug is data, never
 * copy: a screen renders a publisher through an en.json key named after it,
 * and this lane ships no string. The frames read "published by the Ethereum
 * Foundation" (design/live-frame-strings.md); no en.json key holds that name
 * yet, so the coordinator adds it.
 */
export const PUBLISHERS = ['ethereumFoundation'] as const
export type Publisher = typeof PUBLISHERS[number]

/** One audited action on one chain, with its publisher. */
export interface AuditedAction {
  kind: 'audited'
  chain: RecoveryChain
  action: Address
  publisher: Publisher
}

/** The table: one row per audited action per chain. */
export const AUDITED_ACTIONS = [
  {
    kind: 'audited',
    chain: 'sepolia',
    // cut-q-7 placeholder address.
    action: PLACEHOLDER_ADDRESSES.sepolia.action,
    publisher: 'ethereumFoundation'
  },
  {
    kind: 'audited',
    chain: 'mainnet',
    // cut-q-7 placeholder address.
    action: PLACEHOLDER_ADDRESSES.mainnet.action,
    publisher: 'ethereumFoundation'
  }
] as const

/**
 * The lane's explicit answer for an address the table does not hold. A screen
 * names no publisher for it and offers it nowhere.
 */
export const UNKNOWN_ACTION = Object.freeze({ kind: 'unknown-action' } as const)
export type UnknownAction = typeof UNKNOWN_ACTION

const rows = (): readonly AuditedAction[] => AUDITED_ACTIONS

/** The audited actions of one chain, the only list a screen offers (ux.md D-319). */
export const auditedActionsOn = (chain: RecoveryChain): AuditedAction[] =>
  rows()
    .filter((row) => row.chain === chain)
    .map((row) => ({ ...row }))

/**
 * The table's row for an action address, on the given chain where one is
 * named, or `UNKNOWN_ACTION` where the table holds no such row.
 */
export const auditedActionOf = (
  action: string | undefined,
  chain?: RecoveryChain
): AuditedAction | UnknownAction => {
  const row = rows().find(
    (r) => sameAddress(r.action, action) && (chain === undefined || r.chain === chain)
  )
  return row ? { ...row } : UNKNOWN_ACTION
}

/** Whether an action is one the kit audited, on the given chain where one is named. */
export const isAuditedAction = (action: string | undefined, chain?: RecoveryChain): boolean =>
  auditedActionOf(action, chain).kind === 'audited'
