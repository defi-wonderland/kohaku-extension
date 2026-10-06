/**
 * The readout's pure parts: the account its search names, where continue
 * leads, the setup read before the recovery password, the reading of a
 * refused restore, and the rows and the rule lines a readable setup draws.
 *
 * No client member yet answers the setup's privacy level before the recovery
 * password, so the setup read here composes it from the members that exist:
 * a restore with no password opens only a backup kept in the clear, and the
 * setup event's public note carries the shape of a shape-visible setup. A
 * client that does not serve the events feed reads as sealed, never as
 * readable.
 */
import { decodeAbiParameters, hexToString, isAddress } from 'viem'

import { WEB_ROUTES } from '@common/modules/router/constants/common'
import { RESTORE_CAUSES } from '@web/modules/social-recovery/sdk-interfaces'
import type {
  Address,
  Configuration,
  Credential,
  Hex,
  RestoreCause,
  SetupState
} from '@web/modules/social-recovery/sdk-interfaces'
import {
  REQUEST_WINDOW_SECONDS,
  sameAddress,
  shapeNoteOf
} from '@web/modules/social-recovery/shared/client'
import { renderFullAddress, renderHiddenValue } from '@web/modules/social-recovery/shared/display'
import type { Translate } from '@web/modules/social-recovery/shared/display'
import type { RecoveryRoute } from '@web/modules/social-recovery/shared/records'
import {
  getRuleLines,
  renderRuleLines,
  RULE_LINE_KEYS
} from '@web/modules/social-recovery/shared/rule-lines'
import { kindOfMethodIn } from '@web/modules/social-recovery/setup/privacy/exposure'
import { kindNameOf } from '@web/modules/social-recovery/setup/review/lead'

import { ENTRY_SEARCH_KEYS } from './constants'
import { checklistPathOf } from './search'
import type {
  ReadoutClause,
  ReadoutKitClient,
  ReadoutRow,
  ReadoutRowContext,
  SetupReading,
  ShapeNote,
  UnlockFailure
} from './types'

/** The readout's stage on the logged-in route. */
export const READOUT_STAGE = 3

/** How long the request lasts from the moment the checklist opens, in hours. */
export const REQUEST_HOURS = REQUEST_WINDOW_SECONDS / 3600

/** The password a restore takes to open a backup kept in the clear, which asks for none. */
const NO_PASSWORD = ''

/** The refusal reasons of a backup whose bytes this build cannot read. */
const UNREADABLE_REASONS: readonly unknown[] = ['unknown-version', 'malformed']

const UNKNOWN_KIND_KEY = 'socialRecovery.display.nouns.method'

// ---------------------------------------------------------------------------
// The search and the paths
// ---------------------------------------------------------------------------

/** The account the readout's search names, or null where it names none or a malformed one. */
export const readoutAccountOf = (search: string): Address | null => {
  const account = new URLSearchParams(search).get(ENTRY_SEARCH_KEYS.account)
  return account !== null && isAddress(account, { strict: false }) ? account : null
}

/** Where continue leads: the gas step on the fresh install's route, the checklist on the logged-in one. */
export const continuePathOf = (route: RecoveryRoute, account: Address): string => {
  if (route === 'logged-in') {
    return checklistPathOf(account)
  }
  const query = new URLSearchParams()
  query.set(ENTRY_SEARCH_KEYS.account, account)
  return `/${WEB_ROUTES.socialRecoveryFastTrackGas}?${query.toString()}`
}

// ---------------------------------------------------------------------------
// The thrown values a read answers
// ---------------------------------------------------------------------------

/** The restore cause and the backup's refusal reason a thrown value carries, if it is a restore refusal. */
export const restoreRefusalOf = (
  error: unknown
): { cause: RestoreCause; reason?: unknown } | null => {
  if (typeof error !== 'object' || error === null || !('cause' in error)) {
    return null
  }
  const { cause } = error as { cause: unknown }
  if (typeof cause !== 'object' || cause === null) {
    return null
  }
  const { code, values } = cause as { code?: unknown; values?: unknown }
  const known = RESTORE_CAUSES.find((restore) => restore === code)
  if (!known) {
    return null
  }
  const reason =
    typeof values === 'object' && values !== null
      ? (values as Record<string, unknown>).reason
      : undefined
  return { cause: known, reason }
}

