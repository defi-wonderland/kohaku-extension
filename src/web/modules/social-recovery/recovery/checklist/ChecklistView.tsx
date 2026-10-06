/**
 * The checklist: the live session of the account being recovered, one row
 * per place of the gathering under the path's clauses, the headline that
 * counts a group as one unit, the request's deadline, and continue once the
 * assessment finds the rule satisfied. Nothing renders before the stored
 * session is read and the account's recovery state has answered once; a
 * failed read never renders as an empty path, and a failed poll holds every
 * row until a poll succeeds.
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
import DeadlineBlock from './DeadlineBlock'
import GuardianRow from './GuardianRow'
import IdentityRow from './IdentityRow'
import PasskeyRow from './PasskeyRow'
import PollAlert from './PollAlert'
import { attemptLive } from './poll'
import {
  chosenPlacesOf,
  headlineOf,
  layoutOf,
  methodDidNotAnswer,
  rowStatesOf,
  unlockLineKeyOf,
  unsatisfiedOf
} from './rows'
import { submitPathOf } from './search'
import type {
  AlertKeys,
  AnsweredMemory,
  ChecklistFailure,
  ChecklistRow,
  ChecklistViewProps,
  SlotReading
} from './types'
import UnsatisfiedBlock from './UnsatisfiedBlock'
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

  const { load, assessment, addReply, poll } = checklist
  const kit = client.status === 'ready' ? client.client : null
  const live = load.phase === 'live' ? load : null
  const pollClock = poll.status === 'answered' ? poll.clock : null

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
  // The places the submission would carry, from the client's own pick, so a
  // filled row it leaves out reads not needed.
  const chosen = useMemo(
    () =>
      live && kit && assessment && pollClock !== null
        ? chosenPlacesOf(kit, live.session.gathering, assessment, Math.floor(pollClock / 1000))
        : undefined,
    [live, kit, assessment, pollClock]
  )
  const { outcomes } = claim
  const didNotAnswer = useMemo(
    () =>
      new Set(
        Object.entries(outcomes)
          .filter(([, held]) => !!held && methodDidNotAnswer(held.outcome))
          .map(([place]) => Number(place))
      ),
    [outcomes]
  )
  const states = useMemo(
    () =>
      layout && assessment
        ? rowStatesOf(layout, assessment, live?.session.notes, claim.asked, {
            chosen,
            didNotAnswer
          })
        : null,
    [layout, assessment, live, claim.asked, chosen, didNotAnswer]
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

  // A wiped session keeps no claim: every request and report of this
  // checklist's ceremonies goes, a report that lands later included.
  const isWiped = load.phase === 'wiped'
  const { forgetAll } = claim
  const ceremonyId = search.ceremony
  useEffect(() => {
    if (isWiped && (pending || ceremonyId)) {
      forgetAll()
    }
  }, [isWiped, pending, ceremonyId, forgetAll])

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
    let slot: SlotReading = 'unread'
    if (poll.status === 'failed') {
      slot = 'failed'
    } else if (poll.status === 'answered') {
      slot = attemptLive(poll.facts.attempt) ? 'held' : 'free'
    }
    return (
      <WipedBlock
        session={load.session}
        timeZone={deps.timeZone}
        busy={checklist.busy || destination.status !== 'ready'}
        failed={checklist.gatherFailed}
        onGatherAgain={() => {
          checklist.gatherAgain().catch(() => undefined)
        }}
        hadReplies={load.hadReplies}
        slot={slot}
        onRetryPoll={checklist.retryPoll}
        onReadSetupAgain={() => {
          checklist.readSetupAgain().catch(() => undefined)
        }}
      />
    )
  }

  // The rows never render before the account's recovery state answered once.
  if (!live || poll.status === 'pending') {
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
  // A failed poll, or a death the records could not wipe, holds every add,
  // launch and continue until a poll succeeds.
  const held = poll.status === 'failed' || checklist.deathFailed
  const dormant = poll.status === 'answered' && !poll.facts.authorized
  const busy = checklist.busy || claim.busy || held
  const satisfied = assessment.ruleSatisfied
  const unsatisfied = unsatisfiedOf(layout, assessment, states)

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
      <DeadlineBlock
        gathering={live.session.gathering}
        layout={layout}
        now={deps.now}
        timeZone={deps.timeZone}
      />
      {poll.status === 'failed' && <PollAlert withRows onRetry={checklist.retryPoll} />}
      {checklist.deathFailed && (
        <Alert
          testID="checklist-death-failed"
          type="error"
          size="sm"
          style={spacings.mbSm}
          text={t('socialRecovery.records.writeFailed')}
        >
          {retryButton(checklist.retryPoll, 'checklist-death-failed-retry')}
        </Alert>
      )}
      {dormant && (
        <Alert
          testID="checklist-dormant"
          type="warning"
          size="sm"
          style={spacings.mbSm}
          title={t('socialRecovery.wait.cannotExecute.notAuthorized')}
          text={t('socialRecovery.wait.cannotExecute.notAuthorizedRepair')}
        />
      )}
      {!!unsatisfied && <UnsatisfiedBlock reading={unsatisfied} />}
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
            disabled={!satisfied || busy || dormant}
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
      {unsatisfied?.kind !== 'didNotAnswer' && (
        <AbandonBlock
          busy={checklist.busy || claim.busy}
          failed={checklist.abandonFailed}
          onAbandon={() => {
            checklist.abandon(claim.forgetAll).catch(() => undefined)
          }}
        />
      )}
    </View>
  )
}

export default React.memo(ChecklistView)
