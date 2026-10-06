/**
 * The lookup before it found a setup: the read running, a read that failed
 * with its retry, a client this wallet version cannot read with, and the one
 * dead end that says no setup was found, which renders only where the setup
 * read answered that the account has no setup commitment.
 */
import React from 'react'
import { ActivityIndicator, View } from 'react-native'

import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import { ActionsRow, SectionCard } from '@web/modules/social-recovery/shared/chrome'
import { renderFullAddress } from '@web/modules/social-recovery/shared/display'

import ReadFailedBlock from './ReadFailedBlock'
import type { LookupStateProps } from './types'

const ACCOUNT = 'socialRecovery.entry.account'
const NO_SETUP = 'socialRecovery.entry.noSetup'

const LookupState = ({
  networkName,
  client,
  setupState,
  onRetrySetup,
  onAnotherAddress,
  onClose
}: LookupStateProps) => {
  const { t } = useTranslation()

  const another = (
    <Button
      testID="entry-lookup-another"
      type="outline"
      text={t(`${NO_SETUP}.tryAnother`)}
      onPress={onAnotherAddress}
      hasBottomSpacing={false}
    />
  )

  if (client.status === 'update-the-wallet') {
    return (
      <View testID="entry-lookup-update-the-wallet">
        <ReadFailedBlock
          testID="entry-lookup-refused"
          title={t('socialRecovery.client.updateTheWalletTitle')}
          body={t('socialRecovery.client.updateTheWalletBody')}
          onRetry={client.retry}
        />
        <ActionsRow primary={another} />
      </View>
    )
  }
  if (client.status === 'failed') {
    return (
      <View testID="entry-lookup-failed">
        <ReadFailedBlock
          testID="entry-lookup-read-failed"
          title={t(`${ACCOUNT}.errors.readFailedTitle`, { network: networkName })}
          body={t(`${ACCOUNT}.errors.readFailedHint`)}
          onRetry={client.retry}
        />
        <ActionsRow primary={another} />
      </View>
    )
  }
  if (client.status === 'loading' || setupState.status === 'pending') {
    return (
      <View testID="entry-lookup-loading">
        <ActivityIndicator style={spacings.mbSm} />
        <Text fontSize={14} appearance="secondaryText">
          {t(`${ACCOUNT}.lookingUp`, { network: networkName })}
        </Text>
      </View>
    )
  }
  if (setupState.status === 'failed') {
    return (
      <View testID="entry-lookup-failed">
        <ReadFailedBlock
          testID="entry-lookup-read-failed"
          title={t(`${ACCOUNT}.errors.readFailedTitle`, { network: networkName })}
          body={t(`${ACCOUNT}.errors.readFailedHint`)}
          onRetry={onRetrySetup}
        />
        <ActionsRow primary={another} />
      </View>
    )
  }
  if (setupState.value.hasSetup) {
    return null
  }

  return (
    <View testID="entry-no-setup">
      <Text fontSize={20} weight="medium" style={spacings.mbSm} testID="entry-no-setup-title">
        {t(`${NO_SETUP}.title`, { network: networkName })}
      </Text>
      <Text
        fontSize={14}
        weight="number_medium"
        selectable
        style={spacings.mbTy}
        testID="entry-no-setup-module"
      >
        {t(`${NO_SETUP}.module`, { module: renderFullAddress(client.client.descriptor.manager) })}
      </Text>
      <Text fontSize={14} style={spacings.mbTy}>
        {t(`${NO_SETUP}.checkCard`)}
      </Text>
      <Text fontSize={14} style={spacings.mbSm} testID="entry-no-setup-other-wallet">
        {t(`${NO_SETUP}.otherWallet`)}
      </Text>
      <SectionCard tone="muted" spacing="item" testID="entry-no-setup-card">
        <Text fontSize={14} weight="medium" style={spacings.mbTy}>
          {t(`${NO_SETUP}.cardTitle`)}
        </Text>
        <Text fontSize={12} appearance="secondaryText">
          {t(`${NO_SETUP}.cardBody`)}
        </Text>
      </SectionCard>
      <ActionsRow
        primary={
          <Button
            testID="entry-lookup-another"
            type="primary"
            text={t(`${NO_SETUP}.tryAnother`)}
            onPress={onAnotherAddress}
            hasBottomSpacing={false}
          />
        }
        secondary={
          onClose ? (
            <Button
              testID="entry-no-setup-close"
              type="outline"
              text={t(`${NO_SETUP}.close`)}
              onPress={onClose}
              hasBottomSpacing={false}
            />
          ) : undefined
        }
      />
    </View>
  )
}

export default React.memo(LookupState)
