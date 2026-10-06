/**
 * The wait's route: the account from the search, its recovery entry record
 * for the route and the receiving account, the countdown's record, the chrome
 * by route, and the wait with the page's own helpers: the recovery client of
 * the account being recovered, the handover's two keys, the setup this device
 * holds, the sending key by route and the send port over the request queue.
 * A search with no account, or an account with no entry record, goes back to
 * the account step. No countdown: a live or wiped session goes to the
 * checklist, none to the route's entry. A consumed attempt goes on to the
 * done screen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Linking, View } from 'react-native'
import { useLocation } from 'react-router-dom'

import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import { useTranslation } from '@common/config/localization'
import useNavigation from '@common/hooks/useNavigation'
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import spacings from '@common/styles/spacings'
import useAccountsControllerState from '@web/hooks/useAccountsControllerState'
import useBackgroundService from '@web/hooks/useBackgroundService'
import useKeystoreControllerState from '@web/hooks/useKeystoreControllerState'
import useRequestsControllerState from '@web/hooks/useRequestsControllerState'
import type { Configuration, Hex } from '@web/modules/social-recovery/sdk-interfaces'
import SetupChrome from '@web/modules/social-recovery/shared/chrome/SetupChrome'
import {
  CHAIN_IDS,
  createSendPort,
  sendRequestPort,
  WALLET_RECOVERY_CHAIN
} from '@web/modules/social-recovery/shared/client'
import type { HeldRequestQueue, ListedAccount } from '@web/modules/social-recovery/shared/client'
import { useAccountFacts } from '@web/modules/social-recovery/shared/client/useAccountFacts'
import { useRecoveryClient } from '@web/modules/social-recovery/shared/client/useRecoveryClient'
import {
  createWalletRecords,
  extensionRecordStorage,
  readRecoveryPassword
} from '@web/modules/social-recovery/shared/records'
import {
  accountStepPath,
  checklistPathOf,
  configurationOf,
  destinationKeyOf,
  parseChecklistSearch,
  routeEntryPathOf
} from '@web/modules/social-recovery/recovery/checklist'
import { fastTrackSendingKeyOf, loggedInPlanOf } from '@web/modules/social-recovery/recovery/submit'
import type { SendingReading } from '@web/modules/social-recovery/recovery/submit'
import { explorerTransactionUrlOf } from '@web/modules/social-recovery/setup/arm'

import { anchorOf, donePathOf } from './phase'
import { executeStepsOf } from './steps'
import type {
  CountdownReading,
  ExecuteSteps,
  HandoverKeysReading,
  LeaveState,
  RemovedKeyReading,
  WaitBodyProps,
  WaitClient,
  WaitEntryReading,
  WaitGateProps
} from './types'
import useCountdownClock from './useCountdownClock'
import useExecuteRun from './useExecuteRun'
import useWaitPoll from './useWaitPoll'
import WaitChrome from './WaitChrome'
import WaitView from './WaitView'

const CHAIN_ID = CHAIN_IDS[WALLET_RECOVERY_CHAIN]

const WaitBody = ({ records, account, entry, revision, savedAt }: WaitBodyProps) => {
  const { navigate } = useNavigation()
  const { accounts } = useAccountsControllerState()
  const { keys: keystoreKeys } = useKeystoreControllerState()
  const { dispatch, windowId } = useBackgroundService()
  const queue = useRequestsControllerState()
  const clientState = useRecoveryClient(account)
  const facts = useAccountFacts(entry.receivingAccount)
  const ownFacts = useAccountFacts(account)
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  const kit = clientState.status === 'ready' ? clientState.client : null
  const chainReads = clientState.status === 'ready' ? clientState.reads : null
  const receipts = clientState.status === 'ready' ? clientState.receipts : null
  const client = useMemo<WaitClient>(() => {
    if (kit && chainReads && receipts) {
      return { status: 'ready', client: kit, reads: chainReads, receipts }
    }
    if (clientState.status === 'update-the-wallet') {
      return { status: 'update-the-wallet' }
    }
    if (clientState.status === 'failed') {
      return { status: 'failed' }
    }
    return { status: 'loading' }
  }, [kit, chainReads, receipts, clientState.status])

  // The key the recovery removes, as this wallet read it once for this page.
  const [removed, setRemoved] = useState<RemovedKeyReading>({ status: 'loading' })
  const [removedAttempt, setRemovedAttempt] = useState(0)
  useEffect(() => {
    if (!kit) {
      return undefined
    }
    let live = true
    setRemoved({ status: 'loading' })
    kit.walletReads
      .removedKey()
      .then((reading) => {
        if (live) {
          setRemoved({ status: 'named', key: reading.kind === 'named' ? reading.key : null })
        }
      })
      .catch(() => {
        if (live) {
          setRemoved({ status: 'failed' })
        }
      })
    return () => {
      live = false
    }
  }, [kit, removedAttempt])

  const receivingFacts = facts.status === 'ready' ? facts.facts : null
  const newKey = receivingFacts ? destinationKeyOf(receivingFacts) : null
  const keys = useMemo<HandoverKeysReading>(() => {
    if (removed.status === 'failed' || facts.status === 'unavailable') {
      return { status: 'failed' }
    }
    if (removed.status !== 'named' || facts.status === 'loading') {
      return { status: 'loading' }
    }
    if (!newKey) {
      return { status: 'failed' }
    }
    return { status: 'ready', keys: { newKey, removedKey: removed.key } }
  }, [removed, facts.status, newKey])
  const handover = keys.status === 'ready' ? keys.keys : null

  // The setup this device holds, for the path line and the cancel's threshold.
  const [configuration, setConfiguration] = useState<Configuration | null>(null)
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

  const { poll, retry: retryPoll } = useWaitPoll({
    kit,
    keys: handover,
    visibility: document
  })
  const answered = poll.status === 'answered' ? poll : null
  const anchor = useMemo(() => (answered ? anchorOf(answered) : null), [answered])
  const remainingMs = useCountdownClock(anchor)

  // The countdown that reaches its end asks the chain at once, so execution due needs no wait for the period.
  const dueAsked = useRef<number | null>(null)
  useEffect(() => {
    if (
      answered?.phase.kind === 'waiting' &&
      remainingMs !== null &&
      remainingMs <= 0 &&
      dueAsked.current !== answered.round
    ) {
      dueAsked.current = answered.round
      retryPoll()
    }
  }, [answered, remainingMs, retryPoll])

  const sending = useMemo<SendingReading>(() => {
    if (facts.status === 'loading') {
      return { status: 'loading' }
    }
    if (!receivingFacts) {
      return { status: 'unavailable' }
    }
    const network = {
      name: receivingFacts.network.name,
      nativeAssetSymbol: receivingFacts.network.nativeAssetSymbol
    }
    if (entry.route === 'logged-in') {
      const plan = loggedInPlanOf(receivingFacts)
      return plan ? { status: 'ready', plan, network } : { status: 'unavailable' }
    }
    if (!accounts || !keystoreKeys) {
      return { status: 'loading' }
    }
    const key = fastTrackSendingKeyOf(entry.receivingAccount, accounts, keystoreKeys)
    return key
      ? { status: 'ready', plan: { kind: 'key', key: { addr: key, type: 'internal' } }, network }
      : { status: 'unavailable' }
  }, [facts.status, receivingFacts, entry, accounts, keystoreKeys])

  const accountsRef = useRef<readonly ListedAccount[] | undefined>(accounts)
  accountsRef.current = accounts
  const queueRef = useRef<HeldRequestQueue | undefined>(queue)
  queueRef.current = queue
  const requests = useMemo(
    () =>
      sendRequestPort(
        dispatch,
        () => accountsRef.current,
        () => queueRef.current,
        windowId
      ),
    [dispatch, windowId]
  )
  const port = useMemo(
    () => createSendPort(requests, { chainId: CHAIN_ID, visibility: document }),
    [requests]
  )

  const due = answered?.phase.kind === 'executionDue' ? answered.phase.attempt : null
  const payload = answered?.story.started?.payload ?? null
  const plan = sending.status === 'ready' ? sending.plan : null
  const network = sending.status === 'ready' ? sending.network : null
  const now = useCallback(() => Date.now(), [])
  const steps = useMemo<ExecuteSteps | null>(() => {
    if (!kit || !chainReads || !receipts || !due || !payload || !plan || !network) {
      return null
    }
    return executeStepsOf({
      client: kit,
      reads: chainReads,
      receipts,
      port,
      plan,
      network,
      attempt: due,
      payload,
      now
    })
  }, [kit, chainReads, receipts, due, payload, plan, network, port, now])
  const run = useExecuteRun(steps, `${CHAIN_ID}:${account.toLowerCase()}`)

  // A landed execution is read back at once; a send the attempt read still disagrees with is checked for a drop.
  const writeStatus = run.state.write.status
  useEffect(() => {
    if (writeStatus === 'landed') {
      retryPoll()
    }
  }, [writeStatus, retryPoll])
  const { checkDropped } = run
  useEffect(() => {
    if (answered && answered.phase.kind !== 'consumed' && writeStatus === 'submitting') {
      checkDropped()
    }
  }, [answered, writeStatus, checkDropped])

  const consumed = answered?.phase.kind === 'consumed'
  useEffect(() => {
    if (consumed) {
      navigate(donePathOf(account), { replace: true })
    }
  }, [consumed, navigate, account])

  const [leave, setLeave] = useState<LeaveState>('idle')
  const onLeave = useCallback(() => {
    setLeave('leaving')
    records
      .endCountdown(CHAIN_ID, account, revision)
      .then(() => records.recoveryEntry(CHAIN_ID, account).clear())
      .then(() => navigate(routeEntryPathOf(entry.route), { replace: true }))
      .catch(() => setLeave('failed'))
  }, [records, account, revision, navigate, entry.route])

  const holdsAccountKey = ownFacts.status === 'ready' && !!ownFacts.facts.key
  const onMoveFunds = useCallback(() => {
    if (holdsAccountKey) {
      navigate(`/${WEB_ROUTES.transfer}`)
    }
  }, [holdsAccountKey, navigate])

  const chain = kit?.chain
  const onOpenExplorer = useCallback(
    (transactionHash: Hex) => {
      if (chain) {
        Linking.openURL(explorerTransactionUrlOf(chain, transactionHash)).catch(() => undefined)
      }
    },
    [chain]
  )

  const retryClient = useCallback(() => {
    if (clientState.status === 'failed' || clientState.status === 'update-the-wallet') {
      clientState.retry()
    }
  }, [clientState])
  const retryKeys = useCallback(() => {
    facts.retry()
    setRemovedAttempt((n) => n + 1)
  }, [facts])

  return (
    <WaitView
      account={account}
      client={client}
      keys={keys}
      poll={poll}
      remainingMs={remainingMs}
      startedAt={savedAt}
      timeZone={timeZone}
      configuration={configuration}
      execute={run.state}
      sending={sending}
      holdsAccountKey={holdsAccountKey}
      leave={leave}
      onExecute={run.start}
      onRetryPoll={retryPoll}
      onRetryKeys={retryKeys}
      onRetryClient={retryClient}
      onRetrySending={facts.retry}
      onLeave={onLeave}
      onMoveFunds={onMoveFunds}
      onOpenExplorer={onOpenExplorer}
    />
  )
}

/** The countdown's record of the account, or where the holder goes without one. */
const WaitGate = ({ records, account, entry }: WaitGateProps) => {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const [reading, setReading] = useState<CountdownReading>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    setReading({ status: 'loading' })
    const read = async () => {
      const countdown = await records.countdown(CHAIN_ID, account).read()
      if (!live) {
        return
      }
      if (countdown.status === 'present') {
        setReading({ status: 'present', revision: countdown.revision, savedAt: countdown.savedAt })
        return
      }
      const session = await records.recoverySession(CHAIN_ID, account).read()
      if (!live) {
        return
      }
      navigate(
        session.status === 'present' ? checklistPathOf(account) : routeEntryPathOf(entry.route),
        { replace: true }
      )
    }
    read().catch(() => {
      if (live) {
        setReading({ status: 'failed' })
      }
    })
    return () => {
      live = false
    }
  }, [records, account, entry.route, navigate, attempt])

  if (reading.status === 'present') {
    return (
      <WaitBody
        records={records}
        account={account}
        entry={entry}
        revision={reading.revision}
        savedAt={reading.savedAt}
      />
    )
  }
  if (reading.status === 'failed') {
    return (
      <Alert
        testID="wait-countdown-failed"
        type="error"
        size="sm"
        title={t('socialRecovery.client.unavailableTitle')}
        text={t('socialRecovery.client.unavailableBody')}
      >
        <View style={spacings.mtTy}>
          <Button
            testID="wait-countdown-retry"
            type="secondary"
            size="small"
            text={t('socialRecovery.writes.tryAgain')}
            onPress={() => setAttempt((n) => n + 1)}
            hasBottomSpacing={false}
          />
        </View>
      </Alert>
    )
  }
  return <ActivityIndicator testID="wait-countdown-loading" />
}

