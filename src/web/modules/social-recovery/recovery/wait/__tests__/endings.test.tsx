/**
 * @jest-environment jsdom
 */
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import {
  attemptCancelled,
  attemptConsumed,
  attemptStarted,
  CHAIN_ID,
  consume,
  elapse,
  gatheringOf,
  HOUR,
  MIXED_PATH,
  mountWait,
  NO_ATTEMPT,
  ONE_GUARDIAN,
  openWorld,
  readyFacts,
  factsOf,
  basicAccount,
  mockWallet,
  t,
  tick,
  useWaitClock,
  waiting
} from '@web/modules/social-recovery/recovery/wait/__tests__/harness'
import type { Mounted, World } from '@web/modules/social-recovery/recovery/wait/__tests__/harness'
import type { CancelledBy } from '@web/modules/social-recovery/sdk-interfaces'

const POLL_MS = 30_000
const RECOVER_DOOR = `/${WEB_ROUTES.socialRecoveryRecover}`
const SETTINGS_ENTRY = `/${WEB_ROUTES.socialRecoveryRecovery}`

const donePath = (world: World) =>
  `/${WEB_ROUTES.socialRecoveryRecoveryDone}?account=${world.account}`

const cancelBy = (world: World, by: CancelledBy) => {
  const { chain } = world.kit
  chain.attempt = { ...chain.attempt, state: 'Cancelled' }
  chain.events = [...chain.events, attemptCancelled(world.account, by)]
}

describe('where the wait sends the holder on open', () => {
  useWaitClock()
  let view: Mounted | undefined

  afterEach(() => {
    view?.unmount()
    view = undefined
  })

  it('goes on to the done screen where the attempt already executed, and changes nothing', async () => {
    const world = await openWorld()
    consume(world.kit, world.account)
    view = await mountWait(world.account)

    expect(view.paths()).toEqual([donePath(world)])
    expect((await world.records.countdown(CHAIN_ID, world.account).read()).status).toBe('present')
    expect((await world.records.recoveryEntry(CHAIN_ID, world.account).read()).status).toBe(
      'present'
    )
  })

  it('goes back to the checklist where the session is still live', async () => {
    const world = await openWorld({ countdown: false })
    await world.records
      .recoverySession(CHAIN_ID, world.account)
      .write(gatheringOf(MIXED_PATH, 1, world.account), null)
    view = await mountWait(world.account)

    expect(view.paths()).toEqual([
      `/${WEB_ROUTES.socialRecoveryRecoveryChecklist}?account=${world.account}`
    ])
    expect(world.kit.recoveryState).not.toHaveBeenCalled()
  })

  it("goes to the logged-in route's entry where no session is stored", async () => {
    const world = await openWorld({ countdown: false })
    view = await mountWait(world.account)

    expect(view.paths()).toEqual([SETTINGS_ENTRY])
  })

  it("goes to the fresh install's recover door where no session is stored", async () => {
    const world = await openWorld({ route: 'fresh-install', countdown: false })
    view = await mountWait(world.account)

    expect(view.paths()).toEqual([RECOVER_DOOR])
  })

  it('goes to the account step where the account has no entry record', async () => {
    const world = await openWorld()
    await world.records.recoveryEntry(CHAIN_ID, world.account).clear()
    view = await mountWait(world.account)

    expect(view.paths()).toEqual([`/${WEB_ROUTES.socialRecoveryRecoveryAccount}`])
  })
})

