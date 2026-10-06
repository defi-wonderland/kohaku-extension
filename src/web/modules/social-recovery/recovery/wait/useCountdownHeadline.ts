/**
 * The headline of one countdown on the home surface, through one attempt read
 * of its account: waiting with the countdown's anchor, execution due, or any
 * other reading, which the wait itself names. Null while the client or the
 * read loads, and where either fails, so the home surface never shows a
 * number from a read that did not answer.
 */
import { useEffect, useState } from 'react'

import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import { useRecoveryClient } from '@web/modules/social-recovery/shared/client/useRecoveryClient'
import { POLL_LIMIT_MS } from '@web/modules/social-recovery/recovery/checklist/constants'

import { within } from './read'
import type { CountdownHeadline } from './types'

const useCountdownHeadline = (account: Address): CountdownHeadline | null => {
  const clientState = useRecoveryClient(account)
  const kit = clientState.status === 'ready' ? clientState.client : null
  const [headline, setHeadline] = useState<CountdownHeadline | null>(null)

  useEffect(() => {
    setHeadline(null)
    if (!kit) {
      return undefined
    }
    let live = true
    within(() => kit.recovery.recoveryState(), POLL_LIMIT_MS)
      .then((state) => {
        if (!live || !state) {
          return
        }
        const { attempt, block } = state
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
              round: 1
            }
          })
        }
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [kit])

  return headline
}

export default useCountdownHeadline
