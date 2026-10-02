/**
 * A save the send port refused as `not-a-transaction`: the wallet submitted
 * the batch as an operation another party sends, so it names no transaction
 * of the account, yet that operation may still reach the chain. The save
 * offers no retry for it and does not say that nothing was sent; a later start
 * reads the account's setup first.
 */
import type { WriteState } from '@web/modules/social-recovery/shared/writes'

import type { ThrownFields } from './types'

const MAY_STILL_LAND = 'not-a-transaction'

/** The reason of the send port's refusal a thrown value carries, where it is one. */
const refusalReasonOf = (thrown: unknown): unknown => {
  if (typeof thrown !== 'object' || thrown === null) {
    return undefined
  }
  const { name, reason } = thrown as ThrownFields
  return name === 'SendRefusal' ? reason : undefined
}

/** Whether a save never sent may still reach the chain as an operation another party sends. */
export const mayStillLand = (write: WriteState): boolean =>
  write.status === 'failedNotSent' && refusalReasonOf(write.error) === MAY_STILL_LAND