describe('the cancelled terminals', () => {
  useWaitClock()
  let view: Mounted | undefined

  afterEach(() => {
    view?.unmount()
    view = undefined
  })

  const leaves = async (world: World, to: string) => {
    if (!view) {
      throw new Error('no view')
    }
    await view.press('wait-cancelled-action')
    expect(view.paths()).toEqual([to])
    expect((await world.records.countdown(CHAIN_ID, world.account).read()).status).toBe('absent')
    expect((await world.records.recoveryEntry(CHAIN_ID, world.account).read()).status).toBe(
      'absent'
    )
  }

  it("names the account's own key, says it may be the lost device, and starts again", async () => {
    const world = await openWorld()
    view = await mountWait(world.account)
    expect(view.textOf('wait-time-left')).toBe(waiting(HOUR))

    cancelBy(world, 'cancelByOwner')
    await tick(POLL_MS)
    expect(view.byTestId('wait-cancelled-cancelByOwner')).not.toBeNull()
    expect(view.textOf('wait-cancelled-by')).toBe(t('socialRecovery.wait.cancelled.byOwnerTitle'))
    expect(view.text()).toContain(t('socialRecovery.wait.cancelled.byOwnerBody'))
    expect(view.textOf('wait-cancelled-wiped')).toBe(t('socialRecovery.wait.cancelled.wiped'))
    expect(view.textOf('wait-cancelled-account')).toBe(world.account)
    expect(view.textOf('wait-cancelled-action')).toBe(t('socialRecovery.wait.cancelled.startAgain'))
    expect(view.byTestId('wait-time-left')).toBeNull()

    await leaves(world, SETTINGS_ENTRY)
  })

  it('names a full set of approvals and leaves out the threshold-one sentence on a larger rule', async () => {
    const world = await openWorld({ cache: true, configuration: MIXED_PATH })
    cancelBy(world, 'cancelByProofs')
    view = await mountWait(world.account)

    expect(view.textOf('wait-cancelled-by')).toBe(
      t('socialRecovery.wait.cancelled.byApprovalsTitle')
    )
    expect(view.text()).toContain(t('socialRecovery.wait.cancelled.byApprovalsBody'))
    expect(view.text()).not.toContain(t('socialRecovery.wait.cancelled.byApprovalsThresholdOne'))
    expect(view.textOf('wait-cancelled-action')).toBe(t('socialRecovery.wait.cancelled.startAgain'))

    await leaves(world, SETTINGS_ENTRY)
  })

  it('adds that the same method can cancel again where one approval satisfies the rule', async () => {
    const world = await openWorld({
      route: 'fresh-install',
      cache: true,
      configuration: ONE_GUARDIAN
    })
    cancelBy(world, 'cancelByProofs')
    view = await mountWait(world.account)

    expect(view.text()).toContain(t('socialRecovery.wait.cancelled.byApprovalsThresholdOne'))

    await leaves(world, RECOVER_DOOR)
  })

  it('names a setup change or removal and starts a new recovery', async () => {
    const world = await openWorld()
    cancelBy(world, 'setupWrite')
    view = await mountWait(world.account)

    expect(view.byTestId('wait-cancelled-setupWrite')).not.toBeNull()
    expect(view.text()).toContain(t('socialRecovery.wait.cancelled.bySetupBody'))
    expect(view.textOf('wait-cancelled-action')).toBe(t('socialRecovery.wait.cancelled.startNew'))

    await leaves(world, SETTINGS_ENTRY)
  })

  it('reads an attempt gone with no cancel event as a setup change', async () => {
    const world = await openWorld()
    view = await mountWait(world.account)
    expect(view.textOf('wait-time-left')).toBe(waiting(HOUR))

    world.kit.chain.attempt = NO_ATTEMPT
    await tick(POLL_MS)
    expect(view.byTestId('wait-cancelled-setupWrite')).not.toBeNull()
    expect(view.textOf('wait-cancelled-action')).toBe(t('socialRecovery.wait.cancelled.startNew'))
  })

  it('keeps the countdown and the entry where leaving the terminal fails, and lets the holder press again', async () => {
    const world = await openWorld()
    cancelBy(world, 'cancelByOwner')
    view = await mountWait(world.account)

    const remove = world.storage.remove
    world.storage.remove = async () => {
      throw new Error('storage gone')
    }
    await view.press('wait-cancelled-action')
    expect(view.byTestId('wait-leave-failed')).not.toBeNull()
    expect(view.paths()).toEqual([])
    expect((await world.records.countdown(CHAIN_ID, world.account).read()).status).toBe('present')

    world.storage.remove = remove
    await leaves(world, SETTINGS_ENTRY)
  })
})

