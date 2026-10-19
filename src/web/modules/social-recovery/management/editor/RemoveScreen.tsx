/**
 * The removal of recovery: the warning that the account will have no
 * recovery path, what the one transaction does, the typed confirmation whose
 * exact word alone enables the action, and while an attempt is open on the
 * account the line that removing recovery cancels it, above the action. The
 * removal clears the setup and removes the action's authorization in one
 * batch over the save's own run, in the shared states, and reads as done only
 * once the chain reads both gone and the records were wiped. A run that finds
 * both already gone sends nothing, says that the account has no recovery path
 * now, drawn apart from a removal it sent, and this device keeps nothing of
 * the setup. The removal's prepare reads the attempt again, and the cancel
 * line follows that read. A stored save of the changes in flight sends the holder
 * to the review, and another screen's stored write to the overview; the
 * stored write is read again whenever the tab comes back into view.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'

import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import Input from '@common/components/Input'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import useNavigation from '@common/hooks/useNavigation'
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import { OVERVIEW } from '@web/modules/social-recovery/management/overview/constants'
import { useOverviewReads } from '@web/modules/social-recovery/management/overview/useOverviewReads'
import { ActionsRow, PageTitle } from '@web/modules/social-recovery/shared/chrome'
import ReadFailedBlock from '@web/modules/social-recovery/shared/chrome/ReadFailedBlock'
import SetupChrome from '@web/modules/social-recovery/shared/chrome/SetupChrome'
import useSetupAccount from '@web/modules/social-recovery/shared/chrome/useSetupAccount'
import { CHAIN_IDS, WALLET_RECOVERY_CHAIN } from '@web/modules/social-recovery/shared/client'
import { useAccountFacts } from '@web/modules/social-recovery/shared/client/useAccountFacts'
import { useRecoveryClient } from '@web/modules/social-recovery/shared/client/useRecoveryClient'
import {
  createWalletRecords,
  extensionRecordStorage
} from '@web/modules/social-recovery/shared/records'
import { armScreenOf } from '@web/modules/social-recovery/setup/arm'
import { useArmRun } from '@web/modules/social-recovery/setup/arm/useArmRun'

import { REMOVE } from './constants'
import { nothingOnItsWay } from './readings'
import ReadsGate from './ReadsGate'
import RunBlock from './RunBlock'
import { editSessionOf } from './session'
import { removalStepsOf, wipeRemovedSetup } from './steps'
import type { AttemptRead, EditStageProps } from './types'
import { useHeldWrite } from './useHeldWrite'
import { useWriteSeams } from './useWriteSeams'

export const RemoveStageView = ({
  records,
  session,
  chainId,
  account,
  navigate
}: EditStageProps) => {
  const { t } = useTranslation()
  const clientState = useRecoveryClient(account)
  const reads = useOverviewReads({ client: clientState, records, chainId, account })
  const kit = clientState.status === 'ready' ? clientState.client : null
  // The attempt as the removal's prepare last read it; a new read of the overview's facts replaces it.
  const [attemptRead, setAttemptRead] = useState<AttemptRead | null>(null)
  useEffect(() => setAttemptRead(null), [reads.facts])
  const attemptOpen = attemptRead
    ? attemptRead.open
    : reads.facts.status === 'answered' && reads.facts.value.attemptOpen
  const seams = useWriteSeams(chainId)
  const accountFacts = useAccountFacts(account)
  const { held, retry: retryHeld, refresh: refreshHeld } = useHeldWrite(records, chainId, account)
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (held.status === 'held' && held.write === 'manageEdit') {
      navigate(WEB_ROUTES.socialRecoveryManageReview)
    }
    if (held.status === 'other') {
      navigate(WEB_ROUTES.socialRecoveryManage)
    }
  }, [held, navigate])

  const ready = accountFacts.status === 'ready' ? accountFacts.facts : null
  const ownWrite =
    held.status === 'none' || (held.status === 'held' && held.write === 'manageRemove')
  const steps = useMemo(() => {
    if (!ready?.key || !kit || !ownWrite || clientState.status !== 'ready') {
      return null
    }
    return removalStepsOf({
      client: kit,
      reads: clientState.reads,
      receipts: clientState.receipts,
      port: seams.port,
      requests: seams.requests,
      records,
      session,
      chainId,
      account,
      facts: ready,
      key: ready.key,
      onAttempt: setAttemptRead
    })
  }, [ready, kit, ownWrite, clientState, seams, records, session, chainId, account])
  const run = useArmRun(steps, `manage:remove:${chainId}:${account.toLowerCase()}`, 'ownerWrite')
  const { state } = run
  const screen = armScreenOf(state)

  // A run that read or lost its claim to another screen's write ends unsent; the stored write is read again.
  useEffect(() => {
    if (state.lookup === 'failed' || state.write.status === 'failedNotSent') {
      refreshHeld()
    }
  }, [state.lookup, state.write.status, refreshHeld])

  // The chain holds no setup and no authorization: this device keeps nothing of the setup either.
  const endedElsewhere = screen === 'already-set-up'
  useEffect(() => {
    if (endedElsewhere) {
      wipeRemovedSetup({ records, session, chainId, account }).catch(() => undefined)
    }
  }, [endedElsewhere, records, session, chainId, account])

  const toOverview = useCallback(() => navigate(WEB_ROUTES.socialRecoveryManage), [navigate])
  const word = t(`${REMOVE}.word`)
  const confirmed = typed === word

  const keep = (
    <Button
      testID="manage-remove-keep"
      type="outline"
      text={t(`${REMOVE}.keep`)}
      onPress={toOverview}
      hasBottomSpacing={false}
    />
  )
  const cancels = attemptOpen && (
    <Text fontSize={14} weight="medium" style={spacings.mbSm} testID="manage-remove-cancels">
      {t(`${REMOVE}.cancelsLine`)}
    </Text>
  )

  const done = (
    <View testID={endedElsewhere ? 'manage-remove-ended' : 'manage-remove-done'}>
      <PageTitle
        title={t(endedElsewhere ? `${REMOVE}.alreadyTitle` : `${REMOVE}.doneTitle`)}
        lead={t(endedElsewhere ? `${REMOVE}.alreadyBody` : `${REMOVE}.doneBody`)}
        titleTestID="manage-remove-done-title"
      />
      <ActionsRow
        primary={
          <Button
            testID="manage-remove-done-action"
            type="primary"
            text={t('socialRecovery.done.close')}
            onPress={toOverview}
            hasBottomSpacing={false}
          />
        }
      />
    </View>
  )

  const arrival = () => {
    if (held.status === 'failed') {
      return (
        <ReadFailedBlock
          testID="manage-remove-held-failed"
          title={t('socialRecovery.records.loadFailed')}
          onRetry={retryHeld}
        />
      )
    }
    const lookingUp =
      held.status === 'pending' ||
      state.lookup === 'reading' ||
      (!steps && accountFacts.status === 'loading')
    return (
      <View testID="manage-remove-arrival">
        <Text fontSize={14} style={spacings.mbSm} testID="manage-remove-body">
          {t(`${REMOVE}.body`)}
        </Text>
        <Input
          testID="manage-remove-word"
          label={t(`${REMOVE}.typeToConfirm`, { word })}
          accessibilityLabel={t(`${REMOVE}.typeToConfirm`, { word })}
          placeholder={word}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {ready && !ready.key && (
          <Alert
            testID="manage-remove-view-only"
            type="error"
            size="sm"
            style={spacings.mbSm}
            text={t('socialRecovery.arm.viewOnly')}
          />
        )}
        {cancels}
        {lookingUp ? (
          <ActivityIndicator testID="manage-remove-lookup" />
        ) : (
          <ActionsRow
            primary={
              <Button
                testID="manage-remove-action"
                type="danger"
                text={t(`${REMOVE}.action`)}
                disabled={!confirmed || !steps || state.lookup !== 'none'}
                onPress={run.start}
                hasBottomSpacing={false}
              />
            }
            secondary={keep}
          />
        )}
        {state.lookup === 'failed' && (
          <ReadFailedBlock
            testID="manage-remove-lookup-failed"
            title={t('socialRecovery.records.loadFailed')}
            onRetry={run.lookAgain}
          />
        )}
      </View>
    )
  }

  const body = () => {
    switch (screen) {
      case 'saved':
      case 'already-set-up':
        return done
      case 'disagreed':
      case 'unread':
        return (
          <ReadFailedBlock
            testID="manage-remove-check-failed"
            title={t(`${OVERVIEW}.reads.failedTitle`)}
            body={t(`${OVERVIEW}.reads.failedBody`)}
            onRetry={run.reread}
          />
        )
      case 'confirming':
        return <ActivityIndicator testID="manage-remove-confirming" />
      case 'run':
        return (
          <View>
            {cancels}
            <RunBlock run={run} write="ownerWrite" testID="manage-remove-run" />
            {nothingOnItsWay(state) && (
              <View style={[flexbox.directionRow, spacings.mtSm]}>{keep}</View>
            )}
          </View>
        )
      case 'arrival':
      default:
        return arrival()
    }
  }

  if (screen === 'saved' || screen === 'already-set-up') {
    return done
  }

  return (
    <View testID="manage-remove">
      <PageTitle title={t(`${REMOVE}.title`)} titleTestID="manage-remove-title" />
      <Alert
        testID="manage-remove-warning"
        type="warning"
        size="sm"
        style={spacings.mbSm}
        text={t(`${REMOVE}.warning`)}
      />
      <ReadsGate reads={reads} needsPath={false} testID="manage-remove-reads">
        {body()}
      </ReadsGate>
    </View>
  )
}

const RemoveScreen = () => {
  const { navigate } = useNavigation()
  const { account } = useSetupAccount()
  const records = useMemo(() => createWalletRecords({ storage: extensionRecordStorage }), [])
  const chainId = CHAIN_IDS[WALLET_RECOVERY_CHAIN]
  const session = useMemo(
    () => (account ? editSessionOf(extensionRecordStorage, chainId, account) : null),
    [account, chainId]
  )

  return (
    <SetupChrome testID="manage-remove-screen">
      {!!account && !!session && (
        <RemoveStageView
          key={`${chainId}:${account}`}
          records={records}
          session={session}
          chainId={chainId}
          account={account}
          navigate={navigate}
        />
      )}
    </SetupChrome>
  )
}

export default React.memo(RemoveScreen)
