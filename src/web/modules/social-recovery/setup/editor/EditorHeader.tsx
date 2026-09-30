import React from 'react'
import { View } from 'react-native'

import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'

import { renderClientRefusal } from './copy'
import type { EditorHeaderProps } from './types'

/**
 * The heading for building or adjusting a path, the line a refused duplicate
 * leaves, and the lines of a client that cannot run the path check.
 */
const EditorHeader = ({ mode, refused, clientRefusal }: EditorHeaderProps) => {
  const { t } = useTranslation()
  const heading = mode === 'adjust' ? 'adjust' : 'build'
  const refusalLines = clientRefusal ? renderClientRefusal(clientRefusal, t) : null

  return (
    <>
      <Text fontSize={20} weight="semiBold" style={spacings.mbTy} testID="editor-title">
        {t(`socialRecovery.editor.${heading}.title`)}
      </Text>
      <Text fontSize={14} appearance="secondaryText" style={spacings.mbLg}>
        {t(`socialRecovery.editor.${heading}.lead`)}
      </Text>

      {refused && (
        <Text fontSize={14} appearance="errorText" style={spacings.mbMd} testID="editor-refusal">
          {t('socialRecovery.editor.duplicate')}
        </Text>
      )}

      {!!refusalLines && (
        <View style={spacings.mbMd} testID="editor-client-refusal">
          <Text fontSize={14} weight="semiBold" appearance="errorText" style={spacings.mbTy}>
            {refusalLines.title}
          </Text>
          <Text fontSize={14} appearance="secondaryText">
            {refusalLines.body}
          </Text>
        </View>
      )}
    </>
  )
}

export default React.memo(EditorHeader)
