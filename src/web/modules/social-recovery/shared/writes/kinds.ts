/**
 * The writes of the chapter that share the submitting and failed states and
 * the gas check (PT-039).
 *
 * Every owner-signed write and both recovery calls inherit them (ux.md D-319,
 * D-307, D-393). Which key pays follows from the write: the account's own
 * operations (a setup save, an edit, any other setup write, the owner's cancel) are
 * sent by the account's controlling key, and the two recovery calls anyone may
 * send (the submission, the execution) by the recoverer's own key, since the
 * first release configures no sponsor (ux.md D-312, shared/client `sending.ts`).
 */
import type { PreparedBatch, PreparedCall } from '@web/modules/social-recovery/sdk-interfaces'

/**
 * The writes of the chapter, by the copy they need:
 *
 * - `save`: the setup save, the arming batch of D-319 (frame C-07);
 * - `edit`: the editor's save of D-309, the recovery password's change among
 *   them (frame G-05b);
 * - `ownerWrite`: any other setup write the account's key sends, the removal
 *   among them, with no failed-state frame of its own;
 * - `cancel`: the owner's cancel of D-307 (frame D2-01);
 * - `submission`: the start of a recovery, D-393 (frame D-11);
 * - `execution`: the execution at execution due, D-393 (frame D-13).
 */
export const WRITE_KINDS = [
  'save',
  'edit',
  'ownerWrite',
  'cancel',
  'submission',
  'execution'
] as const
export type WriteKind = typeof WRITE_KINDS[number]

/** The writes the account's controlling key sends and pays for. */
export const OWNER_WRITES = ['save', 'edit', 'ownerWrite', 'cancel'] as const
export type OwnerWrite = typeof OWNER_WRITES[number]

/** The two recovery calls the recoverer's own key sends and pays for in the first release. */
export const RECOVERY_CALLS = ['submission', 'execution'] as const
export type RecoveryCall = typeof RECOVERY_CALLS[number]

/**
 * Who pays the gas of a write: the account's controlling key, or the sending
 * key of a recovery (the recoverer's own key).
 */
export const PAYERS = ['accountKey', 'sendingKey'] as const
export type Payer = typeof PAYERS[number]

export const isWriteKind = (value: unknown): value is WriteKind =>
  typeof value === 'string' && (WRITE_KINDS as readonly string[]).includes(value)

export const isOwnerWrite = (write: WriteKind): write is OwnerWrite =>
  (OWNER_WRITES as readonly string[]).includes(write)

export const isRecoveryCall = (write: WriteKind): write is RecoveryCall =>
  (RECOVERY_CALLS as readonly string[]).includes(write)

/** The key that pays the gas of a write. */
export const payerOf = (write: WriteKind): Payer =>
  isOwnerWrite(write) ? 'accountKey' : 'sendingKey'

/**
 * Checks that a prepared write comes through the door its kind names: an owner
 * write is a call whose sender is the account, or a batch, which the account
 * runs as one transaction; a recovery call is a call anyone may send. Throws a
 * TypeError otherwise, so no screen names the wrong key as the payer.
 */
export const assertWriteDoor = (write: WriteKind, prepared: PreparedCall | PreparedBatch): void => {
  const sender = prepared.kind === 'batch' ? 'account' : prepared.sender
  const expected = isOwnerWrite(write) ? 'account' : 'anyone'
  if (sender !== expected) {
    throw new TypeError(
      `A ${write} is a call whose sender is ${
        expected === 'account' ? 'the account' : 'anyone'
      }, but the prepared ${prepared.kind} names ${
        sender === 'account' ? 'the account' : 'anyone'
      }.`
    )
  }
}
