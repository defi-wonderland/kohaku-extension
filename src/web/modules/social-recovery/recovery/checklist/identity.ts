/**
 * What an identity row reads of its claim's last outcome: the note, the line
 * that names a failure's cause, and whether it offers a retry. A passed claim
 * reads nothing here; its row reads collected once the reply is added.
 */
import { noteKeyOfOutcome } from '@web/modules/social-recovery/shared/ceremony'

import type { ClaimOutcome, IdentityClaimSlug, IdentityNotes } from './types'

const CEREMONY = 'socialRecovery.ceremony'

const NO_NOTES: IdentityNotes = { note: null, cause: null, retry: false }

/**
 * A failure's cause line: the result that did not match the identifier
 * recorded at enrollment, or any other result the method's own check refused.
 * The phone's own error says so in its note and carries no cause line.
 */
const causeKeyOf = (cause: string): string | null => {
  if (cause === 'phone-error') {
    return null
  }
  return cause === 'material-rejected' ? `${CEREMONY}.noMatchCause` : `${CEREMONY}.rejectedCause`
}

export const identityNotesOf = (
  held: ClaimOutcome | undefined,
  slug: IdentityClaimSlug
): IdentityNotes => {
  if (!held) {
    return NO_NOTES
  }
  const { outcome } = held
  if (outcome.kind === 'dismissed') {
    const declined = outcome.note === 'refused' && slug === 'zkpassport'
    return {
      note: declined ? `${CEREMONY}.declinedNote` : noteKeyOfOutcome(outcome, 'createClaim'),
      cause: null,
      retry: true
    }
  }
  if (outcome.verdict === 'passed') {
    return NO_NOTES
  }
  return {
    note: noteKeyOfOutcome(outcome, 'createClaim'),
    cause: outcome.verdict === 'failed' ? causeKeyOf(outcome.cause) : null,
    retry: outcome.retry === true
  }
}
