/**
 * The gas step of the fast track, with no step number: the deposit step for
 * the key that sends the recovery while it holds too little, a failed read
 * with retry, or the wait while the check reads. Continue stays disabled: the
 * step moves on by itself once the funds arrive.
 */
import React from 'react'
import { ActivityIndicator, View } from 'react-native'

import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import { ActionsRow } from '@web/modules/social-recovery/shared/chrome'
import DepositStepView from '@web/modules/social-recovery/shared/writes/components/DepositStepView'

import type { GasStepViewProps } from './types'

const GasStepView = ({ state, onRetry }: GasStepViewProps) => {
  const { t } = useTranslation()

  if (state.kind === 'failed') {
    return (
      <View testID="fast-track-gas-failed">
        <Alert type="error" size="sm" text={t('socialRecovery.writes.gasCheckFailed')}>
          <Button
            testID="fast-track-gas-retry"
            type="secondary"
            size="small"
            text={t('socialRecovery.writes.tryAgain')}
            onPress={onRetry}
            hasBottomSpacing={false}
            style={[flexbox.alignSelfStart, spacings.mtSm]}
          />
        </Alert>
      </View>
    )
  }

  if (state.kind !== 'deposit') {
    return <ActivityIndicator testID="fast-track-gas-spinner" />
  }

  return (
    <DepositStepView step={state.step} testID="fast-track-gas">
      <ActionsRow
        testID="fast-track-gas-actions"
        primary={
          <Button
            testID="fast-track-gas-continue"
            type="primary"
            text={t('socialRecovery.actions.continue')}
            disabled
            hasBottomSpacing={false}
          />
        }
      />
    </DepositStepView>
  )
}

export default React.memo(GasStepView)
