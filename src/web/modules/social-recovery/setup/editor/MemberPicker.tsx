import React from 'react'
import { View } from 'react-native'

import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import useTheme from '@common/hooks/useTheme'
import spacings from '@common/styles/spacings'
import common from '@common/styles/utils/common'
import flexbox from '@common/styles/utils/flexbox'
import ActionsRow from '@web/modules/social-recovery/shared/chrome/ActionsRow'
import SectionCard from '@web/modules/social-recovery/shared/chrome/SectionCard'
import SectionLabel from '@web/modules/social-recovery/shared/chrome/SectionLabel'

import { renderKindHeader } from './copy'
import CredentialRow from './CredentialRow'
import type { MemberPickerProps } from './types'

/**
 * "Add to your path": the enrolled credentials by kind, each one the path
 * already holds marked so, and for each kind the way to a new one: a new
 * address for a guardian, a new enrollment for the others.
 */
const MemberPicker = ({
  entries,
  kinds,
  addressBook,
  onPick,
  onEnrollNew,
  onClose,
  disabled
}: MemberPickerProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const enrollments = kinds.flatMap((kind) => entries[kind].map((entry) => entry.enrollment))

  return (
    <SectionCard testID="editor-picker">
      <Text fontSize={16} weight="medium" style={spacings.mbTy}>
        {t('socialRecovery.editor.picker.title')}
      </Text>
      <Text fontSize={14} appearance="secondaryText" style={spacings.mbMd}>
        {t('socialRecovery.editor.picker.lead')}
      </Text>
      {kinds.map((kind) => (
        <View key={kind} testID={`editor-picker-${kind}`} style={spacings.mbMd}>
          <SectionLabel>{renderKindHeader(kind, t)}</SectionLabel>
          {entries[kind].map(({ enrollment, inPath }, index) => (
            <View
              key={`${enrollment.credential.method}:${enrollment.credential.config}`}
              style={[
                flexbox.directionRow,
                flexbox.alignCenter,
                common.borderRadiusPrimary,
                spacings.phSm,
                spacings.pvSm,
                spacings.mbTy,
                { borderWidth: 1, borderColor: theme.primaryBorder }
              ]}
            >
              <CredentialRow
                credential={enrollment.credential}
                addressBook={addressBook}
                enrollments={enrollments}
              />
              {inPath && (
                <Text fontSize={12} appearance="secondaryText" style={spacings.mlSm}>
                  {t('socialRecovery.editor.picker.alreadyInPath')}
                </Text>
              )}
              <Button
                testID={`editor-picker-${kind}-${index}`}
                type="secondary"
                size="small"
                text={t('socialRecovery.actions.add')}
                onPress={() => onPick(enrollment.credential)}
                disabled={disabled}
                hasBottomSpacing={false}
                style={spacings.mlSm}
              />
            </View>
          ))}
          <Button
            testID={`editor-picker-${kind}-new`}
            type="secondary"
            size="small"
            text={
              kind === 'ecdsa'
                ? t('socialRecovery.editor.picker.newAddress')
                : t('socialRecovery.editor.picker.enrollNew')
            }
            onPress={() => onEnrollNew(kind)}
            disabled={disabled}
            hasBottomSpacing={false}
            style={[flexbox.alignSelfStart, spacings.mtTy]}
          />
        </View>
      ))}
      <ActionsRow
        primary={
          <Button
            testID="editor-picker-close"
            type="secondary"
            size="small"
            text={t('socialRecovery.ceremony.cancelAction')}
            onPress={onClose}
            hasBottomSpacing={false}
          />
        }
        note={t('socialRecovery.editor.picker.pickToContinue')}
      />
    </SectionCard>
  )
}

export default React.memo(MemberPicker)
