/** The name of the watcher's browser alarm. */
export const WATCHER_ALARM = 'socialRecovery:watcher'

/** How often the alarm fires, in minutes: an attempt reaches the holder within a minute. */
export const WATCH_PERIOD_MINUTES = 1

/** How long one poll may run before it reads as failed, in ms. */
export const POLL_LIMIT_MS = 30_000

/** Why an open attempt names no key yet. */
export const OPENING_GAPS = ['read-failed', 'not-found', 'undecodable'] as const
