/**
 * The checklist: the live session of the account being recovered, one row
 * per place of the gathering under the path's clauses, the headline that
 * counts a group as one unit, the request's deadline, and continue once the
 * assessment finds the rule satisfied. Nothing renders before the stored
 * session is read; a failed read never renders as an empty path.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'

import Alert from '@common/components/Alert'
import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import type { ApproverRequest } from '@web/modules/social-recovery/sdk-interfaces'
import { failed } from '@web/modules/social-recovery/shared/ceremony'
import { ActionsRow, PageTitle } from '@web/modules/social-recovery/shared/chrome'
import { addressBookOf, WALLET_RECOVERY_CHAIN } from '@web/modules/social-recovery/shared/client'

import AbandonBlock from './AbandonBlock'
import ChecklistRows from './ChecklistRows'
import GuardianRow from './GuardianRow'
import IdentityRow from './IdentityRow'
import { deadlineLineOf } from './lines'
import PasskeyRow from './PasskeyRow'
import { headlineOf, layoutOf, rowStatesOf, unlockLineKeyOf } from './rows'
import { submitPathOf } from './search'
import type {
  AlertKeys,
  AnsweredMemory,
  ChecklistFailure,
  ChecklistRow,
  ChecklistViewProps
} from './types'
import useChecklist from './useChecklist'
import useGuardianSupport from './useGuardianSupport'
import usePasskeyClaim from './usePasskeyClaim'
import WipedBlock from './WipedBlock'

const CHECKLIST = 'socialRecovery.checklist'

const FAILURE_KEYS: Record<ChecklistFailure, AlertKeys> = {
  records: {
    title: 'socialRecovery.client.unavailableTitle',
    body: 'socialRecovery.client.unavailableBody'
  },
  setup: {
    title: 'socialRecovery.entry.confirm.setupReadFailedTitle',
    body: 'socialRecovery.entry.confirm.setupReadFailedBody'
  },
  open: {
    title: 'socialRecovery.client.unavailableTitle',
    body: 'socialRecovery.client.unavailableBody'
  },
  destination: {
    title: 'socialRecovery.entry.confirm.readFailed',
    body: 'socialRecovery.client.unavailableBody'
  }
}

const ChecklistView = ({
  records,
  chainId,
  account,
  entry,
  client,
  destination,
  search,
  navigate,
  deps
}: ChecklistViewProps) => {
  const { t } = useTranslation()
  const book = useMemo(() => addressBookOf(WALLET_RECOVERY_CHAIN), [])
  const checklist = useChecklist({
    records,
    chainId,
    account,
    entry,
    client,
    destination,
    navigate,
    deps
  })
  const claim = usePasskeyClaim({ records, chainId, account, search, navigate, deps })
  const [answered, setAnswered] = useState<Partial<Record<number, AnsweredMemory>>>({})
  const [pendingFailed, setPendingFailed] = useState(false)

  const { load, assessment, addReply } = checklist
  const kit = client.status === 'ready' ? client.client : null
  const live = load.phase === 'live' ? load : null

  const layout = useMemo(
    () => (live ? layoutOf(live.configuration, live.session.gathering, book) : null),
    [live, book]
  )
  const requests = useMemo(() => {
    if (!live || !kit) {
      return new Map<number, ApproverRequest>()
    }
    try {
      return new Map(
        kit.recovery
          .getApproverRequests(live.session.gathering)
          .map((request) => [request.place, request])
      )
    } catch {
      return new Map<number, ApproverRequest>()
    }
  }, [live, kit])
  const states = useMemo(
    () =>
      layout && assessment
        ? rowStatesOf(layout, assessment, live?.session.notes, claim.asked)
        : null,
    [layout, assessment, live, claim.asked]
  )
  const guardianSupport = useGuardianSupport({
    kit,
    gathering: live ? live.session.gathering : null,
    requests,
    layout,
    destination,
    now: deps.now,
    timeZone: deps.timeZone
  })

  // A passed claim joins the session once it is live; a conflict keeps it
  // waiting for the reload, and a refusal reads as the row's note.
  const { pending, settle } = claim
  const applying = useRef(false)
  const applyPending = useCallback(async () => {
    if (!pending || applying.current) {
      return
    }
    applying.current = true
    setPendingFailed(false)
    try {
      const result = await addReply(pending.reply)
      if (result.kind === 'added') {
        setAnswered((held) => ({
          ...held,
          [pending.place]: { phone: pending.facts?.place === 'phone', at: deps.now() }
        }))
        settle(pending.place)
      } else if (result.kind === 'refused') {
        settle(pending.place, failed('check-rejected', result.cause))
      } else if (result.kind === 'write-failed') {
        setPendingFailed(true)
      }
    } finally {
      applying.current = false
    }
  }, [pending, addReply, settle, deps])
  const isLive = load.phase === 'live'
  useEffect(() => {
    if (isLive && pending && !pendingFailed && !checklist.busy) {
      applyPending().catch(() => setPendingFailed(true))
    }
  }, [isLive, pending, pendingFailed, checklist.busy, applyPending])

  const title = (
    <PageTitle
      title={t(`${CHECKLIST}.title`)}
      lead={t(`${CHECKLIST}.lead`)}
      titleTestID="checklist-title"
    />
  )

  const retryButton = (onPress: () => void, testID: string) => (
    <View style={spacings.mtTy}>
      <Button
        testID={testID}
        type="secondary"
        size="small"
        text={t('socialRecovery.writes.tryAgain')}
        onPress={onPress}
        hasBottomSpacing={false}
        style={{ alignSelf: 'flex-start' }}
      />
    </View>
  )

  const errorAlert = (keys: AlertKeys, testID: string, onRetry: () => void) => (
    <Alert
      testID={testID}
      type="error"
      size="sm"
      style={spacings.mbSm}
      title={t(keys.title)}
      text={t(keys.body)}
    >
      {retryButton(onRetry, `${testID}-retry`)}
    </Alert>
  )

  if (client.status === 'update-the-wallet' || client.status === 'failed') {
    const refused = client.status === 'update-the-wallet'
    return (
      <View testID="checklist">
        {title}
        {errorAlert(
          refused
            ? {
                title: 'socialRecovery.client.updateTheWalletTitle',
                body: 'socialRecovery.client.updateTheWalletBody'
              }
            : {
                title: 'socialRecovery.client.unavailableTitle',
                body: 'socialRecovery.client.unavailableBody'
              },
          `checklist-client-${client.status}`,
          checklist.retry
        )}
      </View>
    )
  }

  if (load.phase === 'failed') {
    return (
      <View testID="checklist">
        {title}
        {errorAlert(FAILURE_KEYS[load.cause], `checklist-failed-${load.cause}`, checklist.retry)}
      </View>
    )
  }

  if (load.phase === 'conflict') {
    return (
      <View testID="checklist">
        {title}
        {errorAlert(
          {
            title: 'socialRecovery.client.unavailableBody',
            body: `${CHECKLIST}.leavingKeeps`
          },
          'checklist-conflict',
          checklist.retry
        )}
      </View>
    )
  }

  if (load.phase === 'wiped') {
    return (
      <WipedBlock
        session={load.session}
        timeZone={deps.timeZone}
        busy={checklist.busy || destination.status !== 'ready'}
        failed={checklist.gatherFailed}
        onGatherAgain={() => {
          checklist.gatherAgain().catch(() => undefined)
        }}
      />
    )
  }

  if (!live) {
    return (
      <View testID="checklist">
        {title}
        <ActivityIndicator testID="checklist-loading" />
      </View>
    )
  }

  if (!layout || !assessment || !states) {
    return (
      <View testID="checklist">
        {title}
        {errorAlert(FAILURE_KEYS.setup, 'checklist-failed-setup', checklist.retry)}
      </View>
    )
  }

  const headline = headlineOf(layout, assessment)
  const deadline = deadlineLineOf(live.session.gathering, deps.now(), deps.timeZone, t)
  const busy = checklist.busy || claim.busy
  const satisfied = assessment.ruleSatisfied

  const renderRow = (row: ChecklistRow) => {
    const state = states.get(row.place)
    if (!state) {
      return null
    }
    const request = requests.get(row.place)
    if (row.kind === 'passkey') {
      return (
        <PasskeyRow
          row={row}
          state={state}
          request={request}
          outcome={claim.outcomes[row.place]}
          answered={answered[row.place]}
          rpIdHash={deps.rpIdHash}
          served={deps.passkeysServed}
          busy={busy}
          timeZone={deps.timeZone}
          route={entry.route}
          launch={(asked, handOff) => {
            claim.launch(asked, handOff).catch(() => undefined)
          }}
        />
      )
    }
    if (row.kind === 'ecdsa') {
      return (
        <GuardianRow
          row={row}
          state={state}
          request={request}
          support={guardianSupport}
          busy={busy}
          setNote={(place, note) => {
            checklist.setNote(place, note).catch(() => undefined)
          }}
          addReply={addReply}
        />
      )
    }
    return <IdentityRow row={row} state={state} />
  }

  return (
    <View testID="checklist">
      {title}
      <Text fontSize={16} weight="semiBold" style={spacings.mbTy} testID="checklist-progress">
        {t(`${CHECKLIST}.progress`, { done: headline.done, total: headline.total })}
      </Text>
      {!!deadline && (
        <Text fontSize={14} style={spacings.mbSm} testID="checklist-deadline">
          {deadline}
        </Text>
      )}
      {claim.undelivered && (
        <Alert
          testID="checklist-undelivered"
          type="error"
          size="sm"
          style={spacings.mbSm}
          text={t('socialRecovery.ceremony.undeliveredNote')}
        >
          {retryButton(() => {
            claim.retryUndelivered().catch(() => undefined)
          }, 'checklist-undelivered-retry')}
        </Alert>
      )}
      {(claim.launchFailed || checklist.noteFailed || pendingFailed) && (
        <Alert
          testID="checklist-write-failed"
          type="error"
          size="sm"
          style={spacings.mbSm}
          text={t('socialRecovery.records.writeFailed')}
        >
          {pendingFailed &&
            retryButton(() => setPendingFailed(false), 'checklist-write-failed-retry')}
        </Alert>
      )}
      <ChecklistRows layout={layout} assessment={assessment} renderRow={renderRow} />
      {satisfied ? (
        <Text fontSize={14} style={spacings.mtSm} testID="checklist-satisfied">
          {t(`${CHECKLIST}.satisfied`)}
        </Text>
      ) : null}
      <ActionsRow
        primary={
          <Button
            testID="checklist-continue"
            type="primary"
            text={t('socialRecovery.actions.continue')}
            disabled={!satisfied || busy}
            onPress={() => navigate(submitPathOf(account))}
            hasBottomSpacing={false}
          />
        }
        note={satisfied ? undefined : t(unlockLineKeyOf(layout))}
        noteTestID="checklist-unlock"
      />
      <Text
        fontSize={12}
        appearance="secondaryText"
        style={spacings.mtSm}
        testID="checklist-verify"
      >
        {t(`${CHECKLIST}.verifyNote`)}
      </Text>
      <Text
        fontSize={12}
        appearance="secondaryText"
        style={spacings.mtTy}
        testID="checklist-leaving-keeps"
      >
        {t(`${CHECKLIST}.leavingKeeps`)}
      </Text>
      <AbandonBlock
        busy={busy}
        failed={checklist.abandonFailed}
        onAbandon={() => {
          checklist.abandon(claim.forgetPending).catch(() => undefined)
        }}
      />
    </View>
  )
}

export default React.memo(ChecklistView)
