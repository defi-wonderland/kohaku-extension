/**
 * One poll of the watcher: every read of it pinned to the latest block, read
 * once for the whole poll, never the finalized one.
 *
 * An account's reading is drawn from the manager's record at that block
 * alone, so an attempt a reorganization dropped is gone from the next reading
 * that no longer reads it, and an attempt that ended reads as its ending. A
 * poll that fails, or that does not answer within its limit, keeps the last
 * good reading and marks it failed; it never reads as no attempt.
 *
 * The record holds the payload's hash alone, so the key an attempt hands the
 * account to comes from its opening log, decoded in the action's layout, and
 * only from an opening whose payload hashes to the record's. Until that decode
 * returned the reading carries the countdown and no key.
 */
import { getAddress, keccak256, zeroHash } from 'viem'

import type { Account } from '@ambire-common/interfaces/account'
import type {
  ActionState,
  Address,
  BlockHeader,
  Hex
} from '@web/modules/social-recovery/sdk-interfaces'
import { readWithin } from '@web/modules/social-recovery/shared/client/limits'
import type { WatcherReads } from '@web/modules/social-recovery/shared/client/types'

import { attemptDismissed, readWatcherRecord, updateWatcherRecord } from './record'
import type {
  AttemptEnding,
  PollInput,
  WatchedAttempt,
  WatcherReading,
  WatcherRecord
} from './types'

/** The smart accounts among the listed ones, each once; a basic account holds no setup. */
export const watchedAccountsOf = (accounts: readonly Account[]): Address[] =>
  accounts
    .filter((account) => !!account.creation)
    .map((account) => getAddress(account.addr))
    .filter((addr, index, all) => all.indexOf(addr) === index)

const messageOf = (thrown: unknown): string =>
  thrown instanceof Error ? thrown.message : String(thrown)

const samePayload = (payload: Hex, payloadHash: Hex): boolean =>
  keccak256(payload).toLowerCase() === payloadHash.toLowerCase()

/** The blocks an attempt's logs are scanned over: from the setup's commit to the pinned block. */
const scanOf = (state: ActionState, block: BlockHeader) => ({
  from: state.setupCommittedAtBlock,
  to: block.number
})

type Opening = Pick<WatchedAttempt, 'openedAt' | 'newKey' | 'removedKey' | 'openingGap'>

/** The opening the last reading decoded for the same attempt and payload, which no poll reads again. */
const decodedOpeningOf = (
  attempt: ActionState['attempt'],
  previous: WatcherReading | undefined
): Opening | undefined => {
  const held = previous?.attempt
  if (
    !held ||
    held.attemptId !== attempt.attemptId ||
    held.payloadHash.toLowerCase() !== attempt.payloadHash.toLowerCase() ||
    (held.openingGap !== undefined && held.openingGap !== 'undecodable')
  ) {
    return undefined
  }
  const { openedAt, newKey, removedKey, openingGap } = held
  return { openedAt, newKey, removedKey, openingGap }
}

const openingOf = async (
  reads: WatcherReads,
  account: Address,
  state: ActionState,
  block: BlockHeader
): Promise<Opening> => {
  const { attempt } = state
  try {
    const { started } = await reads.attemptEventsOf(
      account,
      attempt.attemptId,
      scanOf(state, block)
    )
    if (!started || !samePayload(started.payload, attempt.payloadHash)) {
      return { openingGap: 'not-found' }
    }
    const openedAt = await reads.blockTime(started.at.blockNumber)
    const handover = reads.handoverOf(started.payload)
    if (!handover) {
      return { openedAt, openingGap: 'undecodable' }
    }
    return { openedAt, newKey: handover.newAuthority, removedKey: handover.removedAuthority }
  } catch {
    return { openingGap: 'read-failed' }
  }
}

/** Whether the last reading already holds every field of this ending. */
const settledEndingOf = (
  attempt: ActionState['attempt'],
  previous: WatcherReading | undefined
): AttemptEnding | undefined => {
  const held = previous?.ended
  if (!held || held.attemptId !== attempt.attemptId || held.at === undefined) {
    return undefined
  }
  if (attempt.state === 'Consumed' && held.road === 'executed' && held.controller) {
    return held
  }
  if (attempt.state === 'Cancelled' && held.road === 'cancelled' && held.cancelledBy) {
    return held
  }
  return undefined
}

