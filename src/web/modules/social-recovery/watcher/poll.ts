/**
 * One poll of the watcher: every read of it pinned to the latest block, read
 * once for the whole poll, never the finalized one.
 *
 * An account's reading is drawn from the manager's record at that block
 * alone, so an attempt a reorganization dropped is gone from the next reading
 * that no longer reads it, and an attempt that ended reads as its ending. A
 * poll that fails, or whose state reads do not answer within their limit,
 * keeps the last good reading and marks it failed; it never reads as no
 * attempt. The log scans run under a limit of their own, so a slow scan only
 * leaves its fields unread for the next poll.
 *
 * The record holds the payload's hash alone, so the key an attempt hands the
 * account to comes from its opening log, decoded in the action's layout, and
 * only from an opening whose payload hashes to the record's. Until that decode
 * returned the reading carries the countdown and no key.
 */
import { getAddress, isAddress, keccak256, zeroHash } from 'viem'

import type { Account } from '@ambire-common/interfaces/account'
import type {
  ActionState,
  Address,
  BlockHeader,
  Hex
} from '@web/modules/social-recovery/sdk-interfaces'
import { readWithin, within } from '@web/modules/social-recovery/shared/client/limits'
import type { AttemptScan, WatcherReads } from '@web/modules/social-recovery/shared/client/types'
import { sameHash } from '@web/modules/social-recovery/shared/writes/hashes'

import { attemptDismissed, readWatcherRecord, updateWatcherRecord } from './record'
import type {
  AttemptEnding,
  Opening,
  PollInput,
  PollLimits,
  WatchedAttempt,
  WatcherReading,
  WatcherRecord
} from './types'

/**
 * The smart accounts among the listed ones, each once; a basic account holds
 * no setup, and an address that does not parse is skipped.
 */
export const watchedAccountsOf = (accounts: readonly Account[]): Address[] =>
  accounts
    .filter((account) => !!account.creation && isAddress(account.addr, { strict: false }))
    .map((account) => getAddress(account.addr))
    .filter((addr, index, all) => all.indexOf(addr) === index)

export const messageOf = (thrown: unknown): string =>
  thrown instanceof Error ? thrown.message : String(thrown)

const samePayload = (payload: Hex, payloadHash: Hex): boolean =>
  sameHash(keccak256(payload), payloadHash)

/** The blocks an attempt's logs are scanned over: from the setup's commit to the pinned block. */
const scanOf = (
  state: ActionState,
  block: BlockHeader,
  until: AttemptScan['until'] = 'opening'
): AttemptScan => ({ from: state.setupCommittedAtBlock, to: block.number, until })

/** The attempt the last reading holds, where it is this attempt with this payload. */
const heldAttemptOf = (
  attempt: ActionState['attempt'],
  previous: WatcherReading | undefined
): WatchedAttempt | undefined => {
  const held = previous?.attempt
  return held &&
    held.attemptId === attempt.attemptId &&
    sameHash(held.payloadHash, attempt.payloadHash)
    ? held
    : undefined
}

const openingFieldsOf = ({
  openedAt,
  newKey,
  removedKey,
  openingGap,
  scannedTo
}: Opening): Opening => ({
  ...(openedAt !== undefined ? { openedAt } : {}),
  ...(newKey ? { newKey } : {}),
  ...(removedKey ? { removedKey } : {}),
  ...(openingGap ? { openingGap } : {}),
  ...(scannedTo !== undefined ? { scannedTo } : {})
})

/**
 * The attempt's opening. A decoded opening, or one whose payload does not
 * decode, is never read again; one not found is scanned again over the blocks
 * after the last scan alone.
 */
const openingOf = async (
  reads: WatcherReads,
  account: Address,
  state: ActionState,
  block: BlockHeader,
  previous: WatcherReading | undefined,
  scanMs: number
): Promise<Opening> => {
  const { attempt } = state
  const held = heldAttemptOf(attempt, previous)
  if (held && (held.openingGap === undefined || held.openingGap === 'undecodable')) {
    return openingFieldsOf(held)
  }
  const scannedTo = held?.scannedTo
  const from = scannedTo === undefined ? state.setupCommittedAtBlock : scannedTo + 1
  if (from > block.number) {
    return openingFieldsOf({ openingGap: 'not-found', scannedTo })
  }
  const read = await within(async (): Promise<Opening> => {
    const { started } = await reads.attemptEventsOf(account, attempt.attemptId, {
      from,
      to: block.number,
      until: 'opening'
    })
    if (!started || !samePayload(started.payload, attempt.payloadHash)) {
      return { openingGap: 'not-found', scannedTo: block.number }
    }
    const openedAt = await reads.blockTime(started.at.blockNumber)
    const handover = reads.handoverOf(started.payload)
    if (!handover) {
      return { openedAt, openingGap: 'undecodable' }
    }
    return { openedAt, newKey: handover.newAuthority, removedKey: handover.removedAuthority }
  }, scanMs)
  return read ?? openingFieldsOf({ openingGap: 'read-failed', scannedTo })
}

const roadOf = (attempt: ActionState['attempt']): AttemptEnding['road'] =>
  attempt.state === 'Consumed' ? 'executed' : 'cancelled'

