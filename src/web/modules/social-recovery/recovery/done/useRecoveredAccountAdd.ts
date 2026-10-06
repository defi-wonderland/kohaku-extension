/**
 * The add of the recovered account on the fast track, through the wallet's
 * own action for an account the screen builds. It dispatches once per run,
 * once the consume event names the granted key and the wallet pushed its
 * accounts; it reads done once the wallet lists the account, and failed where
 * the accounts controller reports an error after the add started, or where
 * the account is not listed within the limit. A retry runs the add again. An
 * account the wallet already lists is done with no dispatch. Once done, it
 * marks the wallet's setup complete, as the end of the create door's
 * onboarding does, since the fast track never reaches that screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { isAddressEqual } from 'viem'

import useAccountsControllerState from '@web/hooks/useAccountsControllerState'
import useBackgroundService from '@web/hooks/useBackgroundService'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

import { recoveredAccountOf } from './account'
import { ADD_LIMIT_MS } from './constants'
import type { AddHook, AddInput, AddState, CreationBasis } from './types'

const useRecoveredAccountAdd = ({ enabled, account, event }: AddInput): AddHook => {
  const { dispatch } = useBackgroundService()
  const { accounts, statuses } = useAccountsControllerState()
  const [run, setRun] = useState(0)
  const [state, setState] = useState<AddState>(
    enabled ? { status: 'adding' } : { status: 'skipped' }
  )
  const dispatched = useRef<number | null>(null)
  const sawLoading = useRef(false)
  const creation = useRef<CreationBasis | undefined>(undefined)
  const completed = useRef(false)

  const listed = !!accounts?.some((candidate) => isAddressEqual(candidate.addr as Address, account))
  const accountsRef = useRef(accounts)
  accountsRef.current = accounts
  const accountsReady = !!accounts

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'skipped' })
      return
    }
    if (listed) {
      setState({ status: 'done', ...(creation.current ? { creation: creation.current } : {}) })
    }
  }, [enabled, listed])

  useEffect(() => {
    const existing = accountsRef.current
    if (!enabled || listed || !event || !existing || dispatched.current === run) {
      return undefined
    }
    dispatched.current = run
    sawLoading.current = false
    setState({ status: 'adding' })
    // Once built, the account is added even where this screen has gone meanwhile.
    recoveredAccountOf({
      account,
      granted: event.granted,
      removed: event.removed,
      ...(event.removedPrivilege ? { removedPrivilege: event.removedPrivilege } : {}),
      existing: [...existing]
    })
      .then((built) => {
        creation.current = built.creation
        dispatch({
          type: 'MAIN_CONTROLLER_ADD_VIEW_ONLY_ACCOUNTS',
          params: { accounts: [built.account] }
        })
      })
      .catch(() => {
        setState((current) => (current.status === 'adding' ? { status: 'failed' } : current))
      })
    return undefined
  }, [enabled, listed, event, run, account, dispatch, accountsReady])

  const adding = state.status === 'adding' && enabled && !listed
  useEffect(() => {
    if (!adding) {
      return undefined
    }
    const limit = setTimeout(() => {
      setState((current) => (current.status === 'adding' ? { status: 'failed' } : current))
    }, ADD_LIMIT_MS)
    return () => clearTimeout(limit)
  }, [adding, run])

  const addStatus = statuses?.addAccounts
  useEffect(() => {
    if (dispatched.current === null || listed) {
      return
    }
    if (addStatus === 'LOADING') {
      sawLoading.current = true
    }
    if (addStatus === 'ERROR' && sawLoading.current) {
      setState((current) => (current.status === 'adding' ? { status: 'failed' } : current))
    }
  }, [addStatus, listed])

  useEffect(() => {
    if (state.status === 'done' && enabled && !completed.current) {
      completed.current = true
      dispatch({ type: 'SET_IS_SETUP_COMPLETE', params: { isSetupComplete: true } })
    }
  }, [state.status, enabled, dispatch])

  const retry = useCallback(() => setRun((n) => n + 1), [])

  return { state, retry }
}

export default useRecoveredAccountAdd
