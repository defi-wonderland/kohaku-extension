/**
 * @jest-environment jsdom
 */
import { Linking } from 'react-native'

import {
  CHAIN_TIME,
  dateOf,
  DEVICE_NOW,
  HOUR,
  MIXED_PATH,
  moveDeviceClock,
  mountWait,
  openWorld,
  resetTab,
  showTab,
  START_TX,
  t,
  tick,
  useWaitClock,
  waiting
} from '@web/modules/social-recovery/recovery/wait/__tests__/harness'
import type { Mounted } from '@web/modules/social-recovery/recovery/wait/__tests__/harness'
import { explorerTransactionUrlOf } from '@web/modules/social-recovery/setup/arm'

const POLL_MS = 30_000

describe('the countdown', () => {
  useWaitClock()
  let view: Mounted | undefined

  afterEach(() => {
    view?.unmount()
    view = undefined
  })

  it("counts down to the attempt's end against the pinned block's time, not this device's clock", async () => {
    const world = await openWorld()
    world.kit.chain.attempt = { ...world.kit.chain.attempt, consumableAfter: CHAIN_TIME + 2 * HOUR }
    view = await mountWait(world.account)

    expect(view.textOf('wait-time-left')).toBe(waiting(2 * HOUR))
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(view.textOf('wait-finishes')).toBe(
      t('socialRecovery.wait.finishes', { date: dateOf((CHAIN_TIME + 2 * HOUR) * 1000, zone) })
    )
    await tick(5_000)
    expect(view.textOf('wait-time-left')).toBe(waiting(2 * HOUR - 5))
  })

  it('moves only on the next poll when the device clock jumps', async () => {
    const world = await openWorld()
    view = await mountWait(world.account)
    expect(view.textOf('wait-time-left')).toBe(waiting(HOUR))

    moveDeviceClock(20 * 60_000)
    await tick(0)
    expect(view.textOf('wait-time-left')).toBe(waiting(HOUR))

    // The chain moved 10 minutes while the view's own clock counted 29 seconds.
    world.kit.chain.blockTime = CHAIN_TIME + 600
    await tick(POLL_MS - 1_000)
    expect(view.textOf('wait-time-left')).toBe(waiting(HOUR - 29))
    await tick(1_000)
    expect(world.kit.recoveryState).toHaveBeenCalledTimes(2)
    expect(view.textOf('wait-time-left')).toBe(waiting(HOUR - 600))
  })

  it('shows the running recovery: its chip, the account, the new key and the start on chain', async () => {
    const world = await openWorld()
    view = await mountWait(world.account)

    expect(view.textOf('wait-chip')).toBe(t('socialRecovery.status.attempt.recoveryInProgress'))
    expect(view.textOf('wait-account')).toContain(world.account.slice(0, 6))
    expect(view.textOf('wait-new-key')).toContain(world.newKey.slice(0, 6))
    expect(view.byTestId('wait-start-hash')).not.toBeNull()
    expect(view.byTestId('wait-can-close')).not.toBeNull()
    expect(view.byTestId('wait-owner-can-cancel')).not.toBeNull()
    expect(view.byTestId('wait-who-finishes')).not.toBeNull()
  })

  it("dates the start on chain, the attempt's end less the setup's waiting period, where this device holds the setup", async () => {
    const world = await openWorld({ cache: true, configuration: MIXED_PATH })
    view = await mountWait(world.account)

    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const startMs = (CHAIN_TIME + HOUR - Number(MIXED_PATH.wait)) * 1000
    expect(dateOf(startMs, zone)).not.toBe(dateOf(DEVICE_NOW, zone))
    expect(view.textOf('wait-started')).toBe(
      t('socialRecovery.wait.started', { date: dateOf(startMs, zone) })
    )
  })

  it('dates the start by the day the submission landed here where this device holds no setup', async () => {
    const world = await openWorld()
    moveDeviceClock(400 * 24 * HOUR * 1000)
    view = await mountWait(world.account)

    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(dateOf(Date.now(), zone)).not.toBe(dateOf(DEVICE_NOW, zone))
    expect(view.textOf('wait-started')).toBe(
      t('socialRecovery.wait.started', { date: dateOf(DEVICE_NOW, zone) })
    )
  })

  it('opens the transaction that started the recovery on the chain explorer', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    try {
      const world = await openWorld()
      view = await mountWait(world.account)

      await view.press('wait-explorer')
      expect(openURL).toHaveBeenCalledTimes(1)
      expect(openURL).toHaveBeenCalledWith(explorerTransactionUrlOf('sepolia', START_TX))
      expect(openURL.mock.calls[0][0]).toContain(START_TX)
      expect(view.paths()).toEqual([])
    } finally {
      openURL.mockRestore()
    }
  })

  it('names the path by its rule lines where this device holds the setup', async () => {
    const world = await openWorld({ cache: true })
    view = await mountWait(world.account)

    expect(view.byTestId('wait-path')).not.toBeNull()
  })

  it('resumes from the countdown record alone after a reload', async () => {
    const world = await openWorld()
    view = await mountWait(world.account)
    expect(view.textOf('wait-time-left')).toBe(waiting(HOUR))
    view.unmount()

    const stored = JSON.stringify(await world.storage.getAll?.(), (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
    expect(stored).not.toContain('gathering')
    expect(stored).not.toContain('replies')

    world.kit.chain.blockTime = CHAIN_TIME + 100
    view = await mountWait(world.account)
    expect(view.textOf('wait-time-left')).toBe(waiting(HOUR - 100))
    expect(view.paths()).toEqual([])
  })

  it('counts the fifth of five stages on the logged-in route, under the settings chrome', async () => {
    const world = await openWorld()
    view = await mountWait(world.account)

    expect(view.byTestId('setup-chrome')).not.toBeNull()
    expect(view.byTestId('wait-stage')).not.toBeNull()
    expect(view.textOf('wait-stage')).toContain('5')
  })

  it('counts no stage on the fresh install, under the plain header', async () => {
    const world = await openWorld({ route: 'fresh-install' })
    view = await mountWait(world.account)

    expect(view.byTestId('plain-chrome')).not.toBeNull()
    expect(view.byTestId('wait-stage')).toBeNull()
    expect(view.byTestId('wait-time-left')).not.toBeNull()
  })
})

describe("the poll on the tab's return", () => {
  useWaitClock()
  let view: Mounted | undefined

  afterEach(() => {
    view?.unmount()
    view = undefined
    resetTab()
  })

  it('asks the chain again when the tab comes back into view, and not while it is hidden', async () => {
    const world = await openWorld()
    view = await mountWait(world.account)
    expect(world.kit.recoveryState).toHaveBeenCalledTimes(1)

    await showTab('hidden')
    expect(world.kit.recoveryState).toHaveBeenCalledTimes(1)

    world.kit.chain.blockTime = CHAIN_TIME + 900
    await showTab('visible')
    expect(world.kit.recoveryState).toHaveBeenCalledTimes(2)
    expect(view.textOf('wait-time-left')).toBe(waiting(HOUR - 900))
  })

  it('reads the cancel at once when the tab comes back into view', async () => {
    const world = await openWorld()
    view = await mountWait(world.account)
    expect(view.textOf('wait-time-left')).toBe(waiting(HOUR))

    world.kit.chain.attempt = { ...world.kit.chain.attempt, state: 'Cancelled' }
    await showTab('visible')
    expect(view.byTestId('wait-time-left')).toBeNull()
    expect(view.byTestId('wait-cancelled-action')).not.toBeNull()
  })
})

describe('a failed or hanging poll', () => {
  useWaitClock()
  let view: Mounted | undefined

  afterEach(() => {
    view?.unmount()
    view = undefined
  })

  it('reads failed with a retry and no number, and the retry restores the countdown', async () => {
    const world = await openWorld()
    world.kit.chain.failing = true
    view = await mountWait(world.account)

    expect(view.byTestId('wait-poll-failed')).not.toBeNull()
    expect(view.textOf('wait-poll-no-number')).toBe(
      t('socialRecovery.wait.pollFailed.noLastNumber')
    )
    expect(view.byTestId('wait-time-left')).toBeNull()
    expect(view.byTestId('wait-account')).toBeNull()

    world.kit.chain.failing = false
    await view.press('wait-poll-retry')
    expect(view.byTestId('wait-poll-failed')).toBeNull()
    expect(view.textOf('wait-time-left')).toBe(waiting(HOUR))
  })

  it('hides the last good number once a later poll fails, and a later poll restores it', async () => {
    const world = await openWorld()
    view = await mountWait(world.account)
    expect(view.textOf('wait-time-left')).toBe(waiting(HOUR))

    world.kit.chain.failing = true
    await tick(POLL_MS)
    expect(view.byTestId('wait-poll-failed')).not.toBeNull()
    expect(view.byTestId('wait-time-left')).toBeNull()

    world.kit.chain.failing = false
    world.kit.chain.blockTime = CHAIN_TIME + 60
    await tick(POLL_MS)
    expect(view.byTestId('wait-poll-failed')).toBeNull()
    expect(view.textOf('wait-time-left')).toBe(waiting(HOUR - 60))
  })

  it('reads failed once a poll runs past its limit, never the last good number', async () => {
    const world = await openWorld()
    view = await mountWait(world.account)
    expect(view.textOf('wait-time-left')).toBe(waiting(HOUR))

    world.kit.chain.hanging = true
    await tick(POLL_MS)
    await tick(15_000)
    expect(view.byTestId('wait-poll-failed')).not.toBeNull()
    expect(view.byTestId('wait-time-left')).toBeNull()

    world.kit.chain.hanging = false
    await view.press('wait-poll-retry')
    expect(view.byTestId('wait-time-left')).not.toBeNull()
  })

  it('reads failed where the events cannot be read', async () => {
    const world = await openWorld()
    world.kit.fetch.mockRejectedValue(new Error('logs refused'))
    view = await mountWait(world.account)

    expect(view.byTestId('wait-poll-failed')).not.toBeNull()
    expect(view.byTestId('wait-time-left')).toBeNull()
  })
})
