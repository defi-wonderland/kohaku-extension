/**
 * @jest-environment jsdom
 *
 * What the done screen says once the consume is read: the lines under the
 * keys by route, what the recovery published and the methods it used (from
 * the opening event's places, else the attempt record's methods against the
 * path), the discoverability and unlinkability lines, and one cleanup block
 * for each passkey of the path by its kind and the path's shape.
 */
import {
  addedAccountOf,
  attemptConsumed,
  attemptStarted,
  BOOK,
  CHAIN_ID,
  configurationOf,
  consumedAttempt,
  GUARDIANS,
  guardianCredential,
  MIXED_PATH,
  mountDone,
  openWorld,
  aadhaarCredential,
  passkeyCredential,
  passportCredential,
  PASSWORD,
  t,
  useDoneClock,
  walletAddsIt
} from '@web/modules/social-recovery/recovery/done/__tests__/harness'
import type { Mounted } from '@web/modules/social-recovery/recovery/done/__tests__/harness'
import type { Configuration, Credential } from '@web/modules/social-recovery/sdk-interfaces'
import {
  renderChip,
  renderFullAddress,
  renderShortAddress
} from '@web/modules/social-recovery/shared/display'
import { kindNameOf } from '@web/modules/social-recovery/setup/review'
import { setRecoveryPassword } from '@web/modules/social-recovery/shared/records'

useDoneClock()

const DONE = 'socialRecovery.done'
const guardianName = (index: number) =>
  `${t('socialRecovery.display.nouns.guardian')} ${renderShortAddress(GUARDIANS[index])}`
const usedLine = (names: string[]) => t(`${DONE}.used`, { methods: names.join(', ') })

const LAPTOP = passkeyCredential('Laptop passkey')

/** The cleanup blocks the screen renders, one card each. */
const blocksOf = (screen: Mounted) => [
  ...screen.allByTestIdPrefix('done-cleanup-synced-'),
  ...screen.allByTestIdPrefix('done-cleanup-device-bound-')
]

/** Opens a logged-in recovery over `configuration` and mounts it. */
const mountOver = async (
  configuration: Configuration,
  options: Parameters<typeof openWorld>[0] = {}
): Promise<{ screen: Mounted; world: Awaited<ReturnType<typeof openWorld>> }> => {
  const world = await openWorld({ route: 'logged-in', configuration, walletAdds: true, ...options })
  return { world, screen: await mountDone(world.account) }
}

describe('the lines under the keys by route', () => {
  it('on the fast track: one fresh key on this device, the account now in this wallet, and the one limit', async () => {
    const world = await openWorld({ route: 'fresh-install' })
    const screen = await mountDone(world.account)
    await walletAddsIt()
    expect(screen.has('plain-chrome')).toBe(true)
    expect(screen.has('setup-chrome')).toBe(false)
    expect(screen.textOf('done-controlled-by-line-0')).toBe(t(`${DONE}.freshKey`))
    expect(screen.textOf('done-controlled-by-line-1')).toBe(t(`${DONE}.keyLimit`))
    expect(screen.textOf('done-now-in-wallet')).toBe(t(`${DONE}.nowInWallet`))
    expect(screen.text()).not.toContain(t(`${DONE}.sharedKey`, { account: 'Account 1' }))
    expect(screen.textOf('done-removed-line-0')).toBe(t(`${DONE}.removedLine`))
    screen.unmount()
  })

  it('on the logged-in route: the receiving account key now shared by two accounts, and the one limit', async () => {
    const { screen } = await mountOver(MIXED_PATH)
    expect(screen.has('setup-chrome')).toBe(true)
    expect(screen.has('plain-chrome')).toBe(false)
    expect(screen.textOf('done-controlled-by-line-0')).toBe(
      t(`${DONE}.sharedKey`, { account: 'Daily account' })
    )
    expect(screen.textOf('done-controlled-by-line-1')).toBe(t(`${DONE}.keyLimit`))
    expect(screen.text()).not.toContain(t(`${DONE}.freshKey`))
    expect(screen.has('done-now-in-wallet')).toBe(false)
    screen.unmount()
  })

  it('shows the account with the name the wallet gives it, with the set-up chip', async () => {
    const added = await mountOver(MIXED_PATH)
    expect(added.screen.textOf('done-account')).toBe(
      t('socialRecovery.display.accountWithName', {
        account: renderFullAddress(added.world.account),
        name: addedAccountOf().preferences.label
      })
    )
    expect(added.screen.textOf('done-chip')).toBe(renderChip('recovery', 'setUp', t))
    added.screen.unmount()

    const listed = await mountOver(MIXED_PATH, { listed: true })
    expect(listed.screen.textOf('done-account')).toBe(
      t('socialRecovery.display.accountWithName', {
        account: renderFullAddress(listed.world.account),
        name: 'Recovered account'
      })
    )
    listed.screen.unmount()
  })
})

