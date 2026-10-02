/**
 * The save's route: the settings chrome around the save of the selected
 * account's setup. It reads the account's facts, the recovery client, the
 * setup records and the recovery password in memory, runs the review's reads
 * and gate again, and builds the send port over the request queue. The save
 * starts by itself only where the review's Save pushed the route, once the
 * gate lets it run, and the push is then replaced so a later mount at the same
 * entry does not start again; a reload, a typed address, or back and forward
 * show the summary with the Save button instead. The wallet's sign screen is
 * the one confirmation.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { Linking } from 'react-native'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'

import useAccountsControllerState from '@web/hooks/useAccountsControllerState'
import useBackgroundService from '@web/hooks/useBackgroundService'
import useSelectedAccountControllerState from '@web/hooks/useSelectedAccountControllerState'
import {
  addressBookOf,
  auditedActionOf,
  createSendPort,
  recoveryChainOf,
  sendRequestPort,
  WALLET_RECOVERY_CHAIN
} from '@web/modules/social-recovery/shared/client'
import type {
  ListedAccount,
  PrivilegeHoldersReading
} from '@web/modules/social-recovery/shared/client'
import { useAccountFacts } from '@web/modules/social-recovery/shared/client/useAccountFacts'
import { useRecoveryClient } from '@web/modules/social-recovery/shared/client/useRecoveryClient'
import { readRecoveryPassword } from '@web/modules/social-recovery/shared/records'
import { levelOfBackup } from '@web/modules/social-recovery/setup/card'
import SettingsChrome from '@web/modules/social-recovery/setup/privacy/SettingsChrome'
import type { StepViewProps } from '@web/modules/social-recovery/setup/privacy/types'
import {
  accountReadsToRetry,
  methodsOf,
  saveGateOf,
  trustRowsOf
} from '@web/modules/social-recovery/setup/review'
import type { ReviewKitClient } from '@web/modules/social-recovery/setup/review'
import { useAccountReads } from '@web/modules/social-recovery/setup/review/useAccountReads'
import { useTrustReads } from '@web/modules/social-recovery/setup/review/useTrustReads'

import ArmView from './ArmView'
import { arrivalOf } from './arrival'
import { saveStepsOf } from './steps'
import type { SaveSteps } from './types'
import { useArmRun } from './useArmRun'
import { useSaveLoad } from './useSaveLoad'

// The save shows no other doors of the account, so it reads none.
const NO_DOORS_READ = async (): Promise<PrivilegeHoldersReading> => ({
  kind: 'unreadable',
  cause: 'not read on the save'
})

const ArmStep = ({ records, chainId, account, navigate }: StepViewProps) => {
  const { account: selected } = useSelectedAccountControllerState()
  const { accounts } = useAccountsControllerState()
  const { dispatch, windowId } = useBackgroundService()
  const facts = useAccountFacts(account)
  const clientState = useRecoveryClient(account)
  const { load, retry: retryLoad } = useSaveLoad(records, chainId, account)

  const kit = clientState.status === 'ready' ? clientState.client : null
  const chainReads = clientState.status === 'ready' ? clientState.reads : null
  const receipts = clientState.status === 'ready' ? clientState.receipts : null
  const readsClient = useMemo<ReviewKitClient | null>(
    () => (kit ? { ...kit, privilegeHolders: NO_DOORS_READ } : null),
    [kit]
  )
  const draft = load.status === 'loaded' ? load.draft : null
  const enrollments = useMemo(() => (load.status === 'loaded' ? load.enrollments : []), [load])

  const addressBook = useMemo(
    () => addressBookOf(recoveryChainOf(chainId) ?? WALLET_RECOVERY_CHAIN),
    [chainId]
  )
  const clauses = useMemo(() => draft?.clauses ?? [], [draft])
  const methods = useMemo(() => methodsOf(clauses, addressBook), [clauses, addressBook])
  const trust = useTrustReads(kit?.moduleReads ?? null, methods)
  const rows = useMemo(
    () =>
      trustRowsOf({
        clauses,
        enrollments,
        reads: trust.reads,
        shippedMethods: kit?.descriptor.shippedMethods ?? [],
        addressBook
      }),
    [clauses, enrollments, trust.reads, kit, addressBook]
  )
  const accountReads = useAccountReads(readsClient, draft)
  const gate = saveGateOf({
    recordsLoaded: load.status === 'loaded',
    clientReady: !!kit,
    trustRows: rows,
    removedKey: accountReads.removedKey,
    fitCheck: accountReads.fitCheck,
    setupState: accountReads.setupState,
    description: accountReads.description,
    // An untested method warns on the review and never blocks the save.
    untested: false,
    clauses,
    backup: draft?.privacy.backup ?? 'encrypted',
    passwordSet: load.status === 'loaded' && load.passwordSet
  })
  const password = readRecoveryPassword(chainId, account)
  const arrival = arrivalOf({
    facts,
    client: clientState.status,
    load,
    gate,
    setupState: accountReads.setupState,
    passwordHeld: password !== undefined
  })

  const accountsRef = useRef<readonly ListedAccount[] | undefined>(accounts)
  accountsRef.current = accounts
  const port = useMemo(
    () =>
      createSendPort(
        sendRequestPort(dispatch, () => accountsRef.current, windowId),
        { chainId }
      ),
    [dispatch, windowId, chainId]
  )

  const ready = facts.status === 'ready' ? facts.facts : null
  const steps = useMemo<SaveSteps | null>(() => {
    if (!kit || !chainReads || !receipts || !ready?.key || !draft) {
      return null
    }
    return saveStepsOf({
      client: kit,
      reads: chainReads,
      receipts,
      port,
      records,
      setup: records.setup(chainId, account),
      chainId,
      account,
      facts: ready,
      key: ready.key,
      draft,
      password
    })
  }, [kit, chainReads, receipts, ready, draft, port, records, chainId, account, password])

  const { state, start, recheck, reread, checkAgain } = useArmRun(
    steps,
    `${chainId}:${account.toLowerCase()}`
  )
  const navigationType = useNavigationType()
  const location = useLocation()
  const routerNavigate = useNavigate()
  const canStart = arrival.kind === 'ready' && steps !== null
  const untouched = state.write.status === 'idle' && state.write.run === 0
  const pushed = navigationType === 'PUSH'
  useEffect(() => {
    if (canStart && untouched && pushed) {
      start()
      routerNavigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: location.state }
      )
    }
  }, [canStart, untouched, pushed, start, routerNavigate, location])

  const retryReads = useCallback(() => {
    rows
      .filter(({ contract }) => contract.status === 'unavailable')
      .forEach(({ method }) => trust.retry(method))
    accountReads.retry(accountReadsToRetry(accountReads))
  }, [rows, trust, accountReads])

  const retryArrival = useCallback(() => {
    if (arrival.kind === 'load-failed') {
      retryLoad()
    } else if (arrival.kind === 'unavailable' && arrival.retry === 'facts') {
      facts.retry()
    } else if (arrival.kind === 'unavailable' && arrival.retry === 'client') {
      clientState.retry()
    }
  }, [arrival, retryLoad, facts, clientState])

  const openUrl = useCallback((url: string) => {
    Linking.openURL(url).catch(() => undefined)
  }, [])

  const removedKey =
    accountReads.removedKey.status === 'answered' && accountReads.removedKey.value.kind === 'named'
      ? accountReads.removedKey.value.key
      : undefined

  return (
    <ArmView
      arrival={arrival}
      state={state}
      account={{
        address: account,
        label: selected?.preferences?.label || undefined,
        removedKey,
        deployed: ready?.deployed
      }}
      action={kit ? auditedActionOf(kit.descriptor.action, kit.chain) : undefined}
      chain={kit?.chain ?? recoveryChainOf(chainId) ?? WALLET_RECOVERY_CHAIN}
      level={levelOfBackup(draft?.privacy.backup ?? 'encrypted')}
      onRetryReads={retryReads}
      onRetryArrival={retryArrival}
      onSave={canStart && untouched && !pushed ? start : undefined}
      onRetry={start}
      onCheckAgain={checkAgain}
      onRecheck={recheck}
      onReread={reread}
      navigate={navigate}
      openUrl={openUrl}
    />
  )
}

const ArmScreen = () => <SettingsChrome step={ArmStep} />

export default React.memo(ArmScreen)
