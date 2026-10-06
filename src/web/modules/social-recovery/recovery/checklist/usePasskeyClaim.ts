/**
 * The passkey rows' claim ceremony. A claim stores its request before the
 * tab leaves for the ceremony tab, and the return path carries the request's
 * id back. The report is read and left in place, so a passed claim survives a
 * reload until its reply is added. A report that lands after the mount
 * arrives through the subscription. A claim that did not pass loses its
 * request, its report and its id at once; a passed claim waits as `pending`,
 * its request, report and id kept, until the checklist adds its reply to the
 * live session or the session is abandoned. Once the session is wiped, every
 * claim this checklist knows of loses its request and its report, a report
 * that lands after the wipe included.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ApproverRequest } from '@web/modules/social-recovery/sdk-interfaces'
import {
  ceremonyPath,
  ceremonyResultKey,
  isCeremonyReport,
  isReportFor,
  readCeremonyReport
} from '@web/modules/social-recovery/shared/ceremony'
import type {
  CeremonyOutcome,
  CeremonyReport,
  ReportIdentity
} from '@web/modules/social-recovery/shared/ceremony'

import { claimAskedOf, claimReplyOf, claimRequestRecordOf } from './claim'
import { PASSKEY_SLUG } from './constants'
import { checklistPathOf } from './search'
import type { ClaimAsked, ClaimOutcome, ClaimReply, PasskeyClaim, PasskeyClaimInput } from './types'

const usePasskeyClaim = ({
  records,
  chainId,
  account,
  search,
  navigate,
  deps
}: PasskeyClaimInput): PasskeyClaim => {
  const [outcomes, setOutcomes] = useState<Partial<Record<number, ClaimOutcome>>>({})
  const [pending, setPending] = useState<ClaimReply | null>(null)
  const [undelivered, setUndelivered] = useState<ClaimAsked | null>(null)
  const [launchFailed, setLaunchFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [launching, setLaunching] = useState<number | null>(null)

  const taking = useRef<string | null>(null)
  const stopListening = useRef<(() => void) | undefined>()

  const launch = useCallback(
    async (request: ApproverRequest, handOff: boolean) => {
      const id = deps.newRequestId()
      setBusy(true)
      setLaunchFailed(false)
      setLaunching(request.place)
      try {
        await records
          .ceremonyRequest(id)
          .write(claimRequestRecordOf({ account, chainId, request, handOff }))
      } catch {
        setLaunchFailed(true)
        setLaunching(null)
        setBusy(false)
        return
      }
      navigate(
        ceremonyPath({
          call: 'createClaim',
          method: PASSKEY_SLUG,
          id,
          handOff,
          returnTo: checklistPathOf(account, id)
        })
      )
    },
    [deps, records, account, chainId, navigate]
  )

  /**
   * A settled claim's request and report go; the search drops its id unless
   * the tab is leaving the checklist.
   */
  const forget = (id: string, leaving = false) => {
    records
      .ceremonyRequest(id)
      .wipe()
      .catch(() => undefined)
    deps.reportStore.remove(ceremonyResultKey(id)).catch(() => undefined)
    if (!leaving) {
      navigate(checklistPathOf(account), { replace: true })
    }
  }

  const ceremonyId = search.ceremony
  useEffect(() => {
    if (!ceremonyId || taking.current === ceremonyId) {
      return undefined
    }
    taking.current = ceremonyId
    let live = true
    const done = (report: CeremonyReport, asked: ClaimAsked) => {
      setUndelivered(null)
      const { outcome } = report
      setOutcomes((held) => ({ ...held, [asked.place]: { outcome, handOff: asked.handOff } }))
      if (outcome.kind === 'verdict' && outcome.verdict === 'passed') {
        const passed = claimReplyOf(outcome.value)
        if (passed) {
          setPending({ place: asked.place, id: ceremonyId, ...passed })
          return
        }
      }
      forget(ceremonyId)
    }
    const take = async () => {
      const stored = await records.ceremonyRequest(ceremonyId).read()
      const asked =
        stored.status === 'present' ? claimAskedOf(stored.value, { account, chainId }) : null
      if (!asked) {
        navigate(checklistPathOf(account), { replace: true })
        return
      }
      const identity: ReportIdentity = { id: ceremonyId, call: 'createClaim', method: PASSKEY_SLUG }
      const report = await readCeremonyReport(identity, deps.reportStore, deps.now())
      if (report) {
        done(report, asked)
        return
      }
      setUndelivered(asked)
      if (!live) {
        return
      }
      stopListening.current = deps.reportSubscribe(ceremonyResultKey(ceremonyId), (late) => {
        if (isCeremonyReport(late) && isReportFor(late, identity, deps.now())) {
          stopListening.current?.()
          stopListening.current = undefined
          done(late, asked)
        }
      })
    }
    take().catch(() => undefined)
    return () => {
      live = false
      stopListening.current?.()
      stopListening.current = undefined
    }
    // Only a new ceremony id runs this again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ceremonyId])

  const settle = useCallback(
    (place: number, refusal?: CeremonyOutcome<unknown>) => {
      if (pending && pending.place === place) {
        forget(pending.id)
      }
      setPending((held) => (held && held.place === place ? null : held))
      if (refusal) {
        setOutcomes((held) => ({
          ...held,
          [place]: { outcome: refusal, handOff: held[place]?.handOff ?? false }
        }))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending]
  )

  // A report that never came back: the stale request goes, the search drops
  // its id, and the same claim runs again under a new one.
  const retryUndelivered = useCallback(async () => {
    if (!undelivered || !ceremonyId) {
      return
    }
    stopListening.current?.()
    stopListening.current = undefined
    await records
      .ceremonyRequest(ceremonyId)
      .wipe()
      .catch(() => undefined)
    const asked = undelivered
    setUndelivered(null)
    await launch(asked.request, asked.handOff)
  }, [undelivered, ceremonyId, records, launch])

  // An abandoned session takes its waiting claim with it.
  const forgetPending = useCallback(() => {
    if (pending) {
      forget(pending.id, true)
    }
    setPending(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  // A wiped session keeps no claim: the waiting one and the one the search
  // names lose their request and report. The listener stays, so a report the
  // ceremony tab writes later is taken and removed in turn.
  const forgetAll = useCallback(() => {
    const ids = [pending?.id, ceremonyId].filter((id): id is string => typeof id === 'string')
    new Set(ids).forEach((id) => forget(id, true))
    setPending(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, ceremonyId])

  const asked = useMemo(
    () =>
      new Set(
        [launching, pending?.place, undelivered?.place].filter(
          (place): place is number => typeof place === 'number'
        )
      ),
    [launching, pending, undelivered]
  )

  return {
    launch,
    outcomes,
    pending,
    settle,
    forgetPending,
    forgetAll,
    asked,
    undelivered,
    retryUndelivered,
    launchFailed,
    busy
  }
}

export default usePasskeyClaim
