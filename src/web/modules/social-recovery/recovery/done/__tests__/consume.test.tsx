/**
 * @jest-environment jsdom
 *
 * The done screen's one read: the consume event of the account and the
 * privilege events of its transaction. The screen names the keys as these
 * events report them, dates the recovery by the consume's block, sends the
 * holder back to the wait where no consume exists yet, and renders loading
 * and failed with retry for a read that has not answered or failed.
 */
import {
  attemptConsumed,
  attemptStarted,
  CONSUME_BLOCK,
  CONSUME_TIME,
  CONSUME_TX,
  DEPLOYED_AT,
  GRANT_PRIV,
  mockWallet,
  mountDone,
  NEW_KEY,
  openWorld,
  OTHER_TX,
  PINNED_TIME,
  privilegeChanged,
  recoveryPrivileges,
  REMOVED_KEY,
  SIGNER_STATE_KEY,
  t,
  tick,
  useDoneClock
} from '@web/modules/social-recovery/recovery/done/__tests__/harness'
import { POLL_LIMIT_MS } from '@web/modules/social-recovery/recovery/checklist/constants'
import { dateOf, waitPathOf } from '@web/modules/social-recovery/recovery/checklist'
import { renderFullAddress } from '@web/modules/social-recovery/shared/display'
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'
import { zeroHash } from 'viem'

useDoneClock()

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const lead = (seconds: number) =>
  t('socialRecovery.done.lead', { date: dateOf(seconds * 1000, zone()) })

describe('the done screen names the keys from the consume transaction', () => {
  it('renders the granted and the removed key as the consume transaction reports them', async () => {
    const world = await openWorld({ route: 'logged-in' })
    const screen = await mountDone(world.account)
    expect(screen.has('done')).toBe(true)
    expect(screen.textOf('done-controlled-by')).toBe(renderFullAddress(NEW_KEY))
    expect(screen.textOf('done-removed')).toBe(renderFullAddress(REMOVED_KEY))
    expect(screen.text()).toContain(t('socialRecovery.display.values.controlledBy'))
    expect(screen.text()).toContain(t('socialRecovery.display.values.removed'))
    expect(screen.textOf('done-title')).toBe(t('socialRecovery.done.title'))
    screen.unmount()
  })

  it('never reads the signer state, and a signer state that disagrees changes nothing', async () => {
    const world = await openWorld({ route: 'logged-in' })
    const screen = await mountDone(world.account)
    expect(screen.text()).not.toContain(renderFullAddress(SIGNER_STATE_KEY))
    world.kit.signerReads.forEach((read) => expect(read).not.toHaveBeenCalled())
    expect(mockWallet.factsReads).toEqual([])
    screen.unmount()
  })

  it('reads the events from the manager deployment to the pinned block', async () => {
    const world = await openWorld({ route: 'logged-in' })
    const screen = await mountDone(world.account)
    const ranges = world.kit.fetch.mock.calls.map((call) => call[1])
    expect(ranges.length).toBeGreaterThan(0)
    ranges.forEach((range) =>
      expect(range).toEqual({ from: DEPLOYED_AT, to: world.kit.chain.blockNumber })
    )
    screen.unmount()
  })

  it('takes the keys from the latest consume of the account, ignoring other transactions and removed logs', async () => {
    const world = await openWorld({ route: 'logged-in' })
    const { account, kit } = world
    const earlierKey: Address = '0x00000000000000000000000000000000000e0001'
    const strangerKey: Address = '0x00000000000000000000000000000000000e0002'
    const otherAccount: Address = '0x00000000000000000000000000000000000e0003'
    kit.chain.accountEvents = [
      attemptStarted(account, [0], 1n, CONSUME_BLOCK - 300),
      attemptConsumed(account, 1n, CONSUME_BLOCK - 200, OTHER_TX),
      attemptStarted(account, [0, 1, 3], 2n),
      attemptConsumed(account, 2n),
      attemptConsumed(otherAccount, 3n, CONSUME_BLOCK + 1, `0x${'ab'.repeat(32)}`)
    ]
    kit.chain.attempt = { ...kit.chain.attempt, attemptId: 2n }
    kit.chain.privilegeEvents = [
      privilegeChanged(account, earlierKey, GRANT_PRIV, CONSUME_BLOCK - 200, OTHER_TX),
      privilegeChanged(otherAccount, strangerKey, GRANT_PRIV, CONSUME_BLOCK, CONSUME_TX, 4),
      {
        ...privilegeChanged(account, strangerKey, GRANT_PRIV, CONSUME_BLOCK, CONSUME_TX, 0),
        at: {
          blockNumber: CONSUME_BLOCK,
          blockHash: zeroHash,
          logIndex: 0,
          transactionHash: CONSUME_TX,
          removed: true
        }
      },
      ...recoveryPrivileges(account)
    ]
    const screen = await mountDone(account)
    expect(screen.textOf('done-controlled-by')).toBe(renderFullAddress(NEW_KEY))
    expect(screen.textOf('done-removed')).toBe(renderFullAddress(REMOVED_KEY))
    expect(screen.text()).not.toContain(renderFullAddress(earlierKey))
    expect(screen.text()).not.toContain(renderFullAddress(strangerKey))
    screen.unmount()
  })
})

