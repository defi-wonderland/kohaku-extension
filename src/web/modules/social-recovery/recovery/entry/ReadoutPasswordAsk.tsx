/**
 * The recovery password ask at a hidden level: the field and unlock, the
 * check running, the wrong password's blocker with the pointer to the card,
 * and the failed read of the setup event after a password that worked. Each
 * state keeps the line that the account has a recovery setup. The field's
 * value lives in this component alone and is emptied once a check starts.
 */
import React, { useCallback, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'

import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import InputPassword from '@common/components/InputPassword'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import { ActionsRow, NoteBox, SectionCard } from '@web/modules/social-recovery/shared/chrome'
import { renderPasswordName } from '@web/modules/social-recovery/shared/display'

import type { ReadoutPasswordAskProps } from './types'

const READOUT = 'socialRecovery.readout'
const CONFIGURED = 'socialRecovery.client.updateTheWalletBody'

const ReadoutPasswordAsk = ({
  level,
  unlock,
  networkName,
  onUnlock,
  onAskAgain,
  onRetry,
  onBack
}: ReadoutPasswordAskProps) => {
  const { t } = useTranslation()
  const [typed, setTyped] = useState('')

  const submit = useCallback(() => {
    if (!typed) {
      return
    }
    onUnlock(typed)
    setTyped('')
  }, [typed, onUnlock])

  const back = (
    <Button
      testID="readout-back"
      type="outline"
      text={t('socialRecovery.ceremony.backAction')}
      onPress={onBack}
      hasBottomSpacing={false}
    />
  )

  const configured = (
    <Text fontSize={14} appearance="secondaryText" testID="readout-configured">
      {t(CONFIGURED)}
    </Text>
  )

  if (unlock.status === 'checking') {
    return (
      <View testID="readout-unlock-checking">
        <ActivityIndicator style={spacings.mbSm} />
        <Text fontSize={14} appearance="secondaryText" style={spacings.mbTy}>
          {level === 'private'
            ? t(`${READOUT}.reading`, { network: networkName })
            : t(`${READOUT}.readingDetails`)}
        </Text>
        {configured}
      </View>
    )
  }

  if (unlock.status === 'wrong') {
    return (
      <View testID="readout-wrong-password">
        <Alert
          testID="readout-wrong-password-alert"
          type="error"
          size="sm"
          style={spacings.mbSm}
          title={t(`${READOUT}.wrongPassword.title`)}
          text={t(`${READOUT}.wrongPassword.cardPointer`)}
        >
          <View style={[flexbox.directionRow, spacings.mtTy]}>
            <Button
              testID="readout-wrong-password-retry"
              type="secondary"
              size="small"
              text={t('socialRecovery.writes.tryAgain')}
              onPress={onAskAgain}
              hasBottomSpacing={false}
            />
          </View>
        </Alert>
        {configured}
        <ActionsRow primary={back} />
      </View>
    )
  }

  if (unlock.status === 'event-failed') {
    return (
      <View testID="readout-event-failed">
        <Alert
          testID="readout-event-failed-alert"
          type="error"
          size="sm"
          style={spacings.mbSm}
          title={t(`${READOUT}.eventFailed.title`, { network: networkName })}
          text={t(`${READOUT}.eventFailed.body`, { network: networkName })}
        >
          <View style={[flexbox.directionRow, spacings.mtTy]}>
            <Button
              testID="readout-event-failed-retry"
              type="secondary"
              size="small"
              text={t('socialRecovery.writes.tryAgain')}
              onPress={onRetry}
              hasBottomSpacing={false}
            />
          </View>
        </Alert>
        {configured}
        <ActionsRow primary={back} />
      </View>
    )
  }

  return (
    <View testID="readout-locked">
      <SectionCard>
        {level === 'private' && (
          <>
            <Text fontSize={16} weight="medium" style={spacings.mbTy} testID="readout-locked-title">
              {t(`${READOUT}.locked.title`)}
            </Text>
            <Text fontSize={14} style={spacings.mbSm}>
              {t(`${READOUT}.locked.enterPassword`)}
            </Text>
          </>
        )}
        <InputPassword
          testID="readout-password-field"
          label={renderPasswordName('recoveryPassword', t)}
          accessibilityLabel={renderPasswordName('recoveryPassword', t)}
          value={typed}
          onChangeText={setTyped}
          onSubmitEditing={submit}
          containerStyle={spacings.mb0}
        />
        <Text fontSize={12} appearance="secondaryText" style={spacings.mtTy}>
          {t(`${READOUT}.locked.notExtensionPassword`)}
        </Text>
        {level === 'private' && (
          <Text fontSize={12} appearance="secondaryText" style={spacings.mtTy}>
            {t(`${READOUT}.locked.cannotBegin`)}
          </Text>
        )}
      </SectionCard>
      <NoteBox testID="readout-two-passwords">{t(`${READOUT}.twoPasswords.body`)}</NoteBox>
      <ActionsRow
        primary={
          <Button
            testID="readout-unlock"
            type="primary"
            text={t(`${READOUT}.unlock`)}
            disabled={!typed}
            onPress={submit}
            hasBottomSpacing={false}
          />
        }
        secondary={back}
      />
    </View>
  )
}

export default React.memo(ReadoutPasswordAsk)
