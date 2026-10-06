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
 * A phrase the keystore did not confirm, or an add that failed or did not
 * land, within the limit reads as failed, with retry. A retry of the add
 * keeps the phrase the holder wrote down.
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
import type { FastTrackKey, KeyStepPhase, SlotKeys, TempSeed } from './types'

const useFastTrackKey = (): FastTrackKey => {
  const { dispatch } = useBackgroundService()
  const { keys } = useKeystoreControllerState()
  const { accounts } = useAccountsControllerState()
  const picker = useAccountPickerControllerState()
  const { authStatus } = useAuth()
  const { getExtraEntropy } = useExtraEntropy()

  const [seedRun, setSeedRun] = useState(0)
  const [seed, setSeed] = useState<TempSeed | null>(null)
  const [slotKeys, setSlotKeys] = useState<SlotKeys | null>(null)
  const [phase, setPhase] = useState<KeyStepPhase>('creating')
  const made = useRef<{ run: number; phrase: string } | null>(null)
  // What the picker went through since the last add started.
  const seen = useRef({ started: false, loading: false, success: false })

  // 1. Make the phrase and hand it to the keystore, once per run.
  useEffect(() => {
    if (made.current?.run === seedRun) {
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
  }, [seedRun, dispatch, getExtraEntropy])

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

  // 3. Open the picker on the phrase; its init selects the slot's basic
  // account with its smart account and adds them.
  const add = useCallback(() => {
    if (!seed || (phase !== 'words' && phase !== 'addFailed')) {
      return
    }
    seen.current = { started: false, loading: false, success: false }
    setPhase('adding')
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
  }, [seed, phase, dispatch])

  // 4. Follow the add until the slot is listed, or it failed.
  const { addAccountsStatus, selectNextAccountStatus, pageError } = picker
  useEffect(() => {
    if (phase !== 'adding') {
      return
    }
    if (listedAndSelected) {
      setPhase('listed')
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
    // The picker reports a failed add by going back to idle without success,
    // and a failed derivation of its page through its page error.
    const addFailed = run.loading && !run.success && addAccountsStatus === 'INITIAL'
    if (addFailed || (run.started && !!pageError)) {
      setPhase('addFailed')
    }
  }, [phase, listedAndSelected, addAccountsStatus, selectNextAccountStatus, pageError])

  useEffect(() => {
    if (phase !== 'adding') {
      return undefined
    }
    const limit = setTimeout(
      () => setPhase((current) => (current === 'adding' ? 'addFailed' : current)),
      KEY_STEP_LIMIT_MS
    )
    return () => clearTimeout(limit)
  }, [phase])

  const retry = useCallback(() => {
    if (phase === 'createFailed') {
      setSeedRun((run) => run + 1)
    } else if (phase === 'addFailed') {
      add()
    }
  }, [phase, add])

  return {
    phase,
    words: seed && slotKeys ? seed.seed.split(' ') : [],
    controllingKey: slotKeys?.controllingKey ?? null,
    listed: listedAndSelected ? listed : null,
    add,
    retry
  }
}

export default useFastTrackKey
