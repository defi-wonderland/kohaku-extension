/**
 * The checklist's session: it opens once the client is ready, reads the
 * stored session before anything renders, opens a gathering only where none
 * is stored, and writes every change under the revision it read. A change
 * another tab made first reads as a conflict to reload, never as a lost reply
 * or note. While a session is open it polls the account's recovery state,
 * assesses the gathering again after every poll that answers, and wipes the
 * session with its reason once the request dies: the deadline passed, another
 * attempt opened or the setup changed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  ApproverReply,
  Assessment,
  Configuration
} from '@web/modules/social-recovery/sdk-interfaces'
import { isSessionRevisionConflict } from '@web/modules/social-recovery/shared/records'
import type {
  DirectWipeEvent,
  RowNote,
  StoredSession
} from '@web/modules/social-recovery/shared/records'

import { deadlinePassed, deathOf, pollTargetOf } from './poll'
import { readoutPathOf, routeEntryPathOf, waitPathOf } from './search'
import {
  configurationOf,
  gatherAgain as gatherAgainOver,
  openChecklist,
  resultOfRead
} from './session'
import type {
  AddReplyResult,
  HeldConfiguration,
  ChecklistHookInput,
  ChecklistLoad,
  ChecklistState,
  LiveChecklist,
  OpenResult,
  PollFacts
} from './types'
import usePoll from './usePoll'

const LOADING: ChecklistLoad = { phase: 'loading' }

/** The live checklist a stored write leaves, keeping the configuration it was opened over. */
const liveOf = (stored: StoredSession, configuration: Configuration): ChecklistLoad =>
  stored.value.state === 'live'
    ? {
        phase: 'live',
        session: stored.value,
        revision: stored.revision,
        savedAt: stored.savedAt,
        configuration
      }
    : LOADING

