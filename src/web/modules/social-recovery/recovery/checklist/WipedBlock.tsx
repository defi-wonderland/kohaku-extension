/**
 * A session a wipe ended: the reason it keeps, as its title and body, that
 * nothing was submitted, and the action that clears the reason and gathers
 * again.
 */
import React from 'react'
import { View } from 'react-native'

import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import { ActionsRow, PageTitle } from '@web/modules/social-recovery/shared/chrome'
import { WIPE_REASON_STRING_KEYS } from '@web/modules/social-recovery/shared/records'

import { dateOf } from './lines'
import type { WipedBlockProps } from './types'

const WipedBlock = ({ session, timeZone, busy, onGatherAgain }: WipedBlockProps) => {
  const { t } = useTranslation()
  const keys = WIPE_REASON_STRING_KEYS[session.reason]
  const deadline = session.deadline !== undefined ? Number(session.deadline) * 1000 : NaN

  return (
    <View testID="checklist-wiped">
      {!!keys && (
        <PageTitle
          title={t(keys.title)}
          lead={t(keys.body, {
            deadline: Number.isFinite(deadline) ? dateOf(deadline, timeZone) : ''
          })}
          titleTestID="checklist-wiped-title"
        />
      )}
      <Text fontSize={14} style={spacings.mbSm} testID="checklist-wiped-note">
        {t('socialRecovery.records.wipedNote')}
      </Text>
      <ActionsRow
        primary={
          <Button
            testID="checklist-gather-again"
            type="primary"
            text={t('socialRecovery.checklist.deaths.gatherAgain')}
            disabled={busy}
            onPress={onGatherAgain}
            hasBottomSpacing={false}
          />
        }
      />
    </View>
  )
}

export default React.memo(WipedBlock)
