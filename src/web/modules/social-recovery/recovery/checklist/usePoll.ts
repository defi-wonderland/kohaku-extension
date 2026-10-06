/**
 * The open checklist's poll: one round at once when a session opens, then on
 * every period and whenever the tab returns to view. Rounds never overlap. A
 * round that has not returned leaves the poll as it stood, and a session that
 * changes starts again from nothing returned, so no reading of an earlier
 * session ever stands for the new one.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { isVisible } from '@web/modules/social-recovery/shared/ceremony'

import { CHECKLIST_POLL_MS, POLL_LIMIT_MS } from './constants'
import { readPollFacts } from './poll'
import type { PollHook, PollInput, PollState } from './types'

const PENDING: PollState = { status: 'pending' }

const usePoll = ({ kit, target, deps, before, after }: PollInput): PollHook => {
  const [poll, setPoll] = useState<PollState>(PENDING)

  const kitRef = useRef(kit)
  kitRef.current = kit
  const targetRef = useRef(target)
  targetRef.current = target
  const depsRef = useRef(deps)
  depsRef.current = deps
  const beforeRef = useRef(before)
  beforeRef.current = before
  const afterRef = useRef(after)
  afterRef.current = after

  // Each session's rounds carry its number; a round of an earlier one is dropped.
  const generation = useRef(0)
  const inFlight = useRef<number | null>(null)

  const run = useCallback(async () => {
    const current = kitRef.current
    const id = generation.current
    if (!current || !targetRef.current || inFlight.current === id) {
      return
    }
    const clock = depsRef.current.now()
    if (beforeRef.current(clock)) {
      return
    }
    inFlight.current = id
    const facts = await readPollFacts(current, POLL_LIMIT_MS)
    if (inFlight.current === id) {
      inFlight.current = null
    }
    if (id !== generation.current) {
      return
    }
    if (!facts) {
      setPoll({ status: 'failed' })
      return
    }
    setPoll({ status: 'answered', facts, clock })
    afterRef.current(facts, clock)
  }, [])

  const key = target?.key ?? null
  const source = deps.visibility
  useEffect(() => {
    generation.current += 1
    inFlight.current = null
    setPoll(PENDING)
    if (!kit || key === null) {
      return undefined
    }
    run().catch(() => undefined)
    const timer = setInterval(() => {
      run().catch(() => undefined)
    }, CHECKLIST_POLL_MS)
    const onChange = () => {
      if (source && isVisible(source)) {
        run().catch(() => undefined)
      }
    }
    source?.addEventListener('visibilitychange', onChange)
    return () => {
      generation.current += 1
      clearInterval(timer)
      source?.removeEventListener('visibilitychange', onChange)
    }
  }, [kit, key, source, run])

  const retry = useCallback(() => {
    run().catch(() => undefined)
  }, [run])

  return { poll, retry }
}

export default usePoll
