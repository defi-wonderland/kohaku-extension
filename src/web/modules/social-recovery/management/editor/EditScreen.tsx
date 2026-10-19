/**
 * The edit of the committed recovery path: the overview's reads in front,
 * the committed configuration loaded into the setup records, then the setup's
 * own editor over them with the groups whose every member the rule needs, and
 * the committed values beside it, the waiting period, the recovery password
 * and the privacy level, each opening its own step. What the edit changes and
 * the stale card line follow every write of the draft.
 *
 * A write of the editor stored on this device as in flight sends the holder
 * to the screen that follows it, so no edit starts over a write on its way.
 * Cancel drops the edit: the setup records, the session and a new password.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'

import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import { useTranslation } from '@common/config/localization'
import useNavigation from '@common/hooks/useNavigation'
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import spacings from '@common/styles/spacings'
import { useOverviewReads } from '@web/modules/social-recovery/management/overview/useOverviewReads'
import type { SetupDraft } from '@web/modules/social-recovery/sdk-interfaces'
import { ActionsRow, PageTitle } from '@web/modules/social-recovery/shared/chrome'
import SetupChrome from '@web/modules/social-recovery/shared/chrome/SetupChrome'
import useSetupAccount from '@web/modules/social-recovery/shared/chrome/useSetupAccount'
import {
  addressBookOf,
  CHAIN_IDS,
  privacyLevelOf,
  WALLET_RECOVERY_CHAIN
} from '@web/modules/social-recovery/shared/client'
import { useRecoveryClient } from '@web/modules/social-recovery/shared/client/useRecoveryClient'
import {
  createWalletRecords,
  extensionRecordStorage,
  readRecoveryPassword,
  SETUP_RECORD_NAMES,
  setRecoveryPassword,
  wipeRecoveryPassword
} from '@web/modules/social-recovery/shared/records'
import type { WalletRecords } from '@web/modules/social-recovery/shared/records'
import EditorView from '@web/modules/social-recovery/setup/editor/EditorView'
import type { EditorClient } from '@web/modules/social-recovery/setup/editor/types'
import PrivacyView from '@web/modules/social-recovery/setup/privacy/PrivacyView'
import WaitingPeriodView from '@web/modules/social-recovery/setup/privacy/WaitingPeriodView'

import { changesOf, makesCardStale, passwordChangedOf, stillNeededOf } from './changes'
import { EDITOR } from './constants'
import { ruleOfPath } from './copy'
import { openEditSession } from './load'
import PasswordChange from './PasswordChange'
import ReadsGate from './ReadsGate'
import { editorTargetOf, isPrivacyContinue } from './routing'
import { dropNewPassword, editSessionOf, holdNewPassword } from './session'
import { writeOfRequest } from './steps'
import StillNeededBlock from './StillNeededBlock'
import type { EditSession, EditStage, EditStageProps } from './types'
import { useCommittedLevel } from './useCommittedLevel'
import ValuesBlock from './ValuesBlock'

export const EditStageView = ({ records, session, chainId, account, navigate }: EditStageProps) => {
  const { t } = useTranslation()
  const clientState = useRecoveryClient(account)
  const reads = useOverviewReads({ client: clientState, records, chainId, account })
  const kit = clientState.status === 'ready' ? clientState.client : null
  const setupState = reads.facts.status === 'answered' ? reads.facts.value.setup : null
  const committedLevel = useCommittedLevel(kit, setupState)
  const addressBook = useMemo(() => addressBookOf(WALLET_RECOVERY_CHAIN), [])

  const configuration = reads.path.kind === 'readable' ? reads.path.configuration : null
  const level = committedLevel.level.status === 'answered' ? committedLevel.level.value : null
  // The password lives in memory, outside React: a successful unlock moves the reads and renders again.
  const passwordHeld = readRecoveryPassword(chainId, account) !== undefined
  const canOpen = !!configuration && !!setupState && !!level && (level === 'public' || passwordHeld)

  const [opened, setOpened] = useState<EditSession | null>(null)
  const [openFailed, setOpenFailed] = useState(false)
  const [openRound, setOpenRound] = useState(0)
  const [draft, setDraft] = useState<SetupDraft | null>(null)
  const [stage, setStage] = useState<EditStage>('path')
  // The recovery password the committed setup opens with, as this tab verified it.
  const committedPassword = useRef<string | undefined>(undefined)

  // Every write of the draft, by the editor or a value's step, reaches the changes.
  const observed = useMemo<WalletRecords>(
    () => ({
      ...records,
      setup: (onChain, holder) => {
        const inner = records.setup(onChain, holder)
        return {
          ...inner,
          writeDraftAndPath: async (next) => {
            const written = await inner.writeDraftAndPath(next)
            setDraft(next)
            return written
          }
        }
      }
    }),
    [records]
  )
  const setupRecords = useMemo(() => observed.setup(chainId, account), [observed, chainId, account])

  useEffect(() => {
    if (!canOpen || !configuration || !setupState || !level || opened) {
      return undefined
    }
    let live = true
    setOpenFailed(false)
    const open = async () => {
      const held = await records.saveInFlight(chainId, account).read()
      if (held.status === 'present') {
        navigate(
          writeOfRequest(held.value.requestId) === 'remove'
            ? WEB_ROUTES.socialRecoveryManageRemove
            : WEB_ROUTES.socialRecoveryManageReview
        )
        return
      }
      const editing = await openEditSession({
        setup: setupRecords,
        session,
        state: setupState,
        configuration,
        level
      })
      const stored = await setupRecords.setupDraft.read()
      if (!live) {
        return
      }
      committedPassword.current = readRecoveryPassword(chainId, account)
      if (editing.password === 'kept') {
        dropNewPassword(chainId, account)
      }
      setOpened(editing)
      setDraft(stored.status === 'present' ? stored.value : null)
    }
    open().catch(() => {
      if (live) {
        setOpenFailed(true)
      }
    })
    return () => {
      live = false
    }
    // The session opens once per answered read; a later read of the same setup opens nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOpen, opened, openRound])

  const markPassword = useCallback(
    (password: EditSession['password']) => {
      if (!opened || opened.password === password) {
        return
      }
      const next = { ...opened, password }
      setOpened(next)
      session.write(next).catch(() => undefined)
    },
    [opened, session]
  )

  // The privacy step keeps the password it was given in the shared holder; a new one moves to
  // the edit's own, and the holder gets the committed one back for the setup as it stands.
  const afterPrivacy = useCallback(async () => {
    const stored = await setupRecords.setupDraft.read()
    const hidden = stored.status === 'present' && privacyLevelOf(stored.value.privacy) !== 'public'
    const typed = readRecoveryPassword(chainId, account)
    const committed = committedPassword.current
    if (hidden && typed !== undefined && typed !== committed) {
      holdNewPassword(chainId, account, typed)
      markPassword('changed')
    } else if (!hidden) {
      dropNewPassword(chainId, account)
      markPassword('kept')
    }
    if (committed !== undefined) {
      setRecoveryPassword(chainId, account, committed)
    } else {
      wipeRecoveryPassword(chainId, account)
    }
  }, [setupRecords, chainId, account, markPassword])

  const editorNavigate = useCallback((to: string) => navigate(editorTargetOf(to)), [navigate])
  const stepNavigate = useCallback(
    (to: string) => {
      if (isPrivacyContinue(to)) {
        afterPrivacy()
          .catch(() => undefined)
          .finally(() => setStage('path'))
        return
      }
      setStage('path')
    },
    [afterPrivacy]
  )

  const onNewPassword = useCallback(
    (password: string) => {
      holdNewPassword(chainId, account, password)
      markPassword('changed')
      setStage('path')
    },
    [chainId, account, markPassword]
  )

  const onCancel = useCallback(async () => {
    await Promise.all([
      ...SETUP_RECORD_NAMES.map((name) => setupRecords[name].wipe()),
      session.wipe()
    ]).catch(() => undefined)
    dropNewPassword(chainId, account)
    if (committedPassword.current !== undefined) {
      setRecoveryPassword(chainId, account, committedPassword.current)
    }
    navigate(WEB_ROUTES.socialRecoveryManage)
  }, [setupRecords, session, chainId, account, navigate])

  const editorClient = useMemo<EditorClient>(() => {
    if (kit) {
      return { status: 'ready', setup: kit.setup }
    }
    if (clientState.status === 'update-the-wallet') {
      return { status: 'update-the-wallet', retry: clientState.retry }
    }
    if (clientState.status === 'failed') {
      return { status: 'failed', retry: clientState.retry }
    }
    return { status: 'loading' }
  }, [kit, clientState])

  const rows = useMemo(
    () =>
      opened && draft
        ? changesOf({
            baseline: opened,
            draft,
            passwordChanged: passwordChangedOf(opened, draft, opened.password),
            ruleOf: ruleOfPath(addressBook, t)
          })
        : [],
    [opened, draft, addressBook, t]
  )

  const body = () => {
    if (openFailed) {
      return (
        <View testID="manage-edit-open-failed">
          <Alert type="error" size="sm" text={t('socialRecovery.records.loadFailed')} />
          <ActionsRow
            primary={
              <Button
                testID="manage-edit-open-retry"
                type="primary"
                text={t('socialRecovery.writes.tryAgain')}
                onPress={() => setOpenRound((round) => round + 1)}
                hasBottomSpacing={false}
              />
            }
          />
        </View>
      )
    }
    if (!opened || !draft) {
      return <ActivityIndicator testID="manage-edit-opening" />
    }
    if (stage === 'wait') {
      return (
        <WaitingPeriodView
          records={observed}
          chainId={chainId}
          account={account}
          navigate={stepNavigate}
        />
      )
    }
    if (stage === 'privacy') {
      return (
        <PrivacyView
          records={observed}
          chainId={chainId}
          account={account}
          navigate={stepNavigate}
        />
      )
    }
    if (stage === 'password') {
      return <PasswordChange onDone={onNewPassword} onCancel={() => setStage('path')} />
    }
    return (
      <View testID="manage-edit-path">
        <StillNeededBlock groups={stillNeededOf(draft.clauses)} />
        <EditorView
          records={setupRecords}
          client={editorClient}
          addressBook={addressBook}
          navigate={editorNavigate}
        />
        <ValuesBlock
          draft={draft}
          addressBook={addressBook}
          passwordChanged={rows.some(({ kind }) => kind === 'password')}
          stale={makesCardStale(rows)}
          onStage={setStage}
        />
        <ActionsRow
          primary={
            <Button
              testID="manage-edit-cancel"
              type="outline"
              text={t('socialRecovery.actions.cancel')}
              onPress={onCancel}
              hasBottomSpacing={false}
            />
          }
        />
      </View>
    )
  }

  return (
    <View testID="manage-edit">
      <PageTitle
        title={t(`${EDITOR}.title`)}
        lead={t(`${EDITOR}.lead`)}
        titleTestID="manage-edit-title"
      />
      <ReadsGate
        reads={reads}
        level={committedLevel.level}
        onRetryLevel={committedLevel.retry}
        passwordHeld={passwordHeld}
        testID="manage-edit-reads"
      >
        <View style={spacings.mtSm}>{body()}</View>
      </ReadsGate>
    </View>
  )
}

const EditScreen = () => {
  const { navigate } = useNavigation()
  const { account } = useSetupAccount()
  const records = useMemo(() => createWalletRecords({ storage: extensionRecordStorage }), [])
  const chainId = CHAIN_IDS[WALLET_RECOVERY_CHAIN]
  const session = useMemo(
    () => (account ? editSessionOf(extensionRecordStorage, chainId, account) : null),
    [account, chainId]
  )

  return (
    <SetupChrome testID="manage-edit-screen">
      {/* Another account mounts a new stage, so no read or edit carries across. */}
      {!!account && !!session && (
        <EditStageView
          key={`${chainId}:${account}`}
          records={records}
          session={session}
          chainId={chainId}
          account={account}
          navigate={navigate}
        />
      )}
    </SetupChrome>
  )
}

export default React.memo(EditScreen)
