/**
 * Holds the execution's run for the wait, one per chain and account, outside
 * the screen, so a remount takes up the run in flight instead of sending a
 * second execution. When the screen leaves a run with nothing in flight, the
 * run is dropped. A move with no steps yet does nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

import {
  attachExecuteSteps,
  checkDropped,
  createExecuteStore,
  detachExecuteSteps,
  outlivesWait,
  startExecution
} from './execute'
import type { ExecuteRun, ExecuteSteps, ExecuteStore } from './types'

const RUNS = new Map<string, ExecuteStore>()

const storeFor = (runKey: string): ExecuteStore => {
  const held = RUNS.get(runKey)
  if (held) {
    return held
  }
  const created = createExecuteStore()
  RUNS.set(runKey, created)
  return created
}

const useExecuteRun = (steps: ExecuteSteps | null, runKey: string): ExecuteRun => {
  const store = useMemo(() => storeFor(runKey), [runKey])
  const state = useSyncExternalStore(store.subscribe, store.state)
  const stepsRef = useRef(steps)
  stepsRef.current = steps

  useEffect(() => {
    if (!RUNS.has(runKey)) {
      RUNS.set(runKey, store)
    }
    return () => {
      if (RUNS.get(runKey) === store && !outlivesWait(store.state())) {
        RUNS.delete(runKey)
      }
    }
  }, [store, runKey])

  useEffect(() => {
    if (!steps) {
      return undefined
    }
    attachExecuteSteps(store, steps)
    return () => detachExecuteSteps(store, steps)
  }, [store, steps])

  const start = useCallback(() => {
    if (stepsRef.current) {
      startExecution(store, stepsRef.current).catch(() => undefined)
    }
  }, [store])
  const dropped = useCallback(() => {
    if (stepsRef.current) {
      checkDropped(store, stepsRef.current).catch(() => undefined)
    }
  }, [store])

  return { state, start, checkDropped: dropped }
}

export default useExecuteRun
