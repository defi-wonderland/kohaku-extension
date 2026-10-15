/**
 * The owner's cancel, by state. Before any send: the fresh read of the
 * attempt (loading, failed with a retry, or the attempt already gone), then
 * the confirm with the attempt's facts. Then the shared write states: the gas
 * check, the deposit step naming the account's key with both routes, the
 * cancel in progress, the two readings of the failed state with the
 * move-funds action where the state offers it, and after a landing the reads
 * until the attempt reads cancelled, then the cancelled terminal.
 */
import React from 'react'
import { ActivityIndicator, View } from 'react-native'

import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import { SectionCard } from '@web/modules/social-recovery/shared/chrome'
import {
  mayStillLand,
  offersMoveFunds,
  otherRequestPending,
  renderDepositStep,
  WRITES_KEYS
} from '@web/modules/social-recovery/shared/writes'
import DepositStepView from '@web/modules/social-recovery/shared/writes/components/DepositStepView'
import WriteStateView from '@web/modules/social-recovery/shared/writes/components/WriteStateView'

import { AttemptFacts, CancelledBlock, EndedBlock } from './CancelBlocks'
import { standingOf } from './readings'
import type { CancelViewProps } from './types'

const BANNER = 'socialRecovery.watcher.banner'
const CANCEL = 'socialRecovery.cancel'

