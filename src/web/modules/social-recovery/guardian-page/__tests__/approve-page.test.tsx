/**
 * @jest-environment jsdom
 *
 * The approval page as a guardian opens it: the lead with the four values in
 * full, verify the details, the states drawn in place of the sign action, the
 * gates of the sign action, the re-read every minute and the decline.
 */
import type {
  ApproverRequest,
  Notification,
  RecoveryState
} from '@web/modules/social-recovery/sdk-interfaces'

import {
  ACCOUNT,
  ACCOUNT_FILTER,
  advance,
  clientAccounts,
  CREATED_AT,
  DESCRIPTOR,
  descriptionOf,
  kit,
  linkOf,
  MANAGER,
  mountLive,
  mountPage,
  navigate,
  NEW_KEY,
  PAYEE,
  PAYLOAD,
  readyClient,
  recoveryStateOf,
  REMOVED_KEY,
  requestOf,
  resetEdges,
  searchOf,
  setClient,
  settle,
  startedLogOf,
  SUBMITTED,
  t,
  unmountPages,
  VALID_UNTIL,
  WAIT_ENDS_AT
} from '@web/modules/social-recovery/guardian-page/__tests__/harness'
import { LOG_CHUNK_BLOCKS } from '@web/modules/social-recovery/shared/client/kit/events'

const PAGE = 'socialRecovery.guardianPage'
const MINUTE = 60_000
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const dateOf = (ms: number) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
    timeZoneName: 'short'
  }).format(new Date(ms))

beforeEach(resetEdges)
afterEach(() => {
  unmountPages()
  jest.useRealTimers()
})

describe('the lead of a live request', () => {
  it('renders who asks, the four values in full and every line of the lead', async () => {
    const page = await mountLive()
    expect(page.textOf('guardian-brand')).toBe(t(`${PAGE}.brand`))
    expect(page.textOf('guardian-lead-title')).toBe(t(`${PAGE}.lead.title`))
    expect(page.textOf('guardian-value-accountBeingRecovered')).toBe(ACCOUNT)
    expect(page.textOf('guardian-value-newKey')).toBe(NEW_KEY)
    expect(page.textOf('guardian-value-keyBeingRemoved')).toBe(REMOVED_KEY)
    expect(page.textOf('guardian-value-payment')).toBe(t('socialRecovery.display.values.noPayment'))
    const lines = [
      ['guardian-lead-effect', `${PAGE}.lead.effect`],
      ['guardian-lead-publication', `${PAGE}.lead.publication`],
      ['guardian-lead-path-public', `${PAGE}.lead.pathPublic`],
      ['guardian-lead-submittable', 'socialRecovery.checklist.submittable'],
      ['guardian-lead-no-forward', `${PAGE}.lead.noForward`],
      ['guardian-lead-compare', `${PAGE}.lead.compare`]
    ]
    lines.forEach(([id, key]) => {
      expect({ id, text: page.textOf(id) }).toEqual({ id, text: t(key) })
    })
    page.unmount()
  })

  it('renders the new key whole, never shortened and never as a hash', async () => {
    const page = await mountLive()
    const shown = page.textOf('guardian-value-newKey')
    expect(shown).toBe(NEW_KEY)
    expect(shown).toHaveLength(42)
    expect(shown).not.toContain('…')
    page.unmount()
  })

  it('opens verify the details on the deadline, the numbers, the network and the registry', async () => {
    const page = await mountLive()
    expect(page.has('guardian-details-rows')).toBe(false)
    await page.press('guardian-verify-details')
    expect(page.textOf('guardian-details-deadline')).toBe(
      t(`${PAGE}.details.validUntil`, {
        date: dateOf(VALID_UNTIL * 1000),
        remaining: t('socialRecovery.display.remainingHours', { count: 24 })
      })
    )
    expect(page.textOf('guardian-details-setup-number')).toBe('2')
    expect(page.textOf('guardian-details-attempt-number')).toBe('3')
    expect(page.textOf('guardian-details-network')).toBe('Sepolia')
    expect(page.textOf('guardian-details-registry')).toBe(MANAGER)
    page.unmount()
  })

  it('renders the handover as not readable where the orchestrator could not decode it', async () => {
    kit.describeRequest.mockImplementation((request) =>
      descriptionOf(request, { handover: { decoded: false } })
    )
    const page = await mountLive()
    expect(page.has('guardian-value-newKey')).toBe(false)
    expect(page.textOf('guardian-value-newKey-unreadable')).toBe(t(`${PAGE}.notReadable`))
    expect(page.textOf('guardian-value-keyBeingRemoved-unreadable')).toBe(t(`${PAGE}.notReadable`))
    await page.press('guardian-acknowledge')
    expect(page.isDisabled('guardian-sign')).toBe(true)
    page.unmount()
  })

  it('renders a payment with an amount as not readable and keeps the sign action disabled', async () => {
    kit.describeRequest.mockImplementation((request) =>
      descriptionOf(request, { order: { token: PAYEE, amount: 5_000_000n, payee: PAYEE } })
    )
    const page = await mountLive()
    expect(page.has('guardian-value-payment')).toBe(false)
    expect(page.textOf('guardian-value-payment-unreadable')).toBe(t(`${PAGE}.notReadable`))
    expect(page.textOf('guardian-value-newKey')).toBe(NEW_KEY)
    await page.press('guardian-acknowledge')
    expect(page.isDisabled('guardian-sign')).toBe(true)
    page.unmount()
  })
})

