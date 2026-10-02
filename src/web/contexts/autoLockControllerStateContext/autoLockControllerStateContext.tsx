/* eslint-disable @typescript-eslint/no-shadow */
import React, { createContext, useEffect, useMemo } from 'react'
import { useIdleTimer } from 'react-idle-timer'

import usePrevious from '@common/hooks/usePrevious'
import { AutoLockController } from '@web/extension-services/background/controllers/auto-lock'
import useBackgroundService from '@web/hooks/useBackgroundService'
import useControllerState from '@web/hooks/useControllerState'

const AutoLockControllerStateContext = createContext<AutoLockController>({} as AutoLockController)

const AutoLockControllerStateProvider: React.FC<any> = ({ children }) => {
  const controller = 'autoLock'
  const state = useControllerState(controller)
  const prevAutoLockTime = usePrevious(state.autoLockTime)
  const { dispatch } = useBackgroundService()

  useEffect(() => {
    dispatch({
      type: 'INIT_CONTROLLER_STATE',
      params: { controller }
    })
  }, [dispatch])

  useEffect(() => {
    if (!prevAutoLockTime && !!state.autoLockTime) {
      dispatch({ type: 'AUTO_LOCK_CONTROLLER_SET_LAST_ACTIVE_TIME' })
    }
  }, [dispatch, prevAutoLockTime, state.autoLockTime])

  useIdleTimer({
    onAction(e) {
      if (e && ['mousedown', 'mousemove'].includes(e.type) && state.autoLockTime > 0) {
        dispatch({ type: 'AUTO_LOCK_CONTROLLER_SET_LAST_ACTIVE_TIME' })
      }
    },
    throttle: 5000
  })

  return (
    <AutoLockControllerStateContext.Provider value={useMemo(() => state, [state])}>
      {children}
    </AutoLockControllerStateContext.Provider>
  )
}

export { AutoLockControllerStateProvider, AutoLockControllerStateContext }
