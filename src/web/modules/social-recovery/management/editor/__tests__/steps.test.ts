/**
 * @jest-environment jsdom
 *
 * The editor's two writes over the save's own run on the stand-in's chain:
 * the edit loaded from the committed configuration, saved through the
 * account's batch, reading as saved only once it landed and the check agreed,
 * and then wiping the setup records, rewriting this device's opened setup
 * and ending the session; a refused send that changes nothing on this device;
 * a setup moved past the edit's start that sends nothing; and the removal's
 * one batch of the clear and the zero write, its check and its wipe.
 */
import type { EditWorld } from '@web/modules/social-recovery/management/editor/__fixtures__/types'
import type { EditSession } from '@web/modules/social-recovery/management/editor/types'

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const fixture: typeof import('@web/modules/social-recovery/management/editor/__fixtures__/world') = require('@web/modules/social-recovery/management/editor/__fixtures__/world')
const {
  editStepsOf,
  removalStepsOf,
  removalStands,
  writeOfRequest
}: typeof import('@web/modules/social-recovery/management/editor/steps') = require('@web/modules/social-recovery/management/editor/steps')
const {
  configurationOfDraft,
  openEditSession
}: typeof import('@web/modules/social-recovery/management/editor/load') = require('@web/modules/social-recovery/management/editor/load')
const {
  holdNewPassword,
  readNewPassword
}: typeof import('@web/modules/social-recovery/management/editor/session') = require('@web/modules/social-recovery/management/editor/session')
const {
  createArmStore,
  isSaved,
  startSave
}: typeof import('@web/modules/social-recovery/setup/arm') = require('@web/modules/social-recovery/setup/arm')
const {
  readRecoveryPassword,
  setRecoveryPassword,
  SETUP_RECORD_NAMES
}: typeof import('@web/modules/social-recovery/shared/records') = require('@web/modules/social-recovery/shared/records')
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

const { CHAIN_ID, CONFIGURATION, KEY, PASSWORD, NEW_PASSWORD, guardianOf, SECOND_GUARDIAN } =
  fixture

/** Opens the edit over the committed setup and adds a second guardian to its one group. */
const openAndEdit = async (world: EditWorld): Promise<EditSession> => {
  const state = await world.client.setup.setupState()
  const setup = world.records.setup(CHAIN_ID, world.account)
  const session = await openEditSession({
    setup,
    session: world.session,
    state,
    configuration: CONFIGURATION,
    level: 'private'
  })
  const draft = await setup.setupDraft.read()
  if (draft.status !== 'present') {
    throw new Error('the edit loaded no draft')
  }
  await setup.writeDraftAndPath({
    ...draft.value,
    clauses: [
      {
        threshold: 1,
        credentials: [...draft.value.clauses[0].credentials, guardianOf(SECOND_GUARDIAN)]
      }
    ]
  })
  return session
}

const editSteps = async (world: EditWorld, baseline: EditSession) => {
  const draft = await world.records.setup(CHAIN_ID, world.account).setupDraft.read()
  if (draft.status !== 'present') {
    throw new Error('no draft to save')
  }
  return {
    draft: draft.value,
    steps: editStepsOf({
      ...world,
      chainId: CHAIN_ID,
      key: KEY,
      baseline,
      draft: draft.value,
      password: readRecoveryPassword(CHAIN_ID, world.account),
      newPassword: readNewPassword(CHAIN_ID, world.account)
    })
  }
}

const removalSteps = (world: EditWorld) => removalStepsOf({ ...world, chainId: CHAIN_ID, key: KEY })

const setupRecordsHeld = async (world: EditWorld): Promise<number> => {
  const setup = world.records.setup(CHAIN_ID, world.account)
  const reads = await Promise.all(SETUP_RECORD_NAMES.map((name) => setup[name].read()))
  return reads.filter(({ status }) => status === 'present').length
}

