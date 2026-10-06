/**
 * A poll that failed or ran past its limit: the read says nothing about
 * whether the recovery still runs, the last number stays hidden, and the
 * retry. The rows of facts stay hidden with it.
 */
import React from 'react'
import { View } from 'react-native'

import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'

import type { PollFailedBlockProps } from './types'

const POLL_FAILED = 'socialRecovery.wait.pollFailed'

const PollFailedBlock = ({ onRetry }: PollFailedBlockProps) => {
  const { t } = useTranslation()

  return (
    <Alert
      testID="wait-poll-failed"
      type="error"
      size="sm"
      style={spacings.mbSm}
      title={t(`${POLL_FAILED}.title`)}
      text={t(`${POLL_FAILED}.body`)}
    >
      <Text fontSize={12} style={spacings.mtTy} testID="wait-poll-no-number">
        {t(`${POLL_FAILED}.noLastNumber`)}
      </Text>
      <View style={spacings.mtTy}>
        <Button
          testID="wait-poll-retry"
          type="secondary"
          size="small"
          text={t('socialRecovery.writes.tryAgain')}
          onPress={onRetry}
          hasBottomSpacing={false}
          style={flexbox.alignSelfStart}
        />
      </View>
    </Alert>
  )
}

export default React.memo(PollFailedBlock)
