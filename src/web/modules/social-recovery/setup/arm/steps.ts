/**
 * The save's steps over the wallet's own seams: the prepare through the
 * client, the shared gas check of the batch the controlling key sends, the
 * send through the request queue with the recovery kit's mark, the check after
 * the landing, and the wipe of the six setup records.
 *
 * The batch is the prepared calls in order and nothing else: for an account
 * with no code the account library deploys it in the same transaction.
 */
import type {
  PreparedBatch,
  PreparedCall,
  SetupDraft
} from '@web/modules/social-recovery/sdk-interfaces'
import {
  accountBatchTransactionOf,
  privacyLevelOf,
  recoveryKitMarkOf,
  shapeNoteOf
} from '@web/modules/social-recovery/shared/client'
import {
  assertWriteDoor,
  checkGas,
  driveAccountBatch,
  walletAccountRefOf
} from '@web/modules/social-recovery/shared/writes'

import type { PreparedSave, SaveSteps, SaveStepsInput } from './types'

/** The calls of a prepared write, in order: a batch's own, or the one call. */
export const callsOf = (prepared: PreparedCall | PreparedBatch): readonly PreparedCall[] =>
  prepared.kind === 'batch' ? prepared.calls : [prepared]

/**
 * The draft the save commits. At Shape visible the public note is rebuilt from
 * the draft's path and wait as they stand now, since the path may have changed
 * after the privacy step wrote the note. Any other level commits the draft as
 * it is.
 */
export const committedDraftOf = (draft: SetupDraft): SetupDraft => {
  if (privacyLevelOf(draft.privacy) !== 'shape-visible') {
    return draft
  }
  const { clauses, wait, ignoresPause } = draft
  const publicMetadata = shapeNoteOf({ clauses, wait, ignoresPause })
  return publicMetadata === draft.privacy.publicMetadata
    ? draft
    : { ...draft, privacy: { ...draft.privacy, publicMetadata } }
}

export const saveStepsOf = (input: SaveStepsInput): SaveSteps => {
  const { client, facts, key } = input
  return {
    async prepare(): Promise<PreparedSave> {
      const draft = committedDraftOf(input.draft)
      if (draft !== input.draft) {
        await input.setup.writeDraftAndPath(draft)
      }
      const password = draft.privacy.backup === 'encrypted' ? input.password : undefined
      const prepared = await client.setup.prepareCommitSetup(draft, password)
      assertWriteDoor('save', prepared)
      return { draft, prepared, calls: callsOf(prepared) }
    },
    checkGas: ({ prepared, calls }) =>
      checkGas({
        write: 'save',
        prepared,
        key,
        reads: input.reads,
        network: facts.network,
        transaction: accountBatchTransactionOf(facts, key, calls),
        operates: walletAccountRefOf(facts)
      }),
    send: ({ calls }, dispatch, run) =>
      driveAccountBatch({
        dispatch,
        run,
        receipts: input.receipts,
        port: input.port,
        account: input.account,
        calls,
        recoveryKit: recoveryKitMarkOf(client.descriptor)
      }),
    confirm: ({ draft, prepared }) => client.setup.confirmSetup(draft, prepared),
    wipe: () => input.records.saveSetup(input.chainId, input.account)
  }
}
