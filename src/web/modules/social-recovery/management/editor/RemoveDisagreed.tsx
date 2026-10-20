/**
 * The removal whose check after the landing disagrees: a read of the same
 * check again answers the same, so the overview reads what stands.
 */
import React from 'react'
import { View } from 'react-native'

import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import { OVERVIEW } from '@web/modules/social-recovery/management/overview/constants'

import type { RemoveDisagreedProps } from './types'

const RemoveDisagreed = ({ onOverview }: RemoveDisagreedProps) => {
  const { t } = useTranslation()
  return (
    <Alert
      testID="manage-remove-check-disagreed"
      type="error"
      size="sm"
      style={spacings.mbSm}
      title={t(`${OVERVIEW}.reads.failedTitle`)}
      text={t(`${OVERVIEW}.reads.failedBody`)}
    >
      <View style={[flexbox.directionRow, spacings.mtTy]}>
        <Button
          testID="manage-remove-check-disagreed-overview"
          type="secondary"
          size="small"
          text={t(`${OVERVIEW}.writes.openOverview`)}
          onPress={onOverview}
          hasBottomSpacing={false}
        />
      </View>
    </Alert>
  )
}

export default React.memo(RemoveDisagreed)
