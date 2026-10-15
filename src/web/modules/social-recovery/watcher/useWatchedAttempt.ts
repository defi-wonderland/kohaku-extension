/**
 * The watcher's record of one account on the recovery chain, for a page: read
 * from the extension's local storage, then followed through its change events
 * for that key alone. A failed last poll comes back beside the last good
 * reading, never in its place.
 */
import { useEffect, useState } from 'react'

import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import {
  browserReportStore,
  browserReportSubscribe
} from '@web/modules/social-recovery/shared/ceremony/screen/browserDefaults'
import { CHAIN_IDS, WALLET_RECOVERY_CHAIN } from '@web/modules/social-recovery/shared/client/chains'

import { attemptDismissed, watcherKeyOf, watcherRecordFrom } from './record'
import type { WatchedAttemptSources, WatchedAttemptState } from './types'

const LOADING: WatchedAttemptState = { status: 'loading' }

const BROWSER_SOURCES: WatchedAttemptSources = {
  read: (key) => browserReportStore.get(key),
  subscribe: browserReportSubscribe
}

const stateOf = (stored: unknown): WatchedAttemptState => {
  const record = watcherRecordFrom(stored)
  if (!record) {
    return { status: 'unwatched' }
  }
  return {
    status: 'watched',
    ...(record.reading ? { reading: record.reading } : {}),
    ...(record.failed ? { failed: record.failed } : {}),
    attemptDismissed: attemptDismissed(record)
  }
}

export const useWatchedAttempt = (
  account: Address | undefined,
  sources: WatchedAttemptSources = BROWSER_SOURCES
): WatchedAttemptState => {
  const key = account ? watcherKeyOf(CHAIN_IDS[WALLET_RECOVERY_CHAIN], account) : undefined
  const [stored, setStored] = useState<{ key?: string; state: WatchedAttemptState }>({
    state: LOADING
  })

  useEffect(() => {
    if (!key) {
      return undefined
    }
    let live = true
    let changed = false
    const unsubscribe = sources.subscribe(key, (value) => {
      if (live) {
        changed = true
        setStored({ key, state: stateOf(value) })
      }
    })
    sources
      .read(key)
      .then((value) => {
        // A change event that arrived first is newer than this read.
        if (live && !changed) {
          setStored({ key, state: stateOf(value) })
        }
      })
      .catch(() => undefined)
    return () => {
      live = false
      unsubscribe()
    }
  }, [key, sources])

  return stored.key === key && key !== undefined ? stored.state : LOADING
}
