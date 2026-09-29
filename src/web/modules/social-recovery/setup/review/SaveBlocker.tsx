import React from 'react'
import { View } from 'react-native'

import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import { renderChip } from '@web/modules/social-recovery/shared/display'

import type { SaveBlockerProps } from './types'

const BLOCKED = 'socialRecovery.review.blocked'

/** Why Save cannot run, on screen beside it, with the action that clears it where one does. */
const SaveBlocker = ({ blocked, onRetry, onOpen }: SaveBlockerProps) => {
  const { t } = useTranslation()

  const chip = (text: string) => (
    <Text
      fontSize={12}
      weight="medium"
      appearance="errorText"
      style={spacings.mbTy}
      testID="review-blocked-chip"
    >
      {text}
    </Text>
  )
  const title = (text: string) => (
    <Text fontSize={14} weight="medium" testID="review-blocked-title">
      {text}
    </Text>
  )
  const body = (text: string) => (
    <Text
      fontSize={14}
      appearance="secondaryText"
      style={spacings.mbSm}
      testID="review-blocked-body"
    >
      {text}
    </Text>
  )
  const action = (text: string, onPress: () => void, testID: string) => (
    <Button
      testID={testID}
      type="outline"
      size="small"
      text={text}
      onPress={onPress}
      hasBottomSpacing={false}
    />
  )

  let content: React.ReactNode
  if (blocked.kind === 'unavailable') {
    content = (
      <>
        {chip(t(`${BLOCKED}.unavailable.chip`))}
        {title(t(`${BLOCKED}.unavailable.title`))}
        {body(t(`${BLOCKED}.unavailable.body`))}
        {action(t('socialRecovery.writes.tryAgain'), onRetry, 'review-blocked-retry')}
      </>
    )
  } else if (blocked.kind === 'removed-key-unreadable') {
    content = (
      <>
        {title(t(`${BLOCKED}.removedKeyUnreadable.title`))}
        {body(t(`${BLOCKED}.removedKeyUnreadable.body`))}
        {action(t('socialRecovery.writes.tryAgain'), onRetry, 'review-blocked-retry')}
      </>
    )
  } else if (blocked.kind === 'cannot-recover') {
    content = (
      <>
        {chip(renderChip('recovery', 'cannotRecover', t))}
        {title(t(`${BLOCKED}.cannotRecover.title`))}
        {body(
          blocked.reason === 'key-count'
            ? t(`${BLOCKED}.cannotRecover.reasonKeyCount`, { count: blocked.count })
            : t(`${BLOCKED}.cannotRecover.reasonNotSupported`)
        )}
      </>
    )
  } else {
    content = (
      <>
        {chip(t(`${BLOCKED}.alreadySetUp.chip`))}
        {title(t(`${BLOCKED}.alreadySetUp.title`))}
        {body(t(`${BLOCKED}.alreadySetUp.body`))}
        {action(t(`${BLOCKED}.alreadySetUp.open`), onOpen, 'review-blocked-open')}
      </>
    )
  }

  return (
    <View style={spacings.mbMd} testID={`review-blocked-${blocked.kind}`}>
      {content}
    </View>
  )
}

export default React.memo(SaveBlocker)
