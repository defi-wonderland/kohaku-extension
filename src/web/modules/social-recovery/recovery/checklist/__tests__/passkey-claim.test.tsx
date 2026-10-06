/**
 * @jest-environment jsdom
 *
 * The passkey row's claim: it stores the ceremony request with the hand-off
 * the holder chose, opens the ceremony tab, and on its report adds the reply
 * through the client and writes the session under the revision it read. A
 * ceremony that did not pass leaves its note with a retry; a passkey another
 * origin committed offers no action.
 */
import type { Configuration } from '@web/modules/social-recovery/sdk-interfaces'
import type { CeremonyOutcome } from '@web/modules/social-recovery/shared/ceremony'

import type { ChecklistSearch } from '@web/modules/social-recovery/recovery/checklist/types'

import type {
  FakeDeps,
  FakeKit,
  Mounted,
  TestRecords
} from '@web/modules/social-recovery/recovery/checklist/__tests__/harness'
import {
  ACCOUNT,
  CHAIN_ID,
  configurationOf,
  depsOf,
  each,
  fakeKit,
  gatheringOf,
  GUARDIANS,
  guardianCredential,
  mountChecklist,
  OTHER_RP_HASH,
  outside,
  passkeyCredential,
  replyOf,
  requestOf,
  seedCache,
  seedEntry,
  seedSession,
  storedSession,
  t,
  testRecords
} from '@web/modules/social-recovery/recovery/checklist/__tests__/harness'

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const {
  ceremonyPath,
  dismissed,
  failed,
  passed,
  unavailable
}: typeof import('@web/modules/social-recovery/shared/ceremony') = require('@web/modules/social-recovery/shared/ceremony')
const {
  checklistPathOf
}: typeof import('@web/modules/social-recovery/recovery/checklist') = require('@web/modules/social-recovery/recovery/checklist')
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

const CEREMONY = 'socialRecovery.ceremony'
const PASSKEY = 'socialRecovery.checklist.passkey'

const PATH: Configuration = configurationOf([
  { threshold: 1, credentials: [passkeyCredential('Laptop passkey')] },
  { threshold: 1, credentials: [guardianCredential(GUARDIANS[0])] }
])

