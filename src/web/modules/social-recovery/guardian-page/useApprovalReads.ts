/**
 * The page's chain reads: the account's recovery state, with the attempt and
 * the setup number, and whether the account authorizes the action, and where
 * the request would read void, whether it was submitted. One round
 * runs when the client is ready or another link opens, then one every minute
 * and on a retry. Rounds never overlap. A round that throws or runs past its
 * limit reads as failed, never as the last answer; a new client or a new link
 * starts again from nothing answered. Once the last answer is final no round
 * runs, and that answer stays, through a new client too, until another link
 * opens.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { LOG_CHUNK_BLOCKS } from '@web/modules/social-recovery/shared/client/kit/events'

import { readApprovalFacts } from './approval-facts'
import { APPROVAL_READ_LIMIT_MS, APPROVAL_READ_MS } from './constants'
import type {
  ApprovalReads,
  ApprovalReadsHook,
  ApprovalReadsInput,
  LinkedApprovalReads
} from './types'

const PENDING: ApprovalReads = { status: 'pending' }

const useApprovalReads = ({
  client,
  request,
  link,
  enabled,
  stopped
}: ApprovalReadsInput): ApprovalReadsHook => {
  // Reads answered for another link read as pending, from the first render
  // of the new link on.
  const [linked, setLinked] = useState<LinkedApprovalReads>({ link, reads: PENDING })
  const linkedRef = useRef(linked)
  linkedRef.current = linked
  const clientRef = useRef(client)
  clientRef.current = client
  const linkRef = useRef(link)
  linkRef.current = link
  const requestRef = useRef(request)
  requestRef.current = request
  // Each client's and each link's rounds carry their number; a round of an
  // earlier one is dropped.
  const generation = useRef(0)
  const inFlight = useRef(false)
  const stoppedRef = useRef(stopped)
  stoppedRef.current = stopped

  const run = useCallback(async () => {
    const current = clientRef.current
    const forLink = linkRef.current
    const id = generation.current
    if (!current || inFlight.current) {
      return
    }
    inFlight.current = true
    const facts = await readApprovalFacts(
      current,
      requestRef.current,
      APPROVAL_READ_LIMIT_MS,
      LOG_CHUNK_BLOCKS
    )
    if (id !== generation.current) {
      return
    }
    inFlight.current = false
    setLinked({
      link: forLink,
      reads: facts ? { status: 'answered', facts } : { status: 'failed' }
    })
  }, [])

  const active = enabled ? client : null
  useEffect(() => {
    generation.current += 1
    inFlight.current = false
    // A final answer for this link outlives a new client: a round of the old
    // client is dropped, and nothing reads again.
    if (stoppedRef.current && linkedRef.current.link === link) {
      return undefined
    }
    setLinked({ link, reads: PENDING })
    if (!active) {
      return undefined
    }
    run().catch(() => undefined)
    return () => {
      generation.current += 1
    }
  }, [active, link, run])

  useEffect(() => {
    if (!active || stopped) {
      return undefined
    }
    const timer = setInterval(() => {
      run().catch(() => undefined)
    }, APPROVAL_READ_MS)
    return () => clearInterval(timer)
  }, [active, stopped, run])

  // A retry after a failed round reads as reading until its round answers.
  const retry = useCallback(() => {
    if (!clientRef.current || inFlight.current || stoppedRef.current) {
      return
    }
    setLinked((last) => (last.reads.status === 'failed' ? { ...last, reads: PENDING } : last))
    run().catch(() => undefined)
  }, [run])

  return { reads: linked.link === link ? linked.reads : PENDING, retry }
}

export default useApprovalReads
