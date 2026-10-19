/**
 * The overview's own confirmation step for one of its writes, run as the save
 * runs: the re-authorize reads the committed level, asks the recovery
 * password where the level hides the setup and this tab holds none, shows the
 * trust list and keeps its action disabled until every party has rendered;
 * the clear carries its title and line, and the sentence that clearing ends
 * the recovery in progress while one is open; the removal of the
 * authorization runs from the warning's own action. The wallet's sign screen
 * is the one confirmation. The step shows the shared submitting and failed
 * states, and hands the overview back its chain read once the run ended where
 * the read decides, so the write never reads as done on this step's word.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Linking, View } from 'react-native'

import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import useAccountsControllerState from '@web/hooks/useAccountsControllerState'
import useBackgroundService from '@web/hooks/useBackgroundService'
import useRequestsControllerState from '@web/hooks/useRequestsControllerState'
import useSelectedAccountControllerState from '@web/hooks/useSelectedAccountControllerState'
import { readSetupReading } from '@web/modules/social-recovery/recovery/entry/readout'
import { ActionsRow, PageTitle, SectionCard } from '@web/modules/social-recovery/shared/chrome'
import ReadFailedBlock from '@web/modules/social-recovery/shared/chrome/ReadFailedBlock'
import {
  addressBookOf,
  createSendPort,
  sendRequestPort
} from '@web/modules/social-recovery/shared/client'
import type { HeldRequestQueue, ListedAccount } from '@web/modules/social-recovery/shared/client'
import { useAccountFacts } from '@web/modules/social-recovery/shared/client/useAccountFacts'
import { readRecoveryPassword } from '@web/modules/social-recovery/shared/records'
import { mayStillLand, renderDepositStep } from '@web/modules/social-recovery/shared/writes'
import DepositStepView from '@web/modules/social-recovery/shared/writes/components/DepositStepView'
import WriteStateView from '@web/modules/social-recovery/shared/writes/components/WriteStateView'
import { armScreenOf } from '@web/modules/social-recovery/setup/arm'
import DisagreedView from '@web/modules/social-recovery/setup/arm/DisagreedView'
import { useArmRun } from '@web/modules/social-recovery/setup/arm/useArmRun'
import {
  methodsOf,
  trustReadsComplete,
  trustRowsOf
} from '@web/modules/social-recovery/setup/review'
import TrustList from '@web/modules/social-recovery/setup/review/TrustList'
import { useTrustReads } from '@web/modules/social-recovery/setup/review/useTrustReads'

import { OVERVIEW, REMOVAL_DRAFT } from './constants'
import { overviewWriteKeysOf } from './copy'
import PathLockedAsk from './PathLockedAsk'
import { levelOfReading, needsPassword, reauthorizeDraftOf } from './readings'
import type { LevelRead, OverviewIntent, OverviewWriteStepProps, StepHeadings } from './types'
import { overviewStepsOf } from './writeSteps'

const HEADINGS: Record<OverviewIntent, StepHeadings> = {
  reauthorize: {
    title: `${OVERVIEW}.reauthorize.title`,
    lead: `${OVERVIEW}.reauthorize.lead`,
    action: `${OVERVIEW}.reauthorize.action`
  },
  clear: {
    title: `${OVERVIEW}.dormant.clearTitle`,
    lead: `${OVERVIEW}.dormant.clearBody`,
    action: `${OVERVIEW}.dormant.clear`
  },
  removeAuthorization: {
    title: `${OVERVIEW}.mirror.title`,
    lead: `${OVERVIEW}.mirror.body`,
    action: `${OVERVIEW}.mirror.action`
  }
}

const OverviewWriteStep = ({
  intent,
  client,
  chainReads,
  receipts,
  records,
  chainId,
  account,
  facts,
  reads,
  autoStart,
  onFinished,
  onClose,
  navigate
}: OverviewWriteStepProps) => {
  const { t } = useTranslation()
  const { accounts } = useAccountsControllerState()
  const { dispatch, windowId } = useBackgroundService()
  const queue = useRequestsControllerState()
  const { account: selectedAccount } = useSelectedAccountControllerState()
  const accountFacts = useAccountFacts(account)
  const reauthorize = intent === 'reauthorize'

  const accountsRef = useRef<readonly ListedAccount[] | undefined>(accounts)
  accountsRef.current = accounts
  const queueRef = useRef<HeldRequestQueue | undefined>(queue)
  queueRef.current = queue
  const selectedRef = useRef<string | undefined>(selectedAccount?.addr)
  selectedRef.current = selectedAccount?.addr
  const requests = useMemo(
    () =>
      sendRequestPort(
        dispatch,
        () => accountsRef.current,
        () => queueRef.current,
        () => selectedRef.current,
        windowId
      ),
    [dispatch, windowId]
  )
  // A withdrawal a hidden tab could not send is sent again once the tab is shown.
  const port = useMemo(
    () => createSendPort(requests, { chainId, visibility: document }),
    [requests, chainId]
  )

  // The re-authorize commits the setup at the level it was committed at.
  const [level, setLevel] = useState<LevelRead>({ status: 'pending' })
  const [levelRound, setLevelRound] = useState(0)
  useEffect(() => {
    if (!reauthorize) {
      return undefined
    }
    setLevel({ status: 'pending' })
    let live = true
    readSetupReading(client, facts.setup).then(
      (reading) => {
        if (!live) {
          return
        }
        const read = levelOfReading(reading)
        setLevel(read ? { status: 'answered', value: read } : { status: 'unreadable' })
      },
      () => {
        if (live) {
          setLevel({ status: 'failed' })
        }
      }
    )
    return () => {
      live = false
    }
  }, [reauthorize, client, facts.setup, levelRound])

  const configuration = reads.path.kind === 'readable' ? reads.path.configuration : null
  // The password lives in memory, outside React: a successful unlock moves the ask and renders again.
  const password = readRecoveryPassword(chainId, account)
  const passwordMissing =
    reauthorize &&
    level.status === 'answered' &&
    needsPassword(level.value) &&
    password === undefined
  const draft = useMemo(
    () =>
      reauthorize && configuration && level.status === 'answered'
        ? reauthorizeDraftOf(configuration, level.value)
        : null,
    [reauthorize, configuration, level]
  )

  const addressBook = useMemo(() => addressBookOf(client.chain), [client.chain])
  const clauses = useMemo(() => configuration?.clauses ?? [], [configuration])
  const methods = useMemo(
    () => (reauthorize ? methodsOf(clauses, addressBook) : []),
    [reauthorize, clauses, addressBook]
  )
  const trust = useTrustReads(reauthorize ? client.moduleReads : null, methods)
  const rows = useMemo(
    () =>
      trustRowsOf({
        clauses,
        enrollments: [],
        reads: trust.reads,
        shippedMethods: client.descriptor.shippedMethods,
        addressBook
      }),
    [clauses, trust.reads, client, addressBook]
  )

  // A re-authorize the wallet refused at its prepare, an attempt being open, hands back
  // once its run ended there, so the run is dropped with the step and none is kept.
  const [refusedAtPrepare, setRefusedAtPrepare] = useState(false)
  const onAttemptOpen = useCallback(() => setRefusedAtPrepare(true), [])

  const ready = accountFacts.status === 'ready' ? accountFacts.facts : null
  // The steps also follow a write stored on this device before the draft is known; a new
  // re-authorize starts only once its draft and its password are held.
  const steps = useMemo(() => {
    if (!ready?.key) {
      return null
    }
    return overviewStepsOf({
      intent,
      client,
      reads: chainReads,
      receipts,
      port,
      requests,
      records,
      chainId,
      account,
      facts: ready,
      key: ready.key,
      draft: draft ?? REMOVAL_DRAFT,
      password,
      onAttemptOpen
    })
  }, [
    onAttemptOpen,
    ready,
    intent,
    client,
    chainReads,
    receipts,
    port,
    requests,
    records,
    chainId,
    account,
    draft,
    password
  ])

  // The re-authorize commits through the save's own prepare and gas check; a removal is another setup write.
  const run = useArmRun(
    steps,
    `overview:${intent}:${chainId}:${account.toLowerCase()}`,
    reauthorize ? 'save' : 'ownerWrite'
  )
  const { state } = run
  const screen = armScreenOf(state)
  const { write } = state

  // A landed write whose check did not answer stays on its step with the check again.
  const finished =
    screen === 'saved' ||
    screen === 'already-set-up' ||
    (!reauthorize && screen === 'disagreed') ||
    (refusedAtPrepare && write.status === 'failedNotSent')
  useEffect(() => {
    if (finished) {
      onFinished()
    }
  }, [finished, onFinished])

  const canStart =
    steps !== null &&
    state.lookup === 'none' &&
    write.status === 'idle' &&
    !state.stop &&
    (!reauthorize || (!!draft && !passwordMissing && trustReadsComplete(rows)))

  const startWhenReady = useRef(autoStart)
  useEffect(() => {
    if (write.status !== 'idle') {
      startWhenReady.current = false
    } else if (canStart && startWhenReady.current) {
      startWhenReady.current = false
      run.start()
    }
  }, [canStart, write.status, run])

  const openUrl = useCallback((url: string) => {
    Linking.openURL(url).catch(() => undefined)
  }, [])

  const headings = HEADINGS[intent]
  const back = (
    <Button
      testID="overview-step-back"
      type="outline"
      text={t('socialRecovery.actions.back')}
      onPress={onClose}
      hasBottomSpacing={false}
    />
  )

  if (reauthorize && (screen === 'disagreed' || screen === 'unread')) {
    const landed = write.status === 'landed' || !!state.landedUnseen
    return landed ? (
      <DisagreedView
        transactionHash={write.status === 'landed' ? write.transactionHash : undefined}
        chain={client.chain}
        check={state.after.stage === 'disagreed' ? state.after.check : undefined}
        onReread={run.reread}
        navigate={navigate}
        openUrl={openUrl}
      />
    ) : null
  }

  const unavailable = () => {
    if (accountFacts.status === 'unavailable') {
      return (
        <ReadFailedBlock
          testID="overview-step-unavailable"
          title={t('socialRecovery.client.unavailableTitle')}
          body={
            accountFacts.cause === 'not-listed'
              ? t('socialRecovery.arm.notListed')
              : t('socialRecovery.client.unavailableBody')
          }
          onRetry={accountFacts.retry}
        />
      )
    }
    if (ready && !ready.key) {
      return (
        <Alert
          testID="overview-step-view-only"
          type="error"
          size="sm"
          style={spacings.mbSm}
          title={t('socialRecovery.client.unavailableTitle')}
          text={t('socialRecovery.arm.viewOnly')}
        />
      )
    }
    return null
  }

  const reauthorizeArrival = () => {
    if (reads.path.kind === 'locked') {
      return (
        <PathLockedAsk
          testID="overview-step-locked"
          ask={reads.ask}
          onUnlock={reads.unlock}
          onAskAgain={reads.askAgain}
          onRetry={reads.retryPath}
          bare
        />
      )
    }
    if (reads.path.kind === 'read-failed') {
      return (
        <ReadFailedBlock
          testID="overview-step-path-failed"
          title={t(`${OVERVIEW}.reads.failedTitle`)}
          body={t(`${OVERVIEW}.reads.failedBody`)}
          onRetry={reads.retryPath}
        />
      )
    }
    if (level.status === 'failed') {
      return (
        <ReadFailedBlock
          testID="overview-step-level-failed"
          title={t(`${OVERVIEW}.reads.failedTitle`)}
          body={t(`${OVERVIEW}.reads.failedBody`)}
          onRetry={() => setLevelRound((round) => round + 1)}
        />
      )
    }
    if (level.status === 'unreadable' || reads.path.kind === 'update-the-wallet') {
      return (
        <Alert
          testID="overview-step-update-the-wallet"
          type="error"
          size="sm"
          style={spacings.mbSm}
          title={t('socialRecovery.client.updateTheWalletTitle')}
          text={t('socialRecovery.client.updateTheWalletHow')}
        />
      )
    }
    if (!configuration || level.status === 'pending') {
      return <ActivityIndicator testID="overview-step-reading" style={spacings.mbSm} />
    }
    if (passwordMissing) {
      return (
        <PathLockedAsk
          testID="overview-step-password"
          ask={reads.ask}
          onUnlock={reads.unlock}
          onAskAgain={reads.askAgain}
          onRetry={reads.retryPath}
          bare
        />
      )
    }
    return <TrustList rows={rows} client={client} onRetry={(method) => trust.retry(method)} />
  }

  const startAction = (
    <Button
      testID="overview-step-start"
      type="primary"
      text={t(headings.action)}
      disabled={!canStart}
      onPress={run.start}
      hasBottomSpacing={false}
    />
  )

  const arrival = () => (
    <View>
      {reauthorize && reauthorizeArrival()}
      {intent === 'clear' && facts.attemptOpen && (
        <Text
          fontSize={14}
          weight="medium"
          style={spacings.mtSm}
          testID="overview-step-clear-cancels"
        >
          {t(`${OVERVIEW}.dormant.clearCancels`)}
        </Text>
      )}
      {state.lookup === 'reading' || (!steps && accountFacts.status === 'loading') ? (
        <ActivityIndicator testID="overview-step-lookup" style={spacings.mtSm} />
      ) : (
        <ActionsRow primary={startAction} secondary={back} />
      )}
      {state.lookup === 'failed' && (
        <ReadFailedBlock
          testID="overview-step-lookup-failed"
          title={t('socialRecovery.records.loadFailed')}
          onRetry={run.lookAgain}
        />
      )}
    </View>
  )

  const runBlock = () => {
    if (write.status === 'needsDeposit') {
      const rendered = renderDepositStep(write.step, {}, t)
      return (
        <SectionCard spacing="none">
          <DepositStepView step={write.step} variant="blocker" testID="overview-step-gas">
            {rendered.routes.map((route) => (
              <View key={route.kind} style={spacings.mbSm}>
                <Text fontSize={14} weight="medium">
                  {route.line}
                </Text>
                {!!route.note && (
                  <Text fontSize={12} appearance="secondaryText">
                    {route.note}
                  </Text>
                )}
              </View>
            ))}
            {rendered.notes.map((note) => (
              <Text key={note} fontSize={14} appearance="secondaryText" style={spacings.mbSm}>
                {note}
              </Text>
            ))}
            <Button
              testID="overview-step-gas-continue"
              type="primary"
              size="small"
              text={t('socialRecovery.actions.continue')}
              onPress={run.recheck}
              hasBottomSpacing={false}
              style={flexbox.alignSelfStart}
            />
          </DepositStepView>
        </SectionCard>
      )
    }
    if (state.dropped) {
      return (
        <SectionCard spacing="none" testID="overview-step-dropped">
          <Text fontSize={14} style={spacings.mbTy} testID="overview-step-dropped-line">
            {t(`${OVERVIEW}.writes.dropped`)}
          </Text>
          <Button
            testID="overview-step-send-again"
            type="secondary"
            size="small"
            text={t('socialRecovery.writes.tryAgain')}
            onPress={run.saveAgain}
            hasBottomSpacing={false}
            style={[flexbox.alignSelfStart, spacings.mtTy]}
          />
        </SectionCard>
      )
    }
    const checksAgain =
      write.status === 'submitting' &&
      ((!!write.transactionHash && !!state.stalled) ||
        (!write.transactionHash && state.follow === 'unread'))
    const keys = overviewWriteKeysOf(write)
    return (
      <SectionCard spacing="none">
        <WriteStateView
          state={write}
          body={keys.body ? [t(keys.body)] : undefined}
          onRetry={run.start}
          testID={`overview-step-${write.status}`}
        >
          {checksAgain && (
            <Button
              testID="overview-step-check-again"
              type="secondary"
              size="small"
              text={t('socialRecovery.arm.checkAgain')}
              onPress={run.checkAgain}
              hasBottomSpacing={false}
              style={[flexbox.alignSelfStart, spacings.mtTy]}
            />
          )}
          {mayStillLand(write) && (
            <Button
              testID="overview-step-check-chain"
              type="secondary"
              size="small"
              text={t('socialRecovery.arm.checkAgain')}
              onPress={run.checkSetup}
              hasBottomSpacing={false}
              style={[flexbox.alignSelfStart, spacings.mtTy]}
            />
          )}
        </WriteStateView>
      </SectionCard>
    )
  }

  // The removal landed and its check did not answer: it reads again, never as done.
  const unreadBlock = () => (
    <SectionCard spacing="none" testID="overview-step-unread">
      <Text fontSize={14} style={spacings.mbTy} testID="overview-step-unread-line">
        {t(`${OVERVIEW}.reads.failedTitle`)}
      </Text>
      <Button
        testID="overview-step-reread"
        type="secondary"
        size="small"
        text={t('socialRecovery.arm.checkAgain')}
        onPress={run.reread}
        hasBottomSpacing={false}
        style={[flexbox.alignSelfStart, spacings.mtTy]}
      />
    </SectionCard>
  )

  // Back wherever nothing is on its way to the chain.
  const stopped =
    !!state.dropped ||
    (write.status === 'failedNotSent' && !mayStillLand(write)) ||
    write.status === 'failedReverted' ||
    write.status === 'gasReadError' ||
    write.status === 'needsDeposit'

  return (
    <View testID={`overview-step-${intent}`}>
      <PageTitle
        title={t(headings.title)}
        lead={t(headings.lead)}
        titleTestID="overview-step-title"
      />
      {unavailable()}
      {screen === 'arrival' && arrival()}
      {screen === 'run' && runBlock()}
      {screen === 'confirming' && <ActivityIndicator testID="overview-step-confirming" />}
      {screen === 'unread' && unreadBlock()}
      {screen === 'run' && stopped && (
        <View style={[flexbox.directionRow, flexbox.alignCenter, spacings.mtSm]}>{back}</View>
      )}
    </View>
  )
}

export default React.memo(OverviewWriteStep)