const WaitScreen = () => {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const location = useLocation()
  const search = useMemo(() => parseChecklistSearch(location.search), [location.search])
  const records = useMemo(() => createWalletRecords({ storage: extensionRecordStorage }), [])
  const account = search?.account
  const [reading, setReading] = useState<WaitEntryReading>({ status: 'loading' })
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
        setReading({ status: 'present', entry: read.value })
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

  if (reading.status === 'present' && account) {
    return (
      <WaitChrome route={reading.entry.route} testID="wait-screen">
        <WaitGate key={account} records={records} account={account} entry={reading.entry} />
      </WaitChrome>
    )
  }

  return (
    <SetupChrome testID="wait-screen">
      {reading.status === 'failed' ? (
        <Alert
          testID="wait-entry-failed"
          type="error"
          size="sm"
          title={t('socialRecovery.client.unavailableTitle')}
          text={t('socialRecovery.client.unavailableBody')}
        >
          <View style={spacings.mtTy}>
            <Button
              testID="wait-entry-retry"
              type="secondary"
              size="small"
              text={t('socialRecovery.writes.tryAgain')}
              onPress={() => setAttempt((n) => n + 1)}
              hasBottomSpacing={false}
            />
          </View>
        </Alert>
      ) : (
        <ActivityIndicator testID="wait-entry-loading" />
      )}
    </SetupChrome>
  )
}

export default React.memo(WaitScreen)
