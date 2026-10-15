/**
 * The watcher's start: the extension's browser alarm, every minute while the
 * browser is open, whether the popup is open or not and whether the keystore
 * is locked or not, and one poll once the accounts have loaded. A poll needs
 * the listed accounts and the recovery chain's network record, never a key.
 *
 * The alarm's listener is registered at once, so an alarm that wakes a
 * stopped worker finds it; every poll waits for the accounts to load. A build
 * whose recovery chain runs no deployed kit keeps no alarm and writes no
 * record. A tick while the previous one still runs is skipped, and a tick
 * runs within its own limit, its storage reads and writes included.
 */
import type { Network } from '@ambire-common/interfaces/network'
import { browser } from '@web/constants/browserapi'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import { CHAIN_IDS, WALLET_RECOVERY_CHAIN } from '@web/modules/social-recovery/shared/client/chains'
import {
  networkOf,
  providerKeyOf
} from '@web/modules/social-recovery/shared/client/extension-provider'
import { readWithin } from '@web/modules/social-recovery/shared/client/limits'
import type { WatcherConnection } from '@web/modules/social-recovery/shared/client/types'
import {
  watchedDeploymentOf,
  watcherConnectionFor
} from '@web/modules/social-recovery/shared/client/watcher-reads'
import { extensionRecordStorage } from '@web/modules/social-recovery/shared/records/extensionStorage'

import {
  POLL_LIMIT_MS,
  SCAN_LIMIT_MS,
  TICK_LIMIT_MS,
  WATCH_PERIOD_MINUTES,
  WATCHER_ALARM
} from './constants'
import { messageOf, pollAccounts, watchedAccountsOf } from './poll'
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
  ready,
  onBadge,
  deployment = buildDeployment,
  alarms = browser?.alarms,
  storage = extensionRecordStorage,
  connect = watcherConnectionFor,
  now = Date.now,
  limitMs = POLL_LIMIT_MS,
  scanLimitMs = SCAN_LIMIT_MS,
  tickLimitMs = TICK_LIMIT_MS
}: RecoveryWatcherOptions): RecoveryWatcher | undefined => {
  if (!alarms) {
    return undefined
  }
  const descriptor = deployment()
  if (!descriptor) {
    // An alarm an earlier build registered outlives the worker; this build has nothing to watch.
    alarms.clear(WATCHER_ALARM)
    return undefined
  }
  const chainId = CHAIN_IDS[WALLET_RECOVERY_CHAIN]
  let connection: WatcherConnection | undefined
  let running = false
  // The accounts the last poll read, which a poll that cannot read them marks failed.
  let lastKnown: Address[] = []
  const loaded = ready.then(
    () => undefined,
    (thrown: unknown) => {
      // eslint-disable-next-line no-console
      console.error('The recovery watcher polls without the loaded accounts', thrown)
    }
  )

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

  /** Marks the last reading of each account failed; answers the number the badge counts. */
  const failAll = async (watched: readonly Address[], thrown: unknown): Promise<number> => {
    const failed = { at: now(), message: messageOf(thrown) }
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

  /** One poll; answers the badge's count, or undefined where the badge stays as it is. */
  const poll = async (): Promise<number | undefined> => {
    let watched: Address[]
    try {
      watched = watchedAccountsOf(accounts())
    } catch (thrown) {
      // eslint-disable-next-line no-console
      console.error('The recovery watcher could not read the accounts', thrown)
      return lastKnown.length === 0 ? undefined : failAll(lastKnown, thrown)
    }
    lastKnown = watched
    if (watched.length === 0) {
      return 0
    }
    let reads: WatcherConnection['reads']
    try {
      const record = network()
      if (!record) {
        return await failAll(
          watched,
          new Error(`The extension holds no enabled network for chain ${chainId}.`)
        )
      }
      reads = connectionFor(record).reads
    } catch (thrown) {
      // eslint-disable-next-line no-console
      console.error('The recovery watcher could not reach the recovery chain', thrown)
      return failAll(watched, thrown)
    }
    return pollAccounts({ reads, accounts: watched, chainId, storage, now, limitMs, scanLimitMs })
  }

  const tick = async (): Promise<void> => {
    if (running) {
      return
    }
    running = true
    try {
      await loaded
      const count = await readWithin(poll, tickLimitMs)
      if (count !== undefined) {
        onBadge(count)
      }
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
  alarms.onAlarm.addListener(listener)
  alarms.create(WATCHER_ALARM, { periodInMinutes: WATCH_PERIOD_MINUTES })
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
