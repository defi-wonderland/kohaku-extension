/**
 * @jest-environment jsdom
 *
 * The readout under each privacy level, read from a setup committed on the
 * stand-in's chain: what renders before the recovery password, the password's
 * blockers, the records an opened setup leaves on this device, the origin read
 * of each passkey, and the states of a read that fails or a setup this build
 * cannot read. Every state says that the account has a recovery setup.
 */
import type { Mounted } from '@web/modules/social-recovery/recovery/entry/__tests__/harness'
import {
  BASIC,
  CARD_PASSWORD,
  CHAIN_ID,
  commitLostSetup,
  deferred,
  failedClient,
  GUARDIANS,
  LOST,
  LOST_SETUP,
  mountReadout,
  NETWORK,
  OTHER_ORIGIN_SETUP,
  outside,
  readoutSearchOf,
  refusedClient,
  resetEdges,
  restoreRefusal,
  setClient,
  shortAddress,
  storedCache,
  storeEntry,
  t
} from '@web/modules/social-recovery/recovery/entry/__tests__/harness'
import type { SetupState } from '@web/modules/social-recovery/sdk-interfaces'
import {
  readRecoveryPassword,
  wipeRecoveryPassword
} from '@web/modules/social-recovery/shared/records'

const NO_SETUP_SENTENCES = [
  t('socialRecovery.entry.noSetup.title', { network: NETWORK }),
  t('socialRecovery.writes.causes.NoSetup')
]
const CONFIGURED_LINES = [
  t('socialRecovery.client.updateTheWalletBody'),
  t('socialRecovery.readout.leadPrivate'),
  t('socialRecovery.readout.leadCommitted'),
  t('socialRecovery.readout.leadUnlocked')
]
const HIDDEN_DOTS = t('socialRecovery.display.hiddenValue')
const HIDDEN_CHIP = t('socialRecovery.display.hiddenChip')
const WAIT_VALUE = t('socialRecovery.display.remainingHours', { count: 120 })
const ORIGIN_MISMATCH = t('socialRecovery.ceremony.relyingPartyMismatch')
const WRONG_PASSWORD = 'ember-harbor-quiet-17'

let screen: Mounted | null = null
const open = async () => {
  screen = await mountReadout(readoutSearchOf(LOST))
  return screen
}

beforeEach(async () => {
  resetEdges()
  wipeRecoveryPassword(CHAIN_ID, LOST)
  wipeRecoveryPassword(CHAIN_ID, BASIC)
  await storeEntry('logged-in')
})
afterEach(() => {
  screen?.unmount()
  screen = null
})

/** The page says the account has a recovery setup and never that it has none. */
const expectConfigured = (page: Mounted) => {
  const text = page.text()
  expect(CONFIGURED_LINES.some((line) => text.includes(line))).toBe(true)
  NO_SETUP_SENTENCES.forEach((sentence) => expect(text).not.toContain(sentence))
}

/** Nothing of the setup renders: no path, no masked row, no value. */
const expectNothingOfTheSetup = (page: Mounted) => {
  expect(page.has('readout-path')).toBe(false)
  const text = page.text()
  expect(text).not.toContain(HIDDEN_DOTS)
  expect(text).not.toContain(WAIT_VALUE)
  GUARDIANS.forEach((guardian) => expect(text).not.toContain(shortAddress(guardian)))
}

/** The setup's values render: the guardians, the passkey's kind and the wait. */
const expectValues = (page: Mounted) => {
  expect(page.has('readout-path')).toBe(true)
  const text = page.text()
  GUARDIANS.forEach((guardian) => expect(text).toContain(shortAddress(guardian)))
  expect(page.textOf('readout-row-0-0-name')).toBe(t('socialRecovery.methodNames.passkey'))
  expect(page.textOf('readout-wait-value')).toBe(WAIT_VALUE)
  expect(text).not.toContain(HIDDEN_DOTS)
}

const unlockWith = async (page: Mounted, password: string) => {
  await page.type('readout-password-field', password)
  await page.press('readout-unlock')
}

