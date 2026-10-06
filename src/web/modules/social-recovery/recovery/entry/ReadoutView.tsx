/**
 * The readout: the account being recovered and the network, then the setup
 * under its privacy level. Private shows nothing of the setup until the
 * recovery password opens it; Shape visible shows the path with every value
 * masked and asks the password before continue; Public shows the path with
 * its values and continues at once. A read that runs or failed, a setup this
 * build cannot read, and a setup this device cannot open each have their own
 * state, and every state says the account has a recovery setup.
 */
import React, { useMemo } from 'react'
import { ActivityIndicator, View } from 'react-native'

import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import {
  ActionsRow,
  PageTitle,
  SectionCard,
  SectionLabel
} from '@web/modules/social-recovery/shared/chrome'
import { renderFullAddress, renderValueLabel } from '@web/modules/social-recovery/shared/display'

import ReadFailedBlock from './ReadFailedBlock'
import { previewPathOf, readablePathOf, REQUEST_HOURS } from './readout'
import ReadoutPasswordAsk from './ReadoutPasswordAsk'
import ReadoutPathBlock from './ReadoutPathBlock'
import type { ReadoutStep, ReadoutViewProps } from './types'

const READOUT = 'socialRecovery.readout'
const CONFIGURED = 'socialRecovery.client.updateTheWalletBody'

/** The lead under the title: what the page shows of the setup, where the step knows it. */
const leadKeyOf = (step: ReadoutStep): string | undefined => {
  if (step.kind === 'locked') {
    return step.level === 'private' ? `${READOUT}.leadPrivate` : `${READOUT}.leadCommitted`
  }
  if (step.kind === 'readable') {
    return step.level === 'public' ? `${READOUT}.leadCommitted` : `${READOUT}.leadUnlocked`
  }
  return undefined
}

const ReadoutView = ({ state, account, networkName, context, onBack }: ReadoutViewProps) => {
  const { t } = useTranslation()
  const { step } = state

  const path = useMemo(() => {
    if (step.kind === 'readable') {
      return readablePathOf(step.configuration, context, t)
    }
    if (step.kind === 'locked' && step.shape) {
      return previewPathOf(step.shape, context, t)
    }
    return null
  }, [step, context, t])

  const leadKey = leadKeyOf(step)

  const back = (
    <Button
      testID="readout-back"
      type="outline"
      text={t('socialRecovery.ceremony.backAction')}
      onPress={onBack}
      hasBottomSpacing={false}
    />
  )

  const configured = (
    <Text fontSize={14} appearance="secondaryText" testID="readout-configured">
      {t(CONFIGURED)}
    </Text>
  )

  const renderBody = () => {
    switch (step.kind) {
      case 'reading':
      case 'leaving':
        return (
          <View testID="readout-reading">
            <ActivityIndicator style={spacings.mbSm} />
            <Text fontSize={14} appearance="secondaryText" style={spacings.mbTy}>
              {t(`${READOUT}.reading`, { network: networkName })}
            </Text>
            {configured}
          </View>
        )
      case 'read-failed':
        return (
          <View testID="readout-read-failed">
            <ReadFailedBlock
              testID="readout-read-failed-block"
              title={t(`${READOUT}.readFailedTitle`, { network: networkName })}
              body={t(CONFIGURED)}
              onRetry={state.retry}
            />
            <ActionsRow primary={back} />
          </View>
        )
      case 'update-the-wallet':
        return (
          <View testID="readout-update-the-wallet">
            <Alert
              testID="readout-update-the-wallet-alert"
              type="error"
              size="sm"
              style={spacings.mbSm}
              title={t('socialRecovery.client.updateTheWalletTitle')}
              text={t(CONFIGURED)}
            />
            <Text fontSize={14} testID="readout-update-how">
              {t('socialRecovery.client.updateTheWalletAction')}
            </Text>
          </View>
        )
      case 'no-details':
        return (
          <View testID="readout-no-details">
            <Alert
              testID="readout-no-details-alert"
              type="warning"
              size="sm"
              style={spacings.mbSm}
              title={t(`${READOUT}.noDetails`)}
              text={t(CONFIGURED)}
            />
            <ActionsRow primary={back} />
          </View>
        )
      case 'mismatch':
        return (
          <View testID="readout-mismatch">
            <Alert
              testID="readout-mismatch-alert"
              type="error"
              size="sm"
              style={spacings.mbSm}
              title={t(`${READOUT}.detailsMismatch`, { network: networkName })}
              text={t(CONFIGURED)}
            />
            <ActionsRow primary={back} />
          </View>
        )
      case 'locked':
        return (
          <View testID={`readout-locked-${step.level}`}>
            {!!path && (
              <SectionCard>
                <ReadoutPathBlock path={path} />
              </SectionCard>
            )}
            {step.level === 'shape-visible' && (
              <Text fontSize={14} style={spacings.mbSm} testID="readout-shape-preview">
                {t(`${READOUT}.shapePreview`)}
              </Text>
            )}
            <ReadoutPasswordAsk
              level={step.level}
              unlock={step.unlock}
              networkName={networkName}
              onUnlock={state.unlock}
              onAskAgain={state.askAgain}
              onRetry={state.retry}
              onBack={onBack}
            />
          </View>
        )
      case 'readable':
      default:
        return (
          <View testID={`readout-readable-${step.level}`}>
            {!!path && (
              <SectionCard>
                <ReadoutPathBlock path={path} />
              </SectionCard>
            )}
            {step.level === 'public' && (
              <Text fontSize={14} style={spacings.mbSm} testID="readout-public-line">
                {t(`${READOUT}.publicLine`)}
              </Text>
            )}
            {!!path?.choice && (
              <Text fontSize={14} style={spacings.mbSm} testID="readout-answer-whichever">
                {t(`${READOUT}.answerWhichever`)}
              </Text>
            )}
            <ActionsRow
              primary={
                <Button
                  testID="readout-continue"
                  type="primary"
                  text={t('socialRecovery.actions.continue')}
                  disabled={state.continuing}
                  onPress={state.onContinue}
                  hasBottomSpacing={false}
                />
              }
              secondary={back}
              note={t(`${READOUT}.continueLine`, { hours: REQUEST_HOURS })}
              noteTestID="readout-continue-line"
            />
          </View>
        )
    }
  }

  return (
    <View testID="readout">
      <PageTitle
        title={t('socialRecovery.review.pathHeader')}
        lead={leadKey ? t(leadKey) : undefined}
        titleTestID="readout-title"
      />
      <SectionCard testID="readout-account">
        <SectionLabel>{renderValueLabel('accountBeingRecovered', t)}</SectionLabel>
        <Text
          fontSize={14}
          weight="number_medium"
          selectable
          style={spacings.mbSm}
          testID="readout-account-address"
        >
          {renderFullAddress(account)}
        </Text>
        <SectionLabel>{t('socialRecovery.entry.labels.network')}</SectionLabel>
        <Text fontSize={14} testID="readout-network">
          {networkName}
        </Text>
      </SectionCard>
      {renderBody()}
    </View>
  )
}

export default React.memo(ReadoutView)
