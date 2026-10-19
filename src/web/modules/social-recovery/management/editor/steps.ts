/**
 * The editor's two writes over the save's own steps and run, so each keeps
 * the save's request queue, its stored write in flight, its receipt waits and
 * its check after the landing.
 *
 * The save of the changes commits the draft through the save's own prepare:
 * the kit reads the setup nonce from the chain, so the commit is the update,
 * and it cancels an attempt running against the old setup in the same act.
 * The save's setup read becomes the read of whether the setup moved past the
 * one the edit started from: a run that finds it moved at its start sends
 * nothing, and a followed write that finds it moved is checked as after its
 * receipt. Its landing wipes the setup records, rewrites this device's opened
 * setup with the new configuration and nonce, ends the edit session and keeps
 * the new recovery password as the setup's own.
 *
 * The removal sends the clear and the zero write of the authorization as one
 * batch, prepared together and sent through the account's own door. Its
 * end stands once the setup is gone and the account no longer authorizes the
 * action. Its landing wipes the setup records, this device's opened setup,
 * the edit session and the recovery password.
 */
import { isCacheCurrent } from '@web/modules/social-recovery/management/overview/readings'
import { REMOVAL_DRAFT } from '@web/modules/social-recovery/management/overview/constants'
import type { SetupConfirmation, SetupState } from '@web/modules/social-recovery/sdk-interfaces'
import { newSendRequestId } from '@web/modules/social-recovery/shared/client'
import {
  setRecoveryPassword,
  wipeRecoveryPassword
} from '@web/modules/social-recovery/shared/records'
import { assertWriteDoor } from '@web/modules/social-recovery/shared/writes'
import { callsOf, saveStepsOf } from '@web/modules/social-recovery/setup/arm'
import type { PreparedSave, SaveSteps } from '@web/modules/social-recovery/setup/arm'

import { EDITOR_WRITES } from './constants'
import { configurationOfDraft } from './load'
import { dropNewPassword } from './session'
import type { EditorStepsInput, EditorWrite, EditStepsInput } from './types'

const WRITE_MARK = ':manage-'

/** A request id for one of the editor's writes, carrying which write it is. */
export const requestIdOf = (write: EditorWrite): string =>
  `${newSendRequestId()}${WRITE_MARK}${write}`

/** The write a stored request id names; none for a request another screen sent. */
export const writeOfRequest = (requestId: string): EditorWrite | undefined => {
  const at = requestId.lastIndexOf(WRITE_MARK)
  if (at < 0) {
    return undefined
  }
  const named = requestId.slice(at + WRITE_MARK.length)
  return EDITOR_WRITES.find((write) => write === named)
}

/** Whether the removal's end stands: no setup, and no authorization of the action. */
export const removalStands = (state: SetupState): boolean => !state.hasSetup && !state.isAuthorized

export const editStepsOf = (input: EditStepsInput): SaveSteps => {
  const { client, baseline, chainId, account } = input
  const sealed = input.draft.privacy.backup === 'encrypted'
  const password = sealed ? input.newPassword ?? input.password : undefined
  const save = saveStepsOf({
    ...input,
    setup: input.records.setup(chainId, account),
    password
  })
  return {
    ...save,
    hasSetup: async () => !isCacheCurrent(baseline, await client.setup.setupState()),
    newRequestId: () => requestIdOf('edit'),
    async prepare(): Promise<PreparedSave> {
      if (sealed && password === undefined) {
        throw new Error('The save seals the setup and needs the recovery password.')
      }
      return save.prepare()
    },
    async wipe(): Promise<void> {
      await input.records.saveSetup(chainId, account)
      await input.session.wipe().catch(() => undefined)
      if (!sealed) {
        wipeRecoveryPassword(chainId, account)
      } else if (input.newPassword !== undefined) {
        setRecoveryPassword(chainId, account, input.newPassword)
      }
      dropNewPassword(chainId, account)
      const state = await client.setup.setupState()
      await input.records.decryptedSetupCache(chainId, account).write({
        configuration: configurationOfDraft(input.draft),
        setupNonce: state.setupNonce,
        setupCommitment: state.setupCommitment
      })
    }
  }
}

export const removalStepsOf = (input: EditorStepsInput): SaveSteps => {
  const { client, chainId, account } = input
  // The save's own gas check: the run's write state names the save, and a check
  // named for another write would never move it.
  const save = saveStepsOf({
    ...input,
    setup: input.records.setup(chainId, account),
    draft: REMOVAL_DRAFT,
    password: undefined
  })
  return {
    ...save,
    hasSetup: async () => removalStands(await client.setup.setupState()),
    newRequestId: () => requestIdOf('remove'),
    async prepare(): Promise<PreparedSave> {
      const prepared = await client.setup.prepareRemoveSetup()
      assertWriteDoor('ownerWrite', prepared)
      return { draft: REMOVAL_DRAFT, prepared, calls: callsOf(prepared) }
    },
    async confirm(): Promise<SetupConfirmation> {
      const state = await client.setup.setupState()
      const ended = removalStands(state)
      return {
        landed: ended,
        isAuthorized: ended,
        nonce: state.setupNonce,
        setupCommitment: state.setupCommitment
      }
    },
    async wipe(): Promise<void> {
      await input.records.saveSetup(chainId, account)
      wipeRecoveryPassword(chainId, account)
      dropNewPassword(chainId, account)
      await Promise.all([
        input.records.decryptedSetupCache(chainId, account).wipe(),
        input.session.wipe()
      ])
    }
  }
}
