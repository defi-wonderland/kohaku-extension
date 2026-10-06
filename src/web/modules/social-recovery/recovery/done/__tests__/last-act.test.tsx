/**
 * @jest-environment jsdom
 *
 * The done screen's last act, on Close and on the edit actions: it ends the
 * countdown, clears the entry record and the recovery password held in
 * memory, keeps the decrypted setup cache, and only then leaves. A reload
 * after it renders from the consume event alone where the wallet lists the
 * account, and sends to the account step where it does not.
 */
import {
  ADD_ACTION,
  CHAIN_ID,
  dispatchedOf,
  mockWallet,
  mountDone,
  NEW_KEY,
  openWorld,
  PASSWORD,
  RECEIVING_ADDR,
  REMOVED_KEY,
  reportSelected,
  SIGNER_STATE_KEY,
  SLOT_SMART,
  t,
  useDoneClock
} from '@web/modules/social-recovery/recovery/done/__tests__/harness'
import type { World } from '@web/modules/social-recovery/recovery/done/__tests__/harness'
import { renderFullAddress } from '@web/modules/social-recovery/shared/display'
import {
  readRecoveryPassword,
  setRecoveryPassword
} from '@web/modules/social-recovery/shared/records'

useDoneClock()

const DONE = 'socialRecovery.done'

const recordsOf = async ({ records, account }: World) => ({
  countdown: (await records.countdown(CHAIN_ID, account).read()).status,
  entry: (await records.recoveryEntry(CHAIN_ID, account).read()).status,
  cache: (await records.decryptedSetupCache(CHAIN_ID, account).read()).status,
  password: readRecoveryPassword(CHAIN_ID, account)
})

const BEFORE = { countdown: 'present', entry: 'present', cache: 'present', password: PASSWORD }
const AFTER = { countdown: 'absent', entry: 'absent', cache: 'present', password: undefined }

/** A recovery on `route` with the recovery password held, mounted and done once the wallet added the account. */
const openDone = async (options: Parameters<typeof openWorld>[0] = {}) => {
  const world = await openWorld({ walletAdds: true, ...options })
  setRecoveryPassword(CHAIN_ID, world.account, PASSWORD)
  const screen = await mountDone(world.account)
  expect(screen.has('done')).toBe(true)
  return { world, screen }
}

describe('the last act', () => {
  it('on Close ends the countdown, clears the entry and the password, keeps the cache, and leaves for the dashboard', async () => {
    const { world, screen } = await openDone({ route: 'fresh-install' })
    expect(await recordsOf(world)).toEqual(BEFORE)
    await screen.press('done-close')
    expect(await recordsOf(world)).toEqual(AFTER)
    expect(screen.paths()).toEqual(['/dashboard'])
    expect(mockWallet.navigate.mock.calls[0][1]).toEqual({ replace: true })
    screen.unmount()
  })

  it('runs the last act on the logged-in route too', async () => {
    const { world, screen } = await openDone({ route: 'logged-in' })
    await screen.press('done-close')
    expect(await recordsOf(world)).toEqual(AFTER)
    expect(screen.paths()).toEqual(['/dashboard'])
    screen.unmount()
  })

  it('clears the entry where the countdown record is already gone', async () => {
    const { world, screen } = await openDone({ route: 'logged-in', countdown: false })
    await screen.press('done-close')
    expect(await recordsOf(world)).toEqual(AFTER)
    expect(screen.paths()).toEqual(['/dashboard'])
    screen.unmount()
  })

  it('on Remove the row in the editor runs the last act and opens the editor', async () => {
    const { world, screen } = await openDone({ route: 'fresh-install' })
    await screen.press('done-remove-in-editor')
    expect(await recordsOf(world)).toEqual(AFTER)
    expect(screen.paths()).toEqual(['/social-recovery/setup/editor'])
    screen.unmount()
  })

  it('stays with the actions pressable and leaves nothing where the last act fails, then leaves on a second press', async () => {
    const { world, screen } = await openDone({ route: 'logged-in' })
    const { remove } = world.storage
    world.storage.remove = async () => {
      throw new Error('storage unavailable')
    }
    await screen.press('done-close')
    expect(screen.has('done-finish-failed')).toBe(true)
    expect(screen.paths()).toEqual([])
    expect(screen.byTestId('done-close')?.getAttribute('aria-disabled')).not.toBe('true')
    world.storage.remove = remove
    await screen.press('done-close')
    expect(await recordsOf(world)).toEqual(AFTER)
    expect(screen.paths()).toEqual(['/dashboard'])
    screen.unmount()
  })

  it('disables the actions while the last act runs, so one press leaves once', async () => {
    const { world, screen } = await openDone({ route: 'logged-in' })
    const { remove } = world.storage
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    world.storage.remove = async (key) => {
      await gate
      return remove(key)
    }
    await screen.press('done-close')
    expect(screen.byTestId('done-close')?.getAttribute('aria-disabled')).toBe('true')
    expect(screen.byTestId('done-edit')?.getAttribute('aria-disabled')).toBe('true')
    expect(screen.paths()).toEqual([])
    release()
    await screen.press('done-edit')
    expect(screen.paths()).toEqual(['/dashboard'])
    screen.unmount()
  })
})

