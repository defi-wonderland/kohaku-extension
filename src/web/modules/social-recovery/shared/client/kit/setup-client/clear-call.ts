import { encodeFunctionData } from 'viem'

import type { Address, Hex } from '@web/modules/social-recovery/sdk-interfaces'

import { POLICY_MANAGER_ABI } from '../abi'

/** The manager's `clearSetup(action)`, sent by the account. */
export const clearSetupData = (action: Address): Hex =>
  encodeFunctionData({ abi: POLICY_MANAGER_ABI, functionName: 'clearSetup', args: [action] })
