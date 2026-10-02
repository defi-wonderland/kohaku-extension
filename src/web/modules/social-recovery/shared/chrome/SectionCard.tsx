import React from 'react'
import { View } from 'react-native'

import useTheme from '@common/hooks/useTheme'
import spacings from '@common/styles/spacings'
import common from '@common/styles/utils/common'

import SectionLabel from './SectionLabel'
import type { SectionCardProps } from './types'

const SectionCard = ({ label, tone = 'plain', children, style, testID }: SectionCardProps) => {
  const { theme } = useTheme()

  return (
    <View
      testID={testID}
      style={[
        common.borderRadiusSecondary,
        spacings.ph,
        spacings.pv,
        spacings.mbLg,
        {
          borderWidth: 1,
          borderColor: theme.secondaryBorder,
          backgroundColor: tone === 'muted' ? theme.secondaryBackground : theme.primaryBackground
        },
        style
      ]}
    >
      {!!label && <SectionLabel>{label}</SectionLabel>}
      {children}
    </View>
  )
}

export default React.memo(SectionCard)
