import React, { createContext, useCallback, useMemo } from 'react'

import useStorage from '@common/hooks/useStorage'

import { UsePrivateModeReturnType } from './types'

const PrivateModeContext = createContext<UsePrivateModeReturnType>({
  hidePrivateValue: () => '',
  togglePrivateMode: () => {},
  isPrivateMode: false
})

const PrivateModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isPrivateMode, setIsPrivateMode] = useStorage<boolean>({ key: 'isPrivateMode' })

  const togglePrivateMode = useCallback(() => {
    setIsPrivateMode(!isPrivateMode)
  }, [isPrivateMode, setIsPrivateMode])

  const hidePrivateValue = useCallback(
    (value: string | number) => {
      if (!isPrivateMode) {
        return value
      }

      return typeof value === 'string' && value.startsWith('0x') ? value.replace(/./gi, '*') : '**'
    },
    [isPrivateMode]
  )

  return (
    <PrivateModeContext.Provider
      value={useMemo(
        () => ({
          isPrivateMode,
          hidePrivateValue,
          togglePrivateMode
        }),
        [isPrivateMode, hidePrivateValue, togglePrivateMode]
      )}
    >
      {children}
    </PrivateModeContext.Provider>
  )
}

export { PrivateModeContext, PrivateModeProvider }
