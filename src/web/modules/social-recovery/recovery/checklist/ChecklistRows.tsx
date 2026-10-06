/**
 * The checklist's rows: every required row first, then each group under its
 * header, the filled members against the group's threshold, every member
 * shown.
 */
import React from 'react'
import { View } from 'react-native'

import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'

import { filledIn } from './rows'
import type { ChecklistRowsProps } from './types'

const ChecklistRows = ({ layout, assessment, renderRow }: ChecklistRowsProps) => {
  const { t } = useTranslation()

  return (
    <View testID="checklist-rows">
      {layout.required.map((row) => (
        <React.Fragment key={row.place}>{renderRow(row)}</React.Fragment>
      ))}
      {layout.groups.map((group) => (
        <View key={group.clause} style={spacings.mtSm} testID={`checklist-group-${group.clause}`}>
          <Text
            fontSize={14}
            weight="semiBold"
            style={spacings.mbTy}
            testID={`checklist-group-${group.clause}-progress`}
          >
            {t('socialRecovery.checklist.groupProgress', {
              done: Math.min(filledIn(assessment, group.clause), group.threshold),
              count: group.threshold
            })}
          </Text>
          {group.rows.map((row) => (
            <React.Fragment key={row.place}>{renderRow(row)}</React.Fragment>
          ))}
        </View>
      ))}
    </View>
  )
}

export default React.memo(ChecklistRows)
