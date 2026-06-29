import React, { createContext, useEffect } from 'react'

import { RecoveryController } from '@ambire-common/controllers/recovery/recovery'
import useDeepMemo from '@common/hooks/useDeepMemo'
import useBackgroundService from '@web/hooks/useBackgroundService'
import useControllerState from '@web/hooks/useControllerState'
import useMainControllerState from '@web/hooks/useMainControllerState'

const RecoveryControllerStateContext = createContext<RecoveryController>({} as RecoveryController)

const RecoveryControllerStateProvider: React.FC<any> = ({ children }) => {
  const controller = 'recovery'
  const state = useControllerState(controller)
  const { dispatch } = useBackgroundService()
  const mainState = useMainControllerState()

  useEffect(() => {
    if (mainState.isReady && !Object.keys(state).length) {
      dispatch({
        type: 'INIT_CONTROLLER_STATE',
        params: { controller }
      })
    }
  }, [dispatch, mainState.isReady, state])

  const memoizedState = useDeepMemo(state, controller)

  return (
    <RecoveryControllerStateContext.Provider value={memoizedState}>
      {children}
    </RecoveryControllerStateContext.Provider>
  )
}

export { RecoveryControllerStateProvider, RecoveryControllerStateContext }
