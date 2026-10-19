/**
 * The groups whose every member the rule needs, each with the still needed
 * chip and the fix: lower the threshold or add a replacement before removing
 * one of its members.
 */
import React from 'react'
import { View } from 'react-native'

import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import { SectionCard, StatusChip } from '@web/modules/social-recovery/shared/chrome'
import { renderChip } from '@web/modules/social-recovery/shared/display'

import { EDITOR } from './constants'
import type { StillNeededBlockProps } from './types'

const StillNeededBlock = ({ groups }: StillNeededBlockProps) => {
  const { t } = useTranslation()

  return (
    <>
      {groups.map(({ clause, required, count }) => (
        <SectionCard key={clause} testID={`manage-still-needed-${clause}`}>
          <View style={[flexbox.directionRow, flexbox.alignCenter, flexbox.wrap, spacings.mbTy]}>
            <StatusChip
              text={renderChip('editor', 'stillNeeded', t)}
              tone="warning"
              style={spacings.mrSm}
              testID={`manage-still-needed-${clause}-chip`}
            />
            <Text fontSize={16} weight="medium">
              {t(`${EDITOR}.stillNeeded.title`)}
            </Text>
          </View>
          <Text fontSize={14} appearance="secondaryText">
            {t(`${EDITOR}.stillNeeded.body`, { required, count })}
          </Text>
        </SectionCard>
      ))}
    </>
  )
}

export default React.memo(StillNeededBlock)
