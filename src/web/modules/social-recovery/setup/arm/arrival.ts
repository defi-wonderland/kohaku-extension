/**
 * The save on arrival. The route opens by its address and the review hands
 * nothing over, so the save runs the review's gate again over the same reads
 * and shows the same blocks. It also needs the account's facts: an account the
 * wallet cannot read, or one whose key the keystore does not hold, cannot
 * save. A setup the account already holds blocks before every other block of
 * the gate, so a save that ended, in this tab or another, never reads as the
 * empty draft its wiped records leave. An encrypted backup whose recovery password is no longer in memory
 * (the tab was reloaded) sends the holder back to the privacy step, writing
 * nothing. The save is ready only where none of these applies and the gate
 * lets it run.
 */
import { isSaved } from './run'
import type { ArmScreenKind, ArmState, Arrival, ArrivalInput } from './types'

const LOADING: Arrival = { kind: 'loading' }

export const arrivalOf = ({
  facts,
  client,
  load,
  gate,
  setupState,
  passwordHeld
}: ArrivalInput): Arrival => {
  if (facts.status === 'loading') {
    return LOADING
  }
  if (facts.status === 'unavailable') {
    return facts.cause === 'state-unread'
      ? { kind: 'unavailable', retry: 'facts' }
      : { kind: 'unavailable', retry: null, cause: 'not-listed' }
  }
  if (!facts.facts.key) {
    return { kind: 'unavailable', retry: null, cause: 'view-only' }
  }
  if (client === 'update-the-wallet') {
    return { kind: 'update-the-wallet' }
  }
  if (client === 'failed') {
    return { kind: 'unavailable', retry: 'client' }
  }
  if (client === 'loading' || load.status === 'loading') {
    return LOADING
  }
  if (load.status === 'failed') {
    return { kind: 'load-failed' }
  }
  if (setupState.status === 'answered' && setupState.value.hasSetup) {
    return { kind: 'blocked', block: { kind: 'already-set-up' } }
  }
  if (gate.blocked) {
    return { kind: 'blocked', block: gate.blocked }
  }
  if (!gate.canSave) {
    return LOADING
  }
  if (load.draft.privacy.backup === 'encrypted' && !passwordHeld) {
    return { kind: 'blocked', block: { kind: 'password-missing' } }
  }
  return { kind: 'ready' }
}

/**
 * What the screen shows. Once the save started, its run decides, whatever the
 * arrival reads after it; the saved screen shows only after the check agreed
 * and the records were wiped.
 */
export const armScreenOf = (state: ArmState): ArmScreenKind => {
  if (isSaved(state)) {
    return 'saved'
  }
  if (state.stop) {
    return state.stop
  }
  switch (state.after.stage) {
    case 'disagreed':
      return 'disagreed'
    case 'unread':
      return 'unread'
    case 'confirming':
    case 'saving':
      return 'confirming'
    default:
      return state.write.run === 0 ? 'arrival' : 'run'
  }
}
