/**
 * The guardian's advisory checks, each a line the holder reads and none a
 * gate.
 */
import React from 'react'

import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import SectionCard from '@web/modules/social-recovery/shared/chrome/SectionCard'
import SectionLabel from '@web/modules/social-recovery/shared/chrome/SectionLabel'

import type { GuardianChecksBlockProps } from './types'

const GuardianChecksBlock = ({ lines }: GuardianChecksBlockProps) => {
  const { t } = useTranslation()

  return (
    <SectionCard tone="muted" testID="guardian-checks" style={spacings.mbSm}>
      <SectionLabel>{t('socialRecovery.enroll.guardian.checksHeader')}</SectionLabel>
      {lines.map((line) => (
        <Text key={line.key} testID="guardian-check" fontSize={14} style={spacings.mbTy}>
          {t(line.key, line.values)}
        </Text>
      ))}
      <Text fontSize={12} appearance="secondaryText">
        {t('socialRecovery.enroll.guardian.advisory')}
      </Text>
    </SectionCard>
  )
}

export default React.memo(GuardianChecksBlock)
