/**
 * The page's own reads of an account's attempt. A page poll reads the account
 * at the latest block through the watcher's poll of one account, writes the
 * account's record under the record's queue, so the banner and the badge
 * follow what the page read, and answers its own reading: the record is not
 * read back, since a newer write may stand there.
 */
import { keccak256 } from 'viem'

import type { BlockHeader } from '@web/modules/social-recovery/sdk-interfaces'
import {
  CHAIN_IDS,
  providerReadFailure,
  readWithin,
  WALLET_RECOVERY_CHAIN
} from '@web/modules/social-recovery/shared/client'
import {
  watchedDeploymentOf,
  watcherConnectionFor
} from '@web/modules/social-recovery/shared/client/watcher-reads'
import { extensionRecordStorage } from '@web/modules/social-recovery/shared/records/extensionStorage'
import { sameHash } from '@web/modules/social-recovery/shared/writes/hashes'
import {
  pollAccount,
  pollAccounts,
  POLL_LIMIT_MS,
  readWatcherRecord,
  SCAN_LIMIT_MS,
  updateWatcherRecord
} from '@web/modules/social-recovery/watcher'

import { LANDING_ATTEMPTS } from './constants'
import type {
  AttemptReader,
  AttemptReaderInput,
  LandingReader,
  LandingReaderInput,
  PollOnceInput
} from './types'

/**
 * A fresh reading of the account at the latest block, written to its record.
 * Rejects as a failed provider read where the poll failed or did not answer
 * within its limit, and marks the record failed: a failed read never reads as
 * no attempt.
 */
export const attemptReaderOf =
  ({
    reads,
    account,
    chainId,
    storage,
    now = Date.now,
    limitMs = POLL_LIMIT_MS,
    scanLimitMs = SCAN_LIMIT_MS
  }: AttemptReaderInput): AttemptReader =>
  async () => {
    let pinned: number | undefined
    let latest: Promise<BlockHeader> | undefined
    const latestBlock = () => {
      latest =
        latest ??
        reads.latestBlock().then((block) => {
          pinned = block.number
          return block
        })
      return latest
    }
    try {
      const previous = (await readWatcherRecord(storage, chainId, account))?.reading
      const reading = await pollAccount(reads, account, latestBlock, previous, {
        stateMs: limitMs,
        scanMs: scanLimitMs
      })
      await updateWatcherRecord(
        storage,
        chainId,
        account,
        (current) => ({ reading, dismissed: current?.dismissed ?? [] }),
        { now, block: reading.block.number }
      ).catch(() => undefined)
      return reading
    } catch (thrown: unknown) {
      const failed = {
        at: now(),
        message: thrown instanceof Error ? thrown.message : String(thrown)
      }
      await updateWatcherRecord(
        storage,
        chainId,
        account,
        (current) => ({ ...current, failed, dismissed: current?.dismissed ?? [] }),
        { now, block: pinned }
      ).catch(() => undefined)
      throw providerReadFailure('call', thrown)
    }
  }

/**
 * What a landed cancel ended. The cancel ends the attempt open at its block,
 * whatever its id, so the read takes a fresh reading at or past the receipt's
 * block, then the ending logs of the attempts from the newest the reading
 * names down to the one the run meant: an owner's cancel at or after the
 * receipt's block is this cancel, and names the attempt it ended, by its new
 * key where the opening's payload decodes. Without one, an ending of the
 * meant attempt by another road reads as that road. Anything else answers
 * undefined, so the caller reads again.
 */
export const landingReaderOf =
  ({ reads, account, readAttempt, limitMs = SCAN_LIMIT_MS }: LandingReaderInput): LandingReader =>
  async ({ target, known, startBlock, landedBlock }) => {
    const reading = await readAttempt()
    const pinned = reading.block.number
    if (pinned < landedBlock) {
      return undefined
    }
    const newest = reading.attempt?.attemptId ?? reading.ended?.attemptId ?? target
    const ids: bigint[] = []
    for (let id = newest; id >= target && ids.length < LANDING_ATTEMPTS; id -= 1n) {
      ids.push(id)
    }
    const scans = await readWithin(
      () =>
        Promise.all(
          ids.map(async (attemptId) => ({
            attemptId,
            events: await reads.attemptEventsOf(account, attemptId, {
              from: Math.min(startBlock, landedBlock),
              to: pinned,
              until: 'ending'
            })
          }))
        ),
      limitMs
    )
    const owners = scans.find(
      ({ events }) =>
        events.cancelled?.cancelledBy === 'cancelByOwner' &&
        events.cancelled.at.blockNumber >= landedBlock
    )
    if (owners?.events.cancelled) {
      const { attemptId } = owners
      const block = owners.events.cancelled.at.blockNumber
      const newKey =
        attemptId === known?.attemptId && known.newKey
          ? known.newKey
          : await readWithin(async () => {
              // At the cancel's block the manager still holds the attempt it ended, with its payload's hash.
              const state = await reads.stateOf(account, block)
              if (state.attempt.attemptId !== attemptId) {
                return undefined
              }
              const { started } = await reads.attemptEventsOf(account, attemptId, {
                from: state.setupCommittedAtBlock,
                to: block
              })
              return started && sameHash(keccak256(started.payload), state.attempt.payloadHash)
                ? reads.handoverOf(started.payload)?.newAuthority
                : undefined
            }, limitMs).catch(() => undefined)
      return { stage: 'cancelled', attemptId, ...(newKey ? { newKey } : {}) }
    }
    const meant = scans.find(({ attemptId }) => attemptId === target)?.events.cancelled
    const ended = reading.ended?.attemptId === target ? reading.ended : undefined
    const road = meant?.cancelledBy ?? (ended?.road === 'cancelled' ? ended.cancelledBy : undefined)
    if (road && road !== 'cancelByOwner') {
      return { stage: 'otherRoad', attemptId: target, road }
    }
    return undefined
  }

/** The deployment the watcher reads: the build's deployed kit, or none. */
export const cancelDeploymentOf = () => {
  try {
    return watchedDeploymentOf(WALLET_RECOVERY_CHAIN)
  } catch {
    // A malformed deployment variable leaves the build with no kit to read.
    return undefined
  }
}

/**
 * One poll of one account from a page, over a provider built for this poll
 * and released after it. The poll writes the record, a failed one as failed.
 * Nothing runs where the build reads no deployed kit or the wallet holds no
 * network for the chain.
 */
export const pollOnce = async ({
  account,
  network,
  deployment = cancelDeploymentOf,
  connect = watcherConnectionFor,
  storage = extensionRecordStorage,
  now = Date.now,
  limitMs = POLL_LIMIT_MS,
  scanLimitMs = SCAN_LIMIT_MS
}: PollOnceInput): Promise<void> => {
  const descriptor = deployment()
  if (!descriptor || !network) {
    return
  }
  const connection = connect(network, descriptor)
  try {
    await pollAccounts({
      reads: connection.reads,
      accounts: [account],
      chainId: CHAIN_IDS[WALLET_RECOVERY_CHAIN],
      storage,
      now,
      limitMs,
      scanLimitMs
    })
  } finally {
    connection.destroy()
  }
}