describe('what this recovery did', () => {
  it('names the methods used from the places the opening event published', async () => {
    const { screen } = await mountOver(MIXED_PATH)
    expect(screen.textOf('done-published')).toBe(t(`${DONE}.published`))
    expect(screen.textOf('done-used')).toBe(
      usedLine(['Laptop passkey', guardianName(0), guardianName(2)])
    )
    expect(screen.textOf('done-used-published')).toBe(t(`${DONE}.usedPublished`))
    expect(screen.textOf('done-unlinkable')).toBe(t(`${DONE}.unlinkable`))
    expect(screen.textOf('done-later-release')).toBe(t(`${DONE}.laterRelease`))
    screen.unmount()
  })

  it('takes the used methods from the attempt record against the path where the events no longer name the opening', async () => {
    const world = await openWorld({ route: 'logged-in', walletAdds: true })
    world.kit.chain.accountEvents = [attemptConsumed(world.account)]
    world.kit.chain.attempt = consumedAttempt([BOOK.methods.passkey])
    const screen = await mountDone(world.account)
    expect(screen.textOf('done-used')).toBe(usedLine(['Laptop passkey']))
    screen.unmount()
  })

  it('ignores an opening of another attempt', async () => {
    const world = await openWorld({ route: 'logged-in', walletAdds: true })
    world.kit.chain.accountEvents = [
      attemptStarted(world.account, [2, 3, 4], 7n),
      attemptConsumed(world.account)
    ]
    world.kit.chain.attempt = consumedAttempt([BOOK.methods.passkey])
    const screen = await mountDone(world.account)
    expect(screen.textOf('done-used')).toBe(usedLine(['Laptop passkey']))
    screen.unmount()
  })

  it('opens the path with the recovery password held in memory where this device holds no cache', async () => {
    const world = await openWorld({ route: 'logged-in', cache: false, walletAdds: true })
    setRecoveryPassword(CHAIN_ID, world.account, PASSWORD)
    const screen = await mountDone(world.account)
    expect(world.kit.getSetup).toHaveBeenCalledWith({ password: PASSWORD })
    expect(screen.textOf('done-used')).toBe(
      usedLine(['Laptop passkey', guardianName(0), guardianName(2)])
    )
    screen.unmount()
  })

  it('names only the used kinds where this device holds no path', async () => {
    const world = await openWorld({ route: 'logged-in', cache: false, walletAdds: true })
    world.kit.chain.attempt = consumedAttempt([BOOK.methods.passkey, BOOK.methods.ecdsa])
    const screen = await mountDone(world.account)
    expect(world.kit.getSetup).not.toHaveBeenCalled()
    expect(screen.textOf('done-used')).toBe(
      usedLine([kindNameOf('passkey', t), kindNameOf('ecdsa', t)])
    )
    expect(screen.has('done-discoverable')).toBe(true)
    const blocks = blocksOf(screen)
    expect(blocks).toHaveLength(1)
    expect(screen.has('done-synced-title')).toBe(true)
    expect(screen.has('done-cleanup-row')).toBe(false)
    expect(screen.has('done-synced-add-first')).toBe(false)
    expect(screen.has('done-synced-whole-rule')).toBe(false)
    screen.unmount()
  })

  it('says every guardian is discoverable where the path holds an address row, approved or not, and not otherwise', async () => {
    const withGuardian = await mountOver(MIXED_PATH)
    expect(withGuardian.screen.textOf('done-discoverable')).toBe(t(`${DONE}.discoverable`))
    withGuardian.screen.unmount()

    const world = await openWorld({ route: 'logged-in', walletAdds: true })
    world.kit.chain.accountEvents = [
      attemptStarted(world.account, [0]),
      attemptConsumed(world.account)
    ]
    const passkeyOnly = await mountDone(world.account)
    expect(passkeyOnly.textOf('done-used')).toBe(usedLine(['Laptop passkey']))
    expect(passkeyOnly.textOf('done-discoverable')).toBe(t(`${DONE}.discoverable`))
    passkeyOnly.unmount()

    const noGuardian = configurationOf([
      { threshold: 1, credentials: [LAPTOP] },
      { threshold: 1, credentials: [passportCredential()] }
    ])
    const without = await mountOver(noGuardian)
    expect(without.screen.has('done-discoverable')).toBe(false)
    without.screen.unmount()
  })

  it('says an unused passkey stays unguessable only where the recovery did not use it', async () => {
    const used = await mountOver(MIXED_PATH)
    expect(used.screen.has('done-unused-stays')).toBe(false)
    used.screen.unmount()

    const world = await openWorld({ route: 'logged-in', walletAdds: true })
    world.kit.chain.accountEvents = [
      attemptStarted(world.account, [1, 2]),
      attemptConsumed(world.account)
    ]
    const screen = await mountDone(world.account)
    expect(screen.textOf('done-used')).toBe(usedLine([guardianName(0), guardianName(1)]))
    expect(screen.textOf('done-unused-stays')).toBe(t(`${DONE}.unusedStays`))
    screen.unmount()
  })

  it('says the later release never unlinks a passport only where the path holds an identity method', async () => {
    const plain = await mountOver(MIXED_PATH)
    expect(plain.screen.has('done-passport-never')).toBe(false)
    plain.screen.unmount()

    const withIdentity = async (identity: Credential) => {
      const path = configurationOf([
        { threshold: 1, credentials: [guardianCredential(GUARDIANS[0])] },
        { threshold: 1, credentials: [identity] }
      ])
      const { screen } = await mountOver(path)
      expect(screen.textOf('done-passport-never')).toBe(t(`${DONE}.passportNever`))
      screen.unmount()
    }
    await withIdentity(passportCredential())
    await withIdentity(aadhaarCredential())
  })
})

