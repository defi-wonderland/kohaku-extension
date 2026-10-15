/**
 * The reads of the running attempt's band, once it stands: the registry's
 * attempt, then its opening, and beside them whether a key the keystore holds
 * is an authority of the account and which keys the fast track made on this
 * device. A read that throws, or does not answer within its limit, is failed
 * and never an answer: never no attempt and never a key. A retry reads again
 * every read that failed. The reads are released when the band goes.
 */
import { useCallback, useEffect, useState } from 'react'

import { readWithin } from '@web/modules/social-recovery/shared/client'

import { CONFIRMED_READ_LIMIT_MS_STAND_IN } from './constants'
import { holdsAuthority, readOpening, readRunningAttempt } from './running'
import type {
  EntryRead,
  ListedEntries,
  OpenedAttemptReads,
  RunningAttemptInput,
  RunningAttemptRead,
  RunningAttemptState,
  RunningOpening
} from './types'

const PENDING = { status: 'pending' } as const
const PENDING_READS = { status: 'loading' } as const
const FAILED = { status: 'failed' } as const
const NO_ENTRIES: ListedEntries = []

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
  const [entries, setEntries] = useState<ListedEntries>(NO_ENTRIES)
  const [attemptRound, setAttemptRound] = useState(0)
  const [authorityRound, setAuthorityRound] = useState(0)

  useEffect(() => {
    if (!active) {
      setOpened(PENDING_READS)
      return undefined
    }
    const reads = openReads()
    setOpened(reads)
    return () => {
      if (reads.status === 'ready') {
        reads.close()
      }
    }
  }, [active, openReads])

  useEffect(() => {
    setAttempt(PENDING)
    setOpening(PENDING)
    if (!active || opened.status === 'loading') {
      return undefined
    }
    if (opened.status === 'unreadable') {
      setAttempt(FAILED)
      return undefined
    }
    const { reads } = opened
    let live = true
    const run = async () => {
      const running = await readWithin(
        () => readRunningAttempt(reads, account),
        CONFIRMED_READ_LIMIT_MS_STAND_IN
      ).catch(() => undefined)
      if (!live) {
        return
      }
      if (running === undefined) {
        setAttempt(FAILED)
        return
      }
      if (running === null) {
        setAttempt({ status: 'ended' })
        return
      }
      setAttempt({ status: 'answered', value: running })
      const answered = await readWithin(
        () => readOpening(reads, account, running),
        CONFIRMED_READ_LIMIT_MS_STAND_IN
      ).then(
        (value): EntryRead<RunningOpening> => ({ status: 'answered', value }),
        (): EntryRead<RunningOpening> => FAILED
      )
      if (live) {
        setOpening(answered)
      }
    }
    run().catch(() => undefined)
    return () => {
      live = false
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

  // A listing that fails names no fast-track key; the wallet's own keys still answer.
  useEffect(() => {
    if (!active) {
      return undefined
    }
    let live = true
    records.listRecoveryEntries(chainId).then(
      (listed) => {
        if (live) {
          setEntries(listed)
        }
      },
      () => {
        if (live) {
          setEntries(NO_ENTRIES)
        }
      }
    )
    return () => {
      live = false
    }
  }, [active, records, chainId])

  const retry = useCallback(() => {
    if (attempt.status === 'failed' || opening.status === 'failed') {
      setAttemptRound((round) => round + 1)
    }
    if (authority.status === 'failed') {
      setAuthorityRound((round) => round + 1)
    }
  }, [attempt.status, opening.status, authority.status])

  return { attempt, opening, authority, entries, retry }
}