describe('the sign action', () => {
  it('stays disabled with the line asking for the tick until the box is ticked', async () => {
    const page = await mountLive()
    expect(page.isDisabled('guardian-sign')).toBe(true)
    expect(page.textOf('guardian-tick-first')).toBe(t(`${PAGE}.acknowledgment.tickFirst`))
    expect(page.textOf('guardian-acknowledgment')).toContain(t(`${PAGE}.acknowledgment.label`))
    expect(page.textOf('guardian-acknowledgment-own-number')).toBe(
      t(`${PAGE}.acknowledgment.ownNumber`)
    )
    expect(page.textOf('guardian-acknowledgment-received')).toBe(
      t(`${PAGE}.acknowledgment.received`)
    )
    await page.press('guardian-acknowledge')
    expect(page.isDisabled('guardian-sign')).toBe(false)
    expect(page.has('guardian-tick-first')).toBe(false)
    page.unmount()
  })

  it('stays disabled with the box ticked while the account does not authorize the action', async () => {
    kit.isAuthorized.mockImplementation(async () => false)
    const page = await mountLive()
    expect(page.textOf('guardian-dormant')).toBe(t(`${PAGE}.dormant`))
    expect(page.textOf('guardian-value-newKey')).toBe(NEW_KEY)
    await page.press('guardian-acknowledge')
    expect(page.isDisabled('guardian-sign')).toBe(true)
    page.unmount()
  })

  it('turns disabled once a later read fails, and draws the failed read', async () => {
    const page = await mountLive()
    await page.press('guardian-acknowledge')
    expect(page.isDisabled('guardian-sign')).toBe(false)
    kit.recoveryState.mockImplementation(async () => {
      throw new Error('rpc down')
    })
    await advance(MINUTE)
    expect(page.has('guardian-read-failed')).toBe(true)
    expect(page.isDisabled('guardian-sign')).toBe(true)
    page.unmount()
  })

  it('keeps the values and the tick through a failed re-read, and opens again once a read answers', async () => {
    const page = await mountLive()
    await page.press('guardian-acknowledge')
    kit.recoveryState.mockImplementation(async () => {
      throw new Error('rpc down')
    })
    await advance(MINUTE)
    expect(page.has('guardian-read-failed')).toBe(true)
    expect(page.textOf('guardian-value-newKey')).toBe(NEW_KEY)
    expect(page.has('guardian-acknowledge')).toBe(false)
    kit.recoveryState.mockImplementation(async () => recoveryStateOf())
    await page.press('guardian-read-retry')
    expect(page.has('guardian-read-failed')).toBe(false)
    expect(page.has('guardian-tick-first')).toBe(false)
    expect(page.isDisabled('guardian-sign')).toBe(false)
    page.unmount()
  })
  it('drops the tick when another request for the same account opens in the same tab', async () => {
    const otherKey = '0x5000000000000000000000000000000000000042'
    kit.describeRequest.mockImplementation((request) =>
      request.payload === PAYLOAD
        ? descriptionOf(request)
        : descriptionOf(request, {
            handover: {
              decoded: true,
              value: { newAuthority: otherKey, removedAuthority: REMOVED_KEY }
            }
          })
    )
    const page = await mountLive()
    await page.press('guardian-acknowledge')
    expect(page.isDisabled('guardian-sign')).toBe(false)
    expect(kit.recoveryState).toHaveBeenCalledTimes(1)
    await navigate(searchOf(linkOf(requestOf({ payload: '0x123456', salt: '0x03' }))))
    expect(kit.recoveryState).toHaveBeenCalledTimes(2)
    expect(kit.isAuthorized).toHaveBeenCalledTimes(2)
    expect(page.textOf('guardian-value-newKey')).toBe(otherKey)
    expect(page.has('guardian-tick-first')).toBe(true)
    expect(page.isDisabled('guardian-sign')).toBe(true)
    await page.press('guardian-acknowledge')
    expect(page.isDisabled('guardian-sign')).toBe(false)
    page.unmount()
  })
})

