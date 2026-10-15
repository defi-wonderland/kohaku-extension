/**
 * @jest-environment jsdom
 */
import type { CancelState, CancelViewProps } from '@web/modules/social-recovery/cancel'
import type { WatcherReading } from '@web/modules/social-recovery/watcher'

jest.mock('viem', () => {
  // eslint-disable-next-line global-require
  const { TextDecoder, TextEncoder } = require('util')
  Object.assign(globalThis, { TextDecoder, TextEncoder })
  return jest.requireActual('viem')
})
jest.mock('viem/chains', () => {
  // eslint-disable-next-line global-require
  const { TextDecoder, TextEncoder } = require('util')
  Object.assign(globalThis, { TextDecoder, TextEncoder })
  return jest.requireActual('viem/chains')
})
jest.mock('@common/utils/clipboard', () => ({ setStringAsync: async () => true }))

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const React: typeof import('react') = require('react')
const fixtures: typeof import('@web/modules/social-recovery/cancel/__fixtures__/mount') = require('@web/modules/social-recovery/cancel/__fixtures__/mount')
const watcherFixtures: typeof import('@web/modules/social-recovery/watcher/__fixtures__/harness') = require('@web/modules/social-recovery/watcher/__fixtures__/harness')
const runFixtures: typeof import('@web/modules/social-recovery/cancel/__fixtures__/run') = require('@web/modules/social-recovery/cancel/__fixtures__/run')
const display: typeof import('@web/modules/social-recovery/shared/display') = require('@web/modules/social-recovery/shared/display')
const {
  accountBatchRefusal
}: typeof import('@web/modules/social-recovery/shared/client') = require('@web/modules/social-recovery/shared/client')
const {
  initialCancelState
}: typeof import('@web/modules/social-recovery/cancel') = require('@web/modules/social-recovery/cancel')
const CancelView: typeof import('@web/modules/social-recovery/cancel/CancelView').default =
  require('@web/modules/social-recovery/cancel/CancelView').default
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

const { mount, t } = fixtures
const { ACCOUNT, NEW_KEY, HEAD, HEAD_TIME, ENDED_TIME } = watcherFixtures
const { TX_HASH, SHORT } = runFixtures
const ZONE = 'UTC'

const OPEN: WatcherReading = {
  account: ACCOUNT,
  block: { number: HEAD, timestamp: HEAD_TIME },
  hasSetup: true,
  dormant: false,
  attempt: {
    attemptId: 4n,
    setupNonce: 1n,
    payloadHash: `0x${'11'.repeat(32)}`,
    consumableAfter: HEAD_TIME + 3600,
    executionDue: false,
    newKey: NEW_KEY
  }
}

const endedBy = (ended: NonNullable<WatcherReading['ended']>): WatcherReading => ({
  ...OPEN,
  attempt: undefined,
  ended
})

const RECEIPT = { transactionHash: TX_HASH, status: 0 as const, blockNumber: HEAD + 1 }

const withWrite = (write: CancelState['write'], rest: Partial<CancelState> = {}): CancelState => ({
  ...initialCancelState(),
  target: 4n,
  write,
  ...rest
})

