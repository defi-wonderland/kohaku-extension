/**
 * The wait's reads: one poll of the attempt the manager holds, pinned to one
 * block, with the account's four checks beside it, and the manager's events
 * that tell the attempt's story (its opening and how it ended). A read that
 * throws, or that does not answer within its limit, answers nothing, never
 * the last good reading.
 */
import { isAddressEqual, keccak256 } from 'viem'

import type { Attempt } from '@web/modules/social-recovery/sdk-interfaces'

import type { AttemptStory, HandoverKeys, StartedNotice, WaitFacts, WaitKitClient } from './types'

/** The answer of `read`, or undefined where it throws or does not answer within `limitMs`. */
export const within = <T>(read: () => Promise<T>, limitMs: number): Promise<T | undefined> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), limitMs)
    Promise.resolve()
      .then(read)
      .then(
        (answer) => {
          clearTimeout(timer)
          resolve(answer)
        },
        () => {
          clearTimeout(timer)
          resolve(undefined)
        }
      )
  })

/**
 * One poll: the attempt read with its pinned block, whether the account still
 * authorizes the action, whether the action still fits the account, whether
 * the key being removed still holds a key value, and whether the new key
 * already holds a privilege. A key being removed the wallet no longer names
 * holds nothing.
 */
export const readWaitFacts = (
  kit: Pick<WaitKitClient, 'recovery' | 'action'>,
  keys: HandoverKeys,
  limitMs: number
): Promise<WaitFacts | undefined> =>
  within(async () => {
    const { removedKey } = keys
    const [state, authorized, supported, removedHolds, newKeyHolds] = await Promise.all([
      kit.recovery.recoveryState(),
      kit.action.isAuthorized(),
      kit.action.supportsAccount(),
      removedKey ? kit.action.isAuthority(removedKey) : Promise.resolve(false),
      kit.action.holdsAnyPrivilege(keys.newKey)
    ])
    return {
      attempt: state.attempt,
      block: state.block,
      authorized,
      supported,
      removedHolds,
      newKeyHolds
    }
  }, limitMs)

/**
 * Whether an attempt the manager reports is the one an opening event started:
 * the same id, the same setup number and the hash of that event's payload, in
 * any state but none. A rival under the same id carries another payload.
 */
export const isAttemptOf = (attempt: Attempt, started: StartedNotice): boolean =>
  attempt.state !== 'None' &&
  attempt.attemptId === started.attemptId &&
  attempt.setupNonce === started.setupNonce &&
  attempt.payloadHash.toLowerCase() === keccak256(started.payload).toLowerCase()

/**
 * The story of the recovery's attempt from the manager's events for the
 * account, from the manager's deployment block to the pinned block: the
 * opening of the attempt `attemptId` (or, where the wait knows no id yet, of
 * the latest attempt the events name), its cancel and its consume. Undefined
 * where the read fails or does not answer within `limitMs`.
 */
export const readAttemptStory = (
  kit: Pick<WaitKitClient, 'recovery' | 'descriptor' | 'account'>,
  attemptId: bigint | undefined,
  to: number,
  limitMs: number
): Promise<AttemptStory | undefined> =>
  within(async () => {
    const { events } = kit.recovery
    const from = Math.min(kit.descriptor.deployedAt, to)
    const notifications = (await events.fetch(events.accountFilter(), { from, to })).filter(
      (notification) =>
        !notification.at.removed &&
        'account' in notification &&
        isAddressEqual(notification.account, kit.account)
    )
    const opened = notifications.filter(
      (notification): notification is StartedNotice => notification.kind === 'attempt-started'
    )
    const id = attemptId ?? opened[opened.length - 1]?.attemptId
    if (id === undefined) {
      return { consumed: false }
    }
    const started = [...opened].reverse().find((notification) => notification.attemptId === id)
    const cancelled = notifications.find(
      (notification): notification is Extract<typeof notification, { kind: 'attempt-cancelled' }> =>
        notification.kind === 'attempt-cancelled' && notification.attemptId === id
    )
    const consumed = notifications.some(
      (notification) => notification.kind === 'attempt-consumed' && notification.attemptId === id
    )
    return {
      attemptId: id,
      ...(started ? { started } : {}),
      ...(cancelled ? { cancelled } : {}),
      consumed
    }
  }, limitMs)
