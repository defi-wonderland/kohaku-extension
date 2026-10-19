/**
 * The editor's two writes over the save's own steps and run, so each keeps
 * the save's request queue, its stored write in flight, its receipt waits and
 * its check after the landing.
 *
 * Each write's request id ends with its own mark, and a write never takes up
 * a stored write that names another: reading or losing its claim to one ends
 * the run with nothing sent, and a release of another's request removes
 * nothing, so the page that stored it keeps following it.
 *
 * The save of the changes commits the draft through the save's own prepare:
 * the kit reads the setup nonce from the chain, so the commit is the update,
 * and it cancels an attempt running against the old setup in the same act.
 * Its prepare reads the attempt again and refuses while the setup is not
 * authorized and an attempt is open, since that commit would authorize the
 * setup again while the recovery runs, and refuses an open attempt the screen
 * did not show, so the holder sees that saving cancels it before a second
 * press sends. The save's setup read becomes the read
 * of whether the setup moved past the one the edit started from: a run that
 * finds it moved at its start sends nothing, and a followed write that finds
 * it moved is checked as after its receipt. Its landing first keeps the
 * recovery password the backup is now sealed under, then wipes the setup
 * records, ends the edit session and rewrites this device's opened setup with
 * the configuration and the nonce the landed commit holds.
 *
 * The removal sends the clear and the zero write of the authorization as one
 * batch, prepared together and sent through the account's own door. Its
 * end stands once the setup is gone and the account no longer authorizes the
 * action. Its prepare reads the attempt for the screen's line alone: a read
 * that fails stops nothing. Its landing, and a run that finds that end
 * already standing, wipe the recovery password, the setup records, this
 * device's opened setup and the edit session.
 */
import { REMOVAL_DRAFT } from '@web/modules/social-recovery/management/overview/constants'
import {
  attemptOpenOf,
  isCacheCurrent
} from '@web/modules/social-recovery/management/overview/readings'
import type {
  SetupConfirmation,
  SetupDraft,
  SetupState
} from '@web/modules/social-recovery/sdk-interfaces'
import {
  accountBatchTransactionOf,
  newSendRequestId
} from '@web/modules/social-recovery/shared/client'
import {
  SETUP_RECORD_NAMES,
  setRecoveryPassword,
  wipeRecoveryPassword
} from '@web/modules/social-recovery/shared/records'
import {
  assertWriteDoor,
  checkGas,
  intentOfRequest,
  MANAGE_INTENT_MARKS,
  walletAccountRefOf
} from '@web/modules/social-recovery/shared/writes'
import type { ManageIntent } from '@web/modules/social-recovery/shared/writes'
import { callsOf, saveStepsOf } from '@web/modules/social-recovery/setup/arm'
import type { PreparedSave, SaveSteps } from '@web/modules/social-recovery/setup/arm'

import { passwordChangedOf } from './changes'
import { configurationOfDraft } from './load'
import { dropNewPassword } from './session'
import type { AttemptRead, EditorStepsInput, EditStepsInput, RemovedWipeInput } from './types'

/** Runs every write, and fails with the first that failed once all of them ended. */
const allWrites = async (writes: readonly Promise<unknown>[]): Promise<void> => {
  const failed = (await Promise.allSettled(writes)).find(({ status }) => status === 'rejected')
  if (failed && failed.status === 'rejected') {
    throw failed.reason
  }
}

/** The steps that keep a write to its own stored request. */
const ownRequestSteps = (
  intent: ManageIntent,
  save: SaveSteps
): Pick<SaveSteps, 'newRequestId' | 'readInFlight' | 'claim' | 'release' | 'releaseUnsent'> => {
  const ours = (requestId: string) => intentOfRequest(requestId) === intent
  const refuse = (requestId: string): never => {
    throw new Error(`The write in flight ${requestId} belongs to another screen.`)
  }
  return {
    newRequestId: () => `${newSendRequestId()}${MANAGE_INTENT_MARKS[intent]}`,
    async readInFlight() {
      const read = await save.readInFlight()
      if (read.status === 'present' && !ours(read.value.requestId)) {
        refuse(read.value.requestId)
      }
      return read
    },
    async claim(prepared, requestId, startBlock) {
      const claim = await save.claim(prepared, requestId, startBlock)
      if (!claim.claimed && !ours(claim.record.value.requestId)) {
        refuse(claim.record.value.requestId)
      }
      return claim
    },
    async release(requestId) {
      if (ours(requestId)) {
        await save.release(requestId)
      }
    },
    async releaseUnsent(requestId) {
      if (ours(requestId)) {
        await save.releaseUnsent(requestId)
      }
    }
  }
}

/** Reads the attempt with the setup, and tells the screen what it read. */
const readAttempt = async (input: EditorStepsInput): Promise<AttemptRead> => {
  const [state, attempt] = await Promise.all([
    input.client.setup.setupState(),
    input.client.walletReads.attemptState()
  ])
  const open = attemptOpenOf(state, attempt)
  const read = { open, dormant: open && !state.isAuthorized }
  input.onAttempt?.(read)
  return read
}

