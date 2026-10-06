/**
 * The checklist's session: it opens once the client is ready, reads the
 * stored session before anything renders, opens a gathering only where none
 * is stored, and writes every change under the revision it read. A change
 * another tab made first reads as a conflict to reload, never as a lost reply
 * or note.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  ApproverReply,
  Assessment,
  Configuration
} from '@web/modules/social-recovery/sdk-interfaces'
import { isSessionRevisionConflict } from '@web/modules/social-recovery/shared/records'
import type { RowNote, StoredSession } from '@web/modules/social-recovery/shared/records'

import { readoutPathOf, routeEntryPathOf, waitPathOf } from './search'
import { configurationOf, gatherAgain as gatherAgainOver, openChecklist } from './session'
import type {
  AddReplyResult,
  ChecklistHookInput,
  ChecklistLoad,
  ChecklistState,
  LiveChecklist,
  OpenResult
} from './types'

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

  const kit = client.status === 'ready' ? client.client : null
  const destinationKey = destination.status === 'ready' ? destination.key : undefined
  const destinationUnavailable = destination.status === 'unavailable'

  // Every write reads the session as it stands after the last write, never a
  // render's copy, so two changes in a row both carry the latest revision.
  const loadRef = useRef(load)
  loadRef.current = load
  const configurationRef = useRef<Configuration | null>(null)
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
          setLoad({
            phase: 'live',
            session: result.session,
            revision: result.revision,
            savedAt: result.savedAt,
            configuration
          })
          return
        case 'wiped':
          setNeedsDestination(false)
          setLoad({ phase: 'wiped', session: result.session, revision: result.revision })
          return
        case 'landed':
          navigateRef.current(waitPathOf(account), { replace: true })
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
      let configuration = configurationRef.current
      if (!configuration) {
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
          configuration = reading.configuration
          configurationRef.current = configuration
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
          configuration,
          destination: destinationRef.current
        })
        if (live) {
          apply(result, configuration)
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

  const abandon = useCallback(async () => {
    const current = currentLive()
    if (!current) {
      return
    }
    setBusy(true)
    setAbandonFailed(false)
    try {
      await records.wipeRecoverySession(chainId, account, 'recoverer-abandoned', current.revision)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, chainId, account, entry.route])

  const gatherAgain = useCallback(async () => {
    const current = loadRef.current
    const configuration = configurationRef.current
    if (current.phase !== 'wiped' || !kit || !configuration) {
      return
    }
    setBusy(true)
    try {
      const result = await gatherAgainOver({
        records,
        chainId,
        account,
        client: kit,
        configuration,
        destination: destinationRef.current,
        revision: current.revision
      })
      apply(result, configuration)
      if (result.kind === 'needs-destination') {
        setLoad(LOADING)
      }
    } catch {
      setLoad({ phase: 'failed', cause: 'open' })
    } finally {
      setBusy(false)
    }
  }, [kit, records, chainId, account, apply])

  const gathering = load.phase === 'live' ? load.session.gathering : null
  const assessment = useMemo<Assessment | null>(() => {
    if (!gathering || !kit) {
      return null
    }
    try {
      return kit.recovery.assess(gathering, Math.floor(depsRef.current.now() / 1000))
    } catch {
      return null
    }
  }, [gathering, kit])

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
    busy
  }
}

export default useChecklist