const useChecklist = ({
  records,
  chainId,
  account,
  entry,
  client,
  destination,
  navigate,
  deps
}: ChecklistHookInput): ChecklistState => {
  const [load, setLoad] = useState<ChecklistLoad>(LOADING)
  const [attempt, setAttempt] = useState(0)
  const [needsDestination, setNeedsDestination] = useState(false)
  const [busy, setBusy] = useState(false)
  const [noteFailed, setNoteFailed] = useState(false)
  const [abandonFailed, setAbandonFailed] = useState(false)
  const [gatherFailed, setGatherFailed] = useState(false)
  const [deathFailed, setDeathFailed] = useState(false)

  const kit = client.status === 'ready' ? client.client : null
  const destinationKey = destination.status === 'ready' ? destination.key : undefined
  const destinationUnavailable = destination.status === 'unavailable'

  // Every write reads the session as it stands after the last write, never a
  // render's copy, so two changes in a row both carry the latest revision.
  const loadRef = useRef(load)
  loadRef.current = load
  const configurationRef = useRef<HeldConfiguration | null>(null)
  const destinationRef = useRef(destinationKey)
  destinationRef.current = destinationKey
  const depsRef = useRef(deps)
  depsRef.current = deps
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  const apply = useCallback(
    (result: OpenResult, configuration: Configuration) => {
      switch (result.kind) {
        case 'live':
          setNeedsDestination(false)
          // A stale cache read again with the password: the rows follow the setup the chain commits.
          if (result.configuration) {
            configurationRef.current = { configuration: result.configuration, source: 'password' }
          }
          setLoad({
            phase: 'live',
            session: result.session,
            revision: result.revision,
            savedAt: result.savedAt,
            configuration: result.configuration ?? configuration
          })
          return
        case 'wiped':
          setNeedsDestination(false)
          setLoad({ phase: 'wiped', session: result.session, revision: result.revision })
          return
        case 'landed':
          navigateRef.current(waitPathOf(account), { replace: true })
          return
        case 'needs-password':
          configurationRef.current = null
          navigateRef.current(readoutPathOf(account), { replace: true })
          return
        case 'needs-destination':
        default:
          setNeedsDestination(true)
      }
    },
    [account]
  )

  // The destination key matters only while no session is stored, so it
  // starts the open again only then.
  const openKey = needsDestination ? destinationKey ?? (destinationUnavailable ? 'none' : '') : ''

  useEffect(() => {
    if (!kit) {
      return undefined
    }
    if (needsDestination && destinationUnavailable) {
      setLoad({ phase: 'failed', cause: 'destination' })
      return undefined
    }
    let live = true
    const run = async () => {
      let held = configurationRef.current
      if (!held) {
        try {
          const reading = await configurationOf({
            records,
            chainId,
            account,
            client: kit,
            password: depsRef.current.readPassword(chainId, account)
          })
          if (!live) {
            return
          }
          if (reading.kind === 'none') {
            navigateRef.current(readoutPathOf(account), { replace: true })
            return
          }
          held = { configuration: reading.configuration, source: reading.source }
          configurationRef.current = held
        } catch {
          if (live) {
            setLoad({ phase: 'failed', cause: 'setup' })
          }
          return
        }
      }
      try {
        const result = await openChecklist({
          records,
          chainId,
          account,
          client: kit,
          ...held,
          password: depsRef.current.readPassword(chainId, account),
          destination: destinationRef.current
        })
        if (live) {
          apply(result, held.configuration)
        }
      } catch {
        if (live) {
          setLoad({ phase: 'failed', cause: 'open' })
        }
      }
    }
    run().catch(() => undefined)
    return () => {
      live = false
    }
    // The open runs again on a retry, a new client, or a destination key that
    // arrives while no session is stored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit, records, chainId, account, attempt, openKey])

  const retry = useCallback(() => {
    setLoad(LOADING)
    setNoteFailed(false)
    setAbandonFailed(false)
    configurationRef.current = null
    if (client.status === 'update-the-wallet' || client.status === 'failed') {
      client.retry()
    }
    if (destination.status === 'unavailable') {
      destination.retry()
    }
    setAttempt((n) => n + 1)
  }, [client, destination])

  const currentLive = (): LiveChecklist | null => {
    const current = loadRef.current
    return current.phase === 'live' ? current : null
  }

  const settleWrite = (stored: StoredSession, configuration: Configuration) => {
    const next = liveOf(stored, configuration)
    loadRef.current = next
    setLoad(next)
  }

  const conflict = () => {
    const next: ChecklistLoad = { phase: 'conflict' }
    loadRef.current = next
    setLoad(next)
  }

  const addReply = useCallback(
    async (reply: ApproverReply): Promise<AddReplyResult> => {
      const current = currentLive()
      if (!current || !kit) {
        return { kind: 'refused', cause: 'not-live' }
      }
      const added = kit.recovery.addApproverReply(current.session.gathering, reply)
      if (added.reason) {
        return { kind: 'refused', cause: added.reason.cause }
      }
      setBusy(true)
      try {
        const stored = await records
          .recoverySession(chainId, account)
          .write(added.gathering, current.revision)
        settleWrite(stored, current.configuration)
        return { kind: 'added' }
      } catch (error: unknown) {
        if (isSessionRevisionConflict(error)) {
          conflict()
          return { kind: 'conflict' }
        }
        return { kind: 'write-failed' }
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kit, records, chainId, account]
  )

  const setNote = useCallback(
    async (place: number, note: RowNote | null) => {
      const current = currentLive()
      if (!current) {
        return
      }
      setBusy(true)
      setNoteFailed(false)
      try {
        const stored = await records
          .recoverySession(chainId, account)
          .setNote(place, note, current.revision)
        settleWrite(stored, current.configuration)
      } catch (error: unknown) {
        if (isSessionRevisionConflict(error)) {
          conflict()
        } else {
          setNoteFailed(true)
        }
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, chainId, account]
  )

  const abandon = useCallback(
    async (onWiped?: () => void) => {
      const current = currentLive()
      if (!current) {
        return
      }
      setBusy(true)
      setAbandonFailed(false)
      try {
        await records.wipeRecoverySession(chainId, account, 'recoverer-abandoned', current.revision)
        onWiped?.()
        navigateRef.current(routeEntryPathOf(entry.route), { replace: true })
      } catch (error: unknown) {
        if (isSessionRevisionConflict(error)) {
          conflict()
        } else {
          setAbandonFailed(true)
        }
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, chainId, account, entry.route]
  )

  const gatherAgain = useCallback(async () => {
    const current = loadRef.current
    const held = configurationRef.current
    if (current.phase !== 'wiped' || !kit || !held) {
      return
    }
    setBusy(true)
    setGatherFailed(false)
    try {
      const result = await gatherAgainOver({
        records,
        chainId,
        account,
        client: kit,
        ...held,
        password: depsRef.current.readPassword(chainId, account),
        destination: destinationRef.current,
        revision: current.revision
      })
      // Without the destination key nothing opened, and the reason stays.
      if (result.kind === 'needs-destination') {
        setGatherFailed(true)
      } else {
        apply(result, held.configuration)
      }
    } catch {
      setGatherFailed(true)
    } finally {
      setBusy(false)
    }
  }, [kit, records, chainId, account, apply])

  // A request that died is wiped once, with its reason, under the revision
  // this tab holds; the wiped line it leaves is what the checklist renders.
  const dying = useRef(false)
  const die = useCallback(
    async (event: DirectWipeEvent) => {
      const current = currentLive()
      if (!current || dying.current) {
        return
      }
      dying.current = true
      const hadReplies = current.session.gathering.replies.length > 0
      try {
        await records.wipeRecoverySession(chainId, account, event, current.revision)
        setDeathFailed(false)
        const found = resultOfRead(await records.recoverySession(chainId, account).read())
        if (found?.kind === 'wiped') {
          const next: ChecklistLoad = {
            phase: 'wiped',
            session: found.session,
            revision: found.revision,
            hadReplies
          }
          loadRef.current = next
          setLoad(next)
        } else if (found) {
          apply(found, current.configuration)
        }
      } catch (error: unknown) {
        if (isSessionRevisionConflict(error)) {
          conflict()
        } else {
          setDeathFailed(true)
        }
      } finally {
        dying.current = false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, chainId, account, apply]
  )

  const target = useMemo(() => pollTargetOf(load), [load])
  // The deadline is the clock's alone: it is read before every poll, and a
  // passed one wipes the session without waiting for the chain.
  const beforePoll = useCallback(
    (clock: number): boolean => {
      const current = currentLive()
      if (!current || !deadlinePassed(current.session.gathering, clock)) {
        return false
      }
      die('deadline-passed').catch(() => undefined)
      return true
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [die]
  )
  const afterPoll = useCallback(
    (facts: PollFacts) => {
      const current = currentLive()
      const death = current ? deathOf(current.session.gathering, facts) : null
      if (death) {
        die(death).catch(() => undefined)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [die]
  )
  const { poll, retry: retryPoll } = usePoll({
    kit,
    target,
    deps,
    before: beforePoll,
    after: afterPoll
  })

  const readSetupAgain = useCallback(async () => {
    const current = loadRef.current
    if (current.phase !== 'wiped') {
      return
    }
    setBusy(true)
    setGatherFailed(false)
    try {
      await records.clearWipedSession(chainId, account, current.revision)
      await records.decryptedSetupCache(chainId, account).wipe()
      depsRef.current.forgetPassword(chainId, account)
      configurationRef.current = null
      navigateRef.current(readoutPathOf(account), { replace: true })
    } catch (error: unknown) {
      if (isSessionRevisionConflict(error)) {
        conflict()
      } else {
        setGatherFailed(true)
      }
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, chainId, account])

  const gathering = load.phase === 'live' ? load.session.gathering : null
  // The assessment takes the clock the last answered poll read before its read.
  const assessedAt = poll.status === 'answered' ? poll.clock : null
  const assessment = useMemo<Assessment | null>(() => {
    if (!gathering || !kit) {
      return null
    }
    try {
      return kit.recovery.assess(
        gathering,
        Math.floor((assessedAt ?? depsRef.current.now()) / 1000)
      )
    } catch {
      return null
    }
  }, [gathering, kit, assessedAt])

  return {
    load,
    assessment,
    retry,
    addReply,
    setNote,
    noteFailed,
    abandon,
    abandonFailed,
    gatherAgain,
    gatherFailed,
    readSetupAgain,
    poll,
    retryPoll,
    deathFailed,
    busy
  }
}

export default useChecklist
