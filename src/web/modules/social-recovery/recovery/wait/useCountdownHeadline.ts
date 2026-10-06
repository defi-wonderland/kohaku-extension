/**
 * The headline of one countdown on the home surface, from the attempt read of
 * its account on the checklist's poll period: one round at once, then on every
 * period and whenever the tab returns to view; rounds never overlap. Waiting
 * with the countdown's anchor, execution due, or any other reading, which the
 * wait itself names. Null while the client or the first read loads, and after
 * a round that fails or runs past its limit, so the home surface never shows a
 * number from a read that did not answer and a cancel never hides behind one.
 */
import { useEffect, useRef, useState } from 'react'

import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import { isVisible } from '@web/modules/social-recovery/shared/ceremony'
import { useRecoveryClient } from '@web/modules/social-recovery/shared/client/useRecoveryClient'
import {
  CHECKLIST_POLL_MS,
  POLL_LIMIT_MS
} from '@web/modules/social-recovery/recovery/checklist/constants'

import { within } from './read'
import type { CountdownHeadline } from './types'

const useCountdownHeadline = (account: Address): CountdownHeadline | null => {
  const clientState = useRecoveryClient(account)
  const kit = clientState.status === 'ready' ? clientState.client : null
  const [headline, setHeadline] = useState<CountdownHeadline | null>(null)
  const rounds = useRef(0)

  useEffect(() => {
    setHeadline(null)
    if (!kit) {
      return undefined
    }
    let live = true
    let inFlight = false
    const run = async () => {
      if (inFlight) {
        return
      }
      inFlight = true
      const state = await within(() => kit.recovery.recoveryState(), POLL_LIMIT_MS)
      inFlight = false
      if (!live) {
        return
      }
      if (!state) {
        setHeadline(null)
        return
      }
      const { attempt, block } = state
      rounds.current += 1
      if (attempt.state !== 'Waiting') {
        setHeadline({ kind: 'other' })
      } else if (attempt.consumableAfter <= block.timestamp) {
        setHeadline({ kind: 'executionDue' })
      } else {
        setHeadline({
          kind: 'waiting',
          anchor: {
            endMs: attempt.consumableAfter * 1000,
            blockMs: block.timestamp * 1000,
            round: rounds.current
          }
        })
      }
    }
    run().catch(() => undefined)
    const timer = setInterval(() => {
      run().catch(() => undefined)
    }, CHECKLIST_POLL_MS)
    const onChange = () => {
      if (isVisible(document)) {
        run().catch(() => undefined)
      }
    }
    document.addEventListener('visibilitychange', onChange)
    return () => {
      live = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onChange)
    }
  }, [kit])

  return headline
}

export default useCountdownHeadline
