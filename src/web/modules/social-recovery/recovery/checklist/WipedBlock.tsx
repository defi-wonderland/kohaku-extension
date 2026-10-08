/**
 * A session a wipe ended: the reason it keeps, as its title and body, that
 * nothing was submitted, and the action that gathers again in its place. A
 * session another attempt voided offers no new gathering.
 */
import React from 'react'
import { View } from 'react-native'

import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import { ActionsRow, PageTitle } from '@web/modules/social-recovery/shared/chrome'
import { WIPE_REASON_STRING_KEYS } from '@web/modules/social-recovery/shared/records'

import { dateOf } from './lines'
import type { WipedBlockProps } from './types'

const WipedBlock = ({ session, timeZone, busy, failed, onGatherAgain }: WipedBlockProps) => {
  const { t } = useTranslation()
  const keys = WIPE_REASON_STRING_KEYS[session.reason]
  // While another attempt holds the account's one slot, a new set could not be submitted.
  const gathersAgain = session.reason !== 'another-attempt-opened'
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
      {failed && (
        <Alert
          testID="checklist-gather-again-failed"
          type="error"
          size="sm"
          style={spacings.mbSm}
          title={t('socialRecovery.client.unavailableTitle')}
          text={t('socialRecovery.client.unavailableBody')}
        />
      )}
      {gathersAgain && (
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
      )}
    </View>
  )
}

export default React.memo(WipedBlock)
