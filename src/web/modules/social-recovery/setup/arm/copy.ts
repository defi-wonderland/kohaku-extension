/**
 * The save's own words over the shared write states: its title over a failed
 * save, and its sentence after the submitting state and after a save never
 * sent, that everything enrolled is still on this device. The reverted reading
 * already speaks in the save's words. A replaced transaction was sent, and an
 * operation another party sends may still land, so the not-sent sentence
 * follows neither.
 */
import type { WriteState } from '@web/modules/social-recovery/shared/writes'

import { mayStillLand } from './refusal'
import type { DisagreedCheck, SaveWriteKeys } from './types'

const AFTER = 'socialRecovery.review.after'
const DISAGREED = 'socialRecovery.arm.disagreed'

/** The keys of the save's own title and sentence over a write state, where it sets them. */
export const saveWriteKeysOf = (state: WriteState): SaveWriteKeys => {
  switch (state.status) {
    case 'submitting':
      return { note: `${AFTER}.submitting` }
    case 'failedNotSent':
      return state.replaced || mayStillLand(state)
        ? { title: `${AFTER}.failedTitle` }
        : { title: `${AFTER}.failedTitle`, note: `${AFTER}.notSent` }
    case 'failedReverted':
      return { title: `${AFTER}.failedTitle` }
    default:
      return {}
  }
}

/** The key of the line that names the check that disagreed. */
export const disagreedLineKeyOf = (check: DisagreedCheck): string =>
  check === 'mismatch' ? `${DISAGREED}.mismatch` : `${DISAGREED}.authorizationUnrecognized`
