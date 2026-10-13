/**
 * The approval page over an answered reading: the notice that the page shows
 * what its link says, the lead, verify the details, then in the sign
 * action's place the acknowledgment and the actions while the request lives,
 * or the waiting recovery or the death that ended the request. A live
 * request the account no longer authorizes reads as dormant beside its
 * values, and its sign action stays disabled.
 */
import React, { useMemo, useState } from 'react'
import { View } from 'react-native'

import Alert from '@common/components/Alert'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'

import DetailsBlock from './DetailsBlock'
import LeadBlock from './LeadBlock'
import OutcomeBlock from './OutcomeBlock'
import { signEnabled } from './reading'
import SignBlock from './SignBlock'
import type { ApproveViewProps } from './types'
import { approvalValuesOf, deadlineViewOf } from './values'

const PAGE = 'socialRecovery.guardianPage'

const ApproveView = ({
  described,
  reading,
  networkName,
  now,
  timeZone,
  onClose,
  onDecline
}: ApproveViewProps) => {
  const { t } = useTranslation()
  const [acknowledged, setAcknowledged] = useState(false)
  const { description } = described

  const values = useMemo(() => approvalValuesOf(description, t), [description, t])
  const deadline = deadlineViewOf(description.validUntil, now, timeZone, t)
  const enabled = signEnabled({ values, deadline, reading, acknowledged })

  return (
    <View testID="guardian-page">
      <Text fontSize={12} appearance="secondaryText" style={spacings.mbTy}>
        {t(`${PAGE}.brand`)}
      </Text>
      <Text fontSize={12} appearance="secondaryText" style={spacings.mbLg} testID="guardian-notice">
        {t(`${PAGE}.notice`)}
      </Text>
      <LeadBlock values={values} />
      <DetailsBlock described={described} deadline={deadline} networkName={networkName} />
      {reading.kind === 'live' ? (
        <>
          {!reading.authorized && (
            <Alert
              testID="guardian-dormant"
              type="warning"
              size="sm"
              style={spacings.mbSm}
              text={t(`${PAGE}.dormant`)}
            />
          )}
          <SignBlock
            acknowledged={acknowledged}
            onAcknowledged={setAcknowledged}
            enabled={enabled}
            onDecline={onDecline}
          />
        </>
      ) : (
        <OutcomeBlock reading={reading} timeZone={timeZone} onClose={onClose} />
      )}
    </View>
  )
}

export default React.memo(ApproveView)
