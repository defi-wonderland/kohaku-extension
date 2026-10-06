/**
 * The key step's work, as the create door does it, kept inside the fast
 * track:
 *
 * 1. A new recovery phrase, made on this device and handed to the keystore as
 *    its temporary seed; the keystore sends it back, and the words show only
 *    once the phrase it holds is the one made here. Every mount makes its own
 *    phrase, so no phrase left over from another flow is shown as this key.
 * 2. The key that will control the account, derived from that phrase through
 *    the library's key iterator at the slot's index plus the smart-account
 *    offset.
 * 3. On `add`, the wallet's picker opens on the phrase with the slot's smart
 *    account selected, and adds the slot's basic account and smart account
 *    with both keys (its own automatic add of the next slot).
 * 4. The step reads `listed` once the wallet lists both accounts, the smart
 *    account's key agrees with the derived one, the keystore holds both keys
 *    and the wallet has selected an account.
 *
 * A phrase the keystore did not confirm within the limit reads as failed,
 * with retry; while it waits, a tab shown again hands the phrase over once
 * more. An add reads as failed only once the picker is idle again and added
 * nothing, so nothing was saved; a retry keeps the phrase the holder wrote
 * down, and a success that lands after a failure still lists the slot.
 *
 * A mount that finds the picker still adding accounts (an earlier mount's add,
 * left through Back) makes no phrase and sends no add: a new phrase would
 * take the keystore's place of the one that add is saving. It waits for that
 * add to end; once the wallet lists the accounts, the step goes on as a
 * wallet that already lists accounts does. Where that add fails, the step
 * reads as failed, and its retry makes a new phrase, since nothing was saved.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { BIP44_STANDARD_DERIVATION_TEMPLATE } from '@ambire-common/consts/derivation'
import { EntropyGenerator } from '@ambire-common/libs/entropyGenerator/entropyGenerator'
import useExtraEntropy from '@common/hooks/useExtraEntropy'
import { AUTH_STATUS } from '@common/modules/auth/constants/authStatus'
import useAuth from '@common/modules/auth/hooks/useAuth'
import eventBus from '@web/extension-services/event/eventBus'
import useAccountPickerControllerState from '@web/hooks/useAccountPickerControllerState'
import useAccountsControllerState from '@web/hooks/useAccountsControllerState'
import useBackgroundService from '@web/hooks/useBackgroundService'
import useKeystoreControllerState from '@web/hooks/useKeystoreControllerState'

import { KEY_STEP_LIMIT_MS, RECOVERY_PHRASE_WORDS } from './constants'
import { listedSlotOf, slotKeysOf, tempSeedOf } from './derivation'
import type {
  AddProgress,
  FastTrackKey,
  KeyStepPhase,
  MadePhrase,
  SlotKeys,
  TempSeed
} from './types'

const useFastTrackKey = (): FastTrackKey => {
  const { dispatch } = useBackgroundService()
  const { keys } = useKeystoreControllerState()
  const { accounts } = useAccountsControllerState()
  const picker = useAccountPickerControllerState()
  const { authStatus } = useAuth()
  const { getExtraEntropy } = useExtraEntropy()

  // Whether an add the picker ran before this mount still runs.
  const [waiting, setWaiting] = useState(picker.addAccountsStatus === 'LOADING')
  const [seedRun, setSeedRun] = useState(0)
  const [seed, setSeed] = useState<TempSeed | null>(null)
  const [slotKeys, setSlotKeys] = useState<SlotKeys | null>(null)
  const [phase, setPhase] = useState<KeyStepPhase>(waiting ? 'adding' : 'creating')
  const made = useRef<MadePhrase | null>(null)
  // What the picker went through since the last add started.
  const seen = useRef<AddProgress>({ started: waiting, loading: waiting, success: false })

  // 1. Make the phrase and hand it to the keystore, once per run.
  useEffect(() => {
    if (waiting || made.current?.run === seedRun) {
      return
    }
    const { phrase } = new EntropyGenerator().generateRandomMnemonic(
      RECOVERY_PHRASE_WORDS,
      getExtraEntropy()
    )
    made.current = { run: seedRun, phrase }
    setSeed(null)
    setSlotKeys(null)
    setPhase('creating')
    dispatch({
      type: 'KEYSTORE_CONTROLLER_ADD_TEMP_SEED',
      params: { seed: phrase, hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE }
    })
    dispatch({ type: 'KEYSTORE_CONTROLLER_SEND_TEMP_SEED_TO_UI' })
  }, [waiting, seedRun, dispatch, getExtraEntropy])

  useEffect(() => {
    if (phase !== 'creating') {
      return undefined
    }
    const limit = setTimeout(
      () => setPhase((current) => (current === 'creating' ? 'createFailed' : current)),
      KEY_STEP_LIMIT_MS
    )
    return () => clearTimeout(limit)
  }, [phase, seedRun])

  // A hidden tab drops what it dispatches: while the phrase is not
  // confirmed, a tab shown again hands it to the keystore once more.
  useEffect(() => {
    if (phase !== 'creating') {
      return undefined
    }
    const onVisible = () => {
      const current = made.current
      if (document.visibilityState !== 'visible' || !current) {
        return
      }
      dispatch({
        type: 'KEYSTORE_CONTROLLER_ADD_TEMP_SEED',
        params: { seed: current.phrase, hdPathTemplate: BIP44_STANDARD_DERIVATION_TEMPLATE }
      })
      dispatch({ type: 'KEYSTORE_CONTROLLER_SEND_TEMP_SEED_TO_UI' })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [phase, dispatch])

  // The keystore sends the phrase it holds; only the one made here counts.
  useEffect(() => {
    const onOneTimeData = (data: unknown) => {
      const received = tempSeedOf(data)
      if (received && made.current && received.seed === made.current.phrase) {
        setSeed(received)
      }
    }
    eventBus.addEventListener('receiveOneTimeData', onOneTimeData)
    return () => eventBus.removeEventListener('receiveOneTimeData', onOneTimeData)
  }, [])

  // 2. Derive the slot's keys from the confirmed phrase.
  useEffect(() => {
    if (!seed) {
      return undefined
    }
    let live = true
    slotKeysOf(seed)
      .then((derived) => {
        if (live) {
          setSlotKeys(derived)
          setPhase((current) => (current === 'creating' ? 'words' : current))
        }
      })
      .catch(() => {
        if (live) {
          setPhase('createFailed')
        }
      })
    return () => {
      live = false
    }
  }, [seed])

  const listed = slotKeys && accounts ? listedSlotOf(slotKeys, accounts, keys ?? []) : null
  const selected = authStatus === AUTH_STATUS.AUTHENTICATED
  const listedAndSelected = !!listed && selected

  const { addAccountsStatus, selectNextAccountStatus, pageError } = picker
  // A page error ends the picker's selection where it stood, so a selection
  // still marked loading beside one is not running any more.
  const pickerBusy =
    addAccountsStatus === 'LOADING' || (selectNextAccountStatus === 'LOADING' && !pageError)
  const [limitReached, setLimitReached] = useState(false)

  // 3. Open the picker on the phrase; its init selects the slot's basic
  // account with its smart account and adds them. Nothing goes out where the
  // slot is already listed, or while the picker still runs an add.
  const add = useCallback(() => {
    if (!seed || (phase !== 'words' && phase !== 'addFailed')) {
      return
    }
    if (listed) {
      setPhase('listed')
      return
    }
    setLimitReached(false)
    setPhase('adding')
    if (pickerBusy) {
      return
    }
    seen.current = { started: false, loading: false, success: false }
    dispatch({
      type: 'MAIN_CONTROLLER_ACCOUNT_PICKER_INIT_PRIVATE_KEY_OR_SEED_PHRASE',
      params: {
        privKeyOrSeed: seed.seed,
        seedPassphrase: seed.seedPassphrase,
        hdPathTemplate: seed.hdPathTemplate,
        shouldSelectSmartAccountAutomatically: true
      }
    })
    dispatch({ type: 'MAIN_CONTROLLER_ACCOUNT_PICKER_INIT' })
  }, [seed, phase, listed, pickerBusy, dispatch])

  // 4. Follow the add until the slot is listed, or the picker is idle again
  // having added nothing. A late success after a failure still lists the slot.
  useEffect(() => {
    if (phase !== 'adding' && phase !== 'addFailed') {
      return
    }
    if (listedAndSelected) {
      setPhase('listed')
      return
    }
    if (phase !== 'adding') {
      return
    }
    const run = seen.current
    if (selectNextAccountStatus === 'LOADING' || addAccountsStatus === 'LOADING') {
      run.started = true
    }
    if (addAccountsStatus === 'LOADING') {
      run.loading = true
    }
    if (addAccountsStatus === 'SUCCESS') {
      run.success = true
    }
    if (pickerBusy || run.success) {
      return
    }
    // The picker reports a failed add by going back to idle without success,
    // and a failed derivation of its page through its page error. Past the
    // limit, an idle picker that added nothing reads as failed too.
    const addFailed = run.loading && addAccountsStatus === 'INITIAL'
    if (addFailed || (run.started && !!pageError) || limitReached) {
      setPhase('addFailed')
    }
  }, [
    phase,
    listedAndSelected,
    addAccountsStatus,
    selectNextAccountStatus,
    pageError,
    pickerBusy,
    limitReached
  ])

  useEffect(() => {
    if (phase !== 'adding') {
      return undefined
    }
    const limit = setTimeout(() => setLimitReached(true), KEY_STEP_LIMIT_MS)
    return () => clearTimeout(limit)
  }, [phase])

  const retry = useCallback(() => {
    if (phase === 'createFailed') {
      setSeedRun((run) => run + 1)
    } else if (phase === 'addFailed' && waiting) {
      setWaiting(false)
    } else if (phase === 'addFailed') {
      add()
    }
  }, [phase, waiting, add])

  return {
    phase,
    words: seed && slotKeys ? seed.seed.split(' ') : [],
    controllingKey: slotKeys?.controllingKey ?? null,
    listed: listedAndSelected ? listed : null,
    listedByEarlierAdd: waiting && !!accounts?.length && selected,
    pending: phase === 'adding' && limitReached,
    add,
    retry
  }
}

export default useFastTrackKey
