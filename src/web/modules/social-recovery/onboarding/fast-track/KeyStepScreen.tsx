/**
 * The key step's route. It opens only from the password step, which hands
 * on the warning's acknowledgment; any other arrival meets the warning first.
 * With no extension password yet the holder goes back to step 2; with a
 * locked keystore, to the wallet's unlock. Once the wallet lists the slot's
 * accounts, the holder goes on to the account step on the fresh install's
 * route, with the slot's smart account as the account that receives control.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

import { useTranslation } from '@common/config/localization'
import useNavigation from '@common/hooks/useNavigation'
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import useKeystoreControllerState from '@web/hooks/useKeystoreControllerState'
import RecoverScreen from '@web/modules/social-recovery/onboarding/recover/RecoverScreen'
import PlainChrome from '@web/modules/social-recovery/shared/chrome/PlainChrome'

import { ACKNOWLEDGED_STATE } from './constants'
import KeyStepView from './KeyStepView'
import { accountStepPathOf, acknowledgedOf } from './navigation'
import useAcknowledgment from './useAcknowledgment'
import useFastTrackKey from './useFastTrackKey'

const KeyStep = () => {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const location = useLocation()
  const key = useFastTrackKey()
  const [acknowledged, setAcknowledged] = useState(false)
  const dropping = acknowledgedOf(location.state)
  const { listed } = key

  useEffect(() => {
    if (listed && !dropping) {
      navigate(accountStepPathOf(listed.smartAccount))
    }
  }, [listed, dropping, navigate])

  const proceed = useCallback(() => {
    if (acknowledged) {
      key.add()
    }
  }, [acknowledged, key])

  return (
    <PlainChrome title={t('socialRecovery.routes.recover')} testID="fast-track-key-screen">
      <KeyStepView
        phase={key.phase}
        words={key.words}
        controllingKey={key.controllingKey}
        acknowledged={acknowledged}
        onAcknowledge={setAcknowledged}
        onContinue={proceed}
        onRetry={key.retry}
      />
    </PlainChrome>
  )
}

const KeyStepScreen = () => {
  const { navigate } = useNavigation()
  const location = useLocation()
  const acknowledged = useAcknowledgment()
  const { hasPasswordSecret, isUnlocked } = useKeystoreControllerState()
  const dropping = acknowledgedOf(location.state)

  const away = !acknowledged
    ? null
    : !hasPasswordSecret
    ? WEB_ROUTES.socialRecoveryFastTrack
    : !isUnlocked
    ? WEB_ROUTES.keyStoreUnlock
    : null

  useEffect(() => {
    if (away && !dropping) {
      navigate(away, {
        replace: true,
        ...(away === WEB_ROUTES.socialRecoveryFastTrack ? { state: ACKNOWLEDGED_STATE } : {})
      })
    }
  }, [away, dropping, navigate])

  if (!acknowledged) {
    return <RecoverScreen />
  }
  if (away) {
    return null
  }
  return <KeyStep />
}

export default React.memo(KeyStepScreen)
