/**
 * The deployment a record was read under, and whether a record counts for the
 * deployment a client reads now: a setup nonce read from one manager says
 * nothing about another's.
 */
import { isAddressEqual } from 'viem'

import type { DeploymentDescriptor } from '@kohaku-eth/social-recovery'

import { isStoredAddress } from './guards'
import type { RecordDeployment } from './types'

/** The deployment fields a record read through a client of this descriptor carries. */
export const recordDeploymentOf = ({
  manager,
  action
}: Pick<DeploymentDescriptor, 'manager' | 'action'>): RecordDeployment => ({ manager, action })

/**
 * The deployment fields of a stored value, or undefined where the value is not
 * a manager and an action address: a storage read is a boundary.
 */
export const recordDeploymentFrom = (value: unknown): RecordDeployment | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const { manager, action } = value as Record<string, unknown>
  return isStoredAddress(manager) && isStoredAddress(action) ? { manager, action } : undefined
}

/**
 * Whether a record was read under the descriptor's manager and action. A
 * record that names no deployment, one an earlier build wrote, was not.
 */
export const isOfDeployment = (
  deployment: RecordDeployment | undefined,
  descriptor: Pick<DeploymentDescriptor, 'manager' | 'action'>
): boolean =>
  deployment !== undefined &&
  isAddressEqual(deployment.manager, descriptor.manager) &&
  isAddressEqual(deployment.action, descriptor.action)