describe('Edit selects the recovered account', () => {
  const routes = ['fresh-install', 'logged-in'] as const
  routes.forEach((route) => {
    it(`on the ${route} route runs the last act, selects the recovered account, never the receiving one, and opens the editor`, async () => {
      const { world, screen } = await openDone({ route })
      await screen.press('done-edit')
      expect(await recordsOf(world)).toEqual(AFTER)
      expect(dispatchedOf('MAIN_CONTROLLER_SELECT_ACCOUNT')).toEqual([
        { type: 'MAIN_CONTROLLER_SELECT_ACCOUNT', params: { accountAddr: world.account } }
      ])
      expect(screen.paths()).toEqual(['/social-recovery/setup/editor'])
      screen.unmount()
    })

    it(`on the ${route} route opens the editor only once the wallet reports the recovered account selected`, async () => {
      const { world, screen } = await openDone({ route })
      mockWallet.holdsSelection = true
      await reportSelected(route === 'logged-in' ? RECEIVING_ADDR : SLOT_SMART)
      await screen.press('done-edit')
      expect(dispatchedOf('MAIN_CONTROLLER_SELECT_ACCOUNT')).toHaveLength(1)
      expect(await recordsOf(world)).toEqual(AFTER)
      expect(screen.paths()).toEqual([])
      expect(screen.byTestId('done-edit')?.getAttribute('aria-disabled')).toBe('true')
      expect(screen.byTestId('done-close')?.getAttribute('aria-disabled')).toBe('true')

      await reportSelected(SIGNER_STATE_KEY)
      expect(screen.paths()).toEqual([])
      await reportSelected(world.account)
      expect(screen.paths()).toEqual(['/social-recovery/setup/editor'])
      await reportSelected(world.account)
      expect(screen.paths()).toEqual(['/social-recovery/setup/editor'])
      screen.unmount()
    })
  })

  it('does not open the editor for a recovered account selected before Edit was pressed', async () => {
    const { world, screen } = await openDone({ route: 'logged-in' })
    await reportSelected(world.account)
    expect(screen.paths()).toEqual([])
    screen.unmount()
  })
})

describe('a reload after the last act', () => {
  it('renders from the consume event alone where the wallet lists the account, adding nothing', async () => {
    const { world, screen } = await openDone({ route: 'fresh-install' })
    await screen.press('done-close')
    screen.unmount()
    const adds = dispatchedOf(ADD_ACTION).length

    const reloaded = await mountDone(world.account)
    expect(reloaded.has('done')).toBe(true)
    expect(reloaded.has('setup-chrome')).toBe(true)
    expect(reloaded.textOf('done-controlled-by')).toBe(renderFullAddress(NEW_KEY))
    expect(reloaded.textOf('done-removed')).toBe(renderFullAddress(REMOVED_KEY))
    expect(reloaded.textOf('done-controlled-by-line-0')).toBe(t(`${DONE}.keyLimit`))
    expect(reloaded.has('done-controlled-by-line-1')).toBe(false)
    expect(reloaded.has('done-now-in-wallet')).toBe(false)
    expect(dispatchedOf(ADD_ACTION).length).toBe(adds)
    expect(reloaded.paths()).toEqual([])
    reloaded.unmount()
  })

  it('sends to the account step where no entry record is left and the wallet does not list the account', async () => {
    const world = await openWorld({ route: 'logged-in', entry: false, countdown: false })
    const reloaded = await mountDone(world.account)
    expect(reloaded.paths()).toEqual(['/social-recovery/recovery/account'])
    expect(reloaded.has('done')).toBe(false)
    expect(dispatchedOf(ADD_ACTION)).toHaveLength(0)
    reloaded.unmount()
  })
})
