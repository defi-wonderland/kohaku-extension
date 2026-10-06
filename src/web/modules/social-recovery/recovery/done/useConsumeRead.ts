/**
 * The consume event's read, once the client and the block time read are
 * ready, and again on retry. Until it answers it reads pending; a read that
 * fails reads failed, never the last answer.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { POLL_LIMIT_MS } from '@web/modules/social-recovery/recovery/checklist/constants'

import { readConsume } from './read'
import type { DoneRead, DoneReadHook, DoneReadInput } from './types'

const PENDING: DoneRead = { status: 'pending' }

const useConsumeRead = ({ kit, blockTime }: DoneReadInput): DoneReadHook => {
  const [read, setRead] = useState<DoneRead>(PENDING)
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    const id = generation.current
    setRead(PENDING)
    if (!kit || !blockTime) {
      return undefined
    }
    readConsume(kit, blockTime, POLL_LIMIT_MS)
      .then((reading) => {
        if (id === generation.current) {
          setRead(reading ? { status: 'answered', reading } : { status: 'failed' })
        }
      })
      .catch(() => {
        if (id === generation.current) {
          setRead({ status: 'failed' })
        }
      })
    return () => {
      generation.current += 1
    }
  }, [kit, blockTime, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { read, retry }
}

export default useConsumeRead
