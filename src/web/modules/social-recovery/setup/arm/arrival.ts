/**
 * The save on arrival. The route opens by its address and the review hands
 * nothing over, so the save runs the review's gate again over the same reads
 * and shows the same blocks. It also needs the account's facts: an account the
 * wallet cannot read, or one whose key the keystore does not hold, cannot
 * save. An encrypted backup whose recovery password is no longer in memory
 * (the tab was reloaded) sends the holder back to the privacy step, writing
 * nothing. The save is ready only where none of these applies and the gate
 * lets it run.
 */
import type { ArmScreenKind, ArmState, Arrival, ArrivalInput } from './types'

const LOADING: Arrival = { kind: 'loading' }

export const arrivalOf = ({ facts, client, load, gate, passwordHeld }: ArrivalInput): Arrival => {
  if (facts.status === 'loading') {
    return LOADING
  }
  if (facts.status === 'unavailable') {
    return { kind: 'unavailable', retry: facts.cause === 'state-unread' ? 'facts' : null }
  }
  if (!facts.facts.key) {
    return { kind: 'unavailable', retry: null }
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
  switch (state.after.stage) {
    case 'saved':
      return 'saved'
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
