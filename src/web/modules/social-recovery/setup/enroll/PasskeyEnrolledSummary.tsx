/**
 * The passkey the slot holds: its name and test chip, the synced or
 * device-bound kind with what losing it means, and the origin it serves.
 */
import React from 'react'
import { View } from 'react-native'

import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import useTheme from '@common/hooks/useTheme'
import spacings from '@common/styles/spacings'
import common from '@common/styles/utils/common'
import flexbox from '@common/styles/utils/flexbox'
import { lossLineKeyOf, renderKindLine } from '@web/modules/social-recovery/shared/ceremony'
import StatusChip from '@web/modules/social-recovery/shared/chrome/StatusChip'
import { renderChip } from '@web/modules/social-recovery/shared/display'

import { TEST_CHIPS } from './outcome'
import type { PasskeyEnrolledSummaryProps } from './types'

const PasskeyEnrolledSummary = ({ enrollment, platform }: PasskeyEnrolledSummaryProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { facts } = enrollment

  return (
    <View
      style={[
        common.borderRadiusPrimary,
        spacings.phSm,
        spacings.pvSm,
        spacings.mbSm,
        {
          borderWidth: 1,
          borderColor: theme.primaryBorder,
          backgroundColor: theme.primaryBackground
        }
      ]}
    >
      <View
        style={[
          flexbox.directionRow,
          flexbox.alignCenter,
          flexbox.justifySpaceBetween,
          spacings.mbTy
        ]}
      >
        <Text
          testID="passkey-label"
          fontSize={16}
          weight="medium"
          style={[flexbox.flex1, spacings.mrSm]}
        >
          {enrollment.credential.label}
        </Text>
        <StatusChip
          testID="passkey-chip"
          text={renderChip('method', TEST_CHIPS[enrollment.test], t)}
        />
      </View>
      {!!facts && (
        <Text testID="passkey-kind-line" fontSize={14}>
          {renderKindLine(facts, platform, t)}
        </Text>
      )}
      {!!(facts ?? enrollment.backup) && (
        <Text testID="passkey-loss-line" fontSize={14} style={spacings.mbTy}>
          {t(lossLineKeyOf({ kind: facts?.kind ?? enrollment.backup ?? 'synced' }))}
        </Text>
      )}
      <Text testID="passkey-origin" fontSize={12} appearance="secondaryText">
        {t('socialRecovery.ceremony.passkeyOrigin')}
      </Text>
    </View>
  )
}

export default React.memo(PasskeyEnrolledSummary)