describe('the states in place of the sign action', () => {
  const deaths = [
    {
      name: 'void',
      state: () => recoveryStateOf({ nextAttemptId: 4n }),
      title: `${PAGE}.dead.voidTitle`,
      body: `${PAGE}.dead.voidBody`
    },
    {
      name: 'setup-changed',
      state: () => recoveryStateOf({ setupNonce: 3n }),
      title: `${PAGE}.dead.changedTitle`,
      body: `${PAGE}.dead.changedBody`
    }
  ]
  deaths.forEach(({ name, state, title, body }) =>
    it(`draws ${name} with its lines, the line to tell the owner and close`, async () => {
      kit.recoveryState.mockImplementation(async () => state())
      const page = await mountLive()
      expect(page.has(`guardian-dead-${name}`)).toBe(true)
      expect(page.textOf('guardian-dead-title')).toBe(t(title))
      expect(page.textOf('guardian-dead-body')).toBe(t(body))
      expect(page.textOf('guardian-tell-owner')).toBe(t(`${PAGE}.dead.tellOwner`))
      expect(page.has('guardian-sign')).toBe(false)
      expect(page.textOf('guardian-value-newKey')).toBe(NEW_KEY)
      page.unmount()
    })
  )

  it('draws the request the recoverer submitted as used once its recovery ended, never as void', async () => {
    const ended = ['Cancelled', 'Consumed'] as const
    // eslint-disable-next-line no-restricted-syntax
    for (const state of ended) {
      kit.recoveryState.mockImplementation(async () =>
        recoveryStateOf({ attempt: { ...SUBMITTED, state }, nextAttemptId: 4n, setupNonce: 3n })
      )
      // eslint-disable-next-line no-await-in-loop
      const page = await mountLive()
      expect({ state, used: page.has('guardian-dead-used') }).toEqual({ state, used: true })
      expect(page.textOf('guardian-dead-title')).toBe(t(`${PAGE}.dead.usedTitle`))
      expect(page.textOf('guardian-dead-body')).toBe(t(`${PAGE}.dead.usedBody`))
      expect(page.textOf('guardian-tell-owner')).toBe(t(`${PAGE}.dead.tellOwner`))
      expect(page.has('guardian-close')).toBe(true)
      expect(page.has('guardian-dead-void')).toBe(false)
      expect(page.has('guardian-sign')).toBe(false)
      page.unmount()
    }
  })

  it('draws expired once the deadline passes on the open page', async () => {
    const page = await mountLive(requestOf({ validUntil: String(CREATED_AT + 90) }))
    expect(page.has('guardian-sign')).toBe(true)
    await advance(MINUTE)
    expect(page.has('guardian-sign')).toBe(true)
    await advance(31_000)
    expect(page.has('guardian-dead-expired')).toBe(true)
    expect(page.textOf('guardian-dead-title')).toBe(t(`${PAGE}.dead.expiredTitle`))
    expect(page.textOf('guardian-dead-body')).toBe(t(`${PAGE}.dead.expiredBody`))
    expect(page.has('guardian-sign')).toBe(false)
    page.unmount()
  })

  it('draws a submitted request as waiting until its end, with the dormant line where it applies', async () => {
    kit.recoveryState.mockImplementation(async () =>
      recoveryStateOf({ attempt: SUBMITTED, nextAttemptId: 4n })
    )
    kit.isAuthorized.mockImplementation(async () => false)
    const page = await mountLive()
    expect(page.textOf('guardian-waiting-title')).toBe(t(`${PAGE}.waiting.title`))
    expect(page.textOf('guardian-waiting-headline')).toBe(t(`${PAGE}.waiting.headline`))
    expect(page.textOf('guardian-waiting-body')).toBe(
      t(`${PAGE}.waiting.body`, { date: dateOf(WAIT_ENDS_AT * 1000) })
    )
    expect(page.textOf('guardian-dormant')).toBe(t(`${PAGE}.dormant`))
    expect(page.textOf('guardian-tell-owner')).toBe(t(`${PAGE}.dead.tellOwner`))
    expect(page.has('guardian-dead-void')).toBe(false)
    expect(page.has('guardian-sign')).toBe(false)
    page.unmount()
  })

  it('draws a submitted request whose waiting period is over with the date it ended', async () => {
    const endedAt = CREATED_AT - 60
    kit.recoveryState.mockImplementation(async () =>
      recoveryStateOf({ attempt: { ...SUBMITTED, consumableAfter: endedAt }, nextAttemptId: 4n })
    )
    const page = await mountLive()
    expect(page.textOf('guardian-waiting-headline')).toBe(t(`${PAGE}.waiting.headline`))
    expect(page.textOf('guardian-waiting-body')).toBe(
      t(`${PAGE}.waiting.bodyEnded`, { date: dateOf(endedAt * 1000) })
    )
    expect(page.has('guardian-sign')).toBe(false)
    page.unmount()
  })

  it('draws the reading state in place of the sign action, below the link values, with sign disabled', async () => {
    kit.recoveryState.mockImplementation(() => new Promise(() => {}))
    const page = await mountLive()
    expect(page.textOf('guardian-reading')).toBe(t(`${PAGE}.reading`))
    expect(page.has('guardian-lead')).toBe(true)
    expect(page.textOf('guardian-value-newKey')).toBe(NEW_KEY)
    expect(page.has('guardian-details')).toBe(true)
    expect(page.has('guardian-acknowledge')).toBe(false)
    expect(page.isDisabled('guardian-sign')).toBe(true)
    expect(page.has('guardian-dead-expired')).toBe(false)
    page.unmount()
  })

  it('keeps the link values while the client is built again', async () => {
    const page = await mountLive()
    setClient({ status: 'loading', retry: () => {} })
    expect(page.has('guardian-reading')).toBe(true)
    expect(page.textOf('guardian-value-newKey')).toBe(NEW_KEY)
    expect(page.isDisabled('guardian-sign')).toBe(true)
    page.unmount()
  })

  it('draws a failed read with a retry below the link values, never a death', async () => {
    kit.isAuthorized.mockImplementation(async () => {
      throw new Error('rpc down')
    })
    const page = await mountLive(requestOf({ validUntil: String(CREATED_AT - 1) }))
    expect(page.textOf('guardian-read-failed')).toContain(t(`${PAGE}.readFailed`))
    expect(page.textOf('guardian-read-retry')).toBe(t(`${PAGE}.actions.tryAgain`))
    expect(page.isDisabled('guardian-sign')).toBe(true)
    expect(page.has('guardian-dead-expired')).toBe(false)
    expect(page.has('guardian-lead')).toBe(true)
    expect(page.textOf('guardian-value-accountBeingRecovered')).toBe(ACCOUNT)
    expect(page.has('guardian-acknowledge')).toBe(false)
    kit.isAuthorized.mockImplementation(async () => true)
    await page.press('guardian-read-retry')
    expect(page.has('guardian-read-failed')).toBe(false)
    expect(page.has('guardian-dead-expired')).toBe(true)
    page.unmount()
  })

  it('draws a read that ran past its limit as failed', async () => {
    kit.recoveryState.mockImplementation(() => new Promise(() => {}))
    const page = await mountLive()
    expect(page.has('guardian-reading')).toBe(true)
    expect(page.textOf('guardian-reading')).toBe(t(`${PAGE}.reading`))
    await advance(15_000)
    expect(page.has('guardian-read-failed')).toBe(true)
    page.unmount()
  })

  it('draws a client that failed as a failed read, whose retry builds it again', async () => {
    const retry = jest.fn()
    setClient({ status: 'failed', error: new Error('rpc down'), retry })
    const page = await mountLive()
    expect(page.textOf('guardian-read-failed')).toContain(t(`${PAGE}.readFailed`))
    expect(page.isDisabled('guardian-sign')).toBe(true)
    await page.press('guardian-read-retry')
    expect(retry).toHaveBeenCalledTimes(1)
    page.unmount()
  })

  it('draws a client refused for the digest version the manager publishes as another deployment, with no retry', async () => {
    setClient({ status: 'update-the-wallet', refusal: {} as never, retry: () => {} })
    const page = await mountLive()
    expect(page.textOf('guardian-other-deployment')).toContain(t(`${PAGE}.otherDeployment`))
    expect(page.has('guardian-read-failed')).toBe(false)
    expect(page.has('guardian-read-retry')).toBe(false)
    expect(page.has('guardian-lead')).toBe(false)
    expect(page.isDisabled('guardian-sign')).toBe(true)
    page.unmount()
  })

  it('refuses a request aimed at another deployment with no retry and no read', async () => {
    const page = await mountLive(requestOf({ digestVersion: '9' }))
    expect(page.textOf('guardian-other-deployment')).toContain(t(`${PAGE}.otherDeployment`))
    expect(page.has('guardian-read-retry')).toBe(false)
    expect(page.isDisabled('guardian-sign')).toBe(true)
    expect(clientAccounts().every((account) => account === undefined)).toBe(true)
    expect(kit.recoveryState).not.toHaveBeenCalled()
    page.unmount()
  })

  it('refuses a request the built client names another deployment for', async () => {
    setClient(readyClient({ ...DESCRIPTOR, digestVersion: '9' }))
    const page = await mountLive()
    expect(page.has('guardian-other-deployment')).toBe(true)
    expect(page.has('guardian-lead')).toBe(false)
    page.unmount()
  })

  it('renders only the no-request line for a link that carries none', async () => {
    const page = await mountPage('?request=broken')
    expect(page.textOf('guardian-no-request')).toBe(t(`${PAGE}.noRequest`))
    expect(page.has('guardian-sign')).toBe(false)
    expect(kit.recoveryState).not.toHaveBeenCalled()
    page.unmount()
  })

  it('reads the request from the window hash where the router hands no search', async () => {
    window.location.hash = new URL(linkOf(requestOf())).hash
    const page = await mountPage('')
    expect(page.textOf('guardian-value-newKey')).toBe(NEW_KEY)
    page.unmount()
  })
})

