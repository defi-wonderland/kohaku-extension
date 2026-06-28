import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, View } from 'react-native'
import { useModalize } from 'react-native-modalize'

import { isSmartAccount } from '@ambire-common/libs/account/account'
import { Key } from '@ambire-common/interfaces/keystore'
import { SigningStatus } from '@ambire-common/controllers/signAccountOp/signAccountOp'
import Button from '@common/components/Button'
import Input from '@common/components/Input'
import Text from '@common/components/Text'
import useTheme from '@common/hooks/useTheme'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import { createTab } from '@web/extension-services/background/webapi/tab'
import useAccountsControllerState from '@web/hooks/useAccountsControllerState'
import useBackgroundService from '@web/hooks/useBackgroundService'
import useRecoveryControllerState from '@web/hooks/useRecoveryControllerState'
import useSelectedAccountControllerState from '@web/hooks/useSelectedAccountControllerState'
import Estimation from '@web/modules/sign-account-op/components/OneClick/Estimation'

/**
 * Recovery v0 demo form — fully in-extension Activate / Recover on Sepolia.
 *
 * Proves the REAL path (GUI -> recovery controller -> CREATE2 deploy of the
 * recovery contracts via the wallet's native rails -> real signing pipeline ->
 * ERC-7579 `executeFromExecutor` signer rotation), with no external deploy
 * scripts and no throwaway keys. The recovery POLICY is intentionally trivial
 * for v0 (AlwaysValidMethod); this screen proves the end-to-end path, not the
 * production combinator UI.
 *
 * Two accounts are involved:
 *   - Account A: the account being recovered. Activate runs while A is selected
 *     and is signed by A's owner.
 *   - Account B: the new owner + sender. Recover runs while B is selected; B
 *     signs + pays and afterwards controls A.
 *
 * Like the Railgun/PrivacyPools flows, this component only PREPARES the op in
 * the controller (via `RECOVERY_CONTROLLER_ACTIVATE` / `RECOVERY_CONTROLLER_RECOVER`)
 * and then opens the shared `Estimation` modal, which signs + broadcasts through
 * `MAIN_CONTROLLER_HANDLE_SIGN_AND_BROADCAST_ACCOUNT_OP { updateType: 'Recovery' }`.
 *
 * State is read from the `recovery` controller via `useRecoveryControllerState`.
 */

const SEPOLIA_TX_URL = (txHash: string) => `https://sepolia.etherscan.io/tx/${txHash}`

const shortAddr = (addr?: string | null) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '—')

/** A single labelled address/value row in the status panel. */
const InfoRow = ({
  label,
  value,
  appearance = 'secondaryText',
  selectable = false
}: {
  label: string
  value: React.ReactNode
  appearance?: 'secondaryText' | 'successText' | 'errorText'
  selectable?: boolean
}) => (
  <View style={[flexbox.directionRow, flexbox.alignCenter, spacings.mtTy]}>
    <Text fontSize={12} appearance="secondaryText" style={{ width: 150 }}>
      {label}
    </Text>
    {typeof value === 'string' || typeof value === 'number' ? (
      <Text fontSize={12} appearance={appearance} selectable={selectable}>
        {value}
      </Text>
    ) : (
      value
    )}
  </View>
)

