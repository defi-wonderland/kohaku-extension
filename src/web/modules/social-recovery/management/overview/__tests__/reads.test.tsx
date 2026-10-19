/**
 * @jest-environment jsdom
 *
 * The overview over its own reads on a client built over the stand-in's
 * chain: the locked path's password flow, the path a public setup shows with
 * no password, the dormant reading over an open attempt, and a failed setup
 * read that reads as failed with retry, never as not set up.
 */
import type { World } from '@web/modules/social-recovery/management/overview/__fixtures__/types'

jest.mock('viem', () => {
  // eslint-disable-next-line global-require
  const { TextDecoder, TextEncoder } = require('util')
  Object.assign(globalThis, { TextDecoder, TextEncoder })
  return jest.requireActual('viem')
})

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const React: typeof import('react') = require('react')
const harness: typeof import('@web/modules/social-recovery/management/overview/__fixtures__/harness') = require('@web/modules/social-recovery/management/overview/__fixtures__/harness')
const {
  CHAIN_IDS,
  WALLET_RECOVERY_CHAIN
}: typeof import('@web/modules/social-recovery/shared/client') = require('@web/modules/social-recovery/shared/client')
const {
  readRecoveryPassword,
  wipeRecoveryPassword
}: typeof import('@web/modules/social-recovery/shared/records') = require('@web/modules/social-recovery/shared/records')
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

const { mount, t, worldAt, readyOver, ReadsProbe, typeInto, ACCOUNT, PASSWORD, CONFIGURATION } =
  harness
const CHAIN_ID = CHAIN_IDS[WALLET_RECOVERY_CHAIN]
const O = 'socialRecovery.management.overview'

describe('the overview reads', () => {
  let view: Awaited<ReturnType<typeof mount>> | undefined

  afterEach(() => {
    view?.unmount()
    view = undefined
    wipeRecoveryPassword(CHAIN_ID, ACCOUNT)
  })

  const renderOver = async (world: World, onOpen = jest.fn()) =>
    mount(
      <ReadsProbe
        client={readyOver(world.client)}
        records={world.records}
        chainId={CHAIN_ID}
        onOpen={onOpen}
      />
    )

  it('keeps a private path locked until the right recovery password, then shows it and keeps it', async () => {
    const world = await worldAt('private')
    view = await renderOver(world)
    expect(view.byTestId('overview-chip-path-locked')).not.toBeNull()
    expect(view.byTestId('readout-path')).toBeNull()

    await view.press('overview-locked-action')
    await typeInto(view.byTestId('overview-locked-field'), 'not the password')
    await view.press('overview-locked-unlock')
    expect(view.textOf('overview-locked-wrong')).toBe(t(`${O}.locked.wrong`))
    expect(view.byTestId('readout-path')).toBeNull()
    const stillEmpty = await world.records.decryptedSetupCache(CHAIN_ID, ACCOUNT).read()
    expect(stillEmpty.status).toBe('absent')

    await typeInto(view.byTestId('overview-locked-field'), PASSWORD)
    await view.press('overview-locked-unlock')
    expect(view.byTestId('readout-path')).not.toBeNull()
    expect(view.byTestId('overview-chip-path-locked')).toBeNull()
    const kept = await world.records.decryptedSetupCache(CHAIN_ID, ACCOUNT).read()
    expect(kept.status).toBe('present')
    expect(kept.status === 'present' && kept.value.configuration.clauses).toEqual(
      CONFIGURATION.clauses
    )
    expect(readRecoveryPassword(CHAIN_ID, ACCOUNT)).toBe(PASSWORD)
  })

  it('opens the kept setup again with no password', async () => {
    const world = await worldAt('private')
    view = await renderOver(world)
    await view.press('overview-locked-action')
    await typeInto(view.byTestId('overview-locked-field'), PASSWORD)
    await view.press('overview-locked-unlock')
    view.unmount()
    wipeRecoveryPassword(CHAIN_ID, ACCOUNT)

    view = await renderOver(world)
    expect(view.byTestId('readout-path')).not.toBeNull()
    expect(view.byTestId('overview-chip-path-locked')).toBeNull()
  })

  it('shows a public path with no password', async () => {
    const world = await worldAt('public')
    view = await renderOver(world)
    expect(view.byTestId('readout-path')).not.toBeNull()
    expect(view.byTestId('overview-chip-set-up')).not.toBeNull()
  })

  it('reads the dormant setup over an open attempt with no re-authorize', async () => {
    const world = await worldAt('public')
    world.chain.openAttempt()
    world.chain.setAuthorized(false)
    view = await renderOver(world)
    expect(view.byTestId('overview-dormant')).not.toBeNull()
    expect(view.byTestId('overview-reauthorize')).toBeNull()
    expect(view.textOf('overview-dormant-refused')).toBe(t(`${O}.dormant.refused`))
    expect(view.textOf('overview-dormant-pending')).toBe(t(`${O}.dormant.pendingLine`))
  })

  it('offers the re-authorize on a dormant setup with no attempt', async () => {
    const world = await worldAt('public')
    world.chain.setAuthorized(false)
    view = await renderOver(world)
    expect(view.byTestId('overview-reauthorize')).not.toBeNull()
  })

  it('reads a failed setup read as failed with retry, never as not set up', async () => {
    const world = await worldAt('public')
    world.chain.failRead('setup.setupState')
    view = await renderOver(world)
    expect(view.byTestId('overview-read-failed')).not.toBeNull()
    expect(view.byTestId('overview-chip-not-set-up')).toBeNull()

    world.chain.restoreRead('setup.setupState')
    await view.press('overview-read-failed-retry')
    expect(view.byTestId('overview-read-failed')).toBeNull()
    expect(view.byTestId('overview-chip-set-up')).not.toBeNull()
  })

  it('reads an account with no setup as not set up', async () => {
    const world = await worldAt('public')
    world.chain.clearSetup()
    world.chain.setAuthorized(false)
    view = await renderOver(world)
    expect(view.byTestId('overview-empty')).not.toBeNull()
  })
})
