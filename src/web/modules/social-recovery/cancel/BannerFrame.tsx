/**
 * The dashboard banner's look, for the recovery banner's own content: the
 * tinted card with the coloured left edge and the type's icon, the warning
 * type for an attempt and the error type for a failed poll.
 */
import React from 'react'
import { View } from 'react-native'

import ErrorIcon from '@common/assets/svg/ErrorIcon'
import WarningIcon from '@common/assets/svg/WarningIcon'
import useTheme from '@common/hooks/useTheme'
import spacings, { SPACING_TY } from '@common/styles/spacings'
import { THEME_TYPES } from '@common/styles/themeConfig'
import commonStyles from '@common/styles/utils/common'
import flexbox from '@common/styles/utils/flexbox'

import type { BannerFrameProps } from './types'

const BannerFrame = ({ type, testID, children }: BannerFrameProps) => {
  const { theme, themeType } = useTheme()
  const decorative = theme[`${type}Decorative`] as string
  const Icon = type === 'error' ? ErrorIcon : WarningIcon

  return (
    <View
      testID={testID}
      style={[
        commonStyles.borderRadiusPrimary,
        {
          marginBottom: SPACING_TY,
          overflow: 'hidden',
          backgroundColor:
            themeType === THEME_TYPES.DARK ? `${decorative}1F` : theme[`${type}Background`]
        }
      ]}
    >
      <View
        style={[
          flexbox.directionRow,
          spacings.plSm,
          spacings.prSm,
          spacings.pvSm,
          { borderLeftWidth: 6, borderLeftColor: decorative }
        ]}
      >
        <View style={spacings.mrSm}>
          <Icon width={20} height={20} color={decorative} />
        </View>
        <View style={flexbox.flex1}>{children}</View>
      </View>
    </View>
  )
}

export default React.memo(BannerFrame)
