import React, { useState } from 'react'
import { Pressable, View } from 'react-native'

import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import type { Credential } from '@web/modules/social-recovery/sdk-interfaces'
import { renderMemberList } from '@web/modules/social-recovery/shared/display'

import { isRequiredRow, pathRowOf } from './lead'
import type { PathBlockProps } from './types'

/**
 * The path as the editor draws it: the required rows, then each group under
 * its header with its threshold, three members and a count of the rest until
 * the holder shows them all.
 */
const PathBlock = ({ clauses, enrollments, addressBook }: PathBlockProps) => {
  const { t } = useTranslation()
  const [shownAll, setShownAll] = useState<number[]>([])

  const renderRow = (credential: Credential, testID: string) => {
    const row = pathRowOf(credential, enrollments, addressBook, t)
    return (
      <View key={testID} testID={testID} style={spacings.mbSm}>
        <View style={[flexbox.directionRow, flexbox.alignCenter, flexbox.wrap]}>
          <Text fontSize={14} weight="medium" style={spacings.mrTy} testID={`${testID}-name`}>
            {row.name}
          </Text>
          {!!row.aside && (
            <Text fontSize={14} style={spacings.mrTy} testID={`${testID}-aside`}>
              {row.aside}
            </Text>
          )}
          {!!row.chip && (
            <Text
              fontSize={12}
              weight="medium"
              appearance="secondaryText"
              testID={`${testID}-chip`}
            >
              {row.chip}
            </Text>
          )}
        </View>
        {row.lines.map((line, index) => (
          <Text
            // The lines of one row are fixed in number and order.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            fontSize={12}
            appearance="secondaryText"
            testID={`${testID}-line-${index}`}
          >
            {line}
          </Text>
        ))}
      </View>
    )
  }

  const hasRequired = clauses.some(isRequiredRow)
  let groupNumber = 0

  return (
    <View testID="review-path">
      <Text fontSize={12} weight="semiBold" appearance="secondaryText" style={spacings.mbTy}>
        {t('socialRecovery.review.pathHeader')}
      </Text>
      {hasRequired && (
        <Text fontSize={12} weight="medium" style={spacings.mbTy}>
          {t('socialRecovery.editor.requiredHeader')}
        </Text>
      )}
      {clauses.map((clause, index) =>
        isRequiredRow(clause) ? renderRow(clause.credentials[0], `review-row-${index}-0`) : null
      )}
      {clauses.map((clause, index) => {
        if (isRequiredRow(clause)) {
          return null
        }
        groupNumber += 1
        const list = renderMemberList(clause.credentials, { showAll: shownAll.includes(index) }, t)
        return (
          // Clauses have no identity of their own; their order is the path's.
          // eslint-disable-next-line react/no-array-index-key
          <View key={index} testID={`review-group-${index}`} style={spacings.mbSm}>
            <Text fontSize={14} weight="semiBold" style={spacings.mbTy}>
              {t('socialRecovery.shape.group', { n: groupNumber })}
            </Text>
            <View style={[flexbox.directionRow, flexbox.alignCenter, spacings.mbTy]}>
              <Text fontSize={14} style={spacings.mrTy}>
                {t('socialRecovery.shape.require')}
              </Text>
              <Text fontSize={14} weight="medium" style={spacings.mrTy}>
                {String(clause.threshold)}
              </Text>
              <Text fontSize={14} style={spacings.mrTy}>
                {t('socialRecovery.shape.of')}
              </Text>
              <Text fontSize={14} weight="medium">
                {String(clause.credentials.length)}
              </Text>
            </View>
            {list.shown.map((credential, member) =>
              renderRow(credential, `review-row-${index}-${member}`)
            )}
            {!!list.more && (
              <View style={[flexbox.directionRow, flexbox.alignCenter]}>
                <Text fontSize={12} appearance="secondaryText" style={spacings.mrTy}>
                  {list.more}
                </Text>
                <Pressable
                  testID={`review-group-${index}-show-all`}
                  onPress={() => setShownAll((held) => [...held, index])}
                >
                  <Text fontSize={12} weight="medium" appearance="primary">
                    {t('socialRecovery.review.showAllMembers')}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        )
      })}
    </View>
  )
}

export default React.memo(PathBlock)