describe('the cleanup block by the path passkeys', () => {
  it('renders the synced repair in its one order, then the cannot-reach exit, in a path of many rows', async () => {
    const { screen } = await mountOver(MIXED_PATH)
    expect(blocksOf(screen)).toHaveLength(1)
    expect(screen.has('done-cleanup-synced-0')).toBe(true)
    expect(screen.textOf('done-synced-title')).toBe(t(`${DONE}.synced.title`))
    expect(screen.textOf('done-cleanup-row')).toBe('Laptop passkey')
    expect(screen.textOf('done-synced-follows')).toBe(t(`${DONE}.synced.follows`))
    expect(screen.textOf('done-synced-order')).toBe(t(`${DONE}.synced.order`))
    expect(screen.textOf('done-cannot-reach')).toContain(t(`${DONE}.synced.cannotReachTitle`))
    expect(screen.textOf('done-cannot-reach-body')).toBe(t(`${DONE}.synced.cannotReachBody`))
    expect(screen.textOf('done-remove-in-editor')).toBe(t(`${DONE}.synced.removeInEditor`))
    expect(screen.textOf('done-editor-shows')).toBe(t(`${DONE}.synced.editorShows`))
    expect(screen.before('done-synced-follows', 'done-synced-order')).toBe(true)
    expect(screen.before('done-synced-order', 'done-cannot-reach')).toBe(true)
    expect(screen.has('done-synced-add-first')).toBe(false)
    expect(screen.has('done-synced-whole-rule')).toBe(false)
    expect(screen.has('done-device-bound-dead')).toBe(false)
    screen.unmount()
  })

  it('asks for a method first where removing the synced passkey would leave none', async () => {
    const { screen } = await mountOver(configurationOf([{ threshold: 1, credentials: [LAPTOP] }]))
    expect(screen.textOf('done-synced-add-first')).toBe(t(`${DONE}.synced.addFirst`))
    expect(screen.has('done-synced-whole-rule')).toBe(false)
    screen.unmount()
  })

  it('names the method that would remain as the whole rule where one row would', async () => {
    const path = configurationOf([
      { threshold: 1, credentials: [LAPTOP] },
      { threshold: 1, credentials: [guardianCredential(GUARDIANS[0])] }
    ])
    const { screen } = await mountOver(path)
    expect(screen.textOf('done-synced-whole-rule')).toBe(
      t(`${DONE}.synced.leavesWholeRule`, { method: guardianName(0) })
    )
    expect(screen.textOf('done-synced-single-method')).toBe(
      t('socialRecovery.ruleLines.singleMethod')
    )
    expect(screen.has('done-synced-add-first')).toBe(false)
    screen.unmount()
  })

  it('reads a passkey whose enrollment names no kind as synced', async () => {
    const path = configurationOf([
      { threshold: 1, credentials: [LAPTOP] },
      { threshold: 1, credentials: [guardianCredential(GUARDIANS[0])] }
    ])
    const { screen } = await mountOver(path, {
      kinds: [{ credential: passkeyCredential('Another', undefined, 40), backup: 'device-bound' }]
    })
    expect(screen.has('done-cleanup-synced-0')).toBe(true)
    expect(screen.has('done-device-bound-dead')).toBe(false)
    screen.unmount()
  })

  it('renders a device-bound passkey as dead, with two required rows', async () => {
    const path = configurationOf([
      { threshold: 1, credentials: [LAPTOP] },
      { threshold: 1, credentials: [guardianCredential(GUARDIANS[0])] }
    ])
    const { screen } = await mountOver(path, {
      kinds: [{ credential: LAPTOP, backup: 'device-bound' }]
    })
    expect(screen.has('done-cleanup-device-bound-0')).toBe(true)
    expect(screen.textOf('done-device-bound-dead')).toBe(t(`${DONE}.deviceBound.dead`))
    expect(screen.textOf('done-twoRequired')).toBe(t(`${DONE}.deviceBound.twoRequired`))
    expect(screen.textOf('done-device-bound-single-method')).toBe(
      t('socialRecovery.ruleLines.singleMethod')
    )
    expect(screen.has('done-groupOfTwo')).toBe(false)
    expect(screen.has('done-synced-title')).toBe(false)
    expect(screen.has('done-synced-order')).toBe(false)
    screen.unmount()
  })

  it('renders a device-bound passkey in a group of two members', async () => {
    const path = configurationOf([
      { threshold: 1, credentials: [LAPTOP, guardianCredential(GUARDIANS[0])] }
    ])
    const { screen } = await mountOver(path, {
      kinds: [{ credential: LAPTOP, backup: 'device-bound' }]
    })
    expect(screen.textOf('done-groupOfTwo')).toBe(t(`${DONE}.deviceBound.groupOfTwo`))
    expect(screen.has('done-twoRequired')).toBe(false)
    screen.unmount()
  })

  it('asks for a method first where the device-bound passkey is the only row', async () => {
    const path = configurationOf([{ threshold: 1, credentials: [LAPTOP] }])
    const { screen } = await mountOver(path, {
      kinds: [{ credential: LAPTOP, backup: 'device-bound' }]
    })
    expect(screen.has('done-device-bound-dead')).toBe(true)
    expect(screen.textOf('done-device-bound-add-first')).toBe(t(`${DONE}.synced.addFirst`))
    expect(screen.has('done-twoRequired')).toBe(false)
    expect(screen.has('done-groupOfTwo')).toBe(false)
    screen.unmount()
  })

  it('renders a device-bound passkey in a larger path as dead alone', async () => {
    const { screen } = await mountOver(MIXED_PATH, {
      kinds: [{ credential: LAPTOP, backup: 'device-bound' }]
    })
    expect(screen.has('done-device-bound-dead')).toBe(true)
    expect(screen.has('done-twoRequired')).toBe(false)
    expect(screen.has('done-groupOfTwo')).toBe(false)
    expect(screen.has('done-device-bound-add-first')).toBe(false)
    expect(screen.has('done-device-bound-single-method')).toBe(false)
    screen.unmount()
  })

  it('renders one block for each passkey, each by its own kind', async () => {
    const phone = passkeyCredential('Phone passkey', undefined, 20)
    const path = configurationOf([
      { threshold: 1, credentials: [LAPTOP] },
      { threshold: 1, credentials: [phone] },
      { threshold: 1, credentials: [guardianCredential(GUARDIANS[0])] }
    ])
    const { screen } = await mountOver(path, {
      kinds: [{ credential: phone, backup: 'device-bound' }]
    })
    expect(screen.has('done-cleanup-synced-0')).toBe(true)
    expect(screen.has('done-cleanup-device-bound-1')).toBe(true)
    expect(blocksOf(screen)).toHaveLength(2)
    screen.unmount()
  })

  it('renders no cleanup block for a path with no passkey', async () => {
    const path = configurationOf([
      {
        threshold: 1,
        credentials: [guardianCredential(GUARDIANS[0]), guardianCredential(GUARDIANS[1])]
      }
    ])
    const { screen } = await mountOver(path)
    expect(blocksOf(screen)).toHaveLength(0)
    expect(screen.has('done-synced-title')).toBe(false)
    expect(screen.has('done-device-bound-dead')).toBe(false)
    screen.unmount()
  })
})

describe('what comes next', () => {
  it('says other doors may exist, the setup survived, the password change, and offers edit and close', async () => {
    const { screen } = await mountOver(MIXED_PATH)
    expect(screen.textOf('done-other-doors')).toBe(t(`${DONE}.otherDoors`))
    expect(screen.textOf('done-survived')).toBe(t(`${DONE}.survived`))
    expect(screen.textOf('done-password-change')).toBe(t(`${DONE}.passwordChange`))
    expect(screen.textOf('done-edit')).toBe(t(`${DONE}.editOrReplace`))
    expect(screen.textOf('done-close')).toBe(t(`${DONE}.close`))
    screen.unmount()
  })
})