const RecoveryForm = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { dispatch } = useBackgroundService()
  const { accounts } = useAccountsControllerState()
  const { account: selectedAccount } = useSelectedAccountControllerState()
  const {
    activated,
    accountA,
    controllerAddr,
    adapterAddr,
    methodAddr,
    newOwner,
    status,
    phase,
    txHashes,
    lastError,
    newOwnerIsAuthorizedOnA,
    signAccountOpController
  } = useRecoveryControllerState()

  // Free-text mirror for the new-owner input so the user can type/paste freely;
  // committed to the controller on blur / explicit picker selection.
  const [newOwnerDraft, setNewOwnerDraft] = useState(newOwner || '')

  // `pendingOpen` = the user clicked a step and we asked the background controller
  // to prepare a signing op. `hasProceeded` (which drives the Estimation BottomSheet
  // `autoOpen`) must only flip true ONCE the controller actually exists in UI state —
  // otherwise the sheet opens before the async controller arrives and renders an empty
  // white bar (its content is gated on `!!signAccountOpController`).
  const [pendingOpen, setPendingOpen] = useState(false)
  const [hasProceeded, setHasProceeded] = useState(false)

  const {
    ref: estimationModalRef,
    open: openEstimationModal,
    close: closeEstimationModal
  } = useModalize()

  const selectedAddr = selectedAccount?.addr || null

  // The user's other smart accounts — candidates for the new owner (Account B).
  const candidateOwners = useMemo(
    () =>
      (accounts || []).filter(
        (acc) =>
          isSmartAccount(acc) && acc.addr.toLowerCase() !== (selectedAddr || '').toLowerCase()
      ),
    [accounts, selectedAddr]
  )

  // Keep the local draft in sync when the controller's newOwner changes elsewhere.
  useEffect(() => {
    setNewOwnerDraft(newOwner || '')
  }, [newOwner])

  // Only mark "proceeded" + open the modal once the controller has actually prepared
  // the signing op. Gating on `signAccountOpController` (not the synchronous click)
  // prevents the empty-white-sheet race.
  useEffect(() => {
    if (pendingOpen && signAccountOpController) {
      setHasProceeded(true)
      openEstimationModal()
      setPendingOpen(false)
    }
  }, [pendingOpen, signAccountOpController, openEstimationModal])

  const isActivatedForSelected =
    !!activated && !!accountA && accountA.toLowerCase() === (selectedAddr || '').toLowerCase()

  const isPreparing = status === 'preparing'

  // ── Step 1: Activate (selected account = A) ──────────────────────────────────
  const handleActivate = useCallback(() => {
    setPendingOpen(true)
    dispatch({ type: 'RECOVERY_CONTROLLER_ACTIVATE' })
  }, [dispatch])

  // ── Step 1b: Install — bind + authorize, a second op on A (gas split) ────────
  const handleInstall = useCallback(() => {
    setPendingOpen(true)
    dispatch({ type: 'RECOVERY_CONTROLLER_INSTALL' })
  }, [dispatch])

  // ── Step 2: pick / set the new owner (Account B) ─────────────────────────────
  const handleCommitNewOwner = useCallback(() => {
    dispatch({
      type: 'RECOVERY_CONTROLLER_SET_NEW_OWNER',
      params: { newOwner: newOwnerDraft.trim() }
    })
  }, [dispatch, newOwnerDraft])

  const handlePickOwner = useCallback(
    (addr: string) => {
      setNewOwnerDraft(addr)
      dispatch({ type: 'RECOVERY_CONTROLLER_SET_NEW_OWNER', params: { newOwner: addr } })
    },
    [dispatch]
  )

  // ── Step 3: Recover (selected account = B, B sends + pays) ───────────────────
  const handleRecover = useCallback(() => {
    setPendingOpen(true)
    dispatch({ type: 'RECOVERY_CONTROLLER_RECOVER' })
  }, [dispatch])

  const handleRefresh = useCallback(() => {
    dispatch({ type: 'RECOVERY_CONTROLLER_REFRESH_STATUS' })
  }, [dispatch])

  // ── Estimation modal wiring (shared sign+broadcast UI) ───────────────────────
  const handleBroadcastAccountOp = useCallback(() => {
    dispatch({
      type: 'MAIN_CONTROLLER_HANDLE_SIGN_AND_BROADCAST_ACCOUNT_OP',
      params: { updateType: 'Recovery' }
    })
  }, [dispatch])

  const handleUpdateStatus = useCallback(
    (signingStatus: SigningStatus) => {
      dispatch({
        type: 'RECOVERY_CONTROLLER_SIGN_ACCOUNT_OP_UPDATE_STATUS',
        params: { status: signingStatus }
      })
    },
    [dispatch]
  )

  const updateController = useCallback(
    (params: { signingKeyAddr?: Key['addr']; signingKeyType?: Key['type'] }) => {
      dispatch({
        type: 'SIGN_ACCOUNT_OP_UPDATE',
        params: { updateType: 'Recovery', ...params }
      })
    },
    [dispatch]
  )

  const handleCloseEstimationModal = useCallback(() => {
    setHasProceeded(false)
    closeEstimationModal()
  }, [closeEstimationModal])

  const openTx = useCallback((txHash: string) => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    createTab(SEPOLIA_TX_URL(txHash))
  }, [])

  const statusAppearance =
    status === 'error' ? 'errorText' : status === 'broadcasted' ? 'successText' : 'secondaryText'

  const canRecover = !!controllerAddr && !!newOwner && !isPreparing

  return (
    <View style={[flexbox.flex1, spacings.ptSm, { maxWidth: 640 }]}>
      <Text fontSize={12} appearance="secondaryText" style={spacings.mbLg}>
        {t(
          'Recovery v0 demo on Sepolia (chainId 11155111). Activate while Account A is selected (A signs). Then switch Kohaku to Account B and run Recover from B (B sends + pays). Afterwards B controls A. Policy is trivial (AlwaysValid) — this proves the real in-extension deploy + sign + rotate path, not the production combinator.'
        )}
      </Text>

      {/* ── STEP 1: Activate on Account A ─────────────────────────────────────── */}
      <Text fontSize={14} weight="medium" style={spacings.mbTy}>
        {t('Step 1 — Activate recovery on this account (A)')}
      </Text>
      <Text fontSize={12} appearance="secondaryText" style={spacings.mbSm}>
        {t(
          'Deploys the recovery contracts from the extension and authorizes them on the currently selected account. Sign this with the account you want to be recoverable.'
        )}
      </Text>
      <InfoRow
        label={t('Account A (to be recovered)')}
        value={shortAddr(selectedAddr)}
        selectable
      />
      <Button
        type="primary"
        size="small"
        text={
          isActivatedForSelected
            ? t('Recovery activated')
            : isPreparing && phase === 'activate'
            ? t('Preparing…')
            : t('Activate recovery on this account')
        }
        onPress={handleActivate}
        disabled={!selectedAddr || isActivatedForSelected || isPreparing}
        hasBottomSpacing={false}
        style={[spacings.mtSm, { alignSelf: 'flex-start' }]}
      />
      {/* Step 1b: after the deploy op (controllerAddr known) but before fully
          activated, the second op binds + authorizes the adapter on A. */}
      {!!controllerAddr && !isActivatedForSelected && (
        <Button
          type="primary"
          size="small"
          text={
            isPreparing && phase === 'install'
              ? t('Preparing…')
              : t('Install recovery (authorize on A)')
          }
          onPress={handleInstall}
          disabled={isPreparing}
          hasBottomSpacing={false}
          style={[spacings.mtSm, { alignSelf: 'flex-start' }]}
        />
      )}
      {isActivatedForSelected && (
        <View style={spacings.mtSm}>
          <Text fontSize={12} appearance="successText">
            {t('Activated. Recovery contracts deployed + authorized on A.')}
          </Text>
          <InfoRow label={t('RecoveryController')} value={shortAddr(controllerAddr)} selectable />
          <InfoRow label={t('AmbireExecutorAdapter')} value={shortAddr(adapterAddr)} selectable />
          <InfoRow label={t('AlwaysValidMethod')} value={shortAddr(methodAddr)} selectable />
          {!!txHashes?.activate && (
            <InfoRow
              label={t('Activate tx')}
              value={
                <Pressable onPress={() => openTx(txHashes.activate as string)}>
                  <Text fontSize={12} appearance="primary" underline>
                    {shortAddr(txHashes.activate)}
                  </Text>
                </Pressable>
              }
            />
          )}
        </View>
      )}

      {/* ── STEP 2: New owner (Account B) ─────────────────────────────────────── */}
      <Text fontSize={14} weight="medium" style={[spacings.mbTy, spacings.mtLg]}>
        {t('Step 2 — New owner (B)')}
      </Text>
      <Text fontSize={12} appearance="secondaryText" style={spacings.mbSm}>
        {t(
          'Pick another of your Kohaku accounts (recommended) or paste any address. After recovery, this account controls Account A.'
        )}
      </Text>
      {candidateOwners.length > 0 && (
        <View style={[flexbox.directionRow, { flexWrap: 'wrap' }, spacings.mbSm]}>
          {candidateOwners.map((acc) => {
            const isPicked = newOwner.toLowerCase() === acc.addr.toLowerCase()
            return (
              <Button
                key={acc.addr}
                type={isPicked ? 'primary' : 'secondary'}
                size="small"
                text={`${acc.preferences?.label || t('Account')} · ${shortAddr(acc.addr)}`}
                onPress={() => handlePickOwner(acc.addr)}
                hasBottomSpacing={false}
                style={[spacings.mrTy, spacings.mbTy]}
              />
            )
          })}
        </View>
      )}
      <Input
        label={t('New owner address (B)')}
        placeholder="0x..."
        value={newOwnerDraft}
        onChangeText={setNewOwnerDraft}
        onBlur={handleCommitNewOwner}
        onSubmitEditing={handleCommitNewOwner}
        containerStyle={spacings.mb0}
      />

      {/* ── STEP 3: Recover (Account B sends + pays) ──────────────────────────── */}
      <Text fontSize={14} weight="medium" style={[spacings.mbTy, spacings.mtLg]}>
        {t('Step 3 — Recover (send from new owner)')}
      </Text>
      <Text fontSize={12} appearance="secondaryText" style={spacings.mbSm}>
        {t(
          'Switch Kohaku to Account B first — B sends and pays for this transaction. This rotates Account A’s controlling signer to B.'
        )}
      </Text>
      <Button
        type="primary"
        size="small"
        text={
          isPreparing && phase === 'recover' ? t('Preparing…') : t('Recover (send from new owner)')
        }
        onPress={handleRecover}
        disabled={!canRecover}
        hasBottomSpacing={false}
        style={{ alignSelf: 'flex-start' }}
      />

      {/* ── Status panel ──────────────────────────────────────────────────────── */}
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
        <InfoRow
          label={t('State')}
          value={`${status || 'initial'}${phase ? ` (${phase})` : ''}`}
          appearance={statusAppearance as any}
        />
        <InfoRow
          label={t('New owner authorized on A')}
          value={newOwnerIsAuthorizedOnA ? t('yes') : t('no')}
          appearance={newOwnerIsAuthorizedOnA ? 'successText' : 'secondaryText'}
        />
        {!!txHashes?.activate && (
          <InfoRow
            label={t('Activate tx')}
            value={
              <Pressable onPress={() => openTx(txHashes.activate as string)}>
                <Text fontSize={12} appearance="primary" underline>
                  {shortAddr(txHashes.activate)}
                </Text>
              </Pressable>
            }
          />
        )}
        {!!txHashes?.recover && (
          <InfoRow
            label={t('Recover tx')}
            value={
              <Pressable onPress={() => openTx(txHashes.recover as string)}>
                <Text fontSize={12} appearance="primary" underline>
                  {shortAddr(txHashes.recover)}
                </Text>
              </Pressable>
            }
          />
        )}
        {!!lastError && (
          <Text fontSize={12} appearance="errorText" style={spacings.mtTy} selectable>
            {lastError}
          </Text>
        )}
      </View>

      {/* Shared sign + broadcast modal (signs as the selected account; the same
          component Railgun/PrivacyPools use). Fires updateType 'Recovery'. */}
      <Estimation
        updateType="Recovery"
        estimationModalRef={estimationModalRef}
        closeEstimationModal={handleCloseEstimationModal}
        updateController={updateController}
        handleUpdateStatus={handleUpdateStatus}
        handleBroadcastAccountOp={handleBroadcastAccountOp}
        hasProceeded={hasProceeded}
        signAccountOpController={signAccountOpController || null}
      />
    </View>
  )
}

export default React.memo(RecoveryForm)
