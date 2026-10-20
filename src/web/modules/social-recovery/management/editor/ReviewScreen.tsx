/**
 * The review of changes before the one transaction the account's key signs:
 * what the edit changes against the configuration it started from, the
 * stale card line, the new path with its rule lines, what a recovery
 * publishes, the trust list of the rows the edit adds under its expander, the
 * account the save writes to, and the save behind the setup review's own
 * gate, which waits for every trust read, plus the edit's own: nothing
 * changed holds it with its line, and so does a setup the account no longer
 * authorizes while an attempt is open, since its commit would authorize it
 * again while that recovery runs. An added row this device never tested warns
 * beside the save. While an attempt is open on the account the line that
 * saving cancels it sits above the save; the save reads the attempt again
 * right before the send, and the line follows that read.
 *
 * The save runs here over the save's own run, in the shared states with the
 * edit's copy, and reads as saved only once the check after the landing
 * agreed and the records were wiped. A stored removal in flight sends the
 * holder to the removal, and another screen's stored write to the overview;
 * the stored write is read again whenever the tab comes back into view.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Linking, View } from 'react-native'

import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import useNavigation from '@common/hooks/useNavigation'
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import { useOverviewReads } from '@web/modules/social-recovery/management/overview/useOverviewReads'
import { ActionsRow, PageTitle, SectionCard } from '@web/modules/social-recovery/shared/chrome'
import ReadFailedBlock from '@web/modules/social-recovery/shared/chrome/ReadFailedBlock'
import SetupChrome from '@web/modules/social-recovery/shared/chrome/SetupChrome'
import useSetupAccount from '@web/modules/social-recovery/shared/chrome/useSetupAccount'
import {
  addressBookOf,
  CHAIN_IDS,
  WALLET_RECOVERY_CHAIN
} from '@web/modules/social-recovery/shared/client'
import { useAccountFacts } from '@web/modules/social-recovery/shared/client/useAccountFacts'
import { useRecoveryClient } from '@web/modules/social-recovery/shared/client/useRecoveryClient'
import { renderFullAddress, renderHash } from '@web/modules/social-recovery/shared/display'
import {
  createWalletRecords,
  extensionRecordStorage,
  readRecoveryPassword,
  sameCredential
} from '@web/modules/social-recovery/shared/records'
import {
  armScreenOf,
  cardPathOf,
  explorerTransactionUrlOf
} from '@web/modules/social-recovery/setup/arm'
import DisagreedView from '@web/modules/social-recovery/setup/arm/DisagreedView'
import { useArmRun } from '@web/modules/social-recovery/setup/arm/useArmRun'
import { levelOfBackup } from '@web/modules/social-recovery/setup/card'
import {
  accountReadsToRetry,
  methodsOf,
  publicationSentenceOf,
  ruleLinesOf,
  saveGateOf,
  trustRowsOf,
  untestedInPath
} from '@web/modules/social-recovery/setup/review'
import PathBlock from '@web/modules/social-recovery/setup/review/PathBlock'
import SaveBlocker from '@web/modules/social-recovery/setup/review/SaveBlocker'
import TrustList from '@web/modules/social-recovery/setup/review/TrustList'
import { useAccountReads } from '@web/modules/social-recovery/setup/review/useAccountReads'
import { useTrustReads } from '@web/modules/social-recovery/setup/review/useTrustReads'

import { addedCredentialsOf, changesOf, makesCardStale, passwordChangedOf } from './changes'
import ChangesBlock from './ChangesBlock'
import { EDITOR, REVIEW } from './constants'
import DetailsExpander from './DetailsExpander'
import { ruleOfPath } from './copy'
import {
  addedTrustRowsOf,
  editedSetupRead,
  editGateOf,
  nothingOnItsWay,
  passwordMissingOf
} from './readings'
import NotTestedBlock from './NotTestedBlock'
import ReadsGate from './ReadsGate'
import RunBlock from './RunBlock'
import { editSessionOf, readNewPassword } from './session'
import { editStepsOf } from './steps'
import type { AttemptRead, EditStageProps, ReviewLoad } from './types'
import { useHeldWrite } from './useHeldWrite'
import { useWriteSeams } from './useWriteSeams'

export const ReviewStageView = ({
  records,
  session,
  chainId,
  account,
  navigate
}: EditStageProps) => {
  const { t } = useTranslation()
  const clientState = useRecoveryClient(account)
  const reads = useOverviewReads({ client: clientState, records, chainId, account })
  const kit = clientState.status === 'ready' ? clientState.client : null
  const facts = reads.facts.status === 'answered' ? reads.facts.value : null
  // The attempt as the save last read it before the send; a new read of the overview's facts replaces it.
  const [attemptRead, setAttemptRead] = useState<AttemptRead | null>(null)
  useEffect(() => setAttemptRead(null), [reads.facts])
  const attemptOpen = attemptRead ? attemptRead.open : !!facts?.attemptOpen
  const dormantRefused = attemptRead
    ? attemptRead.dormant
    : !!facts && facts.attemptOpen && !facts.setup.isAuthorized
  // Read by the save before the send, which sends nothing over an attempt this screen did not show.
  const cancelLineShown = useRef(false)
  cancelLineShown.current = attemptOpen && !dormantRefused
  const addressBook = useMemo(() => addressBookOf(WALLET_RECOVERY_CHAIN), [])
  const seams = useWriteSeams(chainId)
  const accountFacts = useAccountFacts(account)
  const { held, retry: retryHeld, refresh: refreshHeld } = useHeldWrite(records, chainId, account)
  const [load, setLoad] = useState<ReviewLoad>({ status: 'pending' })
  const [loadRound, setLoadRound] = useState(0)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (held.status === 'held' && held.write === 'manageRemove') {
      navigate(WEB_ROUTES.socialRecoveryManageRemove)
    }
    if (held.status === 'other') {
      navigate(WEB_ROUTES.socialRecoveryManage)
    }
  }, [held, navigate])

  useEffect(() => {
    let live = true
    setLoad({ status: 'pending' })
    const setup = records.setup(chainId, account)
    Promise.all([setup.setupDraft.read(), setup.enrollments.read(), session.read()]).then(
      ([draft, enrollments, baseline]) => {
        if (!live) {
          return
        }
        setLoad(
          draft.status === 'present' && baseline
            ? {
                status: 'loaded',
                draft: draft.value,
                enrollments: enrollments.status === 'present' ? enrollments.value : [],
                baseline
              }
            : { status: 'none' }
        )
      },
      () => {
        if (live) {
          setLoad({ status: 'failed' })
        }
      }
    )
    return () => {
      live = false
    }
  }, [records, session, chainId, account, loadRound])

  const loaded = load.status === 'loaded' ? load : null
  const draft = loaded?.draft ?? null
  const clauses = useMemo(() => draft?.clauses ?? [], [draft])
  const added = useMemo(
    () => (loaded ? addedCredentialsOf(loaded.baseline.configuration.clauses, clauses) : []),
    [loaded, clauses]
  )
  const methods = useMemo(
    () => methodsOf([{ threshold: 1, credentials: added }], addressBook),
    [added, addressBook]
  )
  const trust = useTrustReads(kit?.moduleReads ?? null, methods)
  const trustRows = useMemo(
    () =>
      addedTrustRowsOf(
        trustRowsOf({
          clauses,
          enrollments: loaded?.enrollments ?? [],
          reads: trust.reads,
          shippedMethods: kit?.descriptor.shippedMethods ?? [],
          addressBook
        }),
        added
      ),
    [clauses, loaded, trust.reads, kit, addressBook, added]
  )
  const accountReads = useAccountReads(kit, draft)

  const password = readRecoveryPassword(chainId, account)
  const newPassword = readNewPassword(chainId, account)
  const rows = useMemo(
    () =>
      loaded
        ? changesOf({
            baseline: loaded.baseline,
            draft: loaded.draft,
            passwordChanged: passwordChangedOf(
              loaded.baseline,
              loaded.draft,
              loaded.baseline.password
            ),
            ruleOf: ruleOfPath(addressBook, t)
          })
        : [],
    [loaded, addressBook, t]
  )
  const stale = makesCardStale(rows)

  const ready = accountFacts.status === 'ready' ? accountFacts.facts : null
  const ownWrite = held.status === 'none' || (held.status === 'held' && held.write === 'manageEdit')
  const steps = useMemo(() => {
    if (!ready?.key || !kit || !loaded || !ownWrite || clientState.status !== 'ready') {
      return null
    }
    return editStepsOf({
      client: kit,
      reads: clientState.reads,
      receipts: clientState.receipts,
      port: seams.port,
      requests: seams.requests,
      records,
      session,
      chainId,
      account,
      facts: ready,
      key: ready.key,
      baseline: loaded.baseline,
      draft: loaded.draft,
      password,
      newPassword,
      onAttempt: setAttemptRead,
      showsCancelLine: () => cancelLineShown.current
    })
  }, [
    ready,
    kit,
    loaded,
    ownWrite,
    clientState,
    seams,
    records,
    session,
    chainId,
    account,
    password,
    newPassword
  ])
  const run = useArmRun(steps, `manage:edit:${chainId}:${account.toLowerCase()}`)
  const { state } = run
  const screen = armScreenOf(state)
  const { write } = state

  // A run that read or lost its claim to another screen's write ends unsent, or stops for that
  // screen; the stored write is read again.
  useEffect(() => {
    if (
      state.lookup === 'failed' ||
      write.status === 'failedNotSent' ||
      state.stop === 'overview-elsewhere'
    ) {
      refreshHeld()
    }
  }, [state.lookup, write.status, state.stop, refreshHeld])

  const openUrl = useCallback((url: string) => {
    Linking.openURL(url).catch(() => undefined)
  }, [])
  const toEditor = useCallback(() => navigate(WEB_ROUTES.socialRecoveryManageEdit), [navigate])
  const toOverview = useCallback(() => navigate(WEB_ROUTES.socialRecoveryManage), [navigate])

  const backToEditor = (
    <Button
      testID="manage-review-back"
      type="outline"
      text={t(`${REVIEW}.backToEditor`)}
      onPress={toEditor}
      hasBottomSpacing={false}
    />
  )

  const saved = () => (
    <View testID="manage-review-saved">
      <Text fontSize={20} weight="medium" style={spacings.mbTy} testID="manage-review-saved-title">
        {t(`${REVIEW}.savedTitle`)}
      </Text>
      <Text fontSize={14} appearance="secondaryText" style={spacings.mbSm}>
        {t(`${REVIEW}.savedBody`)}
      </Text>
      <SectionCard>
        {write.status === 'landed' && (
          <View style={[flexbox.directionRow, flexbox.alignCenter, flexbox.wrap, spacings.mbTy]}>
            <Text fontSize={14} weight="number_medium" selectable style={spacings.mrSm}>
              {renderHash(write.transactionHash)}
            </Text>
            <Button
              testID="manage-review-saved-explorer"
              type="ghost"
              size="small"
              text={t('socialRecovery.arm.explorer')}
              onPress={() =>
                write.status === 'landed' &&
                openUrl(
                  explorerTransactionUrlOf(
                    kit?.chain ?? WALLET_RECOVERY_CHAIN,
                    write.transactionHash
                  )
                )
              }
              hasBottomSpacing={false}
            />
          </View>
        )}
        <Text fontSize={12} appearance="secondaryText">
          {t('socialRecovery.arm.oneTransaction')}
        </Text>
      </SectionCard>
      {stale && (
        <Text
          fontSize={14}
          weight="medium"
          style={spacings.mbSm}
          testID="manage-review-saved-stale"
        >
          {t(`${EDITOR}.staleCard`)}
        </Text>
      )}
      <ActionsRow
        primary={
          <Button
            testID="manage-review-saved-done"
            type="primary"
            text={t(`${REVIEW}.done`)}
            onPress={toOverview}
            hasBottomSpacing={false}
          />
        }
        secondary={
          stale && draft ? (
            <Button
              testID="manage-review-saved-card"
              type="secondary"
              text={t('socialRecovery.management.overview.card.action')}
              onPress={() => navigate(cardPathOf(levelOfBackup(draft.privacy.backup)))}
              hasBottomSpacing={false}
            />
          ) : undefined
        }
      />
    </View>
  )

  const arrival = () => {
    if (held.status === 'failed' || load.status === 'failed') {
      return (
        <ReadFailedBlock
          testID="manage-review-load-failed"
          title={t('socialRecovery.records.loadFailed')}
          onRetry={() => {
            retryHeld()
            setLoadRound((round) => round + 1)
          }}
        />
      )
    }
    if (load.status === 'none') {
      return (
        <View testID="manage-review-nothing">
          <Text fontSize={14} style={spacings.mbSm}>
            {t(`${EDITOR}.changes.none`)}
          </Text>
          <ActionsRow primary={backToEditor} />
        </View>
      )
    }
    if (!loaded || !draft || held.status === 'pending') {
      return <ActivityIndicator testID="manage-review-loading" />
    }
    const passwordMissing = passwordMissingOf(loaded.baseline, draft, password, newPassword)
    const setupState = editedSetupRead(accountReads.setupState)
    const gate = editGateOf({
      gate: saveGateOf({
        ...accountReads,
        setupState,
        recordsLoaded: true,
        clientReady: !!kit,
        trustRows,
        untested: untestedInPath(clauses, loaded.enrollments).filter(({ credential }) =>
          added.some((one) => sameCredential(one, credential))
        ),
        clauses,
        backup: draft.privacy.backup,
        passwordSet: !passwordMissing
      }),
      rows,
      added,
      reads: { ...accountReads, setupState },
      clientReady: !!kit
    })
    const retryUnanswered = () => {
      trustRows
        .filter(({ contract }) => contract.status === 'unavailable')
        .forEach(({ method }) => trust.retry(method))
      accountReads.retry(accountReadsToRetry(accountReads))
    }
    const publication = publicationSentenceOf(clauses, addressBook, t)
    const ruleLines = ruleLinesOf(draft, addressBook, t)
    const lookingUp = state.lookup === 'reading' || (!steps && accountFacts.status === 'loading')

    return (
      <View testID="manage-review-arrival">
        <ChangesBlock rows={rows} stale={stale} />

        <SectionCard>
          <PathBlock
            clauses={clauses}
            enrollments={loaded.enrollments}
            addressBook={addressBook}
            onRetryTest={toEditor}
          />
          {ruleLines.map((ruleLine, index) => (
            <Text
              // The lines are rebuilt from the path on every render, so a line's place is its identity.
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              fontSize={14}
              style={spacings.mbTy}
              testID={`manage-review-rule-line-${index}`}
            >
              {ruleLine}
            </Text>
          ))}
        </SectionCard>

        <SectionCard
          tone="muted"
          spacing="item"
          label={t('socialRecovery.review.publicationHeader')}
        >
          <Text fontSize={12} appearance="secondaryText" style={spacings.mbTy}>
            {t('socialRecovery.review.publication.lead')}
          </Text>
          {!!publication && (
            <Text fontSize={12} appearance="secondaryText" testID="manage-review-publication">
              {publication}
            </Text>
          )}
        </SectionCard>

        {trustRows.length > 0 && (
          <SectionCard label={t(`${REVIEW}.addedRows`)} testID="manage-review-added">
            <DetailsExpander
              testID="manage-review-verify-details"
              expanded={expanded}
              onToggle={() => setExpanded((open) => !open)}
            />
            {expanded && !!kit && <TrustList rows={trustRows} client={kit} onRetry={trust.retry} />}
          </SectionCard>
        )}

        <SectionCard label={t('socialRecovery.review.account.header')}>
          <Text fontSize={14} weight="medium" selectable testID="manage-review-account">
            {renderFullAddress(account)}
          </Text>
        </SectionCard>

        {dormantRefused && (
          <Alert
            testID="manage-review-dormant-refused"
            type="error"
            size="sm"
            style={spacings.mbSm}
            text={t(`${REVIEW}.dormantRefused`)}
          />
        )}
        {!dormantRefused && !!gate.blocked && (
          <SaveBlocker
            blocked={gate.blocked}
            onRetry={retryUnanswered}
            onOpen={toOverview}
            onEditor={toEditor}
            onPrivacy={toEditor}
          />
        )}
        {ready && !ready.key && (
          <Alert
            testID="manage-review-view-only"
            type="error"
            size="sm"
            style={spacings.mbSm}
            text={t('socialRecovery.arm.viewOnly')}
          />
        )}
        {gate.notTested && (
          <NotTestedBlock
            untested={gate.notTested}
            enrollments={loaded.enrollments}
            addressBook={addressBook}
          />
        )}
        {rows.length === 0 && (
          <Text fontSize={14} style={spacings.mbSm} testID="manage-review-unchanged">
            {t(`${REVIEW}.unchanged`)}
          </Text>
        )}
        {attemptOpen && !dormantRefused && (
          <Text fontSize={14} weight="medium" style={spacings.mbSm} testID="manage-review-cancels">
            {t(`${REVIEW}.cancelsLine`)}
          </Text>
        )}
        {lookingUp ? (
          <ActivityIndicator testID="manage-review-lookup" />
        ) : (
          <ActionsRow
            primary={
              <Button
                testID="manage-review-save"
                type="primary"
                text={t(`${REVIEW}.save`)}
                disabled={
                  !gate.canSave ||
                  dormantRefused ||
                  !steps ||
                  state.lookup !== 'none' ||
                  !!state.stop
                }
                onPress={run.start}
                hasBottomSpacing={false}
              />
            }
            secondary={backToEditor}
          />
        )}
        {state.lookup === 'failed' && (
          <ReadFailedBlock
            testID="manage-review-lookup-failed"
            title={t('socialRecovery.records.loadFailed')}
            onRetry={run.lookAgain}
          />
        )}
      </View>
    )
  }

  const body = () => {
    switch (screen) {
      case 'saved':
        return saved()
      case 'already-set-up':
        return (
          <View testID="manage-review-setup-changed">
            <Alert
              type="warning"
              size="sm"
              style={spacings.mbSm}
              title={t('socialRecovery.records.setupChangedTitle')}
              text={t(`${REVIEW}.setupChangedBody`)}
            />
            <ActionsRow primary={backToEditor} />
          </View>
        )
      case 'disagreed':
      case 'unread':
        return write.status === 'landed' || state.landedUnseen ? (
          <DisagreedView
            transactionHash={write.status === 'landed' ? write.transactionHash : undefined}
            chain={kit?.chain ?? WALLET_RECOVERY_CHAIN}
            check={state.after.stage === 'disagreed' ? state.after.check : undefined}
            onReread={run.reread}
            navigate={navigate}
            openUrl={openUrl}
          />
        ) : null
      case 'confirming':
        return <ActivityIndicator testID="manage-review-confirming" />
      case 'run':
        return (
          <View>
            {dormantRefused && (
              <Alert
                testID="manage-review-run-dormant-refused"
                type="error"
                size="sm"
                style={spacings.mbSm}
                text={t(`${REVIEW}.dormantRefused`)}
              />
            )}
            {attemptOpen && !dormantRefused && (
              <Text fontSize={14} weight="medium" style={spacings.mbSm}>
                {t(`${REVIEW}.cancelsLine`)}
              </Text>
            )}
            <RunBlock run={run} write="edit" testID="manage-review-run" />
            {nothingOnItsWay(state) && (
              <View style={[flexbox.directionRow, spacings.mtSm]}>{backToEditor}</View>
            )}
          </View>
        )
      case 'arrival':
      default:
        return arrival()
    }
  }

  return (
    <View testID="manage-review">
      <PageTitle
        title={t(`${REVIEW}.title`)}
        lead={t(`${REVIEW}.lead`)}
        titleTestID="manage-review-title"
      />
      <ReadsGate reads={reads} needsPath={false} testID="manage-review-reads">
        {body()}
      </ReadsGate>
    </View>
  )
}

const ReviewScreen = () => {
  const { navigate } = useNavigation()
  const { account } = useSetupAccount()
  const records = useMemo(() => createWalletRecords({ storage: extensionRecordStorage }), [])
  const chainId = CHAIN_IDS[WALLET_RECOVERY_CHAIN]
  const session = useMemo(
    () => (account ? editSessionOf(extensionRecordStorage, chainId, account) : null),
    [account, chainId]
  )

  return (
    <SetupChrome testID="manage-review-screen">
      {!!account && !!session && (
        <ReviewStageView
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

export default React.memo(ReviewScreen)