describe('the re-read', () => {
  it('reads the chain when the page opens and once every minute', async () => {
    const page = await mountLive()
    expect(kit.recoveryState).toHaveBeenCalledTimes(1)
    expect(kit.isAuthorized).toHaveBeenCalledTimes(1)
    await advance(MINUTE - 1)
    expect(kit.recoveryState).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(kit.recoveryState).toHaveBeenCalledTimes(2)
    expect(kit.isAuthorized).toHaveBeenCalledTimes(2)
    kit.recoveryState.mockImplementation(async () => recoveryStateOf({ setupNonce: 3n }))
    await advance(MINUTE)
    expect(page.has('guardian-dead-setup-changed')).toBe(true)
    page.unmount()
  })

  it("drops a round of an earlier client that answers after the newer client's round", async () => {
    let answerLate: (state: RecoveryState) => void = () => {}
    kit.recoveryState.mockImplementationOnce(
      () =>
        new Promise<RecoveryState>((resolve) => {
          answerLate = resolve
        })
    )
    const page = await mountLive()
    expect(page.has('guardian-reading')).toBe(true)
    setClient(readyClient())
    await settle()
    expect(kit.recoveryState).toHaveBeenCalledTimes(2)
    expect(page.has('guardian-sign-block')).toBe(true)
    answerLate(recoveryStateOf({ setupNonce: 3n }))
    await settle()
    expect(page.has('guardian-dead-setup-changed')).toBe(false)
    expect(page.has('guardian-sign-block')).toBe(true)
    page.unmount()
  })

  it("drops a round of an earlier link that answers after the new link's round", async () => {
    let answerLate: (state: RecoveryState) => void = () => {}
    kit.recoveryState.mockImplementationOnce(
      () =>
        new Promise<RecoveryState>((resolve) => {
          answerLate = resolve
        })
    )
    const page = await mountLive()
    expect(page.has('guardian-reading')).toBe(true)
    await navigate(searchOf(linkOf(requestOf({ salt: '0x03' }))))
    expect(kit.recoveryState).toHaveBeenCalledTimes(2)
    expect(page.has('guardian-sign-block')).toBe(true)
    answerLate(recoveryStateOf({ setupNonce: 3n }))
    await settle()
    expect(page.has('guardian-dead-setup-changed')).toBe(false)
    expect(page.has('guardian-sign-block')).toBe(true)
    page.unmount()
  })

  it('stops reading once the guardian declines', async () => {
    const page = await mountLive()
    await page.press('guardian-decline')
    await advance(3 * MINUTE)
    expect(kit.recoveryState).toHaveBeenCalledTimes(1)
    page.unmount()
  })
})

