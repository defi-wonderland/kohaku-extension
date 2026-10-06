import React from 'react'
import { View } from 'react-native'

import AmbireLogoHorizontal from '@common/components/AmbireLogoHorizontal'
import Text from '@common/components/Text'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import { SETTINGS_HEADER_HEIGHT } from '@web/modules/settings/contexts/SettingsRoutesContext/styles'

import type { PlainHeaderProps } from './types'

const PlainHeader = ({ title, testID }: PlainHeaderProps) => (
  <View
    testID={testID}
    style={[flexbox.directionRow, flexbox.alignCenter, { height: SETTINGS_HEADER_HEIGHT }]}
  >
    <AmbireLogoHorizontal />
    {!!title && (
      <Text fontSize={16} weight="medium" style={spacings.mlSm}>
        {title}
      </Text>
    )}
  </View>
)

export default React.memo(PlainHeader)