describe('the passkey row', () => {
  let view: Mounted | undefined
  let world: TestRecords
  let kit: FakeKit
  let deps: FakeDeps
  const gathering = gatheringOf(PATH, 1)

  const open = async (search: ChecklistSearch = { account: ACCOUNT }) => {
    view?.unmount()
    view = await mountChecklist({ records: world.records, client: kit.state, deps, search })
    return view
  }

  /** The tab writes its report and returns to the path the row gave it. */
  const returnFrom = async (id: string, outcome: CeremonyOutcome<unknown>) => {
    await deps.channel.report(id, 'createClaim', outcome)
    return open({ account: ACCOUNT, ceremony: id })
  }

  beforeEach(async () => {
    world = testRecords()
    await seedEntry(world.records)
    await seedCache(world.records, PATH)
    await seedSession(world.records, gathering)
    kit = fakeKit(PATH)
    deps = depsOf()
  })

  afterEach(() => {
    view?.unmount()
    view = undefined
  })

  each([
    ['on this device', 'checklist-row-0-answer-here', false],
    ['on the phone', 'checklist-row-0-phone', true]
  ] as const)(
    'launches the claim ceremony %s with a ceremony request and the hand-off flag',
    async ([, button, handOff]) => {
      const mounted = await open()
      expect(mounted.byTestId(button)).not.toBeNull()

      await mounted.press(button)

      const [id] = deps.requestIds
      const stored = await world.records.ceremonyRequest(id).read()
      expect(stored.status === 'present' && stored.value).toEqual({
        call: 'createClaim',
        method: 'passkey',
        account: ACCOUNT,
        chainId: CHAIN_ID,
        request: requestOf(gathering, 0),
        params: { handOff }
      })
      expect(mounted.lastPath()).toBe(
        ceremonyPath({
          call: 'createClaim',
          method: 'passkey',
          id,
          handOff,
          returnTo: checklistPathOf(ACCOUNT, id)
        })
      )
    }
  )

  it('adds a passed claim through the client and writes the session under a new revision', async () => {
    const before = await storedSession(world.records)
    const mounted = await open()
    await mounted.press('checklist-row-0-phone')
    const [id] = deps.requestIds
    const reply = replyOf(gathering, 0)

    const back = await returnFrom(id, passed({ reply, facts: { place: 'phone' } }))

    expect(kit.addApproverReply).toHaveBeenCalledWith(gathering, reply)
    const after = await storedSession(world.records)
    expect(after?.revision).not.toBe(before?.revision)
    expect(after?.value.state === 'live' && after.value.gathering.replies).toEqual([reply])
    expect(back.byTestId('checklist-row-0-chip')?.textContent).toBe(
      t('socialRecovery.status.collection.complete')
    )
    expect(back.byTestId('checklist-row-0-answered')?.textContent).toContain(
      t(`${PASSKEY}.answeredPhone`, { date: '' }).trim()
    )
    expect(back.byTestId('checklist-row-0-answer-here')).toBeNull()
    expect((await world.records.ceremonyRequest(id).read()).status).toBe('absent')
  })

  it('adds a report that lands after the return through the listener', async () => {
    const mounted = await open()
    await mounted.press('checklist-row-0-answer-here')
    const [id] = deps.requestIds
    const back = await open({ account: ACCOUNT, ceremony: id })
    expect(back.byTestId('checklist-undelivered')).not.toBeNull()

    const reply = replyOf(gathering, 0)
    await outside(() => deps.channel.report(id, 'createClaim', passed({ reply })))
    await outside(async () => undefined)

    expect(kit.addApproverReply).toHaveBeenCalledWith(gathering, reply)
    const after = await storedSession(world.records)
    expect(after?.value.state === 'live' && after.value.gathering.replies).toEqual([reply])
    expect(back.byTestId('checklist-undelivered')).toBeNull()
  })

  it('reads a reply the client refuses as the row failed note, with the row still open', async () => {
    const mounted = await open()
    await mounted.press('checklist-row-0-answer-here')
    const [id] = deps.requestIds
    const stale = { ...replyOf(gathering, 0), attemptId: '99' }

    const back = await returnFrom(id, passed({ reply: stale }))

    expect(kit.addApproverReply).toHaveBeenCalledTimes(1)
    const after = await storedSession(world.records)
    expect(after?.value.state === 'live' && after.value.gathering.replies).toEqual([])
    expect(back.byTestId('checklist-row-0-note')?.textContent).toBe(t(`${CEREMONY}.failedNote`))
    expect(back.byTestId('checklist-row-0-chip')?.textContent).toBe(
      t('socialRecovery.status.collection.waiting')
    )
  })

  each([
    ['cancelled', dismissed('cancelled'), `${CEREMONY}.cancelledNote`],
    ['refused', dismissed('refused'), `${CEREMONY}.refusedNote`],
    ['failed', failed('browser-error', 'NotAllowedError'), `${CEREMONY}.failedNote`],
    ['unreachable', unavailable('unreachable'), `${CEREMONY}.unreachableNote`]
  ] as const)(
    'renders the %s report as its note with a retry that launches again',
    async ([, outcome, noteKey]) => {
      const mounted = await open()
      await mounted.press('checklist-row-0-phone')
      const [id] = deps.requestIds

      const back = await returnFrom(id, outcome)

      expect(kit.addApproverReply).not.toHaveBeenCalled()
      expect(back.byTestId('checklist-row-0-note')?.textContent).toBe(t(noteKey))
      expect(back.byTestId('checklist-row-0-no-passkey')).not.toBeNull()
      expect(back.byTestId('checklist-row-0-retry')).not.toBeNull()

      await back.press('checklist-row-0-retry')
      const retried = deps.requestIds[1]
      expect(retried).toBeDefined()
      const stored = await world.records.ceremonyRequest(retried).read()
      expect(stored.status === 'present' && stored.value).toMatchObject({
        call: 'createClaim',
        params: { handOff: true }
      })
    }
  )

  it('shows the lines on synced passkeys and on passkeys of another browser', async () => {
    const mounted = await open()

    expect(mounted.byTestId('checklist-row-0-any-device')?.textContent).toBe(
      t(`${PASSKEY}.anyDevice`)
    )
    expect(mounted.byTestId('checklist-row-0-other-browser')?.textContent).toBe(
      t(`${PASSKEY}.otherBrowser`)
    )
    expect(mounted.byTestId('checklist-row-0')?.querySelector('[tabindex="0"]')).not.toBeNull()
  })

  it('renders the mismatch line and no action for a passkey another origin committed', async () => {
    const foreign = configurationOf([
      { threshold: 1, credentials: [passkeyCredential('Old passkey', OTHER_RP_HASH)] }
    ])
    world = testRecords()
    await seedEntry(world.records)
    await seedCache(world.records, foreign)
    await seedSession(world.records, gatheringOf(foreign))
    kit = fakeKit(foreign)

    const mounted = await open()

    expect(mounted.byTestId('checklist-row-0-mismatch')?.textContent).toBe(
      t(`${CEREMONY}.relyingPartyMismatch`)
    )
    expect(mounted.byTestId('checklist-row-0')?.querySelector('[tabindex="0"]')).toBeNull()
    expect(mounted.byTestId('checklist-row-0-answer-here')).toBeNull()
    expect(mounted.byTestId('checklist-row-0-phone')).toBeNull()
  })
})
