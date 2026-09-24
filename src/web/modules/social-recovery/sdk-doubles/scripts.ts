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
 * The two validations a script can append findings to (sdk.md D-205
 * "Validation"): setup validation, which `validateSetup` and
 * `prepareCommitSetup` run, and request validation, which `prepareStartAttempt`
 * and `prepareCancelByProofs` run. Appended errors refuse the prepares.
 */
export const SCRIPTED_FINDINGS = ['setup.validateSetup', 'recovery.validateRequest'] as const
export type ScriptedFindings = typeof SCRIPTED_FINDINGS[number]

/**
 * A scripted refusal: validation (thrown with findings), restore (thrown with
 * the cause, `getSetup` and the two inits only) or an ordinary error carrying a
 * code.
 */
export type ThrownRefusal =
  | { kind: 'validation'; findings: ValidationResult }
  | { kind: 'restore'; cause: RestoreCause }
  | { kind: 'error'; code?: string; message?: string }

/**
 * An ordinary error carrying a code and its values, what every refusal of the
 * doubles that is not a validation or a restore refusal throws. The code is a
 * D-205, D-206 or D-207 slug, a kit error name, or one of the doubles' own codes
 * the README lists; the message is for a developer and never for a screen.
 */
export interface CodedError extends Error {
  code: string
  values: Record<string, unknown>
}

export const codedError = (
  code: string,
  values?: Record<string, unknown>,
  message?: string
): CodedError => {
  const error = new Error(message ?? code) as CodedError
  error.name = 'CodedError'
  error.code = code
  error.values = values ?? {}
  return error
}

/** The value a scripted read failure throws: a transport failure, never an empty answer. */
export class ScriptedReadFailure extends Error {
  readonly kind = 'scripted-read-failure'

  readonly code = 'read.unanswered'

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
      return codedError(
        refusal.code ?? 'scripted.refused',
        { member },
        refusal.message ?? `${member} refused (scripted).`
      )
  }
}

/**
 * What `ScriptedChain.land` throws when the chain would revert the call: the
 * kit error the revert decodes to, nothing applied (a batch lands whole or not
 * at all).
 */
export interface LandingRevert extends CodedError {
  error: KitError
}

export const landingRevert = (error: KitError): LandingRevert => {
  const name = error.kind === 'known' ? error.name : 'unknown'
  const thrown = codedError(name, { error }, `The chain reverts the call: ${name}`) as LandingRevert
  thrown.name = 'LandingRevert'
  thrown.error = error
  return thrown
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
