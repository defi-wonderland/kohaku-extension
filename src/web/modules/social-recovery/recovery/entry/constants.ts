import { mainnet, sepolia } from 'viem/chains'

import type { RecoveryChain } from '@web/modules/social-recovery/shared/client'

import type { ConfirmedStage } from './types'

/** The logged-in route's stages: the owner, the account, the readout, the collection, the submission. */
export const RECOVERY_STAGES = 5

export const OWNER_STAGE = 1

export const ACCOUNT_STAGE = 2

export const RECOVERY_STAGE_COUNTER_KEY = 'socialRecovery.entry.stageCounter'

/** The search keys of the account step and of the screens after it. */
export const ENTRY_SEARCH_KEYS = {
  route: 'route',
  receivingAccount: 'to',
  account: 'account'
} as const

/** The reads after the confirmation, in the order they run. */
export const CONFIRMED_STAGES: readonly ConfirmedStage[] = ['authorization', 'fit', 'destination']

/** The name a recovery chain goes by where the wallet holds no network record for it. */
export const CHAIN_NAMES: Record<RecoveryChain, string> = {
  sepolia: sepolia.name,
  mainnet: mainnet.name
}