/** Whether the removal's end stands: no setup, and no authorization of the action. */
export const removalStands = (state: SetupState): boolean => !state.hasSetup && !state.isAuthorized

/** What this device keeps of a setup the chain no longer holds: nothing. */
export const wipeRemovedSetup = async ({
  records,
  session,
  chainId,
  account
}: RemovedWipeInput): Promise<void> => {
  wipeRecoveryPassword(chainId, account)
  dropNewPassword(chainId, account)
  const setup = records.setup(chainId, account)
  await allWrites([
    ...SETUP_RECORD_NAMES.map((name) => setup[name].wipe()),
    records.decryptedSetupCache(chainId, account).wipe(),
    session.wipe()
  ])
}

export const editStepsOf = (input: EditStepsInput): SaveSteps => {
  const { baseline, chainId, account } = input
  const sealed = input.draft.privacy.backup === 'encrypted'
  const password = sealed ? input.newPassword ?? input.password : undefined
  const save = saveStepsOf({
    ...input,
    setup: input.records.setup(chainId, account),
    password
  })
  // The commit the check after the landing agreed on, with the draft it sent.
  let landed: { draft: SetupDraft; confirmation: SetupConfirmation } | undefined

  const keepPassword = () => {
    if (!sealed) {
      wipeRecoveryPassword(chainId, account)
    } else if (input.newPassword !== undefined) {
      setRecoveryPassword(chainId, account, input.newPassword)
    } else if (passwordChangedOf(baseline, input.draft, baseline.password)) {
      // Another tab typed the password the backup is sealed under; this tab never held it.
      wipeRecoveryPassword(chainId, account)
    }
    dropNewPassword(chainId, account)
  }

  return {
    ...save,
    ...ownRequestSteps('manageEdit', save),
    hasSetup: async () => !isCacheCurrent(baseline, await input.client.setup.setupState()),
    async prepare(): Promise<PreparedSave> {
      if (sealed && password === undefined) {
        throw new Error('The save seals the setup and needs the recovery password.')
      }
      // What the screen showed when the holder pressed, before this read moves it.
      const lineShown = input.showsCancelLine?.() ?? true
      const attempt = await readAttempt(input)
      if (attempt.dormant) {
        throw new Error(
          'This wallet does not commit a setup again while a recovery is in progress.'
        )
      }
      // The holder confirms a save that cancels an attempt only once the screen says so.
      if (attempt.open && !lineShown) {
        throw new Error('An attempt opened that the screen did not show; nothing was sent.')
      }
      return save.prepare()
    },
    async confirm(prepared: PreparedSave): Promise<SetupConfirmation> {
      const confirmation = await save.confirm(prepared)
      if (confirmation.landed) {
        landed = { draft: prepared.draft, confirmation }
      }
      return confirmation
    },
    async wipe(): Promise<void> {
      keepPassword()
      const cache = input.records.decryptedSetupCache(chainId, account)
      await allWrites([
        input.records.saveSetup(chainId, account),
        input.session.wipe(),
        landed
          ? cache.write({
              configuration: configurationOfDraft(landed.draft),
              setupNonce: landed.confirmation.nonce,
              setupCommitment: landed.confirmation.setupCommitment
            })
          : cache.wipe()
      ])
    }
  }
}

export const removalStepsOf = (input: EditorStepsInput): SaveSteps => {
  const { client, chainId, account, facts, key } = input
  const save = saveStepsOf({
    ...input,
    setup: input.records.setup(chainId, account),
    draft: REMOVAL_DRAFT,
    password: undefined
  })
  return {
    ...save,
    ...ownRequestSteps('manageRemove', save),
    hasSetup: async () => removalStands(await client.setup.setupState()),
    async prepare(): Promise<PreparedSave> {
      // The removal removes whatever stands; an attempt it could not read draws no line.
      await readAttempt(input).catch(() => input.onAttempt?.({ open: false, dormant: false }))
      const prepared = await client.setup.prepareRemoveSetup()
      assertWriteDoor('ownerWrite', prepared)
      return { draft: REMOVAL_DRAFT, prepared, calls: callsOf(prepared) }
    },
    checkGas: ({ prepared, calls }) =>
      checkGas({
        write: 'ownerWrite',
        prepared,
        key,
        reads: input.reads,
        network: facts.network,
        transaction: accountBatchTransactionOf(facts, key, calls),
        operates: walletAccountRefOf(facts)
      }),
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
      wipeRecoveryPassword(chainId, account)
      dropNewPassword(chainId, account)
      await allWrites([
        input.records.saveSetup(chainId, account),
        input.records.decryptedSetupCache(chainId, account).wipe(),
        input.session.wipe()
      ])
    }
  }
}
