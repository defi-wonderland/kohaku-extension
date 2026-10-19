/**
 * The committed values beside the path: the waiting period, the recovery
 * password and the privacy level, each with the step that changes it, and the
 * line that a printed Recovery Card goes stale where the edit makes it so.
 */
import React from 'react'
import { View } from 'react-native'

import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import { SectionCard } from '@web/modules/social-recovery/shared/chrome'
import { privacyLevelOf } from '@web/modules/social-recovery/shared/client'
import { renderNoun, renderPasswordName } from '@web/modules/social-recovery/shared/display'
import { privacyLinesOf, renderWait } from '@web/modules/social-recovery/setup/review'

import { EDITOR } from './constants'
import { renderChange } from './copy'
import type { EditStage, ValuesBlockProps } from './types'

const ValuesBlock = ({ draft, addressBook, passwordChanged, stale, onStage }: ValuesBlockProps) => {
  const { t } = useTranslation()
  const level = privacyLevelOf(draft.privacy)

  const value = (label: string, text: string, action: string, stage: EditStage) => (
    <SectionCard label={label} spacing="item" testID={`manage-value-${stage}`}>
      <View style={[flexbox.directionRow, flexbox.alignCenter, flexbox.wrap]}>
        {!!text && (
          <Text
            fontSize={14}
            weight="medium"
            style={spacings.mrSm}
            testID={`manage-value-${stage}-text`}
          >
            {text}
          </Text>
        )}
        <Button
          testID={`manage-value-${stage}-change`}
          type="secondary"
          size="small"
          text={action}
          onPress={() => onStage(stage)}
          hasBottomSpacing={false}
        />
      </View>
    </SectionCard>
  )

  return (
    <View testID="manage-values">
      {value(
        renderNoun('waitingPeriod', t),
        renderWait(draft.wait, t),
        t(`${EDITOR}.values.change`),
        'wait'
      )}
      {level !== 'public' &&
        value(
          renderPasswordName('recoveryPassword', t),
          passwordChanged ? renderChange({ kind: 'password' }, t) : '',
          t(`${EDITOR}.password.action`),
          'password'
        )}
      {value(
        t('socialRecovery.review.privacyHeader'),
        privacyLinesOf(draft, addressBook, true, t)[0],
        t(`${EDITOR}.values.change`),
        'privacy'
      )}
      {stale && (
        <Text fontSize={14} weight="medium" style={spacings.mbSm} testID="manage-values-stale-card">
          {t(`${EDITOR}.staleCard`)}
        </Text>
      )}
    </View>
  )
}

export default React.memo(ValuesBlock)
