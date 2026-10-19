/**
 * The overview over given reads. The status line reads set up or not set up,
 * with path locked beside set up where this device cannot read the path, not
 * active for a setup the account no longer authorizes or an authorization
 * with no setup behind it, and recovery in progress while an attempt is
 * open. A dormant setup shows its warning with re-authorize and clear; while
 * an attempt is open the re-authorize control is absent with the wallet's
 * reason in its place, the dormant reading stands over the attempt, and the
 * clear carries the sentence that it ends the recovery in progress. The
 * mirror shows its one action. The path, the moved-keys notices, the notice
 * after an ended attempt, the recover-an-account entry and the Recovery Card
 * follow. A read that runs or failed shows its own state, never an answer.
 */
import React, { useMemo } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'

import RightArrowIcon from '@common/assets/svg/RightArrowIcon'
import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import useTheme from '@common/hooks/useTheme'
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import spacings from '@common/styles/spacings'
import common from '@common/styles/utils/common'
import flexbox from '@common/styles/utils/flexbox'
import { readablePathOf } from '@web/modules/social-recovery/recovery/entry/readout'
import ReadoutPathBlock from '@web/modules/social-recovery/recovery/entry/ReadoutPathBlock'
import {
  ActionsRow,
  PageTitle,
  SectionCard,
  StatusChip,
  TwoColumn
} from '@web/modules/social-recovery/shared/chrome'
import ReadFailedBlock from '@web/modules/social-recovery/shared/chrome/ReadFailedBlock'
import {
  renderChip,
  renderDateTimeInZone,
  renderFullAddress
} from '@web/modules/social-recovery/shared/display'

import { OVERVIEW } from './constants'
import PathLockedAsk from './PathLockedAsk'
import { endedNoticeOf, movedInPath, overviewKindOf, pathMethodsOf } from './readings'
import type { OverviewFacts, OverviewKind, OverviewViewProps } from './types'

