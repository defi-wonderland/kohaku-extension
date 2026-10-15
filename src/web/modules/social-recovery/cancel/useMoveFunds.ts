/**
 * Moving funds: the wallet's transfer screen sends from the selected account,
 * so the page selects the account through the wallet's own select action, as
 * the holder's account switch does, and opens the transfer screen once the
 * wallet reports the selection, within a bounded wait. A selection the wallet
 * does not report in time opens nothing.
 */
import { useCallback, useEffect, useRef } from 'react'

import useNavigation from '@common/hooks/useNavigation'
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import useBackgroundService from '@web/hooks/useBackgroundService'
import useSelectedAccountControllerState from '@web/hooks/useSelectedAccountControllerState'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import { sameAddress } from '@web/modules/social-recovery/shared/client'

import { SELECT_ACCOUNT_LIMIT_MS } from './constants'

export const useMoveFunds = (account: Address | null): (() => void) => {
  const { navigate } = useNavigation()
  const { dispatch } = useBackgroundService()
  const { account: selected } = useSelectedAccountControllerState()
  const selectedAddr = selected?.addr
  const selectedRef = useRef(selectedAddr)
  selectedRef.current = selectedAddr
  const waiting = useRef<{ account: Address; timer: ReturnType<typeof setTimeout> } | null>(null)

  const open = useCallback(() => {
    if (waiting.current) {
      clearTimeout(waiting.current.timer)
      waiting.current = null
    }
    navigate(`/${WEB_ROUTES.transfer}`)
  }, [navigate])

  useEffect(() => {
    const held = waiting.current
    if (held && selectedAddr && sameAddress(selectedAddr, held.account)) {
      open()
    }
  }, [selectedAddr, open])

  useEffect(
    () => () => {
      if (waiting.current) {
        clearTimeout(waiting.current.timer)
      }
    },
    []
  )

  return useCallback(() => {
    if (!account || waiting.current) {
      return
    }
    if (selectedRef.current && sameAddress(selectedRef.current, account)) {
      open()
      return
    }
    waiting.current = {
      account,
      timer: setTimeout(() => {
        waiting.current = null
      }, SELECT_ACCOUNT_LIMIT_MS)
    }
    dispatch({ type: 'MAIN_CONTROLLER_SELECT_ACCOUNT', params: { accountAddr: account } })
  }, [account, dispatch, open])
}
