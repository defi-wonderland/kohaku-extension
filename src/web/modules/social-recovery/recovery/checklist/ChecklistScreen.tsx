/**
 * The checklist's route: the account from the search, its recovery entry
 * record for the route and the receiving account, the chrome by route, and
 * the checklist with the page's own helpers: the recovery client of the
 * account being recovered, the receiving account's controlling key, the
 * ceremony's report channel and this page's relying party. A search with no
 * account, or an account with no entry record, goes back to the account step.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { useLocation } from 'react-router-dom'
import { isAddressEqual } from 'viem'

import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import { useTranslation } from '@common/config/localization'
import useNavigation from '@common/hooks/useNavigation'
import spacings from '@common/styles/spacings'
import { relyingPartyOf } from '@web/modules/social-recovery/shared/ceremony'
import {
  browserReportStore,
  browserReportSubscribe,
  pagePasskeysServed
} from '@web/modules/social-recovery/shared/ceremony/screen'
import SetupChrome from '@web/modules/social-recovery/shared/chrome/SetupChrome'
import { CHAIN_IDS, WALLET_RECOVERY_CHAIN } from '@web/modules/social-recovery/shared/client'
import { useAccountFacts } from '@web/modules/social-recovery/shared/client/useAccountFacts'
import { useRecoveryClient } from '@web/modules/social-recovery/shared/client/useRecoveryClient'
import {
  createWalletRecords,
  extensionRecordStorage,
  newCeremonyRequestId,
  readRecoveryPassword,
  wipeRecoveryPassword
} from '@web/modules/social-recovery/shared/records'

import ChecklistChrome from './ChecklistChrome'
import ChecklistView from './ChecklistView'
import { destinationKeyOf } from './destination'
import { accountStepPath, parseChecklistSearch } from './search'
import type {
  ChecklistBodyProps,
  ChecklistClient,
  ChecklistDeps,
  DestinationReading,
  EntryReading
} from './types'

const CHAIN_ID = CHAIN_IDS[WALLET_RECOVERY_CHAIN]

const ChecklistBody = ({ records, account, entry, search }: ChecklistBodyProps) => {
  const { navigate } = useNavigation()
  const clientState = useRecoveryClient(account)
  const facts = useAccountFacts(entry.receivingAccount)

  const { status, retry } = clientState
  const kit = clientState.status === 'ready' ? clientState.client : null
  const client = useMemo<ChecklistClient>(() => {
    if (kit) {
      return { status: 'ready', client: kit }
    }
    if (status === 'loading') {
      return { status: 'loading' }
    }
    if (status === 'update-the-wallet') {
      return { status: 'update-the-wallet', retry }
    }
    return { status: 'failed', retry }
  }, [kit, status, retry])

  const factsRetry = facts.retry
  const key = facts.status === 'ready' ? destinationKeyOf(facts.facts) : undefined
  const destination = useMemo<DestinationReading>(() => {
    if (facts.status === 'loading') {
      return { status: 'loading' }
    }
    if (key) {
      return { status: 'ready', key }
    }
    return { status: 'unavailable', retry: factsRetry }
  }, [facts.status, key, factsRetry])

  const deps = useMemo<ChecklistDeps>(
    () => ({
      reportStore: browserReportStore,
      reportSubscribe: browserReportSubscribe,
      newRequestId: newCeremonyRequestId,
      now: Date.now,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      rpIdHash: relyingPartyOf(window.location).rpIdHash,
      passkeysServed: pagePasskeysServed(),
      readPassword: readRecoveryPassword,
      forgetPassword: wipeRecoveryPassword,
      visibility: document,
      storedEntries: async () => (await extensionRecordStorage.getAll?.()) ?? {}
    }),
    []
  )

  return (
    <ChecklistView
      records={records}
      chainId={CHAIN_ID}
      account={account}
      entry={entry}
      client={client}
      destination={destination}
      search={search}
      navigate={navigate}
      deps={deps}
    />
  )
}

const ChecklistScreen = () => {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const location = useLocation()
  const search = useMemo(() => parseChecklistSearch(location.search), [location.search])
  const records = useMemo(() => createWalletRecords({ storage: extensionRecordStorage }), [])
  const account = search?.account
  const [reading, setReading] = useState<EntryReading>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!account) {
      navigate(accountStepPath(), { replace: true })
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
        if (read.status === 'absent') {
          setReading({ status: 'absent' })
          navigate(accountStepPath(), { replace: true })
          return
        }
        setReading({ status: 'present', account, entry: read.value })
      })
      .catch(() => {
        if (live) {
          setReading({ status: 'failed' })
        }
      })
    return () => {
      live = false
    }
  }, [records, account, attempt, navigate])

  if (reading.status === 'present' && search && isAddressEqual(reading.account, search.account)) {
    return (
      <ChecklistChrome route={reading.entry.route} testID="checklist-screen">
        <ChecklistBody
          key={search.account}
          records={records}
          account={search.account}
          entry={reading.entry}
          search={search}
        />
      </ChecklistChrome>
    )
  }

  return (
    <SetupChrome testID="checklist-screen">
      {reading.status === 'failed' ? (
        <Alert
          testID="checklist-entry-failed"
          type="error"
          size="sm"
          title={t('socialRecovery.client.unavailableTitle')}
          text={t('socialRecovery.client.unavailableBody')}
        >
          <View style={spacings.mtTy}>
            <Button
              testID="checklist-entry-retry"
              type="secondary"
              size="small"
              text={t('socialRecovery.writes.tryAgain')}
              onPress={() => setAttempt((n) => n + 1)}
              hasBottomSpacing={false}
            />
          </View>
        </Alert>
      ) : (
        <ActivityIndicator testID="checklist-entry-loading" />
      )}
    </SetupChrome>
  )
}

export default React.memo(ChecklistScreen)
