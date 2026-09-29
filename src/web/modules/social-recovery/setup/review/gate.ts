/**
 * The save gate: Save runs only once the records loaded, the client is ready,
 * every trust list read answered, the key a recovery removes is named, the
 * action fits the account and no setup exists. The block shown is the first
 * that applies: a read that did not answer, the removed key unreadable, an
 * account this release cannot recover, a setup that already exists. An
 * untested method warns beside Save and never disables it.
 */
import type { Clause } from '@web/modules/social-recovery/sdk-interfaces'
import type { Enrollment } from '@web/modules/social-recovery/shared/records'
import { isEmptySlot } from '@web/modules/social-recovery/shared/records/slots'

import { authoritiesOf } from './doors'
import { enrollmentOf } from './lead'
import { trustReadsComplete } from './trust'
import { ACCOUNT_READ_NAMES } from './types'
import type { AccountReadName, AccountReads, SaveBlock, SaveGate, SaveGateInput } from './types'

/** Whether a credential of the path has no passed access test. */
export const untestedInPath = (
  clauses: readonly Clause[],
  enrollments: readonly Enrollment[]
): boolean =>
  clauses
    .flatMap(({ credentials }) => credentials)
    .some(
      (credential) =>
        !isEmptySlot(credential) && enrollmentOf(credential, enrollments)?.test !== 'passed'
    )

/** Whether the key a recovery would remove could not be named. */
const removedKeyUnreadable = ({ removedKey }: AccountReads): boolean =>
  removedKey.status === 'failed' ||
  (removedKey.status === 'answered' && removedKey.value.kind === 'unavailable')

/**
 * The account's reads a retry runs again: every read that threw, and the
 * removed key where it could not be named.
 */
export const accountReadsToRetry = (reads: AccountReads): AccountReadName[] =>
  ACCOUNT_READ_NAMES.filter(
    (name) =>
      reads[name].status === 'failed' || (name === 'removedKey' && removedKeyUnreadable(reads))
  )

const blockOf = (input: SaveGateInput): SaveBlock | null => {
  const { trustRows, fitCheck, setupState, description } = input
  if (
    trustRows.some(({ contract }) => contract.status === 'unavailable') ||
    fitCheck.status === 'failed' ||
    setupState.status === 'failed'
  ) {
    return { kind: 'unavailable' }
  }
  if (removedKeyUnreadable(input)) return { kind: 'removed-key-unreadable' }
  if (fitCheck.status === 'answered' && !fitCheck.value.fits) {
    return { kind: 'cannot-recover', reason: 'not-supported' }
  }
  if (description.status === 'answered') {
    const count = authoritiesOf(description.value).length
    if (count > 1) return { kind: 'cannot-recover', reason: 'key-count', count }
  }
  if (setupState.status === 'answered' && setupState.value.hasSetup) {
    return { kind: 'already-set-up' }
  }
  return null
}

export const saveGateOf = (input: SaveGateInput): SaveGate => {
  const { recordsLoaded, clientReady, trustRows, removedKey, fitCheck, setupState } = input
  const blocked = recordsLoaded && clientReady ? blockOf(input) : null
  const everyRead =
    trustReadsComplete(trustRows) &&
    removedKey.status === 'answered' &&
    fitCheck.status === 'answered' &&
    setupState.status === 'answered' &&
    // The key count comes from the description, so Save waits for it to settle;
    // a description that could not be read never blocks.
    input.description.status !== 'pending'
  return {
    canSave: recordsLoaded && clientReady && everyRead && blocked === null,
    blocked,
    notTested: recordsLoaded && input.untested
  }
}
