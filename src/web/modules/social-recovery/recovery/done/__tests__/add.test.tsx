/**
 * @jest-environment jsdom
 *
 * On the fast track the done screen adds the recovered account to this wallet
 * through the wallet's own action, once, beside the key the recovery granted;
 * it renders the done text only once the wallet lists the account, renders
 * the add's failure with retry, and marks the wallet's setup complete once the
 * account is listed.
 */
import { dedicatedToOneSAPriv } from '@ambire-common/interfaces/keystore'
import { getSmartAccount } from '@ambire-common/libs/account/account'

import {
  ADD_ACTION,
  addedAccountOf,
  attemptStarted,
  dispatchedOf,
  mockWallet,
  mountDone,
  NEW_KEY,
  openWorld,
  ORIGINAL_PRIV,
  recoveryPrivileges,
  REMOVED_KEY,
  setWallet,
  SETUP_COMPLETE_ACTION,
  t,
  tick,
  useDoneClock,
  walletAddsIt
} from '@web/modules/social-recovery/recovery/done/__tests__/harness'
import type { Mounted } from '@web/modules/social-recovery/recovery/done/__tests__/harness'
import { ADD_LIMIT_MS } from '@web/modules/social-recovery/recovery/done'
import { renderFullAddress } from '@web/modules/social-recovery/shared/display'

useDoneClock()

const DONE = 'socialRecovery.done'

/** Nothing of the done text renders: no lead, no keys, no line that the account is in the wallet. */
const expectNoDoneText = (screen: Mounted) => {
  expect(screen.has('done')).toBe(false)
  expect(screen.has('done-lead')).toBe(false)
  expect(screen.has('done-controlled-by')).toBe(false)
  expect(screen.has('done-now-in-wallet')).toBe(false)
  expect(screen.text()).not.toContain(t(`${DONE}.nowInWallet`))
}

