/**
 * The reads of the running attempt's band, once it stands: the registry's
 * attempt, then its opening, and beside them whether a key the keystore holds
 * is an authority of the account and which keys the fast track made on this
 * device. A read that throws, or does not answer within its limit, is failed
 * and never an answer: never no attempt and never a key; the opening's scan
 * stops at the limit, and a retry scans again from the setup's block. A retry
 * reads again every read that failed. Once the attempt answered, the registry
 * is read again on the checklist's poll period and whenever the tab returns
 * to view: an attempt that ended draws the ended state, another attempt in
 * its place is drawn with its own opening, and a read that fails keeps the
 * last answer. The registry's reads are released when the band goes, or once
 * the registry answers that no attempt waits.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { CHECKLIST_POLL_MS } from '@web/modules/social-recovery/recovery/checklist/constants'
import { isVisible } from '@web/modules/social-recovery/shared/ceremony'
import { readWithin } from '@web/modules/social-recovery/shared/client'

import { CONFIRMED_READ_LIMIT_MS_STAND_IN } from './constants'
import { holdsAuthority, isSameAttempt, readOpening, readRunningAttempt } from './running'
import type {
  AttemptRecheck,
  EntryRead,
  ListedEntries,
  OpenedAttemptReads,
  RunningAttempt,
  RunningAttemptInput,
  RunningAttemptRead,
  RunningAttemptState,
  RunningOpening
} from './types'

const PENDING = { status: 'pending' } as const
const PENDING_READS = { status: 'loading' } as const
const FAILED = { status: 'failed' } as const
const NO_RECHECK = async (): Promise<AttemptRecheck> => ({ status: 'failed' })

export const useRunningAttempt = ({
  account,
  chainId,
  records,
  client,
  ownKeys,
  openReads,
  active
}: RunningAttemptInput): RunningAttemptState => {
  const [opened, setOpened] = useState<OpenedAttemptReads>(PENDING_READS)
  const [attempt, setAttempt] = useState<RunningAttemptRead>(PENDING)
  const [opening, setOpening] = useState<EntryRead<RunningOpening>>(PENDING)
  const [authority, setAuthority] = useState<EntryRead<boolean>>(PENDING)
  const [entries, setEntries] = useState<EntryRead<ListedEntries>>(PENDING)
  const [attemptRound, setAttemptRound] = useState(0)
  const [authorityRound, setAuthorityRound] = useState(0)
  const [entriesRound, setEntriesRound] = useState(0)
  const releaseRef = useRef<() => void>(() => undefined)
  const recheckRef = useRef<() => Promise<AttemptRecheck>>(NO_RECHECK)

  useEffect(() => {
    if (!active) {
      setOpened(PENDING_READS)
      return undefined
    }
    const reads = openReads()
    let released = false
    const release = () => {
      if (!released && reads.status === 'ready') {
        released = true
        reads.close()
      }
    }
    releaseRef.current = release
    setOpened(reads)
    return release
  }, [active, openReads])

  useEffect(() => {
    setAttempt(PENDING)
    setOpening(PENDING)
    recheckRef.current = NO_RECHECK
    if (!active || opened.status === 'loading') {
      return undefined
    }
    if (opened.status === 'unreadable') {
      setAttempt(FAILED)
      return undefined
    }
    const { reads } = opened
    let live = true
    let ended = false
    let held: RunningAttempt | null = null
    let stopScan: () => void = () => undefined
    let queue: Promise<unknown> = Promise.resolve()
    let queued = 0

    const readOpeningOf = async (running: RunningAttempt) => {
      stopScan()
      let stopped = false
      stopScan = () => {
        stopped = true
      }
      const answered = await readWithin(
        () => readOpening(reads, account, running, () => stopped),
        CONFIRMED_READ_LIMIT_MS_STAND_IN,
        (error) => {
          stopped = true
          return error
        }
      ).then(
        (value): EntryRead<RunningOpening> => ({ status: 'answered', value }),
        (): EntryRead<RunningOpening> => FAILED
      )
      if (live && held === running) {
        setOpening(answered)
      }
    }

    // One round reads the registry; the first draws what it finds, a later
    // one changes the band only where the attempt ended or another took its
    // place, and a later one that fails leaves the band as it was.
    const round = async (): Promise<AttemptRecheck> => {
      if (!live || ended) {
        return ended ? { status: 'ended' } : { status: 'failed' }
      }
      const running = await readWithin(
        () => readRunningAttempt(reads, account),
        CONFIRMED_READ_LIMIT_MS_STAND_IN
      ).catch(() => undefined)
      if (!live) {
        return { status: 'failed' }
      }
      if (running === undefined) {
        if (!held) {
          setAttempt(FAILED)
        }
        return { status: 'failed' }
      }
      if (running === null) {
        ended = true
        held = null
        stopScan()
        releaseRef.current()
        setAttempt({ status: 'ended' })
        return { status: 'ended' }
      }
      if (held && isSameAttempt(running, held)) {
        return { status: 'same', attempt: held }
      }
      const replaced = held !== null
      held = running
      setAttempt({ status: 'answered', value: running })
      setOpening(PENDING)
      await readOpeningOf(running)
      return replaced ? { status: 'changed' } : { status: 'same', attempt: running }
    }

    // Rounds run one after another, never side by side.
    const enqueue = (): Promise<AttemptRecheck> => {
      queued += 1
      const next = queue.then(round).finally(() => {
        queued -= 1
      })
      queue = next.catch(() => undefined)
      return next
    }

    const poll = () => {
      if (held && !ended && queued === 0) {
        enqueue().catch(() => undefined)
      }
    }
    const timer = setInterval(poll, CHECKLIST_POLL_MS)
    const onVisibility = () => {
      if (isVisible(document)) {
        poll()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    recheckRef.current = enqueue
    enqueue().catch(() => undefined)
    return () => {
      live = false
      stopScan()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      recheckRef.current = NO_RECHECK
    }
  }, [active, opened, account, attemptRound])

  useEffect(() => {
    setAuthority(PENDING)
    if (!active || !client) {
      return undefined
    }
    if (ownKeys.length === 0) {
      setAuthority({ status: 'answered', value: false })
      return undefined
    }
    let live = true
    readWithin(
      () => holdsAuthority((key) => client.action.isAuthority(key), ownKeys),
      CONFIRMED_READ_LIMIT_MS_STAND_IN
    ).then(
      (value) => {
        if (live) {
          setAuthority({ status: 'answered', value })
        }
      },
      () => {
        if (live) {
          setAuthority(FAILED)
        }
      }
    )
    return () => {
      live = false
    }
  }, [active, client, ownKeys, authorityRound])

  useEffect(() => {
    setEntries(PENDING)
    if (!active) {
      return undefined
    }
    let live = true
    records.listRecoveryEntries(chainId).then(
      (listed) => {
        if (live) {
          setEntries({ status: 'answered', value: listed })
        }
      },
      () => {
        if (live) {
          setEntries(FAILED)
        }
      }
    )
    return () => {
      live = false
    }
  }, [active, records, chainId, entriesRound])

  const retry = useCallback(() => {
    if (attempt.status === 'failed' || opening.status === 'failed') {
      setAttemptRound((round) => round + 1)
    }
    if (authority.status === 'failed') {
      setAuthorityRound((round) => round + 1)
    }
    if (entries.status === 'failed') {
      setEntriesRound((round) => round + 1)
    }
  }, [attempt.status, opening.status, authority.status, entries.status])

  const recheck = useCallback(() => recheckRef.current(), [])

  return { attempt, opening, authority, entries, retry, recheck }
}
