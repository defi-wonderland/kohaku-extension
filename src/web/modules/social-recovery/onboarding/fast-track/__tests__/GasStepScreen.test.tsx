/**
 * @jest-environment jsdom
 *
 * The fast track's gas step mounted whole, over the real records on the
 * storage double: the entry read, the sending key found among the wallet's
 * keys and accounts, the gas check on its balance, and where the step goes.
 */
import { act } from 'react-dom/test-utils'

import {
  byTestId,
  CONTROLLING_KEY,
  flush,
  isDisabled,
  LOST_ACCOUNT,
  mockChain,
  mockStorage,
  mount,
  movesAway,
  ORDINARY_KEY,
  press,
  resetEdge,
  setController,
  SMART_ACCOUNT,
  text,
  unmount,
  walletListsSlot,
  where,
  writeEntry
} from '@web/modules/social-recovery/onboarding/fast-track/__fixtures__/harness'

const GAS_STEP = `/social-recovery/fast-track/gas?account=${LOST_ACCOUNT}`
const CHECKLIST = `/social-recovery/recovery/checklist?account=${LOST_ACCOUNT}`
const READOUT = `/social-recovery/recovery/readout?account=${LOST_ACCOUNT}`
const ACCOUNT_STEP = `/social-recovery/recovery/account?route=fresh-install&to=${SMART_ACCOUNT}`
const POLL_MS = 5_000
const ONE_ETHER = 10n ** 18n

describe('the gas step', () => {
  beforeEach(async () => {
    resetEdge()
    await walletListsSlot()
    await writeEntry()
  })

  afterEach(() => {
    unmount()
    jest.useRealTimers()
  })

  it('skips itself where the sending key already holds enough', async () => {
    mockChain.balance = ONE_ETHER

    await mount(GAS_STEP)

    expect(mockChain.balanceReads).toEqual([ORDINARY_KEY])
    expect(movesAway()).toMatchObject([{ to: CHECKLIST.slice(1), replace: true }])
    expect(where()).toBe(CHECKLIST)
  })

  it('asks to fund the basic account of the slot, never the key the recovery installs', async () => {
    await mount(GAS_STEP)

    expect(byTestId('fast-track-gas')).not.toBeNull()
    expect(mockChain.balanceReads).toEqual([ORDINARY_KEY])
    expect(text()).toContain('Fund the key that sends the recovery')
    expect(text()).toContain(ORDINARY_KEY)
    expect(text()).toContain('Send at most 0.00096 ETH to this key for the submission.')
    expect(text()).not.toContain(CONTROLLING_KEY)
    expect(movesAway()).toEqual([])
  })

  it('never names the smart account as the payer and offers no transfer from it', async () => {
    await mount(GAS_STEP)

    expect(text()).not.toContain(SMART_ACCOUNT)
    expect(text()).not.toContain(LOST_ACCOUNT)
    expect(text()).not.toMatch(/Transfer/)
    expect(text()).toContain('The account cannot pay for itself until it is recovered.')
  })

  it('shows no step counter and no breadcrumb, and keeps continue disabled', async () => {
    await mount(GAS_STEP)

    expect(text()).not.toMatch(/Step \d of \d/)
    expect(text()).not.toContain('Settings ›')
    expect(isDisabled('fast-track-gas-continue')).toBe(true)
  })

  it('continues on its own once the funds arrive', async () => {
    jest.useFakeTimers()
    await mount(GAS_STEP)

    expect(byTestId('fast-track-gas')).not.toBeNull()

    mockChain.balance = ONE_ETHER
    await act(async () => {
      jest.advanceTimersByTime(POLL_MS)
    })
    await flush()

    expect(mockChain.balanceReads).toEqual([ORDINARY_KEY, ORDINARY_KEY])
    expect(where()).toBe(CHECKLIST)
  })

  it('goes back to the readout', async () => {
    await mount(GAS_STEP)

    expect(byTestId('fast-track-gas-back')?.textContent).toBe('Back')
    await press('fast-track-gas-back')

    expect(movesAway()).toMatchObject([{ to: READOUT.slice(1), replace: false }])
    expect(where()).toBe(READOUT)
  })

  it('shows a failed chain read with retry, never the last deposit step', async () => {
    jest.useFakeTimers()
    await mount(GAS_STEP)

    mockChain.fail = true
    await act(async () => {
      jest.advanceTimersByTime(POLL_MS)
    })
    await flush()

    expect(byTestId('fast-track-gas')).toBeNull()
    expect(byTestId('fast-track-gas-failed')).not.toBeNull()

    mockChain.fail = false
    mockChain.balance = ONE_ETHER
    await press('fast-track-gas-retry')
    await flush()

    expect(where()).toBe(CHECKLIST)
  })

  it('shows a failed entry read with retry', async () => {
    mockStorage.failReads = true

    await mount(GAS_STEP)

    expect(byTestId('fast-track-gas-failed')).not.toBeNull()
    expect(mockChain.balanceReads).toEqual([])

    mockStorage.failReads = false
    await press('fast-track-gas-retry')
    await flush()

    expect(byTestId('fast-track-gas')).not.toBeNull()
  })

  it('offers only Back to the account step where no key of this wallet can send the recovery', async () => {
    await setController('keystore', { keys: [] })

    await mount(GAS_STEP)

    expect(byTestId('fast-track-gas-no-key')).not.toBeNull()
    expect(byTestId('fast-track-gas-retry')).toBeNull()
    expect(mockChain.balanceReads).toEqual([])

    await press('fast-track-gas-back')

    expect(movesAway()).toMatchObject([{ to: ACCOUNT_STEP.slice(1), replace: true }])
    expect(where()).toBe(ACCOUNT_STEP)
  })

  it('sends a holder with no entry for the account back to the account step', async () => {
    mockStorage.entries.clear()

    await mount(GAS_STEP)

    expect(where()).toBe(ACCOUNT_STEP)
    expect(mockChain.balanceReads).toEqual([])
  })

  it('goes straight on to the checklist on the logged-in route', async () => {
    mockStorage.entries.clear()
    await writeEntry('logged-in')

    await mount(GAS_STEP)

    expect(where()).toBe(CHECKLIST)
    expect(mockChain.balanceReads).toEqual([])
  })

  it('never calls anything a seed', async () => {
    await mount(GAS_STEP)

    expect(text()).not.toMatch(/seed/i)
  })
})
