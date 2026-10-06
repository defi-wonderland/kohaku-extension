import { zeroAddress } from 'viem'

import type { PaymentOrder } from '@web/modules/social-recovery/sdk-interfaces'

/** The first release's order: no payment, to nobody. */
export const NO_PAYMENT_ORDER: PaymentOrder = {
  token: zeroAddress,
  amount: BigInt(0),
  payee: zeroAddress
}

/** The logged-in route's five stages; the checklist is the fourth. */
export const RECOVERY_STAGES = 5
export const CHECKLIST_STAGE = 4
export const STAGE_COUNTER_KEY = 'socialRecovery.entry.stageCounter'

/** The slug the ceremony tab's route and the ceremony request carry for a passkey. */
export const PASSKEY_SLUG = 'passkey'

/** The search keys the checklist reads: the account being recovered, and a ceremony that returned. */
export const CHECKLIST_SEARCH_KEYS = {
  account: 'account',
  ceremony: 'ceremony'
} as const