describe('the readout at Private', () => {
  it('renders the lock and nothing of the setup before the password', async () => {
    await commitLostSetup('private')
    const page = await open()
    expect(page.has('readout-locked-private')).toBe(true)
    expect(page.text()).toContain(t('socialRecovery.readout.locked.title'))
    expect(page.text()).toContain(t('socialRecovery.readout.locked.enterPassword'))
    expect(page.has('readout-password-field')).toBe(true)
    expect(page.has('readout-continue')).toBe(false)
    expectNothingOfTheSetup(page)
    expectConfigured(page)
  })

  it('keeps unlock off while the field is empty', async () => {
    const world = await commitLostSetup('private')
    const getSetup = jest.spyOn(world.client.setup, 'getSetup')
    const page = await open()
    getSetup.mockClear()
    expect(page.isDisabled('readout-unlock')).toBe(true)
    await page.press('readout-unlock')
    expect(getSetup).not.toHaveBeenCalled()
    expect(page.has('readout-locked')).toBe(true)
  })

  it('shows nothing of the setup while the password is being checked', async () => {
    const world = await commitLostSetup('private')
    const page = await open()
    const held = deferred<void>()
    const real = world.client.setup.getSetup.bind(world.client.setup)
    jest.spyOn(world.client.setup, 'getSetup').mockImplementationOnce(async (source) => {
      await held.promise
      return real(source)
    })
    await unlockWith(page, CARD_PASSWORD)
    expect(page.has('readout-unlock-checking')).toBe(true)
    expectNothingOfTheSetup(page)
    expectConfigured(page)
    await outside(() => held.resolve())
    expectValues(page)
  })

  it('renders a wrong password as a blocker with a retry and the card pointer, never a degrade to hidden values', async () => {
    await commitLostSetup('private')
    const page = await open()
    await unlockWith(page, WRONG_PASSWORD)
    expect(page.has('readout-wrong-password')).toBe(true)
    expect(page.text()).toContain(t('socialRecovery.readout.wrongPassword.title'))
    expect(page.text()).toContain(t('socialRecovery.readout.wrongPassword.cardPointer'))
    expect(page.has('readout-wrong-password-retry')).toBe(true)
    expect(page.has('readout-continue')).toBe(false)
    expectNothingOfTheSetup(page)
    expectConfigured(page)
    expect(readRecoveryPassword(CHAIN_ID, LOST)).toBeUndefined()
    expect(await storedCache()).toBeNull()

    await page.press('readout-wrong-password-retry')
    expect(page.has('readout-password-field')).toBe(true)
    await unlockWith(page, CARD_PASSWORD)
    expectValues(page)
  })

  it('renders the values with the card password, and keeps the password and the opened setup under the account being recovered', async () => {
    const world = await commitLostSetup('private')
    const page = await open()
    await unlockWith(page, CARD_PASSWORD)
    expect(page.has('readout-readable-private')).toBe(true)
    expect(page.text()).toContain(t('socialRecovery.readout.leadUnlocked'))
    expectValues(page)
    expectConfigured(page)

    const state: SetupState = await world.client.setup.setupState()
    expect(readRecoveryPassword(CHAIN_ID, LOST)).toBe(CARD_PASSWORD)
    expect(await storedCache()).toEqual({
      configuration: LOST_SETUP,
      setupNonce: state.setupNonce,
      setupCommitment: state.setupCommitment
    })
    expect(readRecoveryPassword(CHAIN_ID, BASIC)).toBeUndefined()
    expect(await storedCache(BASIC)).toBeNull()
  })

  it('renders a failed setup event read after the card password as its own state naming the network, and its retry opens the setup', async () => {
    const world = await commitLostSetup('private')
    const page = await open()
    world.chain.failRead('events.fetch')
    await unlockWith(page, CARD_PASSWORD)
    expect(page.has('readout-event-failed')).toBe(true)
    expect(page.text()).toContain(t('socialRecovery.readout.readFailedTitle', { network: NETWORK }))
    expect(page.has('readout-wrong-password')).toBe(false)
    expect(page.has('readout-no-details')).toBe(false)
    expectNothingOfTheSetup(page)
    expectConfigured(page)

    world.chain.restoreRead('events.fetch')
    await page.press('readout-event-failed-retry')
    expectValues(page)
    expect(readRecoveryPassword(CHAIN_ID, LOST)).toBe(CARD_PASSWORD)
    expect(await storedCache()).not.toBeNull()
  })
})

