import React, { useEffect, useState } from 'react'
import { View } from 'react-native'

import Input from '@common/components/Input'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'

import type { ThresholdFieldProps } from './types'

/**
 * "Require N of M", with N typed by the holder. Any whole number goes through
 * to the path; the text stays as typed until it reads as one.
 */
const ThresholdField = ({
  threshold,
  members,
  onChange,
  disabled,
  testID
}: ThresholdFieldProps) => {
  const { t } = useTranslation()
  const [text, setText] = useState(String(threshold))

  useEffect(() => {
    setText((current) => (Number(current) === threshold ? current : String(threshold)))
  }, [threshold])

  const onChangeText = (next: string) => {
    setText(next)
    const value = Number(next)
    if (next.trim() !== '' && Number.isInteger(value)) {
      onChange(value)
    }
  }

  return (
    <View style={[flexbox.directionRow, flexbox.alignCenter]}>
      <Text fontSize={14} style={spacings.mrTy}>
        {t('socialRecovery.shape.require')}
      </Text>
      <Input
        testID={testID}
        value={text}
        onChangeText={onChangeText}
        keyboardType="numeric"
        disabled={disabled}
        containerStyle={{ ...spacings.mb0, width: 64 }}
      />
      <Text fontSize={14} style={spacings.mlTy}>
        {`${t('socialRecovery.shape.of')} ${members}`}
      </Text>
    </View>
  )
}

export default React.memo(ThresholdField)