describe('the lead dates the recovery by the consume', () => {
  it('reads the consume block time where the consume is not in the pinned block', async () => {
    const world = await openWorld({ route: 'logged-in' })
    const screen = await mountDone(world.account)
    expect(mockWallet.blockReads).toEqual([CONSUME_BLOCK])
    expect(screen.textOf('done-lead')).toBe(lead(CONSUME_TIME))
    screen.unmount()
  })

  it('takes the pinned block time where the consume is in the pinned block', async () => {
    const world = await openWorld({ route: 'logged-in' })
    world.kit.chain.blockNumber = CONSUME_BLOCK
    const screen = await mountDone(world.account)
    expect(mockWallet.blockReads).toEqual([])
    expect(screen.textOf('done-lead')).toBe(lead(PINNED_TIME))
    screen.unmount()
  })

  it('renders failed with retry where the block time read fails', async () => {
    const world = await openWorld({ route: 'logged-in' })
    mockWallet.blockTimes = new Map()
    const screen = await mountDone(world.account)
    expect(screen.has('done-read-failed')).toBe(true)
    expect(screen.has('done')).toBe(false)
    mockWallet.blockTimes = new Map([[CONSUME_BLOCK, CONSUME_TIME]])
    await screen.press('done-read-failed-retry')
    expect(screen.textOf('done-lead')).toBe(lead(CONSUME_TIME))
    screen.unmount()
  })
})