const CancelView = ({
  read,
  run,
  readiness,
  timeZone,
  onRetryRead,
  onRetryReady,
  onSend,
  onRecheck,
  onCheckAgain,
  onBack,
  onDone,
  onMoveFunds
}: CancelViewProps) => {
  const { t } = useTranslation()
  const { write, target } = run

  const backButton = (
    <Button
      testID="cancel-back"
      type="secondary"
      size="small"
      text={t(`${CANCEL}.confirm.back`)}
      onPress={onBack}
      hasBottomSpacing={false}
      style={[flexbox.alignSelfStart, spacings.mtTy]}
    />
  )
  const moveFundsButton = (key: string) => (
    <Button
      testID="cancel-move-funds"
      type="secondary"
      size="small"
      text={t(key)}
      onPress={onMoveFunds}
      hasBottomSpacing={false}
      style={[flexbox.alignSelfStart, spacings.mtTy]}
    />
  )
  const checkAgainButton = (
    <Button
      testID="cancel-check-again"
      type="secondary"
      size="small"
      text={t(WRITES_KEYS.tryAgain)}
      onPress={onCheckAgain}
      hasBottomSpacing={false}
      style={[flexbox.alignSelfStart, spacings.mtTy]}
    />
  )
  const inProgress = (extra?: React.ReactNode) => (
    <SectionCard testID="cancel-in-progress">
      <WriteStateView
        state={{ status: 'submitting', write: 'cancel' }}
        title={t(`${CANCEL}.inProgress.title`)}
        body={[t(`${CANCEL}.inProgress.body`)]}
      >
        {extra}
      </WriteStateView>
    </SectionCard>
  )

  if (run.gone) {
    return <EndedBlock reading={run.gone} onBack={onBack} />
  }

  switch (write.status) {
    case 'checkingGas':
      return <ActivityIndicator testID="cancel-spinner" />
    case 'needsDeposit': {
      const rendered = renderDepositStep(write.step, {}, t)
      return (
        <SectionCard testID="cancel-gas">
          <DepositStepView step={write.step} variant="blocker" testID="cancel-gas-blocker">
            {rendered.routes.map((route) => (
              <View
                key={route.kind}
                style={spacings.mbSm}
                testID={`cancel-gas-route-${route.kind}`}
              >
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
            <View style={[flexbox.directionRow, flexbox.wrap]}>
              <Button
                testID="cancel-gas-continue"
                type="primary"
                size="small"
                text={t('socialRecovery.actions.continue')}
                onPress={onRecheck}
                hasBottomSpacing={false}
                style={[spacings.mrSm, spacings.mtTy]}
              />
              {backButton}
            </View>
          </DepositStepView>
        </SectionCard>
      )
    }
    case 'submitting':
      return inProgress(run.stalled ? checkAgainButton : undefined)
    case 'landed':
      if (run.after.stage === 'cancelled' || run.after.stage === 'otherRoad') {
        return <CancelledBlock after={run.after} onMoveFunds={onMoveFunds} onDone={onDone} />
      }
      return inProgress(run.after.stage === 'unread' ? checkAgainButton : undefined)
    case 'failedNotSent': {
      // A refusal that may still land, or one for another request, reads the shared line alone.
      const ownBody = !mayStillLand(write) && !otherRequestPending(write)
      return (
        <SectionCard testID="cancel-not-sent">
          <WriteStateView
            state={write}
            title={t(`${CANCEL}.failed.title`)}
            body={ownBody ? [t(`${CANCEL}.failed.body`)] : undefined}
            onRetry={target !== undefined ? () => onSend(target) : undefined}
          >
            {offersMoveFunds(write) && moveFundsButton(`${CANCEL}.failed.moveFunds`)}
            {backButton}
          </WriteStateView>
        </SectionCard>
      )
    }
    case 'failedReverted':
      return (
        <SectionCard testID="cancel-reverted">
          <WriteStateView
            state={write}
            onRetry={target !== undefined ? () => onSend(target) : undefined}
          >
            {offersMoveFunds(write) && moveFundsButton(`${CANCEL}.reverted.moveFunds`)}
            {backButton}
          </WriteStateView>
        </SectionCard>
      )
    case 'gasReadError':
      return (
        <SectionCard testID="cancel-check-failed">
          <WriteStateView
            state={write}
            onRetry={target !== undefined ? () => onSend(target) : undefined}
          >
            {backButton}
          </WriteStateView>
        </SectionCard>
      )
    default:
      break
  }

  if (read.status === 'loading') {
    return <ActivityIndicator testID="cancel-spinner" />
  }
  if (read.status === 'failed') {
    return (
      <SectionCard testID="cancel-read-failed">
        <Text fontSize={14} style={spacings.mbTy} testID="cancel-read-failed-line">
          {t(`${CANCEL}.confirm.readFailed`)}
        </Text>
        <Button
          testID="cancel-read-retry"
          type="primary"
          size="small"
          text={t(WRITES_KEYS.tryAgain)}
          onPress={onRetryRead}
          hasBottomSpacing={false}
          style={flexbox.alignSelfStart}
        />
        {backButton}
      </SectionCard>
    )
  }
  const { reading, target: arrivalTarget } = read.arrival
  const standing = arrivalTarget !== undefined ? standingOf(reading, arrivalTarget) : undefined
  if (!standing || standing.kind !== 'open' || arrivalTarget === undefined) {
    return <EndedBlock reading={reading} onBack={onBack} />
  }

  return (
    <SectionCard testID="cancel-confirm">
      <Text fontSize={20} weight="medium" style={spacings.mbSm} testID="cancel-confirm-title">
        {t(`${CANCEL}.confirm.title`)}
      </Text>
      <Text fontSize={14} style={spacings.mbTy} testID="cancel-confirm-lead">
        {t(`${CANCEL}.confirm.lead`)}
      </Text>
      <Text fontSize={14} style={spacings.mbSm} testID="cancel-confirm-one-transaction">
        {t(`${CANCEL}.confirm.oneTransaction`)}
      </Text>
      <AttemptFacts attempt={standing.attempt} timeZone={timeZone} />
      <Text
        fontSize={14}
        appearance="secondaryText"
        style={spacings.mbSm}
        testID="cancel-only-own-key"
      >
        {t(`${BANNER}.onlyOwnKey`)}
      </Text>
      <View style={[flexbox.directionRow, flexbox.wrap, flexbox.alignCenter]}>
        <Button
          testID="cancel-send"
          type="primary"
          size="small"
          text={t(`${CANCEL}.confirm.send`)}
          onPress={() => onSend(arrivalTarget)}
          disabled={readiness !== 'ready'}
          hasBottomSpacing={false}
          style={[spacings.mrSm, spacings.mtTy]}
        />
        {backButton}
      </View>
      {readiness === 'failed' && (
        <View style={spacings.mtSm} testID="cancel-ready-failed">
          <Text fontSize={14} style={spacings.mbTy} testID="cancel-ready-failed-line">
            {t(`${CANCEL}.confirm.readFailed`)}
          </Text>
          <Button
            testID="cancel-ready-retry"
            type="secondary"
            size="small"
            text={t(WRITES_KEYS.tryAgain)}
            onPress={onRetryReady}
            hasBottomSpacing={false}
            style={flexbox.alignSelfStart}
          />
        </View>
      )}
    </SectionCard>
  )
}

export default React.memo(CancelView)