describe('the save of the changes', () => {
  it('reads as saved once it landed, then wipes the records and rewrites the opened setup', async () => {
    const world = await fixture.worldOf('lands')
    setRecoveryPassword(CHAIN_ID, world.account, PASSWORD)
    const baseline = await openAndEdit(world)
    const { draft, steps } = await editSteps(world, baseline)
    const store = createArmStore()

    await startSave(store, steps)

    expect(isSaved(store.state())).toBe(true)
    const state = await world.client.setup.setupState()
    expect(state.setupNonce).toBe(baseline.setupNonce + 1n)
    expect(await setupRecordsHeld(world)).toBe(0)
    expect(await world.session.read()).toBeUndefined()
    const cache = await world.records.decryptedSetupCache(CHAIN_ID, world.account).read()
    expect(cache.status === 'present' && cache.value).toEqual({
      configuration: configurationOfDraft(draft),
      setupNonce: state.setupNonce,
      setupCommitment: state.setupCommitment
    })
    // The committed setup now opens with the password it was sealed under.
    expect(await world.client.setup.getSetup({ password: PASSWORD })).toEqual(
      configurationOfDraft(draft)
    )
  })

  it('seals the backup under a new password and keeps it as the setup own', async () => {
    const world = await fixture.worldOf('lands')
    setRecoveryPassword(CHAIN_ID, world.account, PASSWORD)
    const baseline = await openAndEdit(world)
    holdNewPassword(CHAIN_ID, world.account, NEW_PASSWORD)
    const { draft, steps } = await editSteps(world, { ...baseline, password: 'changed' })

    await startSave(createArmStore(), steps)

    expect(await world.client.setup.getSetup({ password: NEW_PASSWORD })).toEqual(
      configurationOfDraft(draft)
    )
    expect(readRecoveryPassword(CHAIN_ID, world.account)).toBe(NEW_PASSWORD)
    expect(readNewPassword(CHAIN_ID, world.account)).toBeUndefined()
  })

  it('never reads as saved where the send was refused, and keeps the edit', async () => {
    const world = await fixture.worldOf('refused')
    setRecoveryPassword(CHAIN_ID, world.account, PASSWORD)
    const baseline = await openAndEdit(world)
    const { steps } = await editSteps(world, baseline)
    const store = createArmStore()

    await startSave(store, steps)

    expect(isSaved(store.state())).toBe(false)
    expect(store.state().write.status).toBe('failedNotSent')
    expect((await world.client.setup.setupState()).setupNonce).toBe(baseline.setupNonce)
    expect(await setupRecordsHeld(world)).toBeGreaterThan(0)
    expect(await world.session.read()).toEqual(baseline)
  })

  it('sends nothing once the setup moved past the one the edit started from', async () => {
    const world = await fixture.worldOf('lands')
    setRecoveryPassword(CHAIN_ID, world.account, PASSWORD)
    const baseline = await openAndEdit(world)
    world.chain.commitSetup({ level: 'private', configuration: CONFIGURATION, password: PASSWORD })
    const { steps } = await editSteps(world, baseline)
    const store = createArmStore()

    await startSave(store, steps)

    expect(store.state().stop).toBe('already-set-up')
    expect(world.port.sendAccountBatch).not.toHaveBeenCalled()
  })

  it('refuses to prepare a sealed save with no password in memory', async () => {
    const world = await fixture.worldOf('lands')
    const baseline = await openAndEdit(world)
    const { steps } = await editSteps(world, { ...baseline, password: 'kept' })
    await expect(
      editStepsOf({
        ...world,
        chainId: CHAIN_ID,
        key: KEY,
        baseline,
        draft: (await editSteps(world, baseline)).draft,
        password: undefined,
        newPassword: undefined
      }).prepare()
    ).rejects.toThrow('needs the recovery password')
    expect(writeOfRequest(steps.newRequestId())).toBe('edit')
  })
})

describe('the removal', () => {
  it('prepares the clear and the zero write of the authorization as one batch of two calls', async () => {
    const world = await fixture.worldOf('lands')
    const steps = removalSteps(world)
    const save = await steps.prepare()
    expect(save.prepared.kind).toBe('batch')
    expect(save.calls).toHaveLength(2)
    expect(writeOfRequest(steps.newRequestId())).toBe('remove')
  })

  it('reads as done once the setup and the authorization are both gone, and wipes this device', async () => {
    const world = await fixture.worldOf('lands')
    setRecoveryPassword(CHAIN_ID, world.account, PASSWORD)
    await openAndEdit(world)
    await world.records.decryptedSetupCache(CHAIN_ID, world.account).write({
      configuration: CONFIGURATION,
      setupNonce: 1n
    })
    const store = createArmStore()

    await startSave(store, removalSteps(world))

    expect(isSaved(store.state())).toBe(true)
    expect(removalStands(await world.client.setup.setupState())).toBe(true)
    expect(await setupRecordsHeld(world)).toBe(0)
    expect(await world.session.read()).toBeUndefined()
    expect((await world.records.decryptedSetupCache(CHAIN_ID, world.account).read()).status).toBe(
      'absent'
    )
    expect(readRecoveryPassword(CHAIN_ID, world.account)).toBeUndefined()
  })

  it('agrees only once both writes stand', async () => {
    const world = await fixture.worldOf('lands')
    const steps = removalSteps(world)
    const save = await steps.prepare()
    expect((await steps.confirm(save)).landed).toBe(false)
    world.chain.clearSetup()
    expect((await steps.confirm(save)).landed).toBe(false)
    world.chain.setAuthorized(false)
    expect((await steps.confirm(save)).landed).toBe(true)
  })

  it('never reads as done where the send was refused', async () => {
    const world = await fixture.worldOf('refused')
    const store = createArmStore()
    await startSave(store, removalSteps(world))
    expect(isSaved(store.state())).toBe(false)
    expect((await world.client.setup.setupState()).hasSetup).toBe(true)
  })
})
