/**
 * The watcher: the background's alarm polling the recovery registry for every
 * smart account the wallet lists, and the record of each account it writes.
 * The React hook lives in its own file, `useWatchedAttempt`, imported by path,
 * so the background loads this module without the UI's code.
 */
export { WATCHER_ALARM, WATCH_PERIOD_MINUTES, POLL_LIMIT_MS, OPENING_GAPS } from './constants'
export { startRecoveryWatcher, watchedNetworkOf } from './alarm'
export { pollAccount, pollAccounts, watchedAccountsOf, countsOnBadge } from './poll'
export {
  watcherKeyOf,
  watcherRecordFrom,
  readWatcherRecord,
  updateWatcherRecord,
  dismissAttempt,
  attemptDismissed,
  storedWatcherRecordOf
} from './record'
export type {
  OpeningGap,
  WatchedAttempt,
  AttemptEnding,
  WatcherReading,
  PollFailure,
  WatcherRecord,
  StoredWatchedAttempt,
  StoredAttemptEnding,
  StoredWatcherRecord,
  WatcherStorage,
  WatcherAlarms,
  PollInput,
  RecoveryWatcherOptions,
  RecoveryWatcher,
  WatchedAttemptSources,
  WatchedAttemptState
} from './types'