describe('the decline', () => {
  it('draws the declined page with every line, and close closes the tab', async () => {
    const close = jest.spyOn(window, 'close').mockImplementation(() => {})
    const page = await mountLive()
    await page.press('guardian-decline')
    expect(page.has('guardian-lead')).toBe(false)
    expect(page.textOf('guardian-declined-title')).toBe(t(`${PAGE}.declined.title`))
    expect(page.textOf('guardian-declined-headline')).toBe(t(`${PAGE}.declined.headline`))
    expect(page.textOf('guardian-declined-body')).toBe(t(`${PAGE}.declined.body`))
    const text = page.text()
    const keys = [
      'tellTitle',
      'tellBody',
      'cancelLine',
      'copyMessage',
      'close',
      'sentNothing',
      'stillPublishes'
    ]
    keys.forEach((key) => {
      expect({ key, shown: text.includes(t(`${PAGE}.declined.${key}`)) }).toEqual({
        key,
        shown: true
      })
    })
    await page.press('guardian-declined-close')
    expect(close).toHaveBeenCalledTimes(1)
    close.mockRestore()
    page.unmount()
  })

  it('leaves another link opened in the same tab undeclined, and reads it', async () => {
    const page = await mountLive()
    await page.press('guardian-decline')
    expect(page.has('guardian-declined-title')).toBe(true)
    await navigate(searchOf(linkOf(requestOf({ salt: '0x03' }))))
    expect(page.has('guardian-declined-title')).toBe(false)
    expect(page.textOf('guardian-value-newKey')).toBe(NEW_KEY)
    expect(kit.recoveryState).toHaveBeenCalledTimes(2)
    expect(kit.isAuthorized).toHaveBeenCalledTimes(2)
    await page.press('guardian-acknowledge')
    expect(page.isDisabled('guardian-sign')).toBe(false)
    await advance(MINUTE)
    expect(kit.recoveryState).toHaveBeenCalledTimes(3)
    page.unmount()
  })

  it('closes the tab from a death', async () => {
    const close = jest.spyOn(window, 'close').mockImplementation(() => {})
    kit.recoveryState.mockImplementation(async () => recoveryStateOf({ nextAttemptId: 4n }))
    const page = await mountLive()
    await page.press('guardian-close')
    expect(close).toHaveBeenCalledTimes(1)
    close.mockRestore()
    await settle()
    page.unmount()
  })
})

