/**
 * The revert data of the manager and the action as the kit's named errors.
 * Each contract prefixes its errors (`PolicyManager_`, `RecoveryAction_`);
 * the name without the prefix is the kit's name, except the action's two
 * refusals of a reserved authority, `AlreadyPrivileged` and `NotAKey`, which
 * the kit names `ReservedAuthority`.
 */
import { decodeErrorResult, type Hex, slice } from 'viem'

import {
  KIT_ERROR_NAMES,
  type KitError,
  type KitErrorName,
  type KitErrorSource
} from '@web/modules/social-recovery/sdk-interfaces'

import { POLICY_MANAGER_ABI, RECOVERY_ACTION_ABI } from '../abi'

const KIT_ERRORS_ABI = [...POLICY_MANAGER_ABI, ...RECOVERY_ACTION_ABI]

const SOURCE_PREFIXES: readonly (readonly [string, KitErrorSource])[] = [
  ['PolicyManager_', 'manager'],
  ['RecoveryAction_', 'action']
]

const RENAMED: Readonly<Record<string, KitErrorName>> = {
  AlreadyPrivileged: 'ReservedAuthority',
  NotAKey: 'ReservedAuthority'
}

const kitErrorNameOf = (stripped: string): KitErrorName | undefined =>
  RENAMED[stripped] ?? KIT_ERROR_NAMES.find((name) => name === stripped)

/**
 * The kit error a revert carries: its source, its kit name, its selector and
 * its arguments by name, without the leading underscore. Undefined for data
 * that is no kit error: empty data, an unknown selector, arguments that do not
 * decode, the language's own errors, or a contract error with no kit name.
 * Never throws.
 */
export const decodeRevert = (data: Hex): KitError | undefined => {
  try {
    const { abiItem, args, errorName } = decodeErrorResult({ abi: KIT_ERRORS_ABI, data })
    const prefixed = SOURCE_PREFIXES.find(([prefix]) => errorName.startsWith(prefix))
    if (!prefixed) {
      return undefined
    }
    const [prefix, source] = prefixed
    const name = kitErrorNameOf(errorName.slice(prefix.length))
    if (!name) {
      return undefined
    }
    const values = args ?? []
    return {
      kind: 'known',
      source,
      name,
      selector: slice(data, 0, 4),
      args: Object.fromEntries(
        abiItem.inputs.map((input, index) => [
          (input.name ?? `${index}`).replace(/^_/, ''),
          values[index]
        ])
      )
    }
  } catch {
    return undefined
  }
}
