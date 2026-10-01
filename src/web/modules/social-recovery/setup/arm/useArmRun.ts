/**
 * Holds the save's run for the screen: one store for the screen's life, and
 * the three moves the screen offers over the steps it is given. A move with no
 * steps yet does nothing.
 */
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'

import { createArmStore, recheckGas, rereadConfirmation, startSave } from './run'
import type { ArmRun, SaveSteps } from './types'

export const useArmRun = (steps: SaveSteps | null): ArmRun => {
  const store = useMemo(() => createArmStore(), [])
  const state = useSyncExternalStore(store.subscribe, store.state)
  const stepsRef = useRef(steps)
  stepsRef.current = steps

  const start = useCallback(() => {
    if (stepsRef.current) {
      startSave(store, stepsRef.current).catch(() => undefined)
    }
  }, [store])
  const recheck = useCallback(() => {
    if (stepsRef.current) {
      recheckGas(store, stepsRef.current).catch(() => undefined)
    }
  }, [store])
  const reread = useCallback(() => {
    if (stepsRef.current) {
      rereadConfirmation(store, stepsRef.current).catch(() => undefined)
    }
  }, [store])

  return { state, start, recheck, reread }
}
