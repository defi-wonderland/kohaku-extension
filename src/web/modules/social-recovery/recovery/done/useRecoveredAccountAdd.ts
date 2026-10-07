/**
 * The add of the recovered account to this wallet, on both routes, through
 * the wallet's own action for an account the screen builds, with the key the
 * recovery granted as its signer. It dispatches once per run, once the
 * consume event names the granted key and the wallet pushed its accounts; it
 * reads done once the wallet lists the account with that key, and failed
 * where the accounts controller reports an error after the add started, or
 * where the account is not listed with the key within the limit. Where the
 * wallet already runs an add when the hook mounts, as after a remount during
 * the first add, the first run dispatches nothing and follows that add the
 * same way. A remount dispatches once more where the wallet does not yet run
 * the add: while the first mount still builds the account, after its dispatch
 * and before the wallet reports the add running, or after the add ended and
 * before the wallet lists the account; the wallet merges that add into the
 * listed account. A retry runs the add again. An account the wallet already lists
 * with the key is done with no dispatch; one it lists without the key is
 * added again, and the wallet merges the key into it. Where the add may not
 * dispatch, it reads done only once the wallet lists the account with the
 * key, and adds nothing. On the fast track, once done, it marks the wallet's
 * setup complete, as the end of the create door's onboarding does, since the
 * fast track never reaches that screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import useAccountsControllerState from '@web/hooks/useAccountsControllerState'
import useBackgroundService from '@web/hooks/useBackgroundService'

import { listsWithKey, recoveredAccountOf } from './account'
import { ADD_LIMIT_MS } from './constants'
import type { AddHook, AddInput, AddState, CreationBasis } from './types'

const useRecoveredAccountAdd = ({
  completesSetup,
  dispatches,
  account,
  event
}: AddInput): AddHook => {
  const { dispatch } = useBackgroundService()
  const { accounts, statuses } = useAccountsControllerState()
  const [run, setRun] = useState(0)
  const [state, setState] = useState<AddState>({ status: 'adding' })
  // An add the wallet already runs at mount, as one an earlier mount of this screen sent: followed, not sent again.
  const [followsRunning] = useState(() => statuses?.addAccounts === 'LOADING')
  const dispatched = useRef<number | null>(followsRunning ? 0 : null)
  const creation = useRef<CreationBasis | undefined>(undefined)
  const completed = useRef(false)

  const granted = event?.granted
  const listed = !!granted && listsWithKey(accounts, account, granted)
  const accountsRef = useRef(accounts)
  accountsRef.current = accounts
  const accountsReady = !!accounts

  useEffect(() => {
    if (listed) {
      setState({ status: 'done', ...(creation.current ? { creation: creation.current } : {}) })
    }
  }, [listed])

  useEffect(() => {
    const existing = accountsRef.current
    // The wallet's accounts can go and come back while one add runs: that run is not sent again.
    if (!dispatches || listed || !event || !existing || dispatched.current === run) {
      return undefined
    }
    dispatched.current = run
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
  }, [dispatches, listed, event, run, account, dispatch, accountsReady])

  const adding = dispatches && state.status === 'adding' && !listed
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
    if (!dispatches || dispatched.current === null || listed) {
      return
    }
    if (addStatus === 'ERROR') {
      setState((current) => (current.status === 'adding' ? { status: 'failed' } : current))
    }
  }, [addStatus, listed, dispatches])

  useEffect(() => {
    if (state.status === 'done' && completesSetup && !completed.current) {
      completed.current = true
      dispatch({ type: 'SET_IS_SETUP_COMPLETE', params: { isSetupComplete: true } })
    }
  }, [state.status, completesSetup, dispatch])

  const retry = useCallback(() => setRun((n) => n + 1), [])

  return { state, retry }
}

export default useRecoveredAccountAdd