describe('the readout at Shape visible', () => {
  it('renders the structure with every value masked and asks the password before continue', async () => {
    await commitLostSetup('shape-visible')
    const page = await open()
    expect(page.has('readout-locked-shape-visible')).toBe(true)
    expect(page.has('readout-path')).toBe(true)
    expect(page.text()).toContain(t('socialRecovery.readout.shapePreview'))
    expect(page.textOf('readout-group-1-threshold')).toBe('2')
    expect(page.textOf('readout-group-1-members')).toBe('3')
    const rows = ['readout-row-0-0', 'readout-row-1-0', 'readout-row-1-1', 'readout-row-1-2']
    rows.forEach((row) => {
      expect(page.textOf(`${row}-name`)).toBe(HIDDEN_DOTS)
      expect(page.textOf(`${row}-chip`)).toBe(HIDDEN_CHIP)
    })
    expect(page.textOf('readout-wait-value')).toBe(HIDDEN_DOTS)
    const text = page.text()
    GUARDIANS.forEach((guardian) => expect(text).not.toContain(shortAddress(guardian)))
    expect(text).not.toContain(WAIT_VALUE)
    expect(page.has('readout-password-field')).toBe(true)
    expect(page.has('readout-continue')).toBe(false)
    expectConfigured(page)
    expect(await storedCache()).toBeNull()

    await unlockWith(page, CARD_PASSWORD)
    expect(page.has('readout-readable-shape-visible')).toBe(true)
    expectValues(page)
    expect(page.has('readout-continue')).toBe(true)
    expect(readRecoveryPassword(CHAIN_ID, LOST)).toBe(CARD_PASSWORD)
    expect(await storedCache()).not.toBeNull()
  })

  it('renders a wrong password as the blocker and keeps the values masked', async () => {
    await commitLostSetup('shape-visible')
    const page = await open()
    await unlockWith(page, WRONG_PASSWORD)
    expect(page.has('readout-wrong-password')).toBe(true)
    expect(page.has('readout-continue')).toBe(false)
    const text = page.text()
    GUARDIANS.forEach((guardian) => expect(text).not.toContain(shortAddress(guardian)))
    expect(text).not.toContain(WAIT_VALUE)
    expectConfigured(page)
  })
})

describe('the readout at Public', () => {
  it('renders the structure and the values with no password and offers continue at once', async () => {
    await commitLostSetup('public')
    const page = await open()
    expect(page.has('readout-readable-public')).toBe(true)
    expect(page.text()).toContain(t('socialRecovery.readout.publicLine'))
    expect(page.has('readout-password-field')).toBe(false)
    expectValues(page)
    expect(page.has('readout-continue')).toBe(true)
    expect(page.isDisabled('readout-continue')).toBe(false)
    expect(page.textOf('readout-continue-line')).toBe(
      t('socialRecovery.readout.continueLine', { hours: 24 })
    )
    expect(page.text()).toContain(t('socialRecovery.readout.answerWhichever'))
    expectConfigured(page)
  })

  it('keeps the opened setup under the account being recovered and sets no password', async () => {
    const world = await commitLostSetup('public')
    await open()
    const state: SetupState = await world.client.setup.setupState()
    expect(await storedCache()).toEqual({
      configuration: LOST_SETUP,
      setupNonce: state.setupNonce,
      setupCommitment: state.setupCommitment
    })
    expect(await storedCache(BASIC)).toBeNull()
    expect(readRecoveryPassword(CHAIN_ID, LOST)).toBeUndefined()
  })
})

describe("the passkey's origin", () => {
  it('marks a passkey created under another origin once the values are readable', async () => {
    await commitLostSetup('public', OTHER_ORIGIN_SETUP)
    const page = await open()
    expect(page.textOf('readout-row-0-0-line-0')).toBe(ORIGIN_MISMATCH)
  })

  it('marks a passkey of another origin after the card password opens a private setup', async () => {
    await commitLostSetup('private', OTHER_ORIGIN_SETUP)
    const page = await open()
    expect(page.text()).not.toContain(ORIGIN_MISMATCH)
    await unlockWith(page, CARD_PASSWORD)
    expect(page.textOf('readout-row-0-0-line-0')).toBe(ORIGIN_MISMATCH)
  })

  it('leaves a passkey created under this origin unmarked', async () => {
    await commitLostSetup('public')
    const page = await open()
    expect(page.has('readout-row-0-0')).toBe(true)
    expect(page.text()).not.toContain(ORIGIN_MISMATCH)
  })
})

