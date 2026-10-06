/**
 * Step 2 of 3: the extension password, set as on any first run through the
 * wallet's own keystore setup, in the fast track's words. Continue stays
 * disabled until both fields agree and the password meets the wallet's rule.
 */
import React, { useCallback } from 'react'
import { Controller } from 'react-hook-form'
import { View } from 'react-native'

import { isValidPassword } from '@ambire-common/services/validations'
import Button from '@common/components/Button'
import Input from '@common/components/Input'
import InputPassword from '@common/components/InputPassword'
import Text from '@common/components/Text'
import { isWeb } from '@common/config/env'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import {
  ActionsRow,
  PageTitle,
  SectionCard,
  StepCounter
} from '@web/modules/social-recovery/shared/chrome'
import {
  FAST_TRACK_STEP_COUNTER_KEY,
  FAST_TRACK_STEPS
} from '@web/modules/social-recovery/onboarding/recover'

import { PASSWORD_MIN_LENGTH, PASSWORD_STEP } from './constants'
import type { PasswordStepViewProps } from './types'

const PASSWORD = 'socialRecovery.fastTrack.password'

const PasswordStepView = ({ setup }: PasswordStepViewProps) => {
  const { t } = useTranslation()
  const { control, formState, password, handleKeystoreSetup, isKeystoreSetupLoading } = setup

  const disabled = formState.isSubmitting || isKeystoreSetupLoading || !formState.isValid

  const submit = useCallback(async () => {
    if (disabled) {
      return
    }
    await handleKeystoreSetup()
  }, [disabled, handleKeystoreSetup])

  const strong = isValidPassword(password)

  return (
    <View testID="fast-track-password">
      <StepCounter
        labelKey={FAST_TRACK_STEP_COUNTER_KEY}
        step={PASSWORD_STEP}
        total={FAST_TRACK_STEPS}
        testID="fast-track-password-step"
      />
      <PageTitle
        title={t(`${PASSWORD}.title`)}
        lead={t(`${PASSWORD}.lead`)}
        titleTestID="fast-track-password-title"
      />

      <Controller
        control={control}
        name="password"
        rules={{ validate: isValidPassword }}
        render={({ field: { onChange, onBlur, value } }) => (
          <InputPassword
            label={t('socialRecovery.display.passwords.extensionPassword')}
            testID="fast-track-password-field"
            onBlur={onBlur}
            onChangeText={onChange}
            isValid={isValidPassword(value)}
            autoFocus={isWeb}
            value={value}
            containerStyle={spacings.mbTy}
          />
        )}
      />
      <Text
        fontSize={12}
        appearance={strong ? 'successText' : 'secondaryText'}
        style={spacings.mbSm}
        testID="fast-track-password-rule"
      >
        {strong
          ? t(`${PASSWORD}.strong`, { count: password.length })
          : t(`${PASSWORD}.rulesLine`, { count: PASSWORD_MIN_LENGTH })}
      </Text>
      <Controller
        control={control}
        name="confirmPassword"
        rules={{ validate: (value) => password === value }}
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            label={t(`${PASSWORD}.repeatLabel`)}
            testID="fast-track-password-repeat"
            onBlur={onBlur}
            onChangeText={onChange}
            value={value}
            isValid={!!value && strong && password === value}
            secureTextEntry
            error={formState.errors.confirmPassword ? t(`${PASSWORD}.mismatch`) : undefined}
            autoCorrect={false}
            onSubmitEditing={submit}
            containerStyle={spacings.mbSm}
          />
        )}
      />

      <SectionCard
        tone="muted"
        label={t(`${PASSWORD}.whatHeader`)}
        testID="fast-track-password-what"
      >
        {['thisDeviceOnly', 'forgotten', 'staysHere', 'twoPasswords'].map((line) => (
          <Text key={line} fontSize={14} style={spacings.mbTy}>
            {t(`${PASSWORD}.${line}`)}
          </Text>
        ))}
      </SectionCard>

      <ActionsRow
        testID="fast-track-password-actions"
        primary={
          <Button
            testID="fast-track-password-continue"
            type="primary"
            text={t('socialRecovery.actions.continue')}
            disabled={disabled}
            onPress={submit}
            hasBottomSpacing={false}
          />
        }
      />
    </View>
  )
}

export default React.memo(PasswordStepView)
