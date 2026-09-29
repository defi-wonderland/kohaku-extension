import React from 'react'
import { Pressable, View } from 'react-native'

import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'

import { renderKindName, renderRowChip } from './copy'
import { isEmptySlot, kindOf } from './operations'
import type { CredentialRowProps } from './types'

/**
 * One method of the path: its kind, the holder's own label where an enrolled
 * credential carries one, and its chip. An empty slot shows no address and
 * opens the picker when pressed.
 */
const CredentialRow = ({
  credential,
  addressBook,
  enrollments,
  onPress,
  testID
}: CredentialRowProps) => {
  const { t } = useTranslation()
  const kind = kindOf(credential, addressBook)
  const empty = isEmptySlot(credential)
  const chip = renderRowChip(credential, enrollments, t)
  const label = !empty && credential.label ? credential.label : null

  const content = (
    <View style={[flexbox.directionRow, flexbox.alignCenter, flexbox.wrap]}>
      <Text fontSize={14} weight="medium" style={spacings.mrTy}>
        {renderKindName(kind, t)}
      </Text>
      {!!label && (
        <Text fontSize={14} style={spacings.mrTy}>
          {label}
        </Text>
      )}
      {!!chip && (
        <Text fontSize={12} weight="medium" appearance="secondaryText">
          {chip}
        </Text>
      )}
    </View>
  )

  if (empty && onPress) {
    return (
      <Pressable testID={testID} onPress={onPress} style={flexbox.flex1}>
        {content}
      </Pressable>
    )
  }
  return (
    <View testID={testID} style={flexbox.flex1}>
      {content}
    </View>
  )
}

export default React.memo(CredentialRow)
