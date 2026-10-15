/**
 * The cancel screen's own blocks: the attempt's facts on the confirm, the
 * attempt a read found already ended (nothing sent), and the cancelled
 * terminal with its two defenses, the editor named in a line and moving funds.
 */
import React from 'react'
import { View } from 'react-native'

import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import { SectionCard } from '@web/modules/social-recovery/shared/chrome'
import {
  renderDateTimeInZone,
  renderFullAddress,
  renderValueLabel
} from '@web/modules/social-recovery/shared/display'
import { cancelGoneRoadKey, WRITES_KEYS } from '@web/modules/social-recovery/shared/writes'

import type { AttemptFactsProps, CancelledBlockProps, EndedBlockProps } from './types'

const BANNER = 'socialRecovery.watcher.banner'
const CANCEL = 'socialRecovery.cancel'

export const AttemptFacts = ({ attempt, timeZone }: AttemptFactsProps) => {
  const { t } = useTranslation()
  const date = renderDateTimeInZone(attempt.consumableAfter * 1000, timeZone).date
  return (
    <View style={spacings.mbSm} testID="cancel-facts">
      <Text fontSize={12} appearance="secondaryText">
        {renderValueLabel('newKey', t)}
      </Text>
      <Text
        fontSize={14}
        weight="number_medium"
        selectable
        style={spacings.mbTy}
        testID="cancel-new-key"
      >
        {attempt.newKey ? renderFullAddress(attempt.newKey) : t(`${BANNER}.newKeyPending`)}
      </Text>
      {attempt.executionDue ? (
        <>
          <Text fontSize={12} weight="semiBold" appearance="warningText" testID="cancel-due-chip">
            {t(`${BANNER}.executionDue`)}
          </Text>
          <Text fontSize={14} testID="cancel-due">
            {t(`${BANNER}.dueBody`, { date })}
          </Text>
        </>
      ) : (
        <Text fontSize={14} testID="cancel-finishes">
          {t(`${BANNER}.finishes`, { date })}
        </Text>
      )}
    </View>
  )
}

/** The attempt is gone in the read before any send: nothing was sent, and the road or the controller says why. */
export const EndedBlock = ({ reading, onBack }: EndedBlockProps) => {
  const { t } = useTranslation()
  const { ended } = reading
  return (
    <SectionCard testID="cancel-ended">
      <Text fontSize={14} style={spacings.mbTy} testID="cancel-ended-line">
        {t(`${CANCEL}.confirm.ended`)}
      </Text>
      {ended?.road === 'cancelled' && !!ended.cancelledBy && (
        <Text fontSize={14} style={spacings.mbTy} testID="cancel-ended-road">
          {t(cancelGoneRoadKey(ended.cancelledBy))}
        </Text>
      )}
      {ended?.road === 'executed' && !!ended.controller && (
        <View style={spacings.mbTy}>
          <Text fontSize={12} appearance="secondaryText">
            {t(WRITES_KEYS.nowControlledBy)}
          </Text>
          <Text fontSize={14} weight="number_medium" selectable testID="cancel-ended-controller">
            {renderFullAddress(ended.controller)}
          </Text>
        </View>
      )}
      <Button
        testID="cancel-back"
        type="secondary"
        size="small"
        text={t(`${CANCEL}.confirm.back`)}
        onPress={onBack}
        hasBottomSpacing={false}
        style={[flexbox.alignSelfStart, spacings.mtTy]}
      />
    </SectionCard>
  )
}

/**
 * The cancelled terminal. The owner's cancel ended the attempt: the methods it
 * used still work, so the terminal points at replacing them, which arrives with
 * a later release, and at moving funds. Another road ended it first: control
 * did not move, so no move-funds action.
 */
export const CancelledBlock = ({ after, onMoveFunds, onDone }: CancelledBlockProps) => {
  const { t } = useTranslation()
  const own = after.stage === 'cancelled'
  return (
    <SectionCard testID="cancel-cancelled">
      <Text
        fontSize={12}
        weight="semiBold"
        appearance="successText"
        style={spacings.mbTy}
        testID="cancel-cancelled-eyebrow"
      >
        {t(`${CANCEL}.cancelled.eyebrow`)}
      </Text>
      {own ? (
        <>
          <Text fontSize={16} weight="medium" style={spacings.mbTy} testID="cancel-cancelled-title">
            {t(`${CANCEL}.cancelled.title`)}
          </Text>
          <Text fontSize={14} style={spacings.mbTy} testID="cancel-cancelled-body">
            {t(`${CANCEL}.cancelled.body`)}
          </Text>
          <Text
            fontSize={14}
            appearance="secondaryText"
            style={spacings.mbTy}
            testID="cancel-cancelled-only-own-key"
          >
            {t(`${BANNER}.onlyOwnKey`)}
          </Text>
          <Text
            fontSize={14}
            appearance="secondaryText"
            style={spacings.mbTy}
            testID="cancel-cancelled-replace-later"
          >
            {t(`${CANCEL}.cancelled.replaceLater`)}
          </Text>
        </>
      ) : (
        <Text fontSize={14} style={spacings.mbTy} testID="cancel-other-road">
          {t(`${CANCEL}.cancelled.otherRoad`, { road: t(cancelGoneRoadKey(after.road)) })}
        </Text>
      )}
      <View style={[flexbox.directionRow, flexbox.wrap, spacings.mtTy]}>
        {own && (
          <Button
            testID="cancel-move-funds"
            type="primary"
            size="small"
            text={t(`${CANCEL}.cancelled.moveFunds`)}
            onPress={onMoveFunds}
            hasBottomSpacing={false}
            style={spacings.mrSm}
          />
        )}
        <Button
          testID="cancel-done"
          type="secondary"
          size="small"
          text={t(`${CANCEL}.cancelled.done`)}
          onPress={onDone}
          hasBottomSpacing={false}
        />
      </View>
    </SectionCard>
  )
}
