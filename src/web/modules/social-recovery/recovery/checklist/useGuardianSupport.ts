/**
 * What the checklist's guardian rows share: the key the recovery removes,
 * read once while a guardian row shows, with its own loading and failed
 * states; the page the links open on; and the paste, which checks a pasted
 * approval against the live gathering and adds it to the place it names.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ApproverReply } from '@web/modules/social-recovery/sdk-interfaces'

import { tabPageUrl } from './link'
import { oneApprovalOf, pasteApproval } from './paste'
import type {
  AddReply,
  GuardianSupport,
  GuardianSupportInput,
  Paste,
  RemovedKeyRead
} from './types'

const useGuardianSupport = ({
  kit,
  gathering,
  requests,
  layout,
  destination,
  now,
  timeZone
}: GuardianSupportInput): GuardianSupport => {
  const [removed, setRemoved] = useState<RemovedKeyRead>({ status: 'loading' })
  const [readAttempt, setReadAttempt] = useState(0)
  const [addedAt, setAddedAt] = useState<Partial<Record<number, number>>>({})
  const tabUrl = useMemo(() => tabPageUrl(), [])

  const hasGuardian = useMemo(
    () =>
      !!layout &&
      [...layout.required, ...layout.groups.flatMap((group) => group.rows)].some(
        (row) => row.kind === 'ecdsa'
      ),
    [layout]
  )

  useEffect(() => {
    if (!kit || !hasGuardian) {
      return undefined
    }
    let live = true
    setRemoved({ status: 'loading' })
    kit.walletReads
      .removedKey()
      .then((reading) => {
        if (live) {
          setRemoved(
            reading.kind === 'named'
              ? { status: 'named', key: reading.key }
              : { status: 'unavailable' }
          )
        }
      })
      .catch(() => {
        if (live) {
          setRemoved({ status: 'failed' })
        }
      })
    return () => {
      live = false
    }
  }, [kit, hasGuardian, readAttempt])

  const retryRemoved = useCallback(() => setReadAttempt((n) => n + 1), [])

  const nowRef = useRef(now)
  nowRef.current = now

  const paste = useMemo<Paste | null>(() => {
    if (!kit || !gathering || !layout) {
      return null
    }
    const oneApproval = oneApprovalOf(layout)
    const versionRefused = (reply: ApproverReply): boolean => {
      try {
        return kit.recovery.addApproverReply(gathering, reply).reason?.cause === 'version-unread'
      } catch {
        return false
      }
    }
    return async (text: string, addReply: AddReply) => {
      const at = nowRef.current()
      const outcome = await pasteApproval({
        text,
        gathering,
        requests,
        oneApproval,
        versionRefused,
        now: () => at,
        verifyReply: (request, reply) => kit.walletReads.verifyReply(request, reply),
        addReply
      })
      if (outcome.kind === 'added') {
        setAddedAt((held) => ({ ...held, [outcome.place]: at }))
      }
      return outcome
    }
  }, [kit, gathering, requests, layout])

  return {
    tabUrl,
    newKey: destination.status === 'ready' ? destination.key : undefined,
    removed,
    retryRemoved,
    timeZone,
    addedAt,
    paste
  }
}

export default useGuardianSupport