const OverviewView = ({
  reads,
  context,
  networkName,
  timeZone,
  ending,
  methodNameOf,
  adminOf,
  banner,
  step,
  onOpen,
  navigate
}: OverviewViewProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { facts, path, notices } = reads

  const readablePath = useMemo(
    () => (path.kind === 'readable' ? readablePathOf(path.configuration, context, t) : null),
    [path, context, t]
  )

  if (step) {
    return (
      <TwoColumn testID="overview-columns">
        <View testID="overview">{step}</View>
      </TwoColumn>
    )
  }

  const title = (lead?: string) => (
    <PageTitle title={t(`${OVERVIEW}.title`)} lead={lead} titleTestID="overview-title" />
  )

  const recoverEntry = (
    <Pressable
      testID="overview-recover"
      accessibilityRole="button"
      onPress={() => navigate(WEB_ROUTES.socialRecoveryRecovery)}
      style={[
        flexbox.directionRow,
        flexbox.alignCenter,
        common.borderRadiusSecondary,
        spacings.ph,
        spacings.pv,
        spacings.mtLg,
        { borderWidth: 1, borderColor: theme.secondaryBorder }
      ]}
    >
      <View style={[flexbox.flex1, spacings.mrSm]}>
        <Text fontSize={16} weight="medium">
          {t(`${OVERVIEW}.recover.title`)}
        </Text>
        <Text fontSize={12} appearance="secondaryText">
          {t(`${OVERVIEW}.recover.body`)}
        </Text>
      </View>
      <RightArrowIcon />
    </Pressable>
  )

  if (facts.status !== 'answered') {
    return (
      <TwoColumn testID="overview-columns">
        <View testID="overview">
          {title()}
          {facts.status === 'pending' && (
            <View testID="overview-reading">
              <ActivityIndicator style={spacings.mbSm} />
              <Text fontSize={14} appearance="secondaryText">
                {t(`${OVERVIEW}.reads.loading`)}
              </Text>
            </View>
          )}
          {facts.status === 'failed' && (
            <ReadFailedBlock
              testID="overview-read-failed"
              title={t(`${OVERVIEW}.reads.failedTitle`)}
              body={t(`${OVERVIEW}.reads.failedBody`)}
              onRetry={reads.retry}
            />
          )}
          {facts.status === 'update-the-wallet' && (
            <Alert
              testID="overview-update-the-wallet"
              type="error"
              size="sm"
              style={spacings.mbSm}
              title={t('socialRecovery.client.updateTheWalletTitle')}
              text={t('socialRecovery.client.updateTheWalletHow')}
            />
          )}
          {recoverEntry}
        </View>
      </TwoColumn>
    )
  }

  const { setup, attemptOpen }: OverviewFacts = facts.value
  const kind: OverviewKind = overviewKindOf(setup)

  const leadKey = (): string => {
    if (attemptOpen) {
      return `${OVERVIEW}.lead.inProgress`
    }
    return setup.hasSetup ? `${OVERVIEW}.lead.setUp` : `${OVERVIEW}.lead.notSetUp`
  }

  const chips = (
    <View
      style={[flexbox.directionRow, flexbox.wrap, flexbox.alignCenter, spacings.mbSm]}
      testID="overview-chips"
    >
      {kind === 'set-up' && (
        <StatusChip
          testID="overview-chip-set-up"
          tone="success"
          text={renderChip('recovery', 'setUp', t)}
          style={spacings.mrTy}
        />
      )}
      {kind === 'set-up' && path.kind === 'locked' && (
        <StatusChip
          testID="overview-chip-path-locked"
          tone="warning"
          text={renderChip('recovery', 'pathLocked', t)}
          style={spacings.mrTy}
        />
      )}
      {kind === 'not-set-up' && (
        <StatusChip
          testID="overview-chip-not-set-up"
          text={renderChip('recovery', 'notSetUp', t)}
          style={spacings.mrTy}
        />
      )}
      {(kind === 'dormant' || kind === 'mirror') && (
        <StatusChip
          testID="overview-chip-not-active"
          tone="warning"
          text={renderChip('recovery', 'notActive', t)}
          style={spacings.mrTy}
        />
      )}
      {attemptOpen && (
        <StatusChip
          testID="overview-chip-in-progress"
          tone="error"
          text={renderChip('attempt', 'recoveryInProgress', t)}
        />
      )}
    </View>
  )

  const dormantBlock = () => (
    <SectionCard testID="overview-dormant">
      <Text fontSize={16} weight="medium" style={spacings.mbTy} testID="overview-dormant-title">
        {t(`${OVERVIEW}.dormant.title`)}
      </Text>
      <Text fontSize={14} style={spacings.mbTy} testID="overview-dormant-body">
        {t(`${OVERVIEW}.dormant.body`)}
      </Text>
      {attemptOpen && (
        <>
          <Text
            fontSize={14}
            weight="medium"
            style={spacings.mbTy}
            testID="overview-dormant-pending"
          >
            {t(`${OVERVIEW}.dormant.pendingLine`)}
          </Text>
          <Text
            fontSize={14}
            appearance="secondaryText"
            style={spacings.mbTy}
            testID="overview-dormant-refused"
          >
            {t(`${OVERVIEW}.dormant.refused`)}
          </Text>
          <Text
            fontSize={14}
            weight="medium"
            style={spacings.mtTy}
            testID="overview-dormant-clear-cancels"
          >
            {t(`${OVERVIEW}.dormant.clearCancels`)}
          </Text>
        </>
      )}
      <ActionsRow
        primary={
          attemptOpen ? (
            <Button
              testID="overview-clear"
              type="secondary"
              text={t(`${OVERVIEW}.dormant.clear`)}
              onPress={() => onOpen('clear')}
              hasBottomSpacing={false}
            />
          ) : (
            <Button
              testID="overview-reauthorize"
              type="primary"
              text={t(`${OVERVIEW}.dormant.reauthorize`)}
              onPress={() => onOpen('reauthorize')}
              hasBottomSpacing={false}
            />
          )
        }
        secondary={
          attemptOpen ? undefined : (
            <Button
              testID="overview-clear"
              type="secondary"
              text={t(`${OVERVIEW}.dormant.clear`)}
              onPress={() => onOpen('clear')}
              hasBottomSpacing={false}
            />
          )
        }
        note={attemptOpen ? undefined : t(`${OVERVIEW}.dormant.reauthorizeNote`)}
        noteTestID="overview-reauthorize-note"
      />
    </SectionCard>
  )

  const mirrorBlock = () => (
    <SectionCard testID="overview-mirror">
      <Text fontSize={16} weight="medium" style={spacings.mbTy} testID="overview-mirror-title">
        {t(`${OVERVIEW}.mirror.title`)}
      </Text>
      <Text fontSize={14} style={spacings.mbTy} testID="overview-mirror-body">
        {t(`${OVERVIEW}.mirror.body`)}
      </Text>
      <ActionsRow
        primary={
          <Button
            testID="overview-remove-authorization"
            type="primary"
            text={t(`${OVERVIEW}.mirror.action`)}
            onPress={() => onOpen('removeAuthorization')}
            hasBottomSpacing={false}
          />
        }
      />
    </SectionCard>
  )

  const noticesBlock = () => {
    if (!setup.hasSetup) {
      return null
    }
    if (notices.status === 'pending') {
      return <ActivityIndicator testID="overview-notices-reading" style={spacings.mbSm} />
    }
    if (notices.status === 'failed') {
      return (
        <ReadFailedBlock
          testID="overview-notices-failed"
          title={t(`${OVERVIEW}.reads.noticesFailedTitle`)}
          body={t(`${OVERVIEW}.reads.noticesFailedBody`)}
          onRetry={reads.retryNotices}
        />
      )
    }
    const moved = movedInPath(notices.value.moved, pathMethodsOf(path, context.addressBook))
    const ended = endedNoticeOf(ending, notices.value.cancelledAttempts)
    return (
      <>
        {moved.map(({ method }) => {
          const id = method.toLowerCase()
          const admin = adminOf(method)
          return (
            <SectionCard key={id} testID={`overview-moved-${id}`}>
              <Text
                fontSize={16}
                weight="medium"
                style={spacings.mbTy}
                testID={`overview-moved-${id}-title`}
              >
                {t(`${OVERVIEW}.movedKeys.title`, { method: methodNameOf(method) })}
              </Text>
              <Text fontSize={14} style={spacings.mbTy}>
                {t(`${OVERVIEW}.movedKeys.body`)}
              </Text>
              <Text fontSize={14} appearance="secondaryText" style={spacings.mbTy}>
                {t(`${OVERVIEW}.movedKeys.admin`)}
              </Text>
              {!!admin && (
                <Text
                  fontSize={14}
                  weight="number_medium"
                  selectable
                  style={spacings.mbTy}
                  testID={`overview-moved-${id}-admin`}
                >
                  {renderFullAddress(admin)}
                </Text>
              )}
              <Text
                fontSize={14}
                weight="medium"
                style={spacings.mbTy}
                testID={`overview-moved-${id}-caveat`}
              >
                {t(`${OVERVIEW}.movedKeys.caveat`)}
              </Text>
              <ActionsRow
                primary={
                  <Button
                    testID={`overview-moved-${id}-edit`}
                    type="secondary"
                    text={t(`${OVERVIEW}.movedKeys.edit`)}
                    onPress={() => navigate(WEB_ROUTES.socialRecoveryManageEdit)}
                    hasBottomSpacing={false}
                  />
                }
              />
            </SectionCard>
          )
        })}
        {!!ended && (
          <SectionCard tone="muted" testID="overview-ended">
            <Text fontSize={14} style={spacings.mbTy} testID="overview-ended-line">
              {t(
                ended.road === 'ownerCancel'
                  ? `${OVERVIEW}.ended.ownerCancel`
                  : `${OVERVIEW}.ended.setupWrite`,
                { date: renderDateTimeInZone(ended.at * 1000, timeZone).date }
              )}
            </Text>
            <ActionsRow
              primary={
                <Button
                  testID="overview-ended-replace"
                  type="secondary"
                  text={t(`${OVERVIEW}.ended.replace`)}
                  onPress={() => navigate(WEB_ROUTES.socialRecoveryManageEdit)}
                  hasBottomSpacing={false}
                />
              }
            />
          </SectionCard>
        )}
      </>
    )
  }

  const pathBody = () => {
    switch (path.kind) {
      case 'reading':
        return <ActivityIndicator testID="overview-path-reading" style={spacings.mbSm} />
      case 'read-failed':
        return (
          <ReadFailedBlock
            testID="overview-path-failed"
            title={t(`${OVERVIEW}.reads.failedTitle`)}
            body={t(`${OVERVIEW}.reads.failedBody`)}
            onRetry={reads.retryPath}
          />
        )
      case 'update-the-wallet':
        return (
          <Alert
            testID="overview-path-update-the-wallet"
            type="error"
            size="sm"
            title={t('socialRecovery.client.updateTheWalletTitle')}
            text={t('socialRecovery.client.updateTheWalletHow')}
          />
        )
      case 'no-details':
        return (
          <Alert
            testID="overview-path-no-details"
            type="warning"
            size="sm"
            title={t('socialRecovery.readout.noDetails')}
          />
        )
      case 'mismatch':
        return (
          <Alert
            testID="overview-path-mismatch"
            type="error"
            size="sm"
            title={t('socialRecovery.readout.detailsMismatch', { network: networkName })}
          />
        )
      case 'locked':
        return (
          <PathLockedAsk
            testID="overview-locked"
            ask={reads.ask}
            onUnlock={reads.unlock}
            onAskAgain={reads.askAgain}
            onRetry={reads.retryPath}
          />
        )
      case 'readable':
        return readablePath ? <ReadoutPathBlock path={readablePath} /> : null
      default:
        return null
    }
  }

  const pathBlock = () => (
    <SectionCard testID="overview-path">
      {pathBody()}
      {kind === 'set-up' && (
        <>
          {attemptOpen && (
            <Text
              fontSize={14}
              weight="medium"
              style={spacings.mtSm}
              testID="overview-path-pending"
            >
              {t(`${OVERVIEW}.path.pendingLine`)}
            </Text>
          )}
          <ActionsRow
            primary={
              <Button
                testID="overview-edit-path"
                type="primary"
                text={t(`${OVERVIEW}.path.editPath`)}
                onPress={() => navigate(WEB_ROUTES.socialRecoveryManageEdit)}
                hasBottomSpacing={false}
              />
            }
            secondary={
              <Button
                testID="overview-remove-recovery"
                type="secondary"
                text={t(`${OVERVIEW}.path.removeRecovery`)}
                onPress={() => navigate(WEB_ROUTES.socialRecoveryManageRemove)}
                hasBottomSpacing={false}
              />
            }
          />
        </>
      )}
    </SectionCard>
  )

  const emptyBlock = () => (
    <SectionCard testID="overview-empty">
      <Text fontSize={14} style={spacings.mbTy} testID="overview-empty-body">
        {t(`${OVERVIEW}.empty.body`)}
      </Text>
      <ActionsRow
        primary={
          <Button
            testID="overview-set-up"
            type="primary"
            text={t(`${OVERVIEW}.empty.action`)}
            onPress={() => navigate(WEB_ROUTES.socialRecoverySetup)}
            hasBottomSpacing={false}
          />
        }
      />
    </SectionCard>
  )

  const cardEntry = (
    <SectionCard tone="muted" testID="overview-card">
      <Text fontSize={16} weight="medium" style={spacings.mbTy}>
        {t(`${OVERVIEW}.card.title`)}
      </Text>
      <Text fontSize={12} appearance="secondaryText" style={spacings.mbTy}>
        {t(`${OVERVIEW}.card.body`)}
      </Text>
      <ActionsRow
        primary={
          <Button
            testID="overview-card-open"
            type="secondary"
            size="small"
            text={t(`${OVERVIEW}.card.action`)}
            onPress={() => navigate(WEB_ROUTES.socialRecoverySetupCard)}
            hasBottomSpacing={false}
          />
        }
      />
    </SectionCard>
  )

  return (
    <TwoColumn testID="overview-columns">
      <View testID={`overview-${kind}`}>
        {title(t(leadKey()))}
        {chips}
        {attemptOpen && <View testID="overview-banner">{banner}</View>}
        {kind === 'dormant' && dormantBlock()}
        {kind === 'mirror' && mirrorBlock()}
        {noticesBlock()}
        {setup.hasSetup && pathBlock()}
        {kind === 'not-set-up' && emptyBlock()}
        {recoverEntry}
        {setup.hasSetup && cardEntry}
      </View>
    </TwoColumn>
  )
}

export default React.memo(OverviewView)
