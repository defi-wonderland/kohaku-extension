/**
 * The cancel in flight on this device, in the extension's local storage under
 * `socialRecovery:cancelInFlight:<chainId>:<account>`, stored as
 * `{ value, savedAt }` like every record of the wallet. Every page of the
 * extension reads and writes it while it holds the Web Locks lock named by its
 * key, so two tabs never both claim one cancel.
 */
import { isHex } from 'viem'

import type { Address, Hex } from '@web/modules/social-recovery/sdk-interfaces'
import { isDecimalString } from '@web/modules/social-recovery/shared/records/guards'
import { RECORDS_KEY_PREFIX } from '@web/modules/social-recovery/shared/records/records'
import type { ChainId } from '@web/modules/social-recovery/shared/records/types'
import type { WatcherStorage } from '@web/modules/social-recovery/watcher'

import type { CancelClaim, CancelClaims, StoredCancelClaim } from './types'

export const cancelClaimKeyOf = (chainId: ChainId, account: Address): string =>
  `${RECORDS_KEY_PREFIX}:cancelInFlight:${String(chainId)}:${account.toLowerCase()}`

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The claim a stored value holds; a storage read is a boundary, so every field is checked. */
export const cancelClaimFrom = (stored: unknown): CancelClaim | undefined => {
  if (!isObject(stored) || !isObject(stored.value)) {
    return undefined
  }
  const { value } = stored
  if (
    !isDecimalString(value.attemptId) ||
    typeof value.requestId !== 'string' ||
    !Number.isSafeInteger(value.startBlock) ||
    (value.transactionHash !== undefined && !isHex(value.transactionHash))
  ) {
    return undefined
  }
  return {
    attemptId: BigInt(value.attemptId),
    requestId: value.requestId,
    startBlock: value.startBlock as number,
    ...(value.transactionHash ? { transactionHash: value.transactionHash as Hex } : {})
  }
}

const storedOf = (claim: CancelClaim): StoredCancelClaim => ({
  ...claim,
  attemptId: claim.attemptId.toString()
})

/** Runs `task` while it holds the Web Locks lock named by `key`, where the platform has one. */
const underLock = <R>(key: string, task: () => Promise<R>): Promise<R> => {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  return locks ? (locks.request(key, task) as Promise<R>) : task()
}

export const cancelClaimsOf = (
  storage: WatcherStorage,
  chainId: ChainId,
  account: Address,
  now: () => number = Date.now
): CancelClaims => {
  const key = cancelClaimKeyOf(chainId, account)
  const read = async () => cancelClaimFrom(await storage.get(key))
  const write = async (claim: CancelClaim | null) => {
    await storage.set(key, { value: claim ? storedOf(claim) : null, savedAt: now() })
  }
  return {
    read,
    claim: (claim) =>
      underLock(key, async () => {
        const held = await read()
        if (held) {
          return { claimed: false, held }
        }
        await write(claim)
        return { claimed: true }
      }),
    markSent: (requestId, transactionHash) =>
      underLock(key, async () => {
        const held = await read()
        if (held?.requestId === requestId) {
          await write({ ...held, transactionHash })
        }
      }),
    release: (requestId) =>
      underLock(key, async () => {
        const held = await read()
        if (held?.requestId === requestId) {
          await write(null)
        }
      })
  }
}