describe('the cancel screen', () => {
  let props: CancelViewProps
  let view: Awaited<ReturnType<typeof mount>> | undefined

  beforeEach(() => {
    props = {
      read: { status: 'read', arrival: { reading: OPEN, target: 4n } },
      run: initialCancelState(),
      readiness: 'ready',
      timeZone: ZONE,
      onRetryRead: jest.fn(),
      onRetryReady: jest.fn(),
      onSend: jest.fn(),
      onRecheck: jest.fn(),
      onCheckAgain: jest.fn(),
      onBack: jest.fn(),
      onDone: jest.fn(),
      onMoveFunds: jest.fn()
    }
  })

  afterEach(() => {
    view?.unmount()
    view = undefined
  })

  const render = (overrides: Partial<CancelViewProps> = {}) =>
    mount(<CancelView {...props} {...overrides} />)

  it('confirms with the attempt facts, the one transaction and the only-own-key line', async () => {
    view = await render()

    expect(view.textOf('cancel-confirm-title')).toBe(t('socialRecovery.cancel.confirm.title'))
    expect(view.textOf('cancel-confirm-lead')).toBe(t('socialRecovery.cancel.confirm.lead'))
    expect(view.textOf('cancel-confirm-one-transaction')).toBe(
      t('socialRecovery.cancel.confirm.oneTransaction')
    )
    expect(view.textOf('cancel-new-key')).toBe(display.renderFullAddress(NEW_KEY))
    expect(view.textOf('cancel-finishes')).toBe(
      t('socialRecovery.watcher.banner.finishes', {
        date: display.renderDateTimeInZone((HEAD_TIME + 3600) * 1000, ZONE).date
      })
    )
    expect(view.textOf('cancel-only-own-key')).toBe(t('socialRecovery.watcher.banner.onlyOwnKey'))
    expect(view.textOf('cancel-back')).toBe(t('socialRecovery.cancel.confirm.back'))

    await view.press('cancel-send')
    expect(props.onSend).toHaveBeenCalledWith(4n)
  })

  it('keeps the send closed while the client failed to load, with a retry', async () => {
    view = await render({ readiness: 'failed' })

    expect(view.isDisabled('cancel-send')).toBe(true)
    expect(view.textOf('cancel-ready-failed-line')).toBe(
      t('socialRecovery.cancel.confirm.readFailed')
    )
    await view.press('cancel-ready-retry')
    expect(props.onRetryReady).toHaveBeenCalled()
  })

  it('refuses an attempt already ended by another road, naming it, and sends nothing', async () => {
    view = await render({
      read: {
        status: 'read',
        arrival: {
          reading: endedBy({ attemptId: 4n, road: 'cancelled', cancelledBy: 'cancelByProofs' }),
          target: 4n
        }
      }
    })

    expect(view.textOf('cancel-ended-line')).toBe(t('socialRecovery.cancel.confirm.ended'))
    expect(view.textOf('cancel-ended-road')).toBe(
      t('socialRecovery.writes.cancelGoneRoad.cancelByProofs')
    )
    expect(view.byTestId('cancel-send')).toBeNull()
  })

  it('names the controller where the attempt executed, and a newer attempt is not the one confirmed', async () => {
    view = await render({
      read: {
        status: 'read',
        arrival: {
          reading: endedBy({
            attemptId: 4n,
            road: 'executed',
            controller: NEW_KEY,
            at: ENDED_TIME
          }),
          target: 4n
        }
      }
    })
    expect(view.textOf('cancel-ended-controller')).toBe(display.renderFullAddress(NEW_KEY))
    view.unmount()

    view = await render({
      read: {
        status: 'read',
        arrival: { reading: { ...OPEN, attempt: { ...OPEN.attempt!, attemptId: 5n } }, target: 4n }
      }
    })
    expect(view.textOf('cancel-ended-line')).toBe(t('socialRecovery.cancel.confirm.ended'))
    expect(view.byTestId('cancel-send')).toBeNull()
  })

  it('reads a failed read as failed, with the retry, and sends nothing', async () => {
    view = await render({ read: { status: 'failed' } })

    expect(view.textOf('cancel-read-failed-line')).toBe(
      t('socialRecovery.cancel.confirm.readFailed')
    )
    expect(view.byTestId('cancel-send')).toBeNull()
    await view.press('cancel-read-retry')
    expect(props.onRetryRead).toHaveBeenCalled()
  })

  it('shows the deposit step for the account key with both routes, and checks again on continue', async () => {
    view = await render({
      run: withWrite({
        status: 'needsDeposit',
        write: 'cancel',
        run: 1,
        step: SHORT.kind === 'deposit' ? SHORT.step : (undefined as never)
      })
    })

    expect(view.text()).toContain(t('socialRecovery.writes.gas.notEnoughGasAccountKey'))
    expect(view.text()).toContain(t('socialRecovery.writes.gas.shortfallCancel'))
    expect(view.byTestId('cancel-gas-route-transfer')).not.toBeNull()
    expect(view.byTestId('cancel-gas-route-outside')).not.toBeNull()
    await view.press('cancel-gas-continue')
    expect(props.onRecheck).toHaveBeenCalled()
  })

  it('reads the cancel in progress while it is on its way', async () => {
    view = await render({
      run: withWrite({ status: 'submitting', write: 'cancel', run: 1, transactionHash: TX_HASH })
    })

    expect(view.text()).toContain(t('socialRecovery.cancel.inProgress.title'))
    expect(view.text()).toContain(t('socialRecovery.cancel.inProgress.body'))
    expect(view.byTestId('cancel-check-again')).toBeNull()
  })

  it('reads in progress, never cancelled, after a landing the read does not confirm yet', async () => {
    view = await render({
      run: withWrite(
        {
          status: 'landed',
          write: 'cancel',
          run: 1,
          transactionHash: TX_HASH,
          receipt: { ...RECEIPT, status: 1 }
        },
        { after: { stage: 'unread' } }
      )
    })

    expect(view.text()).toContain(t('socialRecovery.cancel.inProgress.title'))
    expect(view.byTestId('cancel-cancelled')).toBeNull()
    await view.press('cancel-check-again')
    expect(props.onCheckAgain).toHaveBeenCalled()
  })

  it('reads not sent with the retry and move funds', async () => {
    view = await render({
      run: withWrite({
        status: 'failedNotSent',
        write: 'cancel',
        run: 1,
        error: accountBatchRefusal('refused', ACCOUNT)
      })
    })

    expect(view.text()).toContain(t('socialRecovery.cancel.failed.title'))
    expect(view.text()).toContain(t('socialRecovery.cancel.failed.body'))
    expect(view.text()).toContain(t('socialRecovery.writes.tryAgain'))
    expect(view.textOf('cancel-move-funds')).toBe(t('socialRecovery.cancel.failed.moveFunds'))
  })

  it('reads a revert after an execution as nothing left to cancel, naming the controller, with move funds', async () => {
    view = await render({
      run: withWrite({
        status: 'failedReverted',
        write: 'cancel',
        run: 1,
        transactionHash: TX_HASH,
        receipt: RECEIPT,
        cause: { kind: 'attemptGone', ended: 'executed', controller: NEW_KEY }
      })
    })

    expect(view.text()).toContain(t('socialRecovery.writes.cancelRevertedTitle'))
    expect(view.text()).toContain(display.renderFullAddress(NEW_KEY))
    expect(view.textOf('cancel-move-funds')).toBe(t('socialRecovery.cancel.reverted.moveFunds'))
    expect(view.text()).not.toContain(t('socialRecovery.writes.tryAgain'))
  })

  it('reads a revert after another road with that road and no move funds', async () => {
    view = await render({
      run: withWrite({
        status: 'failedReverted',
        write: 'cancel',
        run: 1,
        transactionHash: TX_HASH,
        receipt: RECEIPT,
        cause: { kind: 'attemptGone', ended: 'cancelByProofs' }
      })
    })

    expect(view.text()).toContain(t('socialRecovery.writes.cancelGoneRoad.cancelByProofs'))
    expect(view.byTestId('cancel-move-funds')).toBeNull()
  })

  it('ends on the cancelled terminal with its lines, move funds and done, and no action to the editor', async () => {
    view = await render({
      run: withWrite(
        {
          status: 'landed',
          write: 'cancel',
          run: 1,
          transactionHash: TX_HASH,
          receipt: { ...RECEIPT, status: 1 }
        },
        { after: { stage: 'cancelled' } }
      )
    })

    expect(view.textOf('cancel-cancelled-eyebrow')).toBe(
      t('socialRecovery.cancel.cancelled.eyebrow')
    )
    expect(view.textOf('cancel-cancelled-title')).toBe(t('socialRecovery.cancel.cancelled.title'))
    expect(view.textOf('cancel-cancelled-body')).toBe(t('socialRecovery.cancel.cancelled.body'))
    expect(view.textOf('cancel-cancelled-only-own-key')).toBe(
      t('socialRecovery.watcher.banner.onlyOwnKey')
    )
    expect(view.textOf('cancel-cancelled-replace-later')).toBe(
      t('socialRecovery.cancel.cancelled.replaceLater')
    )
    const actions = Array.from(document.querySelectorAll('[tabindex]')).map(
      (node) => node.textContent
    )
    expect(actions).not.toContain(t('socialRecovery.cancel.cancelled.replace'))
    expect(actions).toEqual(
      expect.arrayContaining([
        t('socialRecovery.cancel.cancelled.moveFunds'),
        t('socialRecovery.cancel.cancelled.done')
      ])
    )
    expect(view.textOf('cancel-move-funds')).toBe(t('socialRecovery.cancel.cancelled.moveFunds'))
    expect(view.textOf('cancel-done')).toBe(t('socialRecovery.cancel.cancelled.done'))

    await view.press('cancel-move-funds')
    expect(props.onMoveFunds).toHaveBeenCalled()
    await view.press('cancel-done')
    expect(props.onDone).toHaveBeenCalled()
  })

  it('names the other road that ended the attempt first, with done and no move funds', async () => {
    view = await render({
      run: withWrite(
        {
          status: 'landed',
          write: 'cancel',
          run: 1,
          transactionHash: TX_HASH,
          receipt: { ...RECEIPT, status: 1 }
        },
        { after: { stage: 'otherRoad', road: 'setupWrite' } }
      )
    })

    expect(view.textOf('cancel-other-road')).toBe(
      t('socialRecovery.cancel.cancelled.otherRoad', {
        road: t('socialRecovery.writes.cancelGoneRoad.setupWrite')
      })
    )
    expect(view.byTestId('cancel-move-funds')).toBeNull()
    expect(view.byTestId('cancel-done')).not.toBeNull()
  })
})