describe('the recovery that can no longer execute', () => {
  useWaitClock()
  let view: Mounted | undefined

  afterEach(() => {
    view?.unmount()
    view = undefined
  })

  const CASES: [string, (world: World) => void, string, string][] = [
    [
      'the account no longer authorizes the action',
      (world) => {
        const { chain } = world.kit
        chain.authorized = false
      },
      'notAuthorized',
      t('socialRecovery.wait.cannotExecute.notAuthorized')
    ],
    [
      'the action no longer fits the account',
      (world) => {
        const { chain } = world.kit
        chain.supported = false
      },
      'upgradedAway',
      t('socialRecovery.wait.cannotExecute.upgradedAway')
    ],
    [
      'the key being removed no longer holds control',
      (world) => {
        const { chain } = world.kit
        chain.removedHolds = false
      },
      'privilegeMoved',
      t('socialRecovery.wait.cannotExecute.refused', {
        read: t('socialRecovery.writes.causes.ReservedAuthority')
      })
    ],
    [
      'the new key already holds a privilege',
      (world) => {
        const { chain } = world.kit
        chain.newKeyHolds = true
      },
      'privilegeMoved',
      t('socialRecovery.wait.cannotExecute.refused', {
        read: t('socialRecovery.writes.causes.ReservedAuthority')
      })
    ]
  ]

  CASES.forEach(([name, fail, cause, line]) => {
    it(`names the cause where ${name}, with the slot and the exits, no retry and no new recovery`, async () => {
      const world = await openWorld()
      elapse(world.kit)
      fail(world)
      view = await mountWait(world.account)

      expect(view.byTestId('wait-cannot-execute')).not.toBeNull()
      expect(view.textOf(`wait-cannot-execute-${cause}`)).toBe(line)
      expect(view.byTestId('wait-cannot-execute-repair') !== null).toBe(cause === 'notAuthorized')
      const text = view.text()
      expect(text).toContain(t('socialRecovery.wait.cannotExecute.approvalsDie'))
      expect(text).toContain(t('socialRecovery.wait.cannotExecute.noRetry'))
      expect(text).toContain(t('socialRecovery.wait.cannotExecute.slotClosed'))
      expect(text).toContain(t('socialRecovery.wait.cannotExecute.exitsNeedKey'))
      expect(view.byTestId('wait-execute')).toBeNull()
      expect(view.byTestId('wait-execution-due')).toBeNull()
      expect(view.byTestId('wait-countdown')).toBeNull()
      expect(view.byTestId('wait-time-left')).toBeNull()
      expect(text).not.toContain(t('socialRecovery.writes.tryAgain'))
      expect(text).not.toContain(t('socialRecovery.wait.cancelled.startAgain'))
      expect(text).not.toContain(t('socialRecovery.wait.cancelled.startNew'))
      expect(view.paths()).toEqual([])
    })
  })

  it('returns to the countdown once a later poll passes every check', async () => {
    const world = await openWorld()
    world.kit.chain.authorized = false
    view = await mountWait(world.account)
    expect(view.byTestId('wait-cannot-execute')).not.toBeNull()

    world.kit.chain.authorized = true
    world.kit.chain.blockTime += 30
    await tick(POLL_MS)
    expect(view.byTestId('wait-cannot-execute')).toBeNull()
    expect(view.textOf('wait-time-left')).toBe(waiting(HOUR - 30))
    expect(view.byTestId('wait-can-close')).not.toBeNull()
  })

  it('returns to execution due once a later poll passes every check after the wait', async () => {
    const world = await openWorld()
    elapse(world.kit)
    world.kit.chain.newKeyHolds = true
    view = await mountWait(world.account)
    expect(view.byTestId('wait-cannot-execute')).not.toBeNull()

    world.kit.chain.newKeyHolds = false
    await tick(POLL_MS)
    expect(view.byTestId('wait-cannot-execute')).toBeNull()
    expect(view.byTestId('wait-execute')).not.toBeNull()
  })

  it('keeps move funds disabled for a recoverer who does not hold the account key', async () => {
    const world = await openWorld()
    world.kit.chain.supported = false
    view = await mountWait(world.account)

    expect(view.isDisabled('wait-move-funds')).toBe(true)
    await view.press('wait-move-funds')
    expect(mockWallet.dispatch).not.toHaveBeenCalled()
    expect(view.paths()).toEqual([])
  })

  it('enables move funds where this wallet holds the account key', async () => {
    const world = await openWorld()
    world.kit.chain.supported = false
    const own = basicAccount(world.account)
    mockWallet.facts.set(
      world.account.toLowerCase(),
      readyFacts(factsOf(own, { addr: world.account, type: 'internal' }))
    )
    view = await mountWait(world.account)

    expect(view.isDisabled('wait-move-funds')).toBe(false)
    await view.press('wait-move-funds')
    expect(view.paths()).toEqual([`/${WEB_ROUTES.transfer}`])
  })

  it('selects the account being recovered, by the address the wallet lists, before it opens the transfer', async () => {
    const world = await openWorld({ lettered: true })
    world.kit.chain.supported = false
    const listed = world.account.toLowerCase() as typeof world.account
    expect(listed).not.toBe(world.account)
    const own = basicAccount(listed)
    mockWallet.facts.set(listed, readyFacts(factsOf(own, { addr: listed, type: 'internal' })))
    view = await mountWait(world.account)

    await view.press('wait-move-funds')
    const selects = mockWallet.dispatch.mock.calls.filter(
      ([action]) => action.type === 'MAIN_CONTROLLER_SELECT_ACCOUNT'
    )
    expect(selects).toEqual([
      [{ type: 'MAIN_CONTROLLER_SELECT_ACCOUNT', params: { accountAddr: listed } }]
    ])
    const selected = mockWallet.dispatch.mock.calls.findIndex(
      ([action]) => action.type === 'MAIN_CONTROLLER_SELECT_ACCOUNT'
    )
    expect(mockWallet.dispatch.mock.invocationCallOrder[selected]).toBeLessThan(
      mockWallet.navigate.mock.invocationCallOrder[0]
    )
    expect(view.paths()).toEqual([`/${WEB_ROUTES.transfer}`])
  })
})

