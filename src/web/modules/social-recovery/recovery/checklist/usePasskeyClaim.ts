/**
 * The passkey rows' claim ceremony. A claim stores its request before the
 * tab leaves for the ceremony tab, and the return path carries the request's
 * id back. The report is taken once. A report that lands after the mount
 * arrives through the listener. A claim that did not pass loses its request
 * and its id at once; a passed claim waits as `pending`, its request and id
 * kept, until the checklist adds its reply to the live session.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ApproverRequest } from '@web/modules/social-recovery/sdk-interfaces'
import {
  ceremonyPath,
  listenForCeremonyReport,
  takeCeremonyReport
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

  /** A taken claim's request goes, and the search drops its id. */
  const forget = (id: string) => {
    records
      .ceremonyRequest(id)
      .wipe()
      .catch(() => undefined)
    navigate(checklistPathOf(account), { replace: true })
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
      const report = await takeCeremonyReport(identity, deps.reportStore, deps.now())
      if (report) {
        done(report, asked)
        return
      }
      setUndelivered(asked)
      if (!live) {
        return
      }
      stopListening.current = listenForCeremonyReport(
        identity,
        deps.reportSubscribe,
        deps.reportStore,
        (late) => done(late, asked),
        deps.now
      )
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
    asked,
    undelivered,
    retryUndelivered,
    launchFailed,
    busy
  }
}

export default usePasskeyClaim
