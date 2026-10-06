/**
 * A guardian row: the guardian's name where the path names one, its short
 * address, the chip, the approval once one is added, and the slot the row's
 * carriers mount in. While the row is open the recoverer can note it declined
 * or unanswered, a note one tap clears.
 */
import React from 'react'
import { View } from 'react-native'

import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import {
  renderNoun,
  renderResolvedName,
  renderShortAddress
} from '@web/modules/social-recovery/shared/display'
import { guardianAddressOf } from '@web/modules/social-recovery/setup/review'

import GuardianCarriers from './GuardianCarriers'
import { dateOf } from './lines'
import RowFrame from './RowFrame'
import type { GuardianRowProps } from './types'

const GUARDIAN = 'socialRecovery.checklist.guardian'

const GuardianRow = ({
  row,
  state,
  request,
  sessionSavedAt,
  timeZone,
  busy,
  setNote,
  addReply
}: GuardianRowProps) => {
  const { t } = useTranslation()
  const { place } = row
  const address = guardianAddressOf(row.gatheringPlace)
  const short = address ? renderShortAddress(address) : undefined
  const named = row.gatheringPlace.label
    ? renderResolvedName(row.gatheringPlace.label, 'informationOnly', t)
    : null
  const open = !state.replied && state.chip !== 'notNeeded'

  const noteButton = (key: string, testID: string, onPress: () => void, primary = false) => (
    <Button
      testID={testID}
      type={primary ? 'secondary' : 'ghost'}
      size="small"
      text={t(key)}
      disabled={busy}
      onPress={onPress}
      hasBottomSpacing={false}
      style={spacings.mrSm}
    />
  )

  return (
    <RowFrame
      row={row}
      state={state}
      title={renderNoun('guardian', t)}
      label={named ? named.name : short}
      detail={named ? short : undefined}
    >
      {state.replied && (
        <Text fontSize={14} style={spacings.mtTy} testID={`checklist-row-${place}-added`}>
          {t(`${GUARDIAN}.added`, { date: dateOf(sessionSavedAt, timeZone) })}
        </Text>
      )}
      <GuardianCarriers
        place={place}
        request={request}
        replied={state.replied}
        busy={busy}
        addReply={addReply}
      />
      {open && !state.note && (
        <View style={spacings.mtSm}>
          <View style={[flexbox.directionRow, flexbox.alignCenter, flexbox.wrap]}>
            {noteButton(`${GUARDIAN}.markDeclined`, `checklist-row-${place}-mark-declined`, () =>
              setNote(place, 'declined')
            )}
            {noteButton(
              `${GUARDIAN}.markUnanswered`,
              `checklist-row-${place}-mark-unanswered`,
              () => setNote(place, 'unanswered')
            )}
          </View>
          <Text fontSize={12} appearance="secondaryText" style={spacings.mtTy}>
            {t(`${GUARDIAN}.noteLine`)}
          </Text>
        </View>
      )}
      {open && !!state.note && (
        <View style={[flexbox.directionRow, flexbox.alignCenter, flexbox.wrap, spacings.mtSm]}>
          <Text
            fontSize={14}
            style={[flexbox.flex1, spacings.mrSm]}
            testID={`checklist-row-${place}-marked`}
          >
            {t(
              state.note === 'declined'
                ? `${GUARDIAN}.markedDeclined`
                : `${GUARDIAN}.markedUnanswered`
            )}
          </Text>
          {noteButton(
            `${GUARDIAN}.clear`,
            `checklist-row-${place}-clear`,
            () => setNote(place, null),
            true
          )}
        </View>
      )}
    </RowFrame>
  )
}

export default React.memo(GuardianRow)
