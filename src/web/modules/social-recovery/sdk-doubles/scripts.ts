/**
 * The failure and refusal vocabulary of the scripted chain: which reads can be
 * scripted to fail, which members can be scripted to refuse, and the thrown
 * values they produce. The thrown shapes are the ones sdk.md D-201 "Refusals
 * throw" fixes and utilities.ts declares: an ordinary error, a
 * `ValidationRefusal` carrying the findings, a `RestoreRefusal` carrying the
 * restore cause.
 */
import { keccak256, stringToHex } from 'viem'

import type {
  Finding,
  FindingCode,
  FindingSubject,
  Hex,
  KitError,
  RestoreCause,
  RestoreRefusal,
  ValidationRefusal,
  ValidationResult
} from '@web/modules/social-recovery/sdk-interfaces'

/**
 * Every read a double makes that a script can fail. The name is the part and
 * the member, so a member two parts share (`prepareStartAttempt`) stays two
 * names. A failed read throws a `ScriptedReadFailure`.
 */
export const SCRIPTED_READS = [
  'provider.chainId',
  'provider.call',
  'provider.logs',
  'provider.block',
  'manager.stateOf',
  'manager.hashApproval',
  'manager.hashCancel',
  'manager.eip712Domain',
  'manager.name',
  'manager.version',
  'manager.supportsInterface',
  'manager.moduleInfo',
  'manager.paused',
  'manager.trustedParties',
  'action.supportsAccount',
  'action.isAuthority',
  'action.isAuthorized',
  'action.holdsAnyPrivilege',
  'action.actionInfo',
  'events.fetch',
  'setup.validateSetup',
  'setup.describeSetup',
  'setup.setupState',
  'recovery.recoveryState',
  'walletReads.verifyReply',
  'walletReads.removedKey',
  'walletReads.fitCheck'
] as const
export type ScriptedRead = typeof SCRIPTED_READS[number]

/**
 * The three module reads answer `{ answered: false }` rather than throwing when
 * the provider failed (sdk.md D-202 "The read surface"); a script chooses either.
 */
export const MODULE_READS = [
  'manager.moduleInfo',
  'manager.paused',
  'manager.trustedParties'
] as const
export type ModuleRead = typeof MODULE_READS[number]

/**
 * Every member whose refusal is a thrown value (sdk.md D-201 "Refusals throw"),
 * beside the manager part's and the action part's own prepares.
 */
export const SCRIPTED_REFUSALS = [
  'setup.prepareCommitSetup',
  'setup.prepareClearSetup',
  'setup.confirmSetup',
  'setup.getSetup',
  'recovery.initRecoveryGathering',
  'recovery.initCancelGathering',
  'recovery.complete',
  'recovery.prepareStartAttempt',
  'recovery.prepareCancelByProofs',
  'recovery.prepareCancelByOwner',
  'recovery.prepareCancelByVeto',
  'recovery.prepareExecuteHandover',
  'manager.prepareCommitSetup',
  'manager.prepareClearSetup',
  'manager.prepareStartAttempt',
  'manager.prepareCancelByProofs',
  'manager.prepareCancelByOwner',
  'manager.prepareCancelByVeto',
  'action.disarmingCall',
  'action.armingCall',
  'orchestrator.signingInput',
  'orchestrator.enrollInput'
] as const
export type ScriptedRefusalMember = typeof SCRIPTED_REFUSALS[number]

/**
 * The prepares whose simulation a script can fail. A failed simulation is not a
 * refusal: the prepare returns its record with `simulation.ok === false` and the
 * typed error (sdk.md D-202 "Simulation", fifth rule).
 */
export const SCRIPTED_SIMULATIONS = [
  'setup.prepareCommitSetup',
  'setup.prepareClearSetup',
  'recovery.prepareStartAttempt',
  'recovery.prepareCancelByProofs',
  'recovery.prepareCancelByOwner',
  'recovery.prepareCancelByVeto',
  'recovery.prepareExecuteHandover'
] as const
export type ScriptedSimulation = typeof SCRIPTED_SIMULATIONS[number]

/**
 * A scripted refusal: validation (thrown with findings), restore (thrown with
 * the cause, `getSetup` and the two inits only) or an ordinary error.
 */
export type ThrownRefusal =
  | { kind: 'validation'; findings: ValidationResult }
  | { kind: 'restore'; cause: RestoreCause }
  | { kind: 'error'; message?: string }

/** The value a scripted read failure throws: a transport failure, never an empty answer. */
export class ScriptedReadFailure extends Error {
  readonly kind = 'scripted-read-failure'

  constructor(readonly read: ScriptedRead, readonly scripted?: unknown) {
    super(`The read ${read} did not answer (scripted).`)
    this.name = 'ScriptedReadFailure'
  }
}

export const finding = <C extends string = FindingCode>(
  code: C,
  subject: FindingSubject,
  values: Record<string, unknown> = {}
): Finding<C> => ({ code, subject, values })

export const validationRefusal = (
  findings: ValidationResult,
  message?: string
): ValidationRefusal => {
  const error = new Error(
    message ?? `Refused by validation: ${findings.errors.map((f) => f.code).join(', ')}`
  ) as ValidationRefusal
  error.name = 'ValidationRefusal'
  error.findings = findings
  return error
}

export const restoreRefusal = (
  cause: RestoreCause,
  values: Record<string, unknown> = {}
): RestoreRefusal => {
  const error = new Error(`The restore refused: ${cause}`) as RestoreRefusal
  error.name = 'RestoreRefusal'
  error.cause = finding(cause, 'restore', values)
  return error
}

export const thrownValueOf = (member: string, refusal: ThrownRefusal): Error => {
  switch (refusal.kind) {
    case 'validation':
      return validationRefusal(refusal.findings)
    case 'restore':
      return restoreRefusal(refusal.cause)
    default:
      return new Error(refusal.message ?? `${member} refused (scripted).`)
  }
}

/** A known kit error by name, the shape `decodeRevert` answers (sdk.md D-205). */
export const kitError = (
  name: string,
  args: Record<string, unknown> = {},
  source: 'manager' | 'action' | 'account' | 'language' = 'manager'
): KitError => ({
  kind: 'known',
  source,
  name,
  selector: keccak256(stringToHex(`${name}()`)).slice(0, 10) as Hex,
  args
})
