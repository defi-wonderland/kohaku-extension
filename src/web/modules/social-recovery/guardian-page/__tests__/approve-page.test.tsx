/**
 * @jest-environment jsdom
 *
 * The approval page as a guardian opens it: the lead with the four values in
 * full, verify the details, the states drawn in place of the sign action, the
 * gates of the sign action, the re-read every minute and the decline.
 */
import {
  ACCOUNT,
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
  NEW_KEY,
  readyClient,
  recoveryStateOf,
  REMOVED_KEY,
  requestOf,
  resetEdges,
  setClient,
  settle,
  SUBMITTED,
  t,
  VALID_UNTIL,
  WAIT_ENDS_AT
} from './harness'

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
afterEach(() => jest.useRealTimers())

describe('the lead of a live request', () => {
  it('renders who asks, the four values in full and every line of the lead', async () => {
    const page = await mountLive()
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
    expect(page.has('guardian-value-newKey-unreadable')).toBe(true)
    expect(page.has('guardian-value-keyBeingRemoved-unreadable')).toBe(true)
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

  it('draws a failed read with a retry, never a death and never the values', async () => {
    kit.isAuthorized.mockImplementation(async () => {
      throw new Error('rpc down')
    })
    const page = await mountLive(requestOf({ validUntil: String(CREATED_AT - 1) }))
    expect(page.textOf('guardian-read-failed')).toContain(t(`${PAGE}.readFailed`))
    expect(page.textOf('guardian-read-retry')).toBe(t(`${PAGE}.actions.tryAgain`))
    expect(page.isDisabled('guardian-sign')).toBe(true)
    expect(page.has('guardian-dead-expired')).toBe(false)
    expect(page.has('guardian-lead')).toBe(false)
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

  it('draws a client that failed or was refused as a failed read, whose retry builds it again', async () => {
    const retry = jest.fn()
    setClient({ status: 'failed', error: new Error('rpc down'), retry })
    const page = await mountLive()
    expect(page.textOf('guardian-read-failed')).toContain(t(`${PAGE}.readFailed`))
    await page.press('guardian-read-retry')
    expect(retry).toHaveBeenCalledTimes(1)
    setClient({ status: 'update-the-wallet', refusal: {} as never, retry })
    expect(page.has('guardian-read-failed')).toBe(true)
    expect(page.has('guardian-sign')).toBe(true)
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
    const keys = ['tellTitle', 'tellBody', 'cancelLine', 'close', 'sentNothing', 'stillPublishes']
    keys.forEach((key) => {
      expect({ key, shown: text.includes(t(`${PAGE}.declined.${key}`)) }).toEqual({
        key,
        shown: true
      })
    })
    expect(text).not.toContain(t(`${PAGE}.declined.copyMessage`))
    await page.press('guardian-declined-close')
    expect(close).toHaveBeenCalledTimes(1)
    close.mockRestore()
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
