/**
 * The done screen's one read: the manager's consume event of the account's
 * current attempt, from the manager's deployment block to the block the
 * attempt read pins, and the account's privilege events of that same
 * transaction, which name the key granted and the key removed. The screen
 * names the keys as these events report them and never as the account's
 * signer state reads. A read that throws, or does not answer within its
 * limit, answers nothing.
 */
import { hexToBigInt, isAddressEqual } from 'viem'

import type { LogPosition } from '@web/modules/social-recovery/sdk-interfaces'
import { within } from '@web/modules/social-recovery/recovery/wait'
import type { StartedNotice } from '@web/modules/social-recovery/recovery/wait'

import type {
  BlockTimeRead,
  ConsumedNotice,
  ConsumeReading,
  DoneKitClient,
  PrivilegeNotice
} from './types'

/** Whether a log sits before another one on the chain. */
const before = (a: LogPosition, b: LogPosition): boolean =>
  a.blockNumber < b.blockNumber || (a.blockNumber === b.blockNumber && a.logIndex < b.logIndex)

const sameTransaction = (a: LogPosition, b: LogPosition): boolean =>
  a.transactionHash.toLowerCase() === b.transactionHash.toLowerCase()

const granting = (notice: PrivilegeNotice): boolean => hexToBigInt(notice.priv) !== 0n

/**
 * The consume of the attempt the manager's record holds, where that record
 * reads consumed, with the opening of the same attempt, the two keys its
 * transaction moved, the removed key's latest earlier grant where an event
 * names one, and the consume's block time. An attempt that is not consumed,
 * or a consume of an earlier attempt only, answers none: the current attempt
 * may still run. A consume whose transaction names no granted or no removed
 * key is a read that has not caught up yet, and fails.
 */
export const readConsume = (
  kit: DoneKitClient,
  blockTime: BlockTimeRead,
  limitMs: number
): Promise<ConsumeReading | undefined> =>
  within(async (): Promise<ConsumeReading> => {
    const { events } = kit.recovery
    const state = await kit.recovery.recoveryState()
    const to = state.block.number
    const range = { from: Math.min(kit.descriptor.deployedAt, to), to }
    const ofAccount = (notice: Pick<ConsumedNotice, 'at' | 'account'>): boolean =>
      !notice.at.removed && isAddressEqual(notice.account, kit.account)

    const { attempt } = state
    if (attempt.state !== 'Consumed') {
      return { kind: 'none' }
    }

    const notifications = await events.fetch(events.accountFilter(), range)
    const consumed = notifications
      .filter((notice): notice is ConsumedNotice => notice.kind === 'attempt-consumed')
      .filter(ofAccount)
      .filter((notice) => notice.attemptId === attempt.attemptId)
      .pop()
    if (!consumed) {
      return { kind: 'none' }
    }
    const started = notifications
      .filter((notice): notice is StartedNotice => notice.kind === 'attempt-started')
      .filter(ofAccount)
      .filter((notice) => notice.attemptId === consumed.attemptId && before(notice.at, consumed.at))
      .pop()

    const privileges = (await events.fetch(events.privilegeFilter(), range))
      .filter((notice): notice is PrivilegeNotice => notice.kind === 'privilege-changed')
      .filter(ofAccount)
    const moved = privileges.filter((notice) => sameTransaction(notice.at, consumed.at))
    const granted = moved.find(granting)?.addr
    const removed = moved.find((notice) => !granting(notice))?.addr
    if (!granted || !removed) {
      throw new Error('The consume transaction names no granted or no removed key yet.')
    }
    const removedPrivilege = privileges
      .filter(
        (notice) =>
          isAddressEqual(notice.addr, removed) && granting(notice) && before(notice.at, consumed.at)
      )
      .pop()?.priv

    const time =
      consumed.at.blockNumber === state.block.number
        ? state.block.timestamp
        : await blockTime(consumed.at.blockNumber)

    return {
      kind: 'found',
      event: {
        consumed,
        ...(started ? { started } : {}),
        granted,
        removed,
        ...(removedPrivilege ? { removedPrivilege } : {}),
        usedMethods: attempt.usedMethods,
        time
      }
    }
  }, limitMs)