/** Whether a thrown value is the client's refusal of a member it does not serve yet. */
const isNotServed = (error: unknown): boolean =>
  error instanceof Error && error.name === 'NotServedRefusal'

/** Why a restore with the recovery password failed; a failure that is no refusal is a failed read. */
export const unlockFailureOf = (error: unknown): UnlockFailure => {
  const refusal = restoreRefusalOf(error)
  if (!refusal) {
    return 'event-failed'
  }
  if (refusal.cause === 'restore.no-backup') {
    return 'no-details'
  }
  if (refusal.cause === 'restore.commitment-mismatch') {
    return 'mismatch'
  }
  return UNREADABLE_REASONS.includes(refusal.reason) ? 'unreadable' : 'wrong'
}

// ---------------------------------------------------------------------------
// The setup read before the recovery password
// ---------------------------------------------------------------------------

const textOf = (bytes: Hex): string | null => {
  try {
    return hexToString(bytes)
  } catch {
    return null
  }
}

/** The bytes the wallet writes before the shape in a public note. */
const SHAPE_NOTE_PREFIX = ((): string => {
  const text = textOf(shapeNoteOf({ clauses: [], wait: 0n, ignoresPause: false })) ?? ''
  const start = text.indexOf('{')
  return start > 0 ? text.slice(0, start) : ''
})()

const isShapeClause = (value: unknown): value is ShapeNote['clauses'][number] => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const { threshold, methods } = value as { threshold?: unknown; methods?: unknown }
  return (
    typeof threshold === 'number' &&
    Number.isInteger(threshold) &&
    threshold >= 0 &&
    Array.isArray(methods) &&
    methods.every((method) => typeof method === 'string' && isAddress(method, { strict: false }))
  )
}

/** The shape a public note carries, or null where the note holds no shape this build reads. */
export const shapeOfNote = (note: Hex): ShapeNote | null => {
  const text = textOf(note)
  if (!SHAPE_NOTE_PREFIX || text === null || !text.startsWith(SHAPE_NOTE_PREFIX)) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(SHAPE_NOTE_PREFIX.length))
  } catch {
    return null
  }
  const clauses =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { clauses?: unknown }).clauses
      : undefined
  if (!Array.isArray(clauses) || clauses.length === 0 || !clauses.every(isShapeClause)) {
    return null
  }
  return {
    clauses: clauses.map(({ threshold, methods }) => ({ threshold, methods: [...methods] }))
  }
}

/**
 * The public note of the setup the state names, read from its setup event at
 * the block the state pins it to; null where the client does not serve the
 * events feed or the block holds no event of this setup.
 */
const committedNoteOf = async (
  setup: ReadoutKitClient['setup'],
  state: SetupState
): Promise<Hex | null> => {
  try {
    const block = state.setupCommittedAtBlock
    const found = await setup.events.fetch(setup.events.accountFilter(), {
      from: block,
      to: block
    })
    const commit = found.find(
      (notification) =>
        notification.kind === 'setup-committed' &&
        notification.nonce === state.setupNonce &&
        notification.setupCommitment.toLowerCase() === state.setupCommitment.toLowerCase()
    )
    return commit && commit.kind === 'setup-committed' ? commit.publicMetadata : null
  } catch (error: unknown) {
    if (isNotServed(error)) {
      return null
    }
    throw error
  }
}

/**
 * The setup read before the recovery password. A thrown value that is no
 * restore refusal, or a failed read of the setup event, throws: the caller
 * renders it as a read that failed, never as an answer.
 */
