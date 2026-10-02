import React, { useCallback } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Image, Keyboard, TouchableWithoutFeedback, View } from 'react-native'

import { isValidPassword } from '@ambire-common/services/validations'
import logo from '@common/assets/images/Ambire-Wallet-logo-colored-white-vertical.png'
import KeyStoreIcon from '@common/assets/svg/KeyStoreIcon'
import Button from '@common/components/Button'
import InputPassword from '@common/components/InputPassword'
import ScrollableWrapper, { WRAPPER_TYPES } from '@common/components/ScrollableWrapper'
import Text from '@common/components/Text'
import { isWeb } from '@common/config/env'
import { useTranslation } from '@common/config/localization'
import useDisableNavigatingBack from '@common/hooks/useDisableNavigatingBack'
import useNavigation from '@common/hooks/useNavigation'
import AnimatedArrows from '@common/modules/auth/components/AnimatedArrows'
import spacings, { IS_SCREEN_SIZE_S } from '@common/styles/spacings'
import flexboxStyles from '@common/styles/utils/flexbox'
import { delayPromise } from '@common/utils/promises'

const AddAccountPasswordToVaultScreen = () => {
  const { t } = useTranslation()
  // const {
  //   pendingLoginAccount: pendingEmailLoginAccount,
  //   handleLogin: handleEmailLogin,
  //   cancelLoginAttempts: cancelEmailLoginAttempts
  // } = useEmailLogin()
  // const {
  //   handleLogin: handleJsonLogin,
  //   pendingLoginWithQuickAccountData: pendingJsonLoginAccount,
  //   cancelLoginAttempts: cancelJsonLoginAttempts
  // } = useJsonLogin()
  const navigation = useNavigation()

  useDisableNavigatingBack(navigation)
  const {
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting }
  } = useForm({
    mode: 'all',
    defaultValues: {
      password: ''
    }
  })

  const handleFormSubmit = useCallback(() => {
    !isWeb && Keyboard.dismiss()

    handleSubmit(async ({ password }) => {
      // wait state update before Wallet calcs because
      // when Wallet method is called on devices with slow CPU the UI freezes
      await delayPromise(100)

      // TODO: v2
    })()
  }, [handleSubmit])

  const handleCancelLoginAttempts = useCallback(() => {
    // TODO: v2
  }, [])

  return (
    <TouchableWithoutFeedback
      onPress={() => {
        !isWeb && Keyboard.dismiss()
      }}
    >
      <ScrollableWrapper
        contentContainerStyle={spacings.pbLg}
        type={WRAPPER_TYPES.KEYBOARD_AWARE_SCROLL_VIEW}
        extraHeight={220}
      >
        <View
          style={[
            flexboxStyles.directionRow,
            flexboxStyles.justifyCenter,
            flexboxStyles.alignCenter,
            spacings.pv
          ]}
        >
          <Image
            source={{ uri: logo }}
            style={{
              height: IS_SCREEN_SIZE_S ? 96 : 136,
              width: 120,
              ...(isWeb ? { modalHeight: 120 } : {})
            }}
            resizeMode="contain"
          />
          <AnimatedArrows />
          <KeyStoreIcon height={IS_SCREEN_SIZE_S ? 96 : 136} width={120} />
        </View>

        <View style={[isWeb && spacings.ph, flexboxStyles.flex1, flexboxStyles.justifyEnd]}>
          <Text weight="regular" style={[spacings.mbMi, spacings.phTy]} fontSize={13}>
            {t(
              'When you add your account password to the Key Store, you will be able to sign transactions on this device using your passphrase only.'
            )}
          </Text>
          <Text weight="regular" style={[spacings.mb, spacings.phTy]} fontSize={13}>
            {t(
              'If you reset your passphrase or {{action}}, the Key Store will be removed from the device, however you can still use your account password on any other device.',
              { action: isWeb ? t('remove the extension') : t('uninstall the app') }
            )}
          </Text>

          <Controller
            control={control}
            rules={{ validate: isValidPassword }}
            render={({ field: { onChange, onBlur, value } }) => (
              <InputPassword
                onBlur={onBlur}
                placeholder={t('Ambire account password')}
                onChangeText={onChange}
                isValid={isValidPassword(value)}
                autoFocus={isWeb}
                disabled={isSubmitting}
                value={value}
                error={
                  errors.password &&
                  (t('Please fill in at least 8 characters for password.') as string)
                }
                onSubmitEditing={handleFormSubmit}
              />
            )}
            name="password"
          />

          <Button
            disabled={isSubmitting || !watch('password', '')}
            text={isSubmitting ? t('Adding to Key Store...') : t('Add password to Key Store')}
            onPress={handleFormSubmit}
          />

          <Button
            type="ghost"
            text={t('Cancel Login Attempt')}
            onPress={handleCancelLoginAttempts}
          />
        </View>
      </ScrollableWrapper>
    </TouchableWithoutFeedback>
  )
}

export default AddAccountPasswordToVaultScreen
