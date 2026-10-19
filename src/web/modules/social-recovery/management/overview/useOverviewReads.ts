/**
 * The overview's reads. The setup state and the attempt come first; the path
 * and the logs since the commit follow from them. The path opens from this
 * device's opened setup where it is the committed one, else with the recovery
 * password held in memory, else by its privacy level: a setup kept in the
 * clear opens with none, a hidden one stays locked until the password opens
 * it. An opened setup is kept in the decrypted setup cache. Every read has
 * its loading state and its failed state with retry, and a read that failed
 * or has not returned never renders as an answer.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  readSetupReading,
  unlockFailureOf
} from '@web/modules/social-recovery/recovery/entry/readout'
import type { EntryRead, UnlockState } from '@web/modules/social-recovery/recovery/entry/types'
import type { Configuration, SetupState } from '@web/modules/social-recovery/sdk-interfaces'
import {
  readRecoveryPassword,
  setRecoveryPassword
} from '@web/modules/social-recovery/shared/records'

import { attemptOpenOf, isCacheCurrent, noticesOf } from './readings'
import type {
  OverviewFactsRead,
  OverviewNotices,
  OverviewReads,
  OverviewReadsInput,
  PathStep
} from './types'

const PENDING = { status: 'pending' } as const
const IDLE: UnlockState = { status: 'idle' }
const NONE: PathStep = { kind: 'none' }

export const useOverviewReads = ({
  client,
  records,
  chainId,
  account
}: OverviewReadsInput): OverviewReads => {
  const kit = client.status === 'ready' ? client.client : null
  const [facts, setFacts] = useState<OverviewFactsRead>(PENDING)
  const [path, setPath] = useState<PathStep>(NONE)
  const [ask, setAsk] = useState<UnlockState>(IDLE)
  const [notices, setNotices] = useState<EntryRead<OverviewNotices>>(PENDING)
  const [factsRound, setFactsRound] = useState(0)
  const [pathRound, setPathRound] = useState(0)
  const [noticesRound, setNoticesRound] = useState(0)
  // The password of an unlock whose setup event read failed, kept in memory for its retry.
  const typed = useRef<string | null>(null)
  // Each unlock answers only while the setup it was typed for is still the one read.
  const unlockRound = useRef(0)

  const setup: SetupState | null = facts.status === 'answered' ? facts.value.setup : null

  useEffect(() => {
    if (client.status === 'update-the-wallet') {
      setFacts({ status: 'update-the-wallet' })
      return undefined
    }
    if (client.status === 'failed') {
      setFacts({ status: 'failed' })
      return undefined
    }
    setFacts(PENDING)
    if (!kit) {
      return undefined
    }
    let live = true
    Promise.all([kit.setup.setupState(), kit.walletReads.attemptState()]).then(
      ([state, attempt]) => {
        if (live) {
          setFacts({
            status: 'answered',
            value: { setup: state, attemptOpen: attemptOpenOf(state, attempt) }
          })
        }
      },
      () => {
        if (live) {
          setFacts({ status: 'failed' })
        }
      }
    )
    return () => {
      live = false
    }
  }, [client.status, kit, factsRound])

  /** Keeps the opened setup on this device; a refused write leaves the path shown. */
  const keep = useCallback(
    (state: SetupState, configuration: Configuration) => {
      records
        .decryptedSetupCache(chainId, account)
        .write({
          configuration,
          setupNonce: state.setupNonce,
          setupCommitment: state.setupCommitment
        })
        .catch(() => undefined)
    },
    [records, chainId, account]
  )

  useEffect(() => {
    unlockRound.current += 1
    typed.current = null
    setAsk(IDLE)
    if (!kit || !setup || !setup.hasSetup) {
      setPath(NONE)
      return undefined
    }
    setPath({ kind: 'reading' })
    let live = true
    const run = async (): Promise<PathStep> => {
      const cached = await records
        .decryptedSetupCache(chainId, account)
        .read()
        .catch(() => null)
      if (cached?.status === 'present' && isCacheCurrent(cached.value, setup)) {
        return { kind: 'readable', configuration: cached.value.configuration }
      }
      const held = readRecoveryPassword(chainId, account)
      if (held !== undefined) {
        const opened = await kit.setup.getSetup({ password: held }).catch(() => null)
        if (opened) {
          keep(setup, opened)
          return { kind: 'readable', configuration: opened }
        }
      }
      const reading = await readSetupReading(kit, setup)
      switch (reading.kind) {
        case 'readable':
          keep(setup, reading.configuration)
          return { kind: 'readable', configuration: reading.configuration }
        case 'shape-readable':
          return { kind: 'locked', level: 'shape-visible', shape: reading.shape }
        case 'sealed':
          return { kind: 'locked', level: 'private' }
        case 'unreadable':
          return { kind: 'update-the-wallet' }
        default:
          return { kind: reading.kind }
      }
    }
    run().then(
      (step) => {
        if (live) {
          setPath(step)
        }
      },
      () => {
        if (live) {
          setPath({ kind: 'read-failed' })
        }
      }
    )
    return () => {
      live = false
    }
  }, [kit, setup, records, chainId, account, keep, pathRound])

  useEffect(() => {
    if (!kit || !setup || !setup.hasSetup) {
      setNotices(PENDING)
      return undefined
    }
    setNotices(PENDING)
    let live = true
    const { events } = kit.setup
    const range = { from: setup.setupCommittedAtBlock, to: setup.block.number }
    // A kit that does not serve the method logs reads as none moved; any other failure fails the read.
    const methodLogs = Promise.resolve()
      .then(() => events.fetch(events.methodFilter(), range))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'NotServedRefusal') {
          return []
        }
        throw error
      })
    Promise.all([
      Promise.resolve().then(() => events.fetch(events.accountFilter(), range)),
      methodLogs
    ]).then(
      ([own, methods]) => {
        if (live) {
          setNotices({ status: 'answered', value: noticesOf([...own, ...methods]) })
        }
      },
      () => {
        if (live) {
          setNotices({ status: 'failed' })
        }
      }
    )
    return () => {
      live = false
    }
  }, [kit, setup, noticesRound])

  const check = useCallback(
    (password: string) => {
      if (!kit || !setup || !setup.hasSetup) {
        return
      }
      unlockRound.current += 1
      const mine = unlockRound.current
      setAsk({ status: 'checking' })
      kit.setup.getSetup({ password }).then(
        (configuration) => {
          if (unlockRound.current !== mine) {
            return
          }
          typed.current = null
          setRecoveryPassword(chainId, account, password)
          keep(setup, configuration)
          setAsk(IDLE)
          setPath({ kind: 'readable', configuration })
        },
        (error: unknown) => {
          if (unlockRound.current !== mine) {
            return
          }
          const failure = unlockFailureOf(error)
          typed.current = failure === 'event-failed' ? password : null
          if (failure === 'wrong' || failure === 'event-failed') {
            setAsk({ status: failure })
            return
          }
          setAsk(IDLE)
          setPath(failure === 'unreadable' ? { kind: 'update-the-wallet' } : { kind: failure })
        }
      )
    },
    [kit, setup, chainId, account, keep]
  )

  const unlock = useCallback(
    (password: string) => {
      if (password && ask.status === 'idle') {
        check(password)
      }
    },
    [ask.status, check]
  )

  const askAgain = useCallback(() => {
    if (ask.status !== 'checking') {
      typed.current = null
      setAsk(IDLE)
    }
  }, [ask.status])

  const retryPath = useCallback(() => {
    if (ask.status === 'event-failed' && typed.current) {
      check(typed.current)
      return
    }
    setPathRound((round) => round + 1)
  }, [ask.status, check])

  const retry = useCallback(() => {
    if (client.status === 'failed') {
      client.retry()
      return
    }
    setFactsRound((round) => round + 1)
  }, [client])

  const retryNotices = useCallback(() => setNoticesRound((round) => round + 1), [])

  return { facts, path, ask, notices, retry, retryPath, retryNotices, unlock, askAgain }
}