describe('a read that found no consume, failed or has not answered', () => {
  it('sends the holder back to the wait where no consume exists yet, rendering nothing of done', async () => {
    const world = await openWorld({ route: 'logged-in' })
    world.kit.chain.accountEvents = [attemptStarted(world.account, [0, 1, 3])]
    world.kit.chain.privilegeEvents = []
    const screen = await mountDone(world.account)
    expect(screen.paths()).toEqual([waitPathOf(world.account)])
    expect(mockWallet.navigate.mock.calls[0][1]).toEqual({ replace: true })
    expect(screen.has('done')).toBe(false)
    expect(screen.text()).not.toContain(t('socialRecovery.done.title'))
    screen.unmount()
  })

  it('renders loading while the read has not answered, then failed with retry at its limit', async () => {
    const world = await openWorld({ route: 'logged-in' })
    world.kit.chain.hanging = true
    const screen = await mountDone(world.account)
    expect(screen.has('done-loading')).toBe(true)
    expect(screen.has('done')).toBe(false)
    await tick(POLL_LIMIT_MS + 1)
    expect(screen.has('done-read-failed')).toBe(true)
    expect(screen.has('done')).toBe(false)
    expect(screen.paths()).toEqual([])
    world.kit.chain.hanging = false
    await screen.press('done-read-failed-retry')
    expect(screen.has('done')).toBe(true)
    screen.unmount()
  })

  it('renders failed with retry where the read throws, and the retry reads again', async () => {
    const world = await openWorld({ route: 'logged-in' })
    world.kit.chain.failing = true
    const screen = await mountDone(world.account)
    expect(screen.has('done-read-failed')).toBe(true)
    expect(screen.text()).toContain(t('socialRecovery.client.unavailableTitle'))
    expect(screen.has('done')).toBe(false)
    expect(screen.paths()).toEqual([])
    const reads = world.kit.recoveryState.mock.calls.length
    world.kit.chain.failing = false
    await screen.press('done-read-failed-retry')
    expect(world.kit.recoveryState.mock.calls.length).toBe(reads + 1)
    expect(screen.textOf('done-controlled-by')).toBe(renderFullAddress(NEW_KEY))
    screen.unmount()
  })

  it('reads a consume whose transaction names no keys yet as failed with retry, never as done', async () => {
    const world = await openWorld({ route: 'logged-in' })
    world.kit.chain.privilegeEvents = recoveryPrivileges(world.account).slice(0, 1)
    const screen = await mountDone(world.account)
    expect(screen.has('done-read-failed')).toBe(true)
    expect(screen.has('done')).toBe(false)
    expect(screen.paths()).toEqual([])
    world.kit.chain.privilegeEvents = recoveryPrivileges(world.account).slice(0, 2)
    await screen.press('done-read-failed-retry')
    expect(screen.has('done-read-failed')).toBe(true)
    world.kit.chain.privilegeEvents = recoveryPrivileges(world.account)
    await screen.press('done-read-failed-retry')
    expect(screen.textOf('done-removed')).toBe(renderFullAddress(REMOVED_KEY))
    screen.unmount()
  })

  it('renders failed where the client failed, and its retry rebuilds the client', async () => {
    const world = await openWorld({ route: 'logged-in' })
    const retry = jest.fn()
    mockWallet.clients.set(world.account.toLowerCase(), { status: 'failed', retry })
    const screen = await mountDone(world.account)
    expect(screen.has('done-read-failed')).toBe(true)
    await screen.press('done-read-failed-retry')
    expect(retry).toHaveBeenCalledTimes(1)
    expect(world.kit.recoveryState).not.toHaveBeenCalled()
    screen.unmount()
  })

  it('renders loading while the client loads', async () => {
    const world = await openWorld({ route: 'logged-in' })
    mockWallet.clients.set(world.account.toLowerCase(), { status: 'loading' })
    const screen = await mountDone(world.account)
    expect(screen.has('done-loading')).toBe(true)
    expect(screen.has('done-read-failed')).toBe(false)
    screen.unmount()
  })
})

describe('the route search and the entry record', () => {
  it('sends a search with no account to the account step', async () => {
    await openWorld({ route: 'logged-in' })
    const screen = await mountDone()
    expect(screen.paths()).toEqual(['/social-recovery/recovery/account'])
    screen.unmount()
  })

  it('renders failed with retry where the entry record read fails', async () => {
    const world = await openWorld({ route: 'logged-in' })
    const { get } = world.storage
    world.storage.get = async () => {
      throw new Error('storage unavailable')
    }
    const screen = await mountDone(world.account)
    expect(screen.has('done-entry-failed')).toBe(true)
    expect(screen.has('done')).toBe(false)
    world.storage.get = get
    await screen.press('done-entry-retry')
    expect(screen.has('done')).toBe(true)
    screen.unmount()
  })

  it('waits for the wallet accounts before it reads the entry record', async () => {
    const world = await openWorld({ route: 'logged-in' })
    mockWallet.accounts = undefined
    const screen = await mountDone(world.account)
    expect(screen.has('done-entry-loading')).toBe(true)
    expect(world.kit.recoveryState).not.toHaveBeenCalled()
    screen.unmount()
  })
})