export const readSetupReading = async (
  client: ReadoutKitClient,
  state: SetupState
): Promise<SetupReading> => {
  try {
    const configuration = await client.setup.getSetup({ password: NO_PASSWORD })
    return { kind: 'readable', configuration }
  } catch (error: unknown) {
    const refusal = restoreRefusalOf(error)
    if (!refusal) {
      throw error
    }
    if (refusal.cause === 'restore.no-backup') {
      return { kind: 'no-details' }
    }
    if (refusal.cause === 'restore.commitment-mismatch') {
      return { kind: 'mismatch' }
    }
    if (UNREADABLE_REASONS.includes(refusal.reason)) {
      return { kind: 'unreadable' }
    }
  }
  const note = await committedNoteOf(client.setup, state)
  const shape = note ? shapeOfNote(note) : null
  return shape ? { kind: 'shape-readable', shape } : { kind: 'sealed' }
}

// ---------------------------------------------------------------------------
// The rows and the rule lines
// ---------------------------------------------------------------------------

const kindNameOfMethod = (method: Address, context: ReadoutRowContext, t: Translate): string => {
  const kind = kindOfMethodIn(context.addressBook)(method)
  return kind ? kindNameOf(kind, t) : t(UNKNOWN_KIND_KEY)
}

const isRequired = (threshold: number, members: number): boolean =>
  threshold === 1 && members === 1

/** The shape's clauses with every value masked. */
export const previewClausesOf = (
  shape: ShapeNote,
  context: ReadoutRowContext,
  t: Translate
): ReadoutClause[] => {
  const hidden = renderHiddenValue(t).dots
  return shape.clauses.map(({ threshold, methods }) => ({
    threshold,
    required: isRequired(threshold, methods.length),
    rows: methods.map((method) => ({
      kindName: kindNameOfMethod(method, context, t),
      value: hidden,
      hidden: true,
      originMismatch: false
    }))
  }))
}

const guardianOf = (config: Hex): Address | null => {
  try {
    const [approver] = decodeAbiParameters([{ type: 'address' }], config)
    return approver
  } catch {
    return null
  }
}

const passkeyRpIdHashOf = (config: Hex): Hex | null => {
  try {
    const [, , rpIdHash] = decodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
      config
    )
    return rpIdHash
  } catch {
    return null
  }
}

const readableRowOf = (
  credential: Credential,
  context: ReadoutRowContext,
  t: Translate
): ReadoutRow => {
  const { methods } = context.addressBook
  const row: ReadoutRow = {
    kindName: kindNameOfMethod(credential.method, context, t),
    value: null,
    hidden: false,
    originMismatch: false
  }
  if (sameAddress(credential.method, methods.ecdsa)) {
    const approver = guardianOf(credential.config)
    return { ...row, value: approver ? renderFullAddress(approver) : null }
  }
  if (sameAddress(credential.method, methods.passkey)) {
    // The passkey config commits the hash of the origin it was created under;
    // a passkey of another origin cannot answer from this build.
    const committed = passkeyRpIdHashOf(credential.config)
    return {
      ...row,
      value: credential.label?.trim() || null,
      originMismatch:
        committed !== null && committed.toLowerCase() !== context.ownRpIdHash.toLowerCase()
    }
  }
  return row
}

/** The configuration's clauses with their values and the origin read of each passkey. */
export const readableClausesOf = (
  configuration: Configuration,
  context: ReadoutRowContext,
  t: Translate
): ReadoutClause[] =>
  configuration.clauses.map(({ threshold, credentials }) => ({
    threshold,
    required: isRequired(threshold, credentials.length),
    rows: credentials.map((credential) => readableRowOf(credential, context, t))
  }))

/** The path's rule lines, each method's family read through the address book; the sizing line is the editor's. */
export const readoutRuleLinesOf = (
  configuration: Configuration,
  context: ReadoutRowContext,
  t: Translate
): string[] =>
  renderRuleLines(
    getRuleLines(configuration, { kindOfMethod: kindOfMethodIn(context.addressBook) }).filter(
      (line) => line.key !== RULE_LINE_KEYS.sizingRule
    ),
    (key, params) => t(key, { ...params })
  )
