/**
 * The banner of one account over the watcher's record: an open attempt, a
 * failed poll with the open attempt the last good reading holds under it, or
 * the notice that a recovery handed control to another key. Nothing while the
 * record is read, for an account the watcher has not polled, for an attempt
 * the holder dismissed, or for an attempt a cancel ended.
 */
import React, { useCallback, useState } from 'react'
import { View } from 'react-native'

import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import {
  renderDateTimeInZone,
  renderFullAddress,
  renderShortAddress
} from '@web/modules/social-recovery/shared/display'

import AttemptLines from './AttemptLines'
import BannerFrame from './BannerFrame'
import { bannerReadingOf } from './readings'
import type { AccountAttemptBannerProps } from './types'

const WATCHER = 'socialRecovery.watcher'

const AccountAttemptBanner = ({
  account,
  name,
  useAttempt,
  useDismissed,
  onCancel,
  onDismiss,
  onRetry,
  timeZone
}: AccountAttemptBannerProps) => {
  const { t } = useTranslation()
  const state = useAttempt(account)
  const dismissed = useDismissed(account, state)
  const reading = bannerReadingOf(state, dismissed)
  const id = account.toLowerCase()
  const [busy, setBusy] = useState(false)

  const retry = useCallback(() => {
    setBusy(true)
    onRetry(account)
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }, [onRetry, account])

  const executedId = reading.kind === 'executed' ? reading.ending.attemptId : undefined
  const dismissExecuted = useCallback(() => {
    if (executedId === undefined) {
      return
    }
    setBusy(true)
    onDismiss(account, executedId)
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }, [onDismiss, account, executedId])

  if (reading.kind === 'none') {
    return null
  }

  const accountLine = !!name && (
    <Text
      fontSize={12}
      weight="medium"
      appearance="secondaryText"
      style={spacings.mbTy}
      testID={`recovery-banner-${id}-account`}
    >
      {t(`${WATCHER}.banner.account`, { name, address: renderShortAddress(account) })}
    </Text>
  )

  if (reading.kind === 'executed') {
    const { ending } = reading
    return (
      <BannerFrame type="warning" testID={`recovery-banner-${id}`}>
        {accountLine}
        <Text
          fontSize={16}
          weight="medium"
          style={spacings.mbTy}
          testID={`recovery-banner-${id}-executed-title`}
        >
          {t(`${WATCHER}.executed.title`)}
        </Text>
        {ending.at !== undefined && (
          <Text fontSize={14} style={spacings.mbTy} testID={`recovery-banner-${id}-executed-body`}>
            {t(`${WATCHER}.executed.body`, {
              date: renderDateTimeInZone(ending.at * 1000, timeZone).date
            })}
          </Text>
        )}
        {!!ending.controller && (
          <View style={spacings.mbTy}>
            <Text fontSize={12} appearance="secondaryText">
              {t(`${WATCHER}.executed.newController`)}
            </Text>
            <Text
              fontSize={14}
              weight="number_medium"
              selectable
              testID={`recovery-banner-${id}-controller`}
            >
              {renderFullAddress(ending.controller)}
            </Text>
          </View>
        )}
        <Button
          testID={`recovery-banner-${id}-executed-dismiss`}
          type="secondary"
          size="small"
          text={t(`${WATCHER}.executed.dismiss`)}
          onPress={dismissExecuted}
          disabled={busy}
          hasBottomSpacing={false}
          style={flexbox.alignSelfStart}
        />
      </BannerFrame>
    )
  }

  if (reading.kind === 'failed') {
    return (
      <BannerFrame type="error" testID={`recovery-banner-${id}`}>
        {accountLine}
        <Text
          fontSize={16}
          weight="medium"
          style={spacings.mbTy}
          testID={`recovery-banner-${id}-failed-title`}
        >
          {t(`${WATCHER}.failed.title`)}
        </Text>
        <Text fontSize={14} style={spacings.mbTy} testID={`recovery-banner-${id}-failed-body`}>
          {t(`${WATCHER}.failed.body`)}
        </Text>
        {reading.lastReadAt !== undefined && (
          <Text
            fontSize={14}
            appearance="secondaryText"
            style={spacings.mbTy}
            testID={`recovery-banner-${id}-last-read`}
          >
            {t(`${WATCHER}.failed.lastRead`, {
              date: renderDateTimeInZone(reading.lastReadAt, timeZone).date
            })}
          </Text>
        )}
        <Button
          testID={`recovery-banner-${id}-retry`}
          type="secondary"
          size="small"
          text={t(`${WATCHER}.failed.retry`)}
          onPress={retry}
          disabled={busy}
          hasBottomSpacing={false}
          style={[flexbox.alignSelfStart, spacings.mbSm]}
        />
        {!!reading.open && (
          <AttemptLines
            open={reading.open}
            account={account}
            timeZone={timeZone}
            onCancel={onCancel}
            onDismiss={onDismiss}
          />
        )}
      </BannerFrame>
    )
  }

  return (
    <BannerFrame type="warning" testID={`recovery-banner-${id}`}>
      {accountLine}
      <AttemptLines
        open={reading.open}
        account={account}
        timeZone={timeZone}
        onCancel={onCancel}
        onDismiss={onDismiss}
      />
    </BannerFrame>
  )
}

export default React.memo(AccountAttemptBanner)