const endingOf = async (
  reads: WatcherReads,
  account: Address,
  state: ActionState,
  block: BlockHeader
): Promise<AttemptEnding> => {
  const { attempt } = state
  const { attemptId } = attempt
  if (attempt.state === 'Consumed') {
    try {
      const { started, consumed } = await reads.attemptEventsOf(
        account,
        attemptId,
        scanOf(state, block)
      )
      const handover =
        started && samePayload(started.payload, attempt.payloadHash)
          ? reads.handoverOf(started.payload)
          : undefined
      const at = consumed ? await reads.blockTime(consumed.at.blockNumber) : undefined
      return { attemptId, road: 'executed', controller: handover?.newAuthority, at }
    } catch {
      return { attemptId, road: 'executed' }
    }
  }
  try {
    const { cancelled } = await reads.attemptEventsOf(account, attemptId, scanOf(state, block))
    if (!cancelled) {
      return { attemptId, road: 'cancelled' }
    }
    return {
      attemptId,
      road: 'cancelled',
      cancelledBy: cancelled.cancelledBy,
      at: await reads.blockTime(cancelled.at.blockNumber)
    }
  } catch {
    return { attemptId, road: 'cancelled' }
  }
}

/**
 * One account's reading at the pinned block. The manager's record, the
 * account's code and the action's authorization decide the poll and reject
 * where they fail; the opening and ending logs only add to the reading, and
 * a failed read of them leaves their fields unread for the next poll.
 */
export const pollAccount = async (
  reads: WatcherReads,
  account: Address,
  block: BlockHeader,
  previous?: WatcherReading
): Promise<WatcherReading> => {
  const pinned = { number: block.number, timestamp: block.timestamp }
  // An address with no code holds no setup, and the registry's reads revert on it.
  if (!(await reads.hasCode(account, block.number))) {
    return { account, block: pinned, hasSetup: false, dormant: false }
  }
  const state = await reads.stateOf(account, block.number)
  const hasSetup = state.setupCommitment.toLowerCase() !== zeroHash
  const authorized = hasSetup ? await reads.isAuthorized(account, block.number) : false
  const reading: WatcherReading = {
    account,
    block: pinned,
    hasSetup,
    dormant: hasSetup && !authorized
  }
  const { attempt } = state
  if (attempt.state === 'Waiting') {
    const opening =
      decodedOpeningOf(attempt, previous) ?? (await openingOf(reads, account, state, block))
    return {
      ...reading,
      attempt: {
        attemptId: attempt.attemptId,
        setupNonce: attempt.setupNonce,
        payloadHash: attempt.payloadHash,
        consumableAfter: attempt.consumableAfter,
        executionDue: block.timestamp >= attempt.consumableAfter,
        ...opening
      }
    }
  }
  if (attempt.state === 'Cancelled' || attempt.state === 'Consumed') {
    return {
      ...reading,
      ended: settledEndingOf(attempt, previous) ?? (await endingOf(reads, account, state, block))
    }
  }
  return reading
}

/** Whether the badge counts a record: an open attempt not dismissed, or a failed last poll. */
export const countsOnBadge = (record: WatcherRecord | undefined): boolean =>
  !!record &&
  (!!record.failed || (record.reading?.attempt !== undefined && !attemptDismissed(record)))

/**
 * One poll over the watched accounts: the latest block read once, then each
 * account's reading at it, written to the account's record. Each account's
 * poll answers within the limit, counted from the poll's start, or reads as
 * failed. Answers the number of accounts the badge counts.
 */
export const pollAccounts = async ({
  reads,
  accounts,
  chainId,
  storage,
  now,
  limitMs
}: PollInput): Promise<number> => {
  const deadline = now() + limitMs
  let latest: Promise<BlockHeader> | undefined
  const latestBlock = () => {
    latest = latest ?? reads.latestBlock()
    return latest
  }
  const records = await Promise.all(
    accounts.map(async (account) => {
      try {
        const previous = (await readWatcherRecord(storage, chainId, account))?.reading
        const reading = await readWithin(
          async () => pollAccount(reads, account, await latestBlock(), previous),
          Math.max(deadline - now(), 0)
        )
        return await updateWatcherRecord(
          storage,
          chainId,
          account,
          (current) => ({ reading, dismissed: current?.dismissed ?? [] }),
          now
        )
      } catch (thrown) {
        const failed = { at: now(), message: messageOf(thrown) }
        return updateWatcherRecord(
          storage,
          chainId,
          account,
          (current) => ({ ...current, failed, dismissed: current?.dismissed ?? [] }),
          now
        ).catch(() => ({ failed, dismissed: [] }))
      }
    })
  )
  return records.filter(countsOnBadge).length
}
