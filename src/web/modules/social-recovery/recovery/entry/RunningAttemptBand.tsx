/**
 * The running attempt's band with its two exits. Continue with that key keeps
 * the recovery entry under the account that holds the attempt's key and the
 * countdown the chain describes, then opens the wait; the recoverer's own
 * session may be gone, and the attempt lives on chain. The cancel opens the
 * cancel's own tab for the account.
 */
import React, { useCallback, useMemo, useState } from 'react'

import { cancelPathOf } from '@web/modules/social-recovery/cancel'
import { waitPathOf } from '@web/modules/social-recovery/recovery/checklist/search'

import { restoreCountdown } from './countdown'
import { continueTargetOf, ownershipOf, seedReceiversOf } from './running'
import RunningAttemptBandView from './RunningAttemptBandView'
import type { ContinueState, RunningAttemptBandProps } from './types'

const RunningAttemptBand = ({
  state,
  account,
  chainId,
  records,
  storage,
  route,
  choices,
  keys,
  navigate
}: RunningAttemptBandProps) => {
  const { attempt, opening, authority, entries, retry } = state
  const [continueState, setContinueState] = useState<ContinueState>('idle')
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  const seedReceivers = useMemo(() => seedReceiversOf(entries, choices), [entries, choices])
  const newKey = opening.status === 'answered' ? opening.value.newKey : null
  const ownership = newKey ? ownershipOf(newKey, seedReceivers, keys) : null
  const target =
    newKey && ownership ? continueTargetOf(newKey, ownership, seedReceivers, choices, route) : null

  const onContinue = useCallback(() => {
    if (
      !target ||
      attempt.status !== 'answered' ||
      opening.status !== 'answered' ||
      continueState === 'writing'
    ) {
      return
    }
    const running = attempt.value
    setContinueState('writing')
    records
      .recoveryEntry(chainId, account)
      .write({ account, ...target })
      .then(() =>
        restoreCountdown(storage, records, chainId, account, {
          attemptId: running.attemptId,
          setupNonce: running.setupNonce,
          payloadHash: running.payloadHash,
          openedAtMs: opening.value.openedAt * 1000
        })
      )
      .then(
        () => {
          setContinueState('idle')
          navigate(waitPathOf(account))
        },
        () => setContinueState('failed')
      )
  }, [target, attempt, opening, continueState, records, storage, chainId, account, navigate])

  const onCancel = useCallback(() => navigate(cancelPathOf(account)), [navigate, account])

  return (
    <RunningAttemptBandView
      attempt={attempt}
      opening={opening}
      ownership={ownership}
      authority={authority}
      canContinue={!!target}
      continueState={continueState}
      timeZone={timeZone}
      onRetry={retry}
      onContinue={onContinue}
      onCancel={onCancel}
    />
  )
}

export default React.memo(RunningAttemptBand)
