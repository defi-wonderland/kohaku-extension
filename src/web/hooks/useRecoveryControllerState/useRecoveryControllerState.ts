import { useContext } from 'react'

import { RecoveryControllerStateContext } from '@web/contexts/recoveryControllerStateContext'

export default function useRecoveryControllerState() {
  const context = useContext(RecoveryControllerStateContext)

  if (!context) {
    throw new Error(
      'useRecoveryControllerState must be used within a RecoveryControllerStateProvider'
    )
  }

  return context
}
