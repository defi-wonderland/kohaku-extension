import React from 'react'
import { ActivityIndicator, View } from 'react-native'

import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import useTheme from '@common/hooks/useTheme'
import spacings from '@common/styles/spacings'
import common from '@common/styles/utils/common'

import type { OtherDoorsProps } from './types'

const DOORS = 'socialRecovery.review.doors'

/**
 * The account's other doors, one line after the security stop block: the
 * keys beside the one a recovery removes and the code entries where the
 * wallet can read them, or the line that it could not read them. Where it
 * names the keys without the code entries, it says the wallet cannot see every
 * door. A recovery leaves every door untouched.
 */
const OtherDoors = ({ doors }: OtherDoorsProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const rowStyle = [
    common.borderRadiusPrimary,
    spacings.phSm,
    spacings.ptSm,
    spacings.pbMi,
    spacings.mbTy,
    { borderWidth: 1, borderColor: theme.secondaryBorder }
  ]

  const line = (text: string, testID?: string) => (
    <Text fontSize={12} appearance="secondaryText" style={spacings.mbTy} testID={testID}>
      {text}
    </Text>
  )

  if (doors.kind === 'pending') {
    return <ActivityIndicator testID="review-doors-pending" style={spacings.mbTy} />
  }
  if (doors.kind === 'unreadable') {
    return <View style={rowStyle}>{line(t(`${DOORS}.unreadable`), 'review-doors')}</View>
  }
  if (doors.kind === 'none') {
    return <View style={rowStyle}>{line(t(`${DOORS}.none`), 'review-doors')}</View>
  }

  const keys = t(`${DOORS}.keysBeside`, { count: doors.keys })
  return (
    <View style={rowStyle}>
      {doors.kind === 'keys'
        ? line(t(`${DOORS}.line`, { doors: keys }), 'review-doors')
        : line(
            t(`${DOORS}.line`, {
              doors: t(`${DOORS}.pair`, {
                codeEntries: t(`${DOORS}.codeEntries`, { count: doors.codeEntries }),
                keys
              })
            }),
            'review-doors'
          )}
      {doors.kind === 'keys' &&
        line(
          t('socialRecovery.review.otherDoors.cannotSeeEveryDoor'),
          'review-doors-cannot-see-every-door'
        )}
      {doors.kind === 'pair' && (
        <>
          {line(t(`${DOORS}.marker`), 'review-doors-marker')}
          {line(t(`${DOORS}.validator`), 'review-doors-validator')}
        </>
      )}
      {line(t(`${DOORS}.untouched`), 'review-doors-untouched')}
    </View>
  )
}

export default React.memo(OtherDoors)
