/**
 * The overview's reads in front of an editor screen: the setup read with its
 * loading and failed states, an account with no setup, then the path with the
 * recovery password ask where this device cannot read it, the committed
 * level, and the password again where the level hides the setup and this tab
 * holds none, since the save seals the backup under it. A screen that needs
 * no path renders once the setup read answered. Otherwise the screen renders
 * once every read answered; a read that failed or has not returned never
 * renders as an answer.
 */
import React from 'react'
import { ActivityIndicator, View } from 'react-native'

import Alert from '@common/components/Alert'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import { OVERVIEW } from '@web/modules/social-recovery/management/overview/constants'
import PathLockedAsk from '@web/modules/social-recovery/management/overview/PathLockedAsk'
import ReadFailedBlock from '@web/modules/social-recovery/shared/chrome/ReadFailedBlock'

import type { CommittedLevel, ReadsGateProps } from './types'

const PENDING: CommittedLevel = { status: 'pending' }

const ReadsGate = ({
  reads,
  level = PENDING,
  onRetryLevel,
  passwordHeld = false,
  needsPath = true,
  testID,
  children
}: ReadsGateProps) => {
  const { t } = useTranslation()

  const failed = (onRetry: () => void, id: string) => (
    <ReadFailedBlock
      testID={`${testID}-${id}`}
      title={t(`${OVERVIEW}.reads.failedTitle`)}
      body={t(`${OVERVIEW}.reads.failedBody`)}
      onRetry={onRetry}
    />
  )
  const updateTheWallet = (
    <Alert
      testID={`${testID}-update-the-wallet`}
      type="error"
      size="sm"
      title={t('socialRecovery.client.updateTheWalletTitle')}
      text={t('socialRecovery.client.updateTheWalletHow')}
    />
  )
  const reading = (
    <View testID={`${testID}-reading`}>
      <ActivityIndicator style={spacings.mbSm} />
      <Text fontSize={14} appearance="secondaryText">
        {t(`${OVERVIEW}.reads.loading`)}
      </Text>
    </View>
  )

  const { facts, path } = reads
  if (facts.status === 'pending') {
    return reading
  }
  if (facts.status === 'failed') {
    return failed(reads.retry, 'facts-failed')
  }
  if (facts.status === 'update-the-wallet') {
    return updateTheWallet
  }
  if (!facts.value.setup.hasSetup) {
    return (
      <Text fontSize={14} testID={`${testID}-not-set-up`}>
        {t(`${OVERVIEW}.lead.notSetUp`)}
      </Text>
    )
  }
  if (!needsPath) {
    return <View testID={testID}>{children}</View>
  }
  switch (path.kind) {
    case 'locked':
      return (
        <PathLockedAsk
          testID={`${testID}-locked`}
          ask={reads.ask}
          onUnlock={reads.unlock}
          onAskAgain={reads.askAgain}
          onRetry={reads.retryPath}
        />
      )
    case 'update-the-wallet':
      return updateTheWallet
    case 'read-failed':
    case 'no-details':
    case 'mismatch':
      return failed(reads.retryPath, 'path-failed')
    case 'readable':
      break
    default:
      return reading
  }
  if (level.status === 'pending') {
    return reading
  }
  if (level.status === 'failed') {
    return failed(onRetryLevel ?? reads.retry, 'level-failed')
  }
  if (level.status === 'unreadable') {
    return updateTheWallet
  }
  if (level.value !== 'public' && !passwordHeld) {
    return (
      <View testID={`${testID}-password`}>
        <Text fontSize={14} style={spacings.mbSm}>
          {t(`${OVERVIEW}.locked.body`)}
        </Text>
        <PathLockedAsk
          testID={`${testID}-password-ask`}
          ask={reads.ask}
          onUnlock={reads.unlock}
          onAskAgain={reads.askAgain}
          onRetry={reads.retryPath}
          bare
        />
      </View>
    )
  }
  return <View testID={testID}>{children}</View>
}

export default React.memo(ReadsGate)