describe('the fast track adds the recovered account', () => {
  it('dispatches the add once with the account and the granted key, and renders the done text only once the wallet lists it', async () => {
    const world = await openWorld({ route: 'fresh-install' })
    const screen = await mountDone(world.account)
    expect(dispatchedOf(ADD_ACTION)).toHaveLength(1)
    const added = addedAccountOf()
    expect(added.addr).toBe(world.account)
    expect(added.associatedKeys).toEqual([NEW_KEY])
    expect(screen.has('done-adding')).toBe(true)
    expectNoDoneText(screen)

    await setWallet({ statuses: { addAccounts: 'LOADING' } })
    await tick(1000)
    expect(dispatchedOf(ADD_ACTION)).toHaveLength(1)
    expectNoDoneText(screen)

    await setWallet({
      accounts: [...(mockWallet.accounts ?? []), added],
      statuses: { addAccounts: 'SUCCESS' }
    })
    expect(screen.textOf('done-now-in-wallet')).toBe(t(`${DONE}.nowInWallet`))
    expect(screen.textOf('done-controlled-by')).toBe(renderFullAddress(NEW_KEY))
    expect(screen.has('done-lead')).toBe(true)
    await tick(ADD_LIMIT_MS * 2)
    expect(dispatchedOf(ADD_ACTION)).toHaveLength(1)
    expect(screen.has('done-add-failed')).toBe(false)
    screen.unmount()
  })

  it('builds the account creation from the privilege the removed key held, with the picker preferences', async () => {
    const world = await openWorld({ route: 'fresh-install' })
    const screen = await mountDone(world.account)
    const added = addedAccountOf()
    const expected = await getSmartAccount([{ addr: REMOVED_KEY, hash: ORIGINAL_PRIV }], [])
    expect(added.initialPrivileges).toEqual([[REMOVED_KEY, ORIGINAL_PRIV]])
    expect(added.creation).toEqual(expected.creation)
    expect(added.preferences.label).toBe('Account 3')
    expect(added.preferences.pfp).toBe(world.account)
    screen.unmount()
  })

  it('computes the creation with the stand-in privilege where no event names the removed key earlier', async () => {
    const world = await openWorld({ route: 'fresh-install' })
    world.kit.chain.privilegeEvents = recoveryPrivileges(world.account, { creation: false })
    const screen = await mountDone(world.account)
    expect(addedAccountOf().initialPrivileges).toEqual([[REMOVED_KEY, dedicatedToOneSAPriv]])
    expect(addedAccountOf().associatedKeys).toEqual([NEW_KEY])
    screen.unmount()
  })

  it('marks the wallet setup complete once, and only after the wallet lists the account', async () => {
    const world = await openWorld({ route: 'fresh-install' })
    const screen = await mountDone(world.account)
    expect(dispatchedOf(SETUP_COMPLETE_ACTION)).toHaveLength(0)
    await walletAddsIt()
    expect(dispatchedOf(SETUP_COMPLETE_ACTION)).toEqual([
      { type: SETUP_COMPLETE_ACTION, params: { isSetupComplete: true } }
    ])
    await setWallet({ statuses: { addAccounts: 'INITIAL' } })
    expect(dispatchedOf(SETUP_COMPLETE_ACTION)).toHaveLength(1)
    screen.unmount()
  })

  it('renders the add failure with retry when the accounts controller reports an error, and the retry adds again', async () => {
    const world = await openWorld({ route: 'fresh-install' })
    const screen = await mountDone(world.account)
    await setWallet({ statuses: { addAccounts: 'LOADING' } })
    await setWallet({ statuses: { addAccounts: 'ERROR' } })
    expect(screen.has('done-add-failed')).toBe(true)
    expect(screen.text()).toContain(t(`${DONE}.addFailed`))
    expectNoDoneText(screen)
    expect(dispatchedOf(SETUP_COMPLETE_ACTION)).toHaveLength(0)

    await screen.press('done-add-retry')
    expect(dispatchedOf(ADD_ACTION)).toHaveLength(2)
    expect(screen.has('done-adding')).toBe(true)
    await walletAddsIt()
    expect(screen.has('done-now-in-wallet')).toBe(true)
    expect(dispatchedOf(SETUP_COMPLETE_ACTION)).toHaveLength(1)
    screen.unmount()
  })

  it('does not read an error the controller held before this add started as its failure', async () => {
    const world = await openWorld({ route: 'fresh-install' })
    mockWallet.statuses = { addAccounts: 'ERROR' }
    const screen = await mountDone(world.account)
    await tick(1000)
    expect(screen.has('done-adding')).toBe(true)
    expect(screen.has('done-add-failed')).toBe(false)
    screen.unmount()
  })

  it('renders the add failure with retry where the wallet does not list the account within the limit', async () => {
    const world = await openWorld({ route: 'fresh-install' })
    const screen = await mountDone(world.account)
    await tick(ADD_LIMIT_MS - 1000)
    expect(screen.has('done-adding')).toBe(true)
    await tick(2000)
    expect(screen.has('done-add-failed')).toBe(true)
    expectNoDoneText(screen)
    expect(dispatchedOf(ADD_ACTION)).toHaveLength(1)
    screen.unmount()
  })

  it('reads a listing that comes after the failure as done', async () => {
    const world = await openWorld({ route: 'fresh-install' })
    const screen = await mountDone(world.account)
    await tick(ADD_LIMIT_MS + 1000)
    expect(screen.has('done-add-failed')).toBe(true)
    await walletAddsIt()
    expect(screen.has('done-now-in-wallet')).toBe(true)
    expect(dispatchedOf(ADD_ACTION)).toHaveLength(1)
    screen.unmount()
  })

  it('dispatches no add for an account the wallet already lists, and renders done', async () => {
    const world = await openWorld({ route: 'fresh-install', listed: true })
    const screen = await mountDone(world.account)
    expect(dispatchedOf(ADD_ACTION)).toHaveLength(0)
    expect(screen.has('done-now-in-wallet')).toBe(true)
    screen.unmount()
  })

  it('adds nothing before the consume is read, and nothing where no consume exists', async () => {
    const pending = await openWorld({ route: 'fresh-install' })
    pending.kit.chain.hanging = true
    const waiting = await mountDone(pending.account)
    expect(dispatchedOf(ADD_ACTION)).toHaveLength(0)
    waiting.unmount()

    const none = await openWorld({ route: 'fresh-install' })
    none.kit.chain.accountEvents = [attemptStarted(none.account, [0])]
    const screen = await mountDone(none.account)
    expect(dispatchedOf(ADD_ACTION)).toHaveLength(0)
    screen.unmount()
  })
})
