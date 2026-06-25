import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { View } from 'react-native'

import Button from '@common/components/Button'
import Input from '@common/components/Input'
import Text from '@common/components/Text'
import useTheme from '@common/hooks/useTheme'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import useBackgroundService from '@web/hooks/useBackgroundService'
import useRecoveryControllerState from '@web/hooks/useRecoveryControllerState'

/**
 * Recovery v0 demo form.
 *
 * Proves the END-TO-END path (GUI -> recovery controller -> real ERC-7579
 * `executeFromExecutor` -> account signer rotation on local anvil). The recovery
 * POLICY is intentionally trivial for v0 (AlwaysValidMethod); this screen is not
 * the production combinator UI.
 *
 * State is read from the `recovery` controller via `useRecoveryControllerState`.
 * Every mutation is dispatched to the background through one of the
 * `RECOVERY_CONTROLLER_*` actions.
 */

const TARGETS: { key: 'native' | 'ambire'; label: string }[] = [
  { key: 'native', label: 'Native 7579' },
  { key: 'ambire', label: 'Ambire' }
]

const shortAddr = (addr?: string | null) =>
  addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—'

const RecoveryForm = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { dispatch } = useBackgroundService()
  const {
    configured,
    selectedTarget,
    targetAccount,
    controllerAddress,
    newOwner,
    status,
    lastTxHash,
    lastError,
    currentOwner,
    newOwnerIsAuthorized
  } = useRecoveryControllerState()

  // Local mirror for the deployment-JSON textarea and the new-owner input so the
  // user can type freely; committed to the controller on blur / explicit action.
  const [deploymentJson, setDeploymentJson] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [newOwnerDraft, setNewOwnerDraft] = useState(newOwner || '')

  const isSending = status === 'sending'
  const canRecover = !!configured && !!newOwner && !isSending

  const handleLoadDeployment = useCallback(() => {
    setJsonError('')
    try {
      const deployment = JSON.parse(deploymentJson)
      dispatch({
        type: 'RECOVERY_CONTROLLER_SETUP',
        params: { deployment, target: selectedTarget || 'native' }
      })
    } catch (e: any) {
      setJsonError(t('Invalid JSON: {{message}}', { message: e?.message || String(e) }))
    }
  }, [deploymentJson, dispatch, selectedTarget, t])

  const handleSelectTarget = useCallback(
    (target: 'native' | 'ambire') => {
      dispatch({ type: 'RECOVERY_CONTROLLER_SELECT_TARGET', params: { target } })
    },
    [dispatch]
  )

  const handleCommitNewOwner = useCallback(() => {
    dispatch({
      type: 'RECOVERY_CONTROLLER_SET_NEW_OWNER',
      params: { newOwner: newOwnerDraft.trim() }
    })
  }, [dispatch, newOwnerDraft])

  const handleRecover = useCallback(() => {
    if (!canRecover) return
    dispatch({ type: 'RECOVERY_CONTROLLER_INITIATE_RECOVERY' })
  }, [canRecover, dispatch])

  const handleRefresh = useCallback(() => {
    dispatch({ type: 'RECOVERY_CONTROLLER_REFRESH_STATUS' })
  }, [dispatch])

  const statusAppearance =
    status === 'error' ? 'errorText' : status === 'mined' ? 'successText' : 'secondaryText'

  return (
    <View style={[flexbox.flex1, spacings.ptSm, { maxWidth: 620 }]}>
      <Text fontSize={12} appearance="secondaryText" style={spacings.mbLg}>
        {t(
          'Recovery v0 demo. Rotates the account signer via a real ERC-7579 executor module on local anvil (chainId 31337). Policy is trivial (AlwaysValid) — this proves the end-to-end path, not the production combinator.'
        )}
      </Text>

      {/* 1. Deployment loader */}
      <Text fontSize={14} weight="medium" style={spacings.mbTy}>
        {t('1. Deployment')}
      </Text>
      <Input
        label={t('anvil-v0.json (paste deployment)')}
        placeholder='{"chainId":31337,"rpcUrl":"http://127.0.0.1:8545", ...}'
        value={deploymentJson}
        onChangeText={setDeploymentJson}
        multiline
        numberOfLines={5}
        error={jsonError}
        nativeInputStyle={{ minHeight: 96, textAlignVertical: 'top' }}
        containerStyle={spacings.mbSm}
      />
      <Button
        type="secondary"
        size="small"
        text={t('Load deployment')}
        onPress={handleLoadDeployment}
        disabled={!deploymentJson.trim()}
        hasBottomSpacing={false}
        style={{ alignSelf: 'flex-start' }}
      />
      <Text
        fontSize={12}
        appearance={configured ? 'successText' : 'secondaryText'}
        style={[spacings.mtTy, spacings.mbLg]}
      >
        {configured ? t('Configured') : t('Not configured')}
      </Text>

      {/* 2. Target selector */}
      <Text fontSize={14} weight="medium" style={spacings.mbTy}>
        {t('2. Target')}
      </Text>
      <View style={[flexbox.directionRow, spacings.mbSm]}>
        {TARGETS.map((target) => (
          <Button
            key={target.key}
            type={selectedTarget === target.key ? 'primary' : 'secondary'}
            size="small"
            text={target.label}
            onPress={() => handleSelectTarget(target.key)}
            hasBottomSpacing={false}
            style={spacings.mrTy}
          />
        ))}
      </View>
      <View style={[flexbox.directionRow, flexbox.alignCenter, spacings.mbTy]}>
        <Text fontSize={12} appearance="secondaryText" style={{ width: 130 }}>
          {t('Target account')}
        </Text>
        <Text fontSize={12} selectable>
          {shortAddr(targetAccount)}
        </Text>
      </View>
      <View style={[flexbox.directionRow, flexbox.alignCenter, spacings.mbLg]}>
        <Text fontSize={12} appearance="secondaryText" style={{ width: 130 }}>
          {t('Controller')}
        </Text>
        <Text fontSize={12} selectable>
          {shortAddr(controllerAddress)}
        </Text>
      </View>

      {/* 3. New owner */}
      <Text fontSize={14} weight="medium" style={spacings.mbTy}>
        {t('3. New owner')}
      </Text>
      <Input
        label={t('New owner address')}
        placeholder="0x..."
        value={newOwnerDraft}
        onChangeText={setNewOwnerDraft}
        onBlur={handleCommitNewOwner}
        onSubmitEditing={handleCommitNewOwner}
        containerStyle={spacings.mbLg}
      />

      {/* 4. Recover */}
      <Button
        type="primary"
        text={isSending ? t('Recovering…') : t('Recover')}
        onPress={handleRecover}
        disabled={!canRecover}
        hasBottomSpacing={false}
        style={{ alignSelf: 'flex-start' }}
      />

      {/* 5. Status panel */}
      <View
        style={[
          spacings.mtLg,
          spacings.pvSm,
          spacings.phSm,
          { borderRadius: 8, borderWidth: 1, borderColor: theme.secondaryBorder }
        ]}
      >
        <View style={[flexbox.directionRow, flexbox.alignCenter, flexbox.justifySpaceBetween]}>
          <Text fontSize={14} weight="medium">
            {t('Status')}
          </Text>
          <Button
            type="ghost"
            size="tiny"
            text={t('Refresh')}
            onPress={handleRefresh}
            hasBottomSpacing={false}
          />
        </View>
        <View style={[flexbox.directionRow, flexbox.alignCenter, spacings.mtTy]}>
          <Text fontSize={12} appearance="secondaryText" style={{ width: 130 }}>
            {t('State')}
          </Text>
          <Text fontSize={12} appearance={statusAppearance as any}>
            {status || 'initial'}
          </Text>
        </View>
        <View style={[flexbox.directionRow, flexbox.alignCenter, spacings.mtTy]}>
          <Text fontSize={12} appearance="secondaryText" style={{ width: 130 }}>
            {t('Current owner')}
          </Text>
          <Text fontSize={12} selectable>
            {shortAddr(currentOwner)}
          </Text>
        </View>
        <View style={[flexbox.directionRow, flexbox.alignCenter, spacings.mtTy]}>
          <Text fontSize={12} appearance="secondaryText" style={{ width: 130 }}>
            {t('New owner authorized')}
          </Text>
          <Text fontSize={12} appearance={newOwnerIsAuthorized ? 'successText' : 'secondaryText'}>
            {newOwnerIsAuthorized ? t('yes') : t('no')}
          </Text>
        </View>
        {!!lastTxHash && (
          <View style={[flexbox.directionRow, flexbox.alignCenter, spacings.mtTy]}>
            <Text fontSize={12} appearance="secondaryText" style={{ width: 130 }}>
              {t('Tx hash')}
            </Text>
            <Text fontSize={12} selectable>
              {lastTxHash}
            </Text>
          </View>
        )}
        {!!lastError && (
          <Text fontSize={12} appearance="errorText" style={spacings.mtTy} selectable>
            {lastError}
          </Text>
        )}
      </View>
    </View>
  )
}

export default React.memo(RecoveryForm)
