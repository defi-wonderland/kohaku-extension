/**
 * A poll that failed or ran past its limit: the read says nothing about
 * whether the recovery still runs, the last number stays hidden, and the
 * retry. The rows of facts stay hidden with it.
 */
import React from 'react'

import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import ReadFailedBlock from '@web/modules/social-recovery/shared/chrome/ReadFailedBlock'

import type { PollFailedBlockProps } from './types'

const POLL_FAILED = 'socialRecovery.wait.pollFailed'

const PollFailedBlock = ({ onRetry }: PollFailedBlockProps) => {
  const { t } = useTranslation()

  return (
    <ReadFailedBlock
      testID="wait-poll-failed"
      retryTestID="wait-poll-retry"
      title={t(`${POLL_FAILED}.title`)}
      body={t(`${POLL_FAILED}.body`)}
      onRetry={onRetry}
    >
      <Text fontSize={12} style={spacings.mtTy} testID="wait-poll-no-number">
        {t(`${POLL_FAILED}.noLastNumber`)}
      </Text>
    </ReadFailedBlock>
  )
}

export default React.memo(PollFailedBlock)
