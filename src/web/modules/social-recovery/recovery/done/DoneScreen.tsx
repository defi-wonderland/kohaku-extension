/**
 * The done screen's route: the account from the search, its recovery entry
 * record for the route and the receiving account, the chrome by route, and
 * the screen with its helpers: the recovery client of the recovered account
 * and the consume event read through it, the block time read on the
 * extension's own provider, the setup this device holds and the passkey kinds
 * its enrollments name, the add of the recovered account on the fast track,
 * and the last act.
 *
 * A search with no account goes to the account step. No entry record, as
 * after the last act: where the wallet lists the account the screen renders
 * from the consume event alone with no line by route, otherwise the account
 * step. A read that found no consume goes back to the wait. The last act ends
 * the countdown, clears the entry record and the recovery password held in
 * memory, and keeps the decrypted setup cache as this device's cache of the
 * setup.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { useLocation } from 'react-router-dom'
import { isAddressEqual } from 'viem'

import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import { useTranslation } from '@common/config/localization'
import useNavigation from '@common/hooks/useNavigation'
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import spacings from '@common/styles/spacings'
import useAccountsControllerState from '@web/hooks/useAccountsControllerState'
import useBackgroundService from '@web/hooks/useBackgroundService'
import useNetworksControllerState from '@web/hooks/useNetworksControllerState'
import type {
  Address,
  Configuration,
  Credential
} from '@web/modules/social-recovery/sdk-interfaces'
import {
  addressBookOf,
  CHAIN_IDS,
  createProviderAdapter,
  extensionProviderFor,
  networkOf,
  WALLET_RECOVERY_CHAIN
} from '@web/modules/social-recovery/shared/client'
import { useRecoveryClient } from '@web/modules/social-recovery/shared/client/useRecoveryClient'
import { renderShortAddress } from '@web/modules/social-recovery/shared/display'
import {
  createWalletRecords,
  extensionRecordStorage,
  readRecoveryPassword,
  wipeRecoveryPassword
} from '@web/modules/social-recovery/shared/records'
import type { Enrollment, PasskeyBackupKind } from '@web/modules/social-recovery/shared/records'
import {
  accountStepPath,
  configurationOf,
  parseChecklistSearch,
  waitPathOf
} from '@web/modules/social-recovery/recovery/checklist'
import { enrollmentOf } from '@web/modules/social-recovery/setup/review'

import DoneChrome from './DoneChrome'
import DoneView from './DoneView'
import { summaryOf } from './summary'
import type { BlockTimeRead, DoneBodyProps, DoneEntryReading, DoneRead, FinishState } from './types'
import useConsumeRead from './useConsumeRead'
import useRecoveredAccountAdd from './useRecoveredAccountAdd'

const CHAIN_ID = CHAIN_IDS[WALLET_RECOVERY_CHAIN]

const DoneBody = ({ records, account, entry }: DoneBodyProps) => {
  const { navigate } = useNavigation()
  const { dispatch } = useBackgroundService()
  const { accounts } = useAccountsControllerState()
  const { networks } = useNetworksControllerState()
  const clientState = useRecoveryClient(account)
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const addressBook = useMemo(() => addressBookOf(WALLET_RECOVERY_CHAIN), [])
  const route = entry?.route ?? null

  const kit = clientState.status === 'ready' ? clientState.client : null

  // A block's time by its number, on the extension's own provider for the recovery chain.
  const network = networkOf(networks, WALLET_RECOVERY_CHAIN)
  const networkRef = useRef(network)
  networkRef.current = network
  const hasNetwork = !!network
  const blockTime = useMemo<BlockTimeRead | null>(() => {
    if (!hasNetwork) {
      return null
    }
    return async (blockNumber: number) => {
      const current = networkRef.current
      if (!current) {
        throw new Error('The extension holds no network for the recovery chain.')
      }
      const provider = extensionProviderFor(current)
      try {
        return (await createProviderAdapter(provider).block(blockNumber)).timestamp
      } finally {
        provider.destroy()
      }
    }
  }, [hasNetwork])

  const { read: consumeRead, retry: retryRead } = useConsumeRead({ kit, blockTime })
  const event =
    consumeRead.status === 'answered' && consumeRead.reading.kind === 'found'
      ? consumeRead.reading.event
      : null

  const none = consumeRead.status === 'answered' && consumeRead.reading.kind === 'none'
  useEffect(() => {
    if (none) {
      navigate(waitPathOf(account), { replace: true })
    }
  }, [none, navigate, account])

  // The setup this device holds, and the passkey kinds its enrollments name.
  const [configuration, setConfiguration] = useState<Configuration | null | undefined>(undefined)
  useEffect(() => {
    if (!kit) {
      return undefined
    }
    let live = true
    configurationOf({
      records,
      chainId: CHAIN_ID,
      account,
      client: kit,
      password: readRecoveryPassword(CHAIN_ID, account)
    })
      .then((reading) => {
        if (live) {
          setConfiguration(reading.kind === 'configuration' ? reading.configuration : null)
        }
      })
      .catch(() => {
        if (live) {
          setConfiguration(null)
        }
      })
    return () => {
      live = false
    }
  }, [kit, records, account])

  const [enrollments, setEnrollments] = useState<readonly Enrollment[] | undefined>(undefined)
  useEffect(() => {
    let live = true
    records
      .setup(CHAIN_ID, account)
      .enrollments.read()
      .then((read) => {
        if (live) {
          setEnrollments(read.status === 'present' ? read.value : [])
        }
      })
      .catch(() => {
        if (live) {
          setEnrollments([])
        }
      })
    return () => {
      live = false
    }
  }, [records, account])

  const passkeyKindOf = useCallback(
    (credential: Credential): PasskeyBackupKind =>
      enrollmentOf(credential, enrollments ?? [])?.backup ?? 'synced',
    [enrollments]
  )
  const summary = useMemo(
    () =>
      event && configuration !== undefined && enrollments !== undefined
        ? summaryOf({ configuration, addressBook, event, passkeyKindOf })
        : null,
    [event, configuration, enrollments, addressBook, passkeyKindOf]
  )

  const { state: add, retry: retryAdd } = useRecoveredAccountAdd({
    enabled: route === 'fresh-install',
    account,
    event
  })

  const listedAccount = accounts?.find((candidate) =>
    isAddressEqual(candidate.addr as Address, account)
  )
  const receiving = entry?.receivingAccount
  const receivingAccount = receiving
    ? accounts?.find((candidate) => isAddressEqual(candidate.addr as Address, receiving))
    : undefined
  const receivingName = receiving
    ? receivingAccount?.preferences.label || renderShortAddress(receiving)
    : null

  const read = useMemo<DoneRead>(() => {
    if (clientState.status === 'failed' || clientState.status === 'update-the-wallet') {
      return { status: 'failed' }
    }
    return consumeRead
  }, [clientState.status, consumeRead])
  const onRetryRead = useCallback(() => {
    if (clientState.status === 'failed' || clientState.status === 'update-the-wallet') {
      clientState.retry()
      return
    }
    retryRead()
  }, [clientState, retryRead])

  const [finish, setFinish] = useState<FinishState>('idle')
  const lastAct = useCallback(async () => {
    const countdown = await records.countdown(CHAIN_ID, account).read()
    if (countdown.status === 'present') {
      await records.endCountdown(CHAIN_ID, account, countdown.revision)
    }
    await records.recoveryEntry(CHAIN_ID, account).clear()
    wipeRecoveryPassword(CHAIN_ID, account)
  }, [records, account])
  const leaveTo = useCallback(
    (next: () => void) => {
      setFinish('finishing')
      lastAct()
        .then(next)
        .catch(() => setFinish('failed'))
    },
    [lastAct]
  )
  const onClose = useCallback(
    () => leaveTo(() => navigate(`/${WEB_ROUTES.dashboard}`, { replace: true })),
    [leaveTo, navigate]
  )
  const isListed = !!listedAccount
  const onEdit = useCallback(
    () =>
      leaveTo(() => {
        if (isListed) {
          dispatch({ type: 'MAIN_CONTROLLER_SELECT_ACCOUNT', params: { accountAddr: account } })
          navigate(`/${WEB_ROUTES.socialRecoverySetupEditor}`)
          return
        }
        navigate(`/${WEB_ROUTES.socialRecoverySetup}`)
      }),
    [leaveTo, isListed, dispatch, navigate, account]
  )

  return (
    <DoneView
      account={account}
      accountName={listedAccount?.preferences.label || null}
      route={route}
      receivingName={receivingName}
      read={event && !summary ? { status: 'pending' } : read}
      add={add}
      summary={summary}
      timeZone={timeZone}
      finish={finish}
      onRetryRead={onRetryRead}
      onRetryAdd={retryAdd}
      onClose={onClose}
      onEdit={onEdit}
    />
  )
}

const DoneScreen = () => {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const location = useLocation()
  const { accounts } = useAccountsControllerState()
  const search = useMemo(() => parseChecklistSearch(location.search), [location.search])
  const records = useMemo(() => createWalletRecords({ storage: extensionRecordStorage }), [])
  const account = search?.account
  const [reading, setReading] = useState<DoneEntryReading>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const accountsRef = useRef(accounts)
  accountsRef.current = accounts
  const accountsReady = !!accounts

  useEffect(() => {
    if (!account) {
      navigate(accountStepPath(), { replace: true })
      return undefined
    }
    if (!accountsReady) {
      return undefined
    }
    let live = true
    setReading({ status: 'loading' })
    records
      .recoveryEntry(CHAIN_ID, account)
      .read()
      .then((read) => {
        if (!live) {
          return
        }
        if (read.status === 'present') {
          setReading({ status: 'present', entry: read.value })
          return
        }
        const listed = accountsRef.current?.some((candidate) =>
          isAddressEqual(candidate.addr as Address, account)
        )
        if (listed) {
          setReading({ status: 'present', entry: null })
          return
        }
        navigate(accountStepPath(), { replace: true })
      })
      .catch(() => {
        if (live) {
          setReading({ status: 'failed' })
        }
      })
    return () => {
      live = false
    }
  }, [records, account, accountsReady, attempt, navigate])

  if (reading.status === 'present' && account) {
    return (
      <DoneChrome route={reading.entry?.route ?? null} testID="done-screen">
        <DoneBody key={account} records={records} account={account} entry={reading.entry} />
      </DoneChrome>
    )
  }

  return (
    <DoneChrome route={null} testID="done-screen">
      {reading.status === 'failed' ? (
        <Alert
          testID="done-entry-failed"
          type="error"
          size="sm"
          title={t('socialRecovery.client.unavailableTitle')}
          text={t('socialRecovery.client.unavailableBody')}
        >
          <View style={spacings.mtTy}>
            <Button
              testID="done-entry-retry"
              type="secondary"
              size="small"
              text={t('socialRecovery.writes.tryAgain')}
              onPress={() => setAttempt((n) => n + 1)}
              hasBottomSpacing={false}
            />
          </View>
        </Alert>
      ) : (
        <ActivityIndicator testID="done-entry-loading" />
      )}
    </DoneChrome>
  )
}

export default React.memo(DoneScreen)
