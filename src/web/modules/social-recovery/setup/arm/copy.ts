/**
 * The save's own words over the shared write states: its title over a failed
 * save, its sentence after the submitting state, and its own line in place of
 * the shared one where nothing was sent, that everything enrolled is still on
 * this device. The reverted reading already speaks in the save's words. A
 * replaced transaction was sent, and a refusal for another waiting request
 * names that request, so both keep the shared line under the save's title. A
 * save that may still land carries no failure title and one line of its own.
 */
import { mayStillLand, otherRequestPending } from '@web/modules/social-recovery/shared/writes'
import type { WriteState } from '@web/modules/social-recovery/shared/writes'

import type { DisagreedCheck, SaveWriteKeys } from './types'

const AFTER = 'socialRecovery.review.after'
const DISAGREED = 'socialRecovery.arm.disagreed'

/** The keys of the save's own title, line and sentence over a write state, where it sets them. */
export const saveWriteKeysOf = (state: WriteState): SaveWriteKeys => {
  switch (state.status) {
    case 'submitting':
      return { note: `${AFTER}.submitting` }
    case 'failedNotSent':
      if (mayStillLand(state)) {
        return { body: 'socialRecovery.arm.mayStillLand' }
      }
      return state.replaced || otherRequestPending(state)
        ? { title: `${AFTER}.failedTitle` }
        : { title: `${AFTER}.failedTitle`, body: `${AFTER}.notSent` }
    case 'failedReverted':
      return { title: `${AFTER}.failedTitle` }
    default:
      return {}
  }
}

/** The key of the line that names the check that disagreed. */
export const disagreedLineKeyOf = (check: DisagreedCheck): string =>
  check === 'mismatch' ? `${DISAGREED}.mismatch` : `${DISAGREED}.authorizationUnrecognized`
