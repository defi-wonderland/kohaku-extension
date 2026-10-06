/**
 * @jest-environment jsdom
 */
import {
  CHAIN_ID,
  elapse,
  HOUR,
  mountBand,
  NO_ATTEMPT,
  openWorld,
  t,
  tick,
  useWaitClock,
  waitPathOf,
  waiting
} from '@web/modules/social-recovery/recovery/wait/__tests__/harness'
import type { Mounted } from '@web/modules/social-recovery/recovery/wait/__tests__/harness'
import { renderShortAddress } from '@web/modules/social-recovery/shared/display'

describe('the home band for a landed recovery', () => {
  useWaitClock()
  let view: Mounted | undefined

  afterEach(() => {
    view?.unmount()
    view = undefined
  })

  it('renders the waiting line with the countdown and opens the wait', async () => {
    const world = await openWorld()
    view = await mountBand(world.records)
    const id = world.account.toLowerCase()

    expect(view.textOf(`home-countdown-${id}-line`)).toBe(
      t('socialRecovery.home.waitingRunning', { account: renderShortAddress(world.account) })
    )
    expect(view.textOf(`home-countdown-${id}-time`)).toBe(waiting(HOUR))
    expect(view.textOf(`home-countdown-${id}-chip`)).toBe(
      t('socialRecovery.status.attempt.recoveryInProgress')
    )
    await tick(3_000)
    expect(view.textOf(`home-countdown-${id}-time`)).toBe(waiting(HOUR - 3))

    expect(view.textOf(`home-countdown-${id}-open`)).toBe(t('socialRecovery.home.open'))
    await view.press(`home-countdown-${id}-open`)
    expect(view.paths()).toEqual([waitPathOf(world.account)])
  })

  it('renders the execution-due line once the wait elapsed', async () => {
    const world = await openWorld()
    elapse(world.kit)
    view = await mountBand(world.records)
    const id = world.account.toLowerCase()

    expect(view.textOf(`home-countdown-${id}-line`)).toBe(
      t('socialRecovery.home.executionDue', { account: renderShortAddress(world.account) })
    )
    expect(view.textOf(`home-countdown-${id}-chip`)).toBe(
      t('socialRecovery.status.attempt.executionDue')
    )
    expect(view.byTestId(`home-countdown-${id}-time`)).toBeNull()
  })

  it('names the account alone, with no number, where the attempt read fails', async () => {
    const world = await openWorld()
    world.kit.chain.failing = true
    view = await mountBand(world.records)
    const id = world.account.toLowerCase()

    expect(view.textOf(`home-countdown-${id}-line`)).toBe(
      t('socialRecovery.home.recovering', { account: renderShortAddress(world.account) })
    )
    expect(view.byTestId(`home-countdown-${id}-time`)).toBeNull()
    expect(view.byTestId(`home-countdown-${id}-chip`)).toBeNull()
  })

  it('names the account alone where the attempt no longer waits', async () => {
    const world = await openWorld()
    world.kit.chain.attempt = NO_ATTEMPT
    view = await mountBand(world.records)
    const id = world.account.toLowerCase()

    expect(view.textOf(`home-countdown-${id}-line`)).toBe(
      t('socialRecovery.home.recovering', { account: renderShortAddress(world.account) })
    )
    expect(view.byTestId(`home-countdown-${id}-time`)).toBeNull()
  })

  it('renders no countdown line once the countdown ended', async () => {
    const world = await openWorld()
    const read = await world.records.countdown(CHAIN_ID, world.account).read()
    if (read.status !== 'present') {
      throw new Error('no countdown')
    }
    await world.records.endCountdown(CHAIN_ID, world.account, read.revision)
    view = await mountBand(world.records)

    expect(view.byTestId(`home-countdown-${world.account.toLowerCase()}`)).toBeNull()
    expect(view.text()).toBe('')
  })
})