describe('a reopened link whose attempt counter moved past the request', () => {
  const MOVED = () => recoveryStateOf({ nextAttemptId: 5n })

  it("reads the account's attempt-started events once and draws used where one is the request's own", async () => {
    const request = requestOf()
    kit.recoveryState.mockImplementation(async () => MOVED())
    kit.fetchEvents.mockImplementation(async () => [startedLogOf(request)])
    const page = await mountLive(request)
    expect(page.has('guardian-dead-used')).toBe(true)
    expect(page.textOf('guardian-dead-title')).toBe(t(`${PAGE}.dead.usedTitle`))
    expect(page.has('guardian-dead-void')).toBe(false)
    expect(kit.fetchEvents.mock.calls).toEqual([
      [ACCOUNT_FILTER, { from: DESCRIPTOR.deployedAt, to: recoveryStateOf().block.number }]
    ])
    await advance(MINUTE)
    expect(kit.fetchEvents).toHaveBeenCalledTimes(1)
    page.unmount()
  })

  it("draws used where the request's own attempt was replaced by another one now waiting", async () => {
    const request = requestOf()
    kit.recoveryState.mockImplementation(async () =>
      recoveryStateOf({
        attempt: { ...SUBMITTED, attemptId: 4n, payloadHash: `0x${'77'.repeat(32)}` },
        nextAttemptId: 5n
      })
    )
    kit.fetchEvents.mockImplementation(async () => [startedLogOf(request)])
    const page = await mountLive(request)
    expect(page.has('guardian-dead-used')).toBe(true)
    page.unmount()
  })

  it("draws void where no started event is the request's own", async () => {
    const request = requestOf()
    const others = [
      [],
      [startedLogOf(request, { payload: '0x123456' })],
      [startedLogOf(request, { setupNonce: 1n })],
      [startedLogOf(request, { attemptId: 4n })],
      [startedLogOf(request, { account: PAYEE })],
      [startedLogOf(request, { action: PAYEE })]
    ]
    // eslint-disable-next-line no-restricted-syntax
    for (const logs of others) {
      kit.recoveryState.mockImplementation(async () => MOVED())
      kit.fetchEvents.mockImplementation(async () => logs)
      // eslint-disable-next-line no-await-in-loop
      const page = await mountLive(request)
      expect({ logs, void: page.has('guardian-dead-void') }).toEqual({ logs, void: true })
      expect(page.has('guardian-dead-used')).toBe(false)
      page.unmount()
    }
  })

  describe('the backward scan of the events', () => {
    const DEPLOYED_AT = 1_000_000
    const WIDTH = LOG_CHUNK_BLOCKS
    // Four chunks: three full ones down from the state's block, then the
    // last 501 blocks down to the deployment block.
    const STATE_BLOCK = DEPLOYED_AT + 3 * WIDTH + 500
    const chunk = (index: number) => ({
      from: Math.max(DEPLOYED_AT, STATE_BLOCK - (index + 1) * WIDTH + 1),
      to: STATE_BLOCK - index * WIDTH
    })
    const startedAt = (
      request: ApproverRequest,
      blockNumber: number,
      overrides: Parameters<typeof startedLogOf>[1] = {}
    ): Notification =>
      startedLogOf(request, {
        ...overrides,
        at: { ...startedLogOf(request).at, blockNumber }
      })
    const scanOver = (logs: Notification[]) => {
      setClient(readyClient({ ...DESCRIPTOR, deployedAt: DEPLOYED_AT }))
      kit.recoveryState.mockImplementation(async () =>
        recoveryStateOf({
          nextAttemptId: 5n,
          block: { ...recoveryStateOf().block, number: STATE_BLOCK }
        })
      )
      kit.fetchEvents.mockImplementation(async (_filter, range) =>
        logs.filter((log) => log.at.blockNumber >= range.from && log.at.blockNumber <= range.to)
      )
    }
    const rangesRead = () => kit.fetchEvents.mock.calls.map(([, range]) => range)

    it('reads used from the newest chunk alone where the own start sits there', async () => {
      const request = requestOf()
      scanOver([startedAt(request, STATE_BLOCK - 10)])
      const page = await mountLive(request)
      expect(page.has('guardian-dead-used')).toBe(true)
      expect(kit.fetchEvents.mock.calls).toEqual([[ACCOUNT_FILTER, chunk(0)]])
      page.unmount()
    })

    it('reads chunks back past a later start until the own start', async () => {
      const request = requestOf()
      scanOver([
        startedAt(request, DEPLOYED_AT + 100),
        startedAt(request, STATE_BLOCK - 10, { attemptId: 4n })
      ])
      const page = await mountLive(request)
      expect(page.has('guardian-dead-used')).toBe(true)
      expect(rangesRead()).toEqual([chunk(0), chunk(1), chunk(2), chunk(3)])
      page.unmount()
    })

    it('stops at a start with a lower id and reads void', async () => {
      const request = requestOf()
      scanOver([
        startedAt(request, DEPLOYED_AT + 100),
        startedAt(request, chunk(1).to - 10, { attemptId: 2n })
      ])
      const page = await mountLive(request)
      expect(page.has('guardian-dead-void')).toBe(true)
      expect(page.has('guardian-dead-used')).toBe(false)
      expect(rangesRead()).toEqual([chunk(0), chunk(1)])
      page.unmount()
    })

    it('never reads below the deployment block', async () => {
      const request = requestOf()
      scanOver([startedAt(request, DEPLOYED_AT - 1)])
      const page = await mountLive(request)
      expect(page.has('guardian-dead-void')).toBe(true)
      expect(rangesRead()).toEqual([chunk(0), chunk(1), chunk(2), chunk(3)])
      expect(chunk(3).from).toBe(DEPLOYED_AT)
      page.unmount()
    })
  })

  it('draws a failed events read as a failed read with a retry, never void', async () => {
    const request = requestOf()
    kit.recoveryState.mockImplementation(async () => MOVED())
    kit.fetchEvents.mockImplementation(async () => {
      throw new Error('logs refused')
    })
    const page = await mountLive(request)
    expect(page.has('guardian-read-failed')).toBe(true)
    expect(page.has('guardian-dead-void')).toBe(false)
    kit.fetchEvents.mockImplementation(async () => [startedLogOf(request)])
    await page.press('guardian-read-retry')
    expect(page.has('guardian-read-failed')).toBe(false)
    expect(page.has('guardian-dead-used')).toBe(true)
    page.unmount()
  })

  it('draws an events read that ran past its limit as failed', async () => {
    kit.recoveryState.mockImplementation(async () => MOVED())
    kit.fetchEvents.mockImplementation(() => new Promise(() => {}))
    const page = await mountLive()
    expect(page.has('guardian-reading')).toBe(true)
    await advance(15_000)
    expect(page.has('guardian-read-failed')).toBe(true)
    expect(page.has('guardian-dead-void')).toBe(false)
    page.unmount()
  })

  it('reads no events for a live, waiting, ended, changed or expired request', async () => {
    const cases: [string, () => RecoveryState, string][] = [
      ['live', () => recoveryStateOf(), 'guardian-sign'],
      [
        'waiting',
        () => recoveryStateOf({ attempt: SUBMITTED, nextAttemptId: 4n }),
        'guardian-waiting-title'
      ],
      [
        'used',
        () => recoveryStateOf({ attempt: { ...SUBMITTED, state: 'Cancelled' }, nextAttemptId: 4n }),
        'guardian-dead-used'
      ],
      [
        'setup-changed',
        () => recoveryStateOf({ setupNonce: 3n, nextAttemptId: 5n }),
        'guardian-dead-setup-changed'
      ]
    ]
    // eslint-disable-next-line no-restricted-syntax
    for (const [name, state, drawn] of cases) {
      kit.recoveryState.mockImplementation(async () => state())
      // eslint-disable-next-line no-await-in-loop
      const page = await mountLive()
      expect({ name, drawn: page.has(drawn) }).toEqual({ name, drawn: true })
      page.unmount()
    }
    kit.recoveryState.mockImplementation(async () => MOVED())
    const expired = await mountLive(requestOf({ validUntil: String(CREATED_AT - 1) }))
    expect(expired.has('guardian-dead-expired')).toBe(true)
    expired.unmount()
    expect(kit.fetchEvents).not.toHaveBeenCalled()
  })
})