/**
 * The ending the last reading holds for this attempt where it is settled:
 * every field named, or its logs read and a field found missing.
 */
const settledEndingOf = (
  attempt: ActionState['attempt'],
  previous: WatcherReading | undefined
): AttemptEnding | undefined => {
  const held = previous?.ended
  if (!held || held.attemptId !== attempt.attemptId || held.road !== roadOf(attempt)) {
    return undefined
  }
  if (held.endingGap !== undefined) {
    return held
  }
  const named = held.road === 'executed' ? !!held.controller : !!held.cancelledBy
  return named && held.at !== undefined ? held : undefined
}

/** The controller an earlier reading already decoded for this attempt. */
const knownControllerOf = (
  attempt: ActionState['attempt'],
  previous: WatcherReading | undefined
): Address | undefined => {
  const ended = previous?.ended
  if (ended?.attemptId === attempt.attemptId && ended.road === 'executed' && ended.controller) {
    return ended.controller
  }
  return heldAttemptOf(attempt, previous)?.newKey
}

const executedOf = async (
  reads: WatcherReads,
  account: Address,
  state: ActionState,
  block: BlockHeader,
  previous: WatcherReading | undefined,
  scanMs: number
): Promise<AttemptEnding> => {
  const { attempt } = state
  const { attemptId } = attempt
  const known = knownControllerOf(attempt, previous)
  const read = await within(async (): Promise<AttemptEnding> => {
    // With the controller already decoded only the consume log is needed.
    const { started, consumed } = await reads.attemptEventsOf(
      account,
      attemptId,
      scanOf(state, block, known ? 'ending' : 'opening')
    )
    const at = consumed ? await reads.blockTime(consumed.at.blockNumber) : undefined
    const opening =
      started && samePayload(started.payload, attempt.payloadHash) ? started : undefined
    const controller =
      known ?? (opening ? reads.handoverOf(opening.payload)?.newAuthority : undefined)
    const ending: AttemptEnding = { attemptId, road: 'executed', controller, at }
    if (at === undefined || (!known && !opening)) {
      return { ...ending, endingGap: 'not-found' }
    }
    return controller ? ending : { ...ending, endingGap: 'undecodable' }
  }, scanMs)
  return read ?? { attemptId, road: 'executed', ...(known ? { controller: known } : {}) }
}

const cancelledOf = async (
  reads: WatcherReads,
  account: Address,
  state: ActionState,
  block: BlockHeader,
  scanMs: number
): Promise<AttemptEnding> => {
  const { attemptId } = state.attempt
  const read = await within(async (): Promise<AttemptEnding> => {
    const { cancelled } = await reads.attemptEventsOf(
      account,
      attemptId,
      scanOf(state, block, 'ending')
    )
    if (!cancelled) {
      return { attemptId, road: 'cancelled', endingGap: 'not-found' }
    }
    return {
      attemptId,
      road: 'cancelled',
      cancelledBy: cancelled.cancelledBy,
      at: await reads.blockTime(cancelled.at.blockNumber)
    }
  }, scanMs)
  return read ?? { attemptId, road: 'cancelled' }
}

/**
 * The account's state at the pinned block: its code, the manager's record and
 * the action's authorization. These decide the poll and reject where they fail.
 */
const stateReadingOf = async (reads: WatcherReads, account: Address, block: BlockHeader) => {
  const pinned = { number: block.number, timestamp: block.timestamp }
  // An address with no code holds no setup, and the registry's reads revert on it.
  if (!(await reads.hasCode(account, block.number))) {
    const reading: WatcherReading = { account, block: pinned, hasSetup: false, dormant: false }
    return { block, reading, state: undefined }
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
  return { block, reading, state }
}

/**
 * One account's reading at the latest block. The state reads answer within
 * `limits.stateMs` or reject; the opening and ending logs then run within
 * `limits.scanMs` and only add to the reading, a scan that failed or ran out
 * leaving its fields unread for the next poll.
 */
export const pollAccount = async (
  reads: WatcherReads,
  account: Address,
  latestBlock: () => Promise<BlockHeader>,
  previous: WatcherReading | undefined,
  limits: PollLimits
): Promise<WatcherReading> => {
  const { block, reading, state } = await readWithin(
    async () => stateReadingOf(reads, account, await latestBlock()),
    limits.stateMs
  )
  if (!state) {
    return reading
  }
  const { attempt } = state
  if (attempt.state === 'Waiting') {
    const opening = await openingOf(reads, account, state, block, previous, limits.scanMs)
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
    const ended =
      settledEndingOf(attempt, previous) ??
      (attempt.state === 'Consumed'
        ? await executedOf(reads, account, state, block, previous, limits.scanMs)
        : await cancelledOf(reads, account, state, block, limits.scanMs))
    return { ...reading, ended }
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
 * state reads answer within the limit, counted from the poll's start, or the
 * account reads as failed. Answers the number of accounts the badge counts.
 */
export const pollAccounts = async ({
  reads,
  accounts,
  chainId,
  storage,
  now,
  limitMs,
  scanLimitMs
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
        const reading = await pollAccount(reads, account, latestBlock, previous, {
          stateMs: Math.max(deadline - now(), 0),
          scanMs: scanLimitMs
        })
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