describe('the reads that fail and the setups this build cannot read', () => {
  it('shows the read running, then the setup, never an answer before it', async () => {
    const world = await commitLostSetup('private')
    const held = deferred<void>()
    const real = world.client.setup.setupState.bind(world.client.setup)
    jest.spyOn(world.client.setup, 'setupState').mockImplementationOnce(async () => {
      await held.promise
      return real()
    })
    const page = await open()
    expect(page.has('readout-reading')).toBe(true)
    expect(page.text()).toContain(t('socialRecovery.readout.reading', { network: NETWORK }))
    expect(page.has('readout-locked')).toBe(false)
    expectConfigured(page)
    await outside(() => held.resolve())
    expect(page.has('readout-locked-private')).toBe(true)
  })

  it('renders a failed setup state read with the network and a retry, never as no setup', async () => {
    const world = await commitLostSetup('private')
    world.chain.failRead('setup.setupState')
    const page = await open()
    expect(page.has('readout-read-failed')).toBe(true)
    expect(page.text()).toContain(t('socialRecovery.readout.readFailedTitle', { network: NETWORK }))
    expectNothingOfTheSetup(page)
    expectConfigured(page)

    world.chain.restoreRead('setup.setupState')
    await page.press('readout-read-failed-block-retry')
    expect(page.has('readout-locked-private')).toBe(true)
  })

  it('renders a client that failed to build with a retry, never as no setup', async () => {
    setClient(LOST, failedClient(LOST))
    const page = await open()
    expect(page.has('readout-read-failed')).toBe(true)
    expect(page.has('readout-read-failed-block-retry')).toBe(true)
    expectConfigured(page)
  })

  it('renders update the wallet for a manager whose digest version this build refuses', async () => {
    setClient(LOST, refusedClient())
    const page = await open()
    expect(page.has('readout-update-the-wallet')).toBe(true)
    expect(page.text()).toContain(t('socialRecovery.client.updateTheWalletTitle'))
    expect(page.text()).toContain(t('socialRecovery.client.updateTheWalletAction'))
    expect(page.has('readout-password-field')).toBe(false)
    expectConfigured(page)
  })

  it('renders update the wallet for a backup whose format this build cannot read', async () => {
    const world = await commitLostSetup('private')
    jest
      .spyOn(world.client.setup, 'getSetup')
      .mockRejectedValue(
        restoreRefusal('restore.backup-unopened', { reason: 'unknown-version', version: 9 })
      )
    const page = await open()
    expect(page.has('readout-update-the-wallet')).toBe(true)
    expect(page.text()).toContain(t('socialRecovery.client.updateTheWalletTitle'))
    expect(page.has('readout-password-field')).toBe(false)
    expectNothingOfTheSetup(page)
    expectConfigured(page)
  })

  it('renders a setup with no backup this device can open as its own state, never as no setup', async () => {
    const world = await commitLostSetup('private')
    jest
      .spyOn(world.client.setup, 'getSetup')
      .mockRejectedValue(restoreRefusal('restore.no-backup', { setup: 'standing', backup: 'none' }))
    const page = await open()
    expect(page.has('readout-no-details')).toBe(true)
    expect(page.text()).toContain(t('socialRecovery.readout.noDetails'))
    expectNothingOfTheSetup(page)
    expectConfigured(page)
  })

  it('renders an opened setup that does not match the commitment as its own state, with no value', async () => {
    const world = await commitLostSetup('private')
    const page = await open()
    jest
      .spyOn(world.client.setup, 'getSetup')
      .mockRejectedValue(restoreRefusal('restore.commitment-mismatch'))
    await unlockWith(page, CARD_PASSWORD)
    expect(page.has('readout-mismatch')).toBe(true)
    expect(page.text()).toContain(t('socialRecovery.readout.detailsMismatch', { network: NETWORK }))
    expectNothingOfTheSetup(page)
    expectConfigured(page)
    expect(await storedCache()).toBeNull()
  })
})
