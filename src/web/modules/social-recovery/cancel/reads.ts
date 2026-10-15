/**
 * The page's own polls: one poll of one account through the watcher's poll,
 * which writes the account's record under the record's lock, so the banner and
 * the badge follow what the page read.
 */
import {
  CHAIN_IDS,
  providerReadFailure,
  WALLET_RECOVERY_CHAIN
} from '@web/modules/social-recovery/shared/client'
import {
  watchedDeploymentOf,
  watcherConnectionFor
} from '@web/modules/social-recovery/shared/client/watcher-reads'
import { extensionRecordStorage } from '@web/modules/social-recovery/shared/records/extensionStorage'
import {
  pollAccounts,
  POLL_LIMIT_MS,
  readWatcherRecord
} from '@web/modules/social-recovery/watcher'

import type { AttemptReader, AttemptReaderInput, PollOnceInput } from './types'

/**
 * A fresh reading of the account at the latest block, written to its record.
 * Rejects as a failed provider read where the poll failed or did not answer
 * within its limit: a failed read never reads as no attempt.
 */
export const attemptReaderOf =
  ({
    reads,
    account,
    chainId,
    storage,
    now = Date.now,
    limitMs = POLL_LIMIT_MS
  }: AttemptReaderInput): AttemptReader =>
  async () => {
    await pollAccounts({ reads, accounts: [account], chainId, storage, now, limitMs })
    const record = await readWatcherRecord(storage, chainId, account)
    if (!record?.reading || record.failed) {
      throw providerReadFailure('call', record?.failed?.message ?? 'no reading of the account')
    }
    return record.reading
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
  limitMs = POLL_LIMIT_MS
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
      limitMs
    })
  } finally {
    connection.destroy()
  }
}