describe('whose attempt the wait reads', () => {
  useWaitClock()
  let view: Mounted | undefined

  afterEach(() => {
    view?.unmount()
    view = undefined
  })

  it('does not take a consumed attempt with another payload for its own executed one', async () => {
    const world = await openWorld()
    view = await mountWait(world.account)
    expect(view.textOf('wait-time-left')).toBe(waiting(HOUR))

    world.kit.chain.attempt = {
      ...world.kit.chain.attempt,
      state: 'Consumed',
      payloadHash: `0x${'ab'.repeat(32)}`
    }
    await tick(POLL_MS)
    expect(view.paths()).not.toContain(donePath(world))
  })

  it('does not open the done screen for a consumed attempt under its id that no event names', async () => {
    const world = await openWorld()
    world.kit.chain.attempt = { ...world.kit.chain.attempt, state: 'Consumed' }
    world.kit.chain.events = []
    view = await mountWait(world.account)

    expect(view.paths()).toEqual([])
    expect(view.byTestId('wait-cannot-execute-unmatched')).not.toBeNull()
    expect(view.byTestId('wait-cancelled-action')).toBeNull()
    expect((await world.records.countdown(CHAIN_ID, world.account).read()).status).toBe('present')
    expect((await world.records.recoveryEntry(CHAIN_ID, world.account).read()).status).toBe(
      'present'
    )
  })

  it('opens the done screen for a consumed attempt under its id once its consume event shows, with no opening event', async () => {
    const world = await openWorld()
    world.kit.chain.attempt = { ...world.kit.chain.attempt, state: 'Consumed' }
    world.kit.chain.events = []
    view = await mountWait(world.account)
    expect(view.paths()).toEqual([])

    world.kit.chain.events = [attemptConsumed(world.account)]
    await tick(POLL_MS)
    expect(view.paths()).toEqual([donePath(world)])
  })

  it('reads cannot execute for a running attempt under its id with no opening event: no execute, no countdown, and the poll goes on', async () => {
    const world = await openWorld()
    elapse(world.kit)
    world.kit.chain.events = []
    view = await mountWait(world.account)

    expect(view.textOf('wait-cannot-execute-unmatched')).toBe(
      t('socialRecovery.wait.cannotExecute.refused', {
        read: t('socialRecovery.writes.causes.NotConsumable')
      })
    )
    expect(view.text()).toContain(t('socialRecovery.wait.cannotExecute.slotClosed'))
    expect(view.text()).toContain(t('socialRecovery.wait.cannotExecute.exitsNeedKey'))
    expect(view.byTestId('wait-execute')).toBeNull()
    expect(view.byTestId('wait-execution-due')).toBeNull()
    expect(view.byTestId('wait-countdown')).toBeNull()
    expect(view.byTestId('wait-time-left')).toBeNull()
    expect(view.paths()).toEqual([])

    const calls = world.kit.recoveryState.mock.calls.length
    world.kit.chain.events = [attemptStarted(world.account)]
    await tick(POLL_MS)
    expect(world.kit.recoveryState.mock.calls.length).toBe(calls + 1)
    expect(view.byTestId('wait-cannot-execute')).toBeNull()
    expect(view.byTestId('wait-execute')).not.toBeNull()
    expect(world.port.send).not.toHaveBeenCalled()
  })

  it('reads cannot execute for a waiting attempt under its id with no opening event, never a countdown', async () => {
    const world = await openWorld()
    world.kit.chain.events = []
    view = await mountWait(world.account)

    expect(view.byTestId('wait-cannot-execute-unmatched')).not.toBeNull()
    expect(view.byTestId('wait-time-left')).toBeNull()
    expect(view.byTestId('wait-can-close')).toBeNull()
  })

  it('renders the cancelled terminal with no canceller where no event names one', async () => {
    const world = await openWorld()
    view = await mountWait(world.account)

    world.kit.chain.attempt = { ...world.kit.chain.attempt, state: 'Cancelled' }
    await tick(POLL_MS)
    expect(view.byTestId('wait-cancelled-unnamed')).not.toBeNull()
    expect(view.byTestId('wait-cancelled-by')).toBeNull()
    expect(view.textOf('wait-cancelled-action')).toBe(t('socialRecovery.wait.cancelled.startAgain'))
  })
})
