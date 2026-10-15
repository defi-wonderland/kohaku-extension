/**
 * The watcher's start: the extension's browser alarm, every minute while the
 * browser is open, whether the popup is open or not and whether the keystore
 * is locked or not, and one poll at start. A poll needs the listed accounts
 * and the recovery chain's network record, never a key.
 *
 * A build whose recovery chain runs no deployed kit starts no alarm and
 * writes no record. A tick while the previous poll still runs is skipped.
 */
import type { Network } from '@ambire-common/interfaces/network'
import { browser } from '@web/constants/browserapi'
import { CHAIN_IDS, WALLET_RECOVERY_CHAIN } from '@web/modules/social-recovery/shared/client/chains'
import {
  networkOf,
  providerKeyOf
} from '@web/modules/social-recovery/shared/client/extension-provider'
import type { WatcherConnection } from '@web/modules/social-recovery/shared/client/types'
import {
  watchedDeploymentOf,
  watcherConnectionFor
} from '@web/modules/social-recovery/shared/client/watcher-reads'
import { extensionRecordStorage } from '@web/modules/social-recovery/shared/records/extensionStorage'

import { POLL_LIMIT_MS, WATCH_PERIOD_MINUTES, WATCHER_ALARM } from './constants'
import { pollAccounts, watchedAccountsOf } from './poll'
import { updateWatcherRecord } from './record'
import type { RecoveryWatcher, RecoveryWatcherOptions } from './types'

/** The network record of the chain the watcher reads, among the extension's networks. */
export const watchedNetworkOf = (networks: readonly Network[] | undefined): Network | undefined =>
  networkOf(networks, WALLET_RECOVERY_CHAIN)

const buildDeployment = () => {
  try {
    return watchedDeploymentOf(WALLET_RECOVERY_CHAIN)
  } catch {
    // A malformed deployment variable leaves the build with no kit to watch.
    return undefined
  }
}

export const startRecoveryWatcher = ({
  accounts,
  network,
  onBadge,
  deployment = buildDeployment,
  alarms = browser?.alarms,
  storage = extensionRecordStorage,
  connect = watcherConnectionFor,
  now = Date.now,
  limitMs = POLL_LIMIT_MS
}: RecoveryWatcherOptions): RecoveryWatcher | undefined => {
  const descriptor = deployment()
  if (!descriptor || !alarms) {
    return undefined
  }
  const chainId = CHAIN_IDS[WALLET_RECOVERY_CHAIN]
  let connection: WatcherConnection | undefined
  let running = false

  // The provider is kept across polls and built again only when the network
  // record's provider fields change.
  const connectionFor = (record: Network): WatcherConnection => {
    if (connection && connection.providerKey === providerKeyOf(record)) {
      return connection
    }
    connection?.destroy()
    connection = undefined
    connection = connect(record, descriptor)
    return connection
  }

  const poll = async (): Promise<number> => {
    const watched = watchedAccountsOf(accounts())
    if (watched.length === 0) {
      return 0
    }
    let reads: WatcherConnection['reads']
    try {
      const record = network()
      if (!record) {
        throw new Error(`The extension holds no network for chain ${chainId}.`)
      }
      reads = connectionFor(record).reads
    } catch (thrown) {
      const failed = {
        at: now(),
        message: thrown instanceof Error ? thrown.message : String(thrown)
      }
      await Promise.all(
        watched.map((account) =>
          updateWatcherRecord(
            storage,
            chainId,
            account,
            (current) => ({ ...current, failed, dismissed: current?.dismissed ?? [] }),
            now
          ).catch(() => undefined)
        )
      )
      return watched.length
    }
    return pollAccounts({ reads, accounts: watched, chainId, storage, now, limitMs })
  }

  const tick = async (): Promise<void> => {
    if (running) {
      return
    }
    running = true
    try {
      onBadge(await poll())
    } catch (thrown) {
      // eslint-disable-next-line no-console
      console.error('The recovery watcher could not poll', thrown)
    } finally {
      running = false
    }
  }

  const listener = (alarm: { name: string }) => {
    if (alarm.name === WATCHER_ALARM) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      tick()
    }
  }
  alarms.create(WATCHER_ALARM, { periodInMinutes: WATCH_PERIOD_MINUTES })
  alarms.onAlarm.addListener(listener)
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  tick()

  return {
    tick,
    stop: () => {
      alarms.onAlarm.removeListener(listener)
      alarms.clear(WATCHER_ALARM)
      connection?.destroy()
      connection = undefined
    }
  }
}
