/**
 * A poll of the account's recovery state that failed or ran past its limit:
 * over the rows, they may be out of date, the read says nothing about whether
 * the request lives and nothing goes on until a read succeeds; over a request
 * another attempt voided, the read could not tell whether that attempt still
 * runs. Either way, the retry.
 */
import React from 'react'
import { View } from 'react-native'

import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'

import type { PollAlertProps } from './types'

const POLL_FAILED = 'socialRecovery.checklist.pollFailed'

const PollAlert = ({ withRows, onRetry }: PollAlertProps) => {
  const { t } = useTranslation()

  return (
    <Alert
      testID="checklist-poll-failed"
      type="error"
      size="sm"
      style={spacings.mbSm}
      title={withRows ? t(`${POLL_FAILED}.title`) : t('socialRecovery.checklist.deaths.readFailed')}
      text={withRows ? t(`${POLL_FAILED}.body`) : undefined}
    >
      {withRows && (
        <Text fontSize={12} style={spacings.mtTy} testID="checklist-poll-held">
          {t(`${POLL_FAILED}.held`)}
        </Text>
      )}
      <View style={spacings.mtTy}>
        <Button
          testID="checklist-poll-retry"
          type="secondary"
          size="small"
          text={t('socialRecovery.writes.tryAgain')}
          onPress={onRetry}
          hasBottomSpacing={false}
          style={{ alignSelf: 'flex-start' }}
        />
      </View>
    </Alert>
  )
}

export default React.memo(PollAlert)
