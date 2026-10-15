import {
  dismissAttempt,
  pollAccounts,
  readWatcherRecord
} from '@web/modules/social-recovery/watcher'

import {
  ACCOUNT,
  cancelledEvent,
  consumedEvent,
  ENDED_TIME,
  HEAD,
  HEAD_TIME,
  memoryStorage,
  NEW_KEY,
  OLD_KEY,
  OPENED_TIME,
  OTHER_ACCOUNT,
  payloadTo,
  scriptedChain,
  SEPOLIA,
  startedEvent,
  stateWith
} from '@web/modules/social-recovery/watcher/__fixtures__/harness'

const NOW = 1_800_000_123_000

const setUp = (accounts = [ACCOUNT]) => {
  const chain = scriptedChain()
  accounts.forEach((account) => chain.deploy(account))
  const storage = memoryStorage()
  const poll = (limitMs = 1_000) =>
    pollAccounts({
      reads: chain.reads,
      accounts,
      chainId: SEPOLIA,
      storage,
      now: () => NOW,
      limitMs
    })
  const record = (account = ACCOUNT) => readWatcherRecord(storage, SEPOLIA, account)
  return { chain, storage, poll, record }
}

const PAYLOAD = payloadTo(NEW_KEY)

describe('a poll of the watched accounts', () => {
  it('writes a reading with no attempt and no badge where none is open', async () => {
    const { chain, poll, record } = setUp()
    chain.setState(ACCOUNT, stateWith())

    expect(await poll()).toBe(0)
    const written = await record()
    expect(written?.reading).toEqual({
      account: ACCOUNT,
      block: { number: HEAD, timestamp: HEAD_TIME },
      hasSetup: true,
      dormant: false
    })
    expect(written?.failed).toBeUndefined()
  })

  it('pins every read of the poll to the latest block, read once', async () => {
    const { chain, poll } = setUp([ACCOUNT, OTHER_ACCOUNT])
    chain.setState(ACCOUNT, stateWith({ attemptId: 1n, state: 'Waiting', payload: PAYLOAD }))
    chain.setState(OTHER_ACCOUNT, stateWith())

    await poll()

    expect(chain.reads.latestBlock).toHaveBeenCalledTimes(1)
    expect(chain.reads.stateOf.mock.calls.map(([, block]) => block)).toEqual([HEAD, HEAD])
    expect(chain.reads.isAuthorized.mock.calls.map(([, block]) => block)).toEqual([HEAD, HEAD])
    expect(chain.reads.attemptEventsOf).toHaveBeenCalledWith(ACCOUNT, 1n, {
      from: 6_900_000,
      to: HEAD
    })
  })

  it('reads an open attempt with its countdown and no key until its opening is read, then the decoded key', async () => {
    const { chain, poll, record } = setUp()
    chain.setState(ACCOUNT, stateWith({ attemptId: 4n, state: 'Waiting', payload: PAYLOAD }))

    expect(await poll()).toBe(1)
    const first = (await record())?.reading
    expect(first?.dormant).toBe(false)
    expect(first?.attempt).toMatchObject({
      attemptId: 4n,
      consumableAfter: HEAD_TIME + 3600,
      executionDue: false,
      openingGap: 'not-found'
    })
    expect(first?.attempt?.newKey).toBeUndefined()
    expect(first?.attempt?.openedAt).toBeUndefined()

    chain.setEvents(ACCOUNT, 4n, { started: startedEvent(4n, PAYLOAD) })
    expect(await poll()).toBe(1)
    const second = (await record())?.reading?.attempt
    expect(second).toMatchObject({ newKey: NEW_KEY, removedKey: OLD_KEY, openedAt: OPENED_TIME })
    expect(second?.openingGap).toBeUndefined()
  })

  it('reads the opening once per attempt and payload', async () => {
    const { chain, poll } = setUp()
    chain.setState(ACCOUNT, stateWith({ attemptId: 4n, state: 'Waiting', payload: PAYLOAD }))
    chain.setEvents(ACCOUNT, 4n, { started: startedEvent(4n, PAYLOAD) })

    await poll()
    await poll()

    expect(chain.reads.attemptEventsOf).toHaveBeenCalledTimes(1)
  })

  it('names no key from an opening whose payload is not the one the attempt committed', async () => {
    const { chain, poll, record } = setUp()
    chain.setState(ACCOUNT, stateWith({ attemptId: 4n, state: 'Waiting', payload: PAYLOAD }))
    chain.setEvents(ACCOUNT, 4n, { started: startedEvent(4n, payloadTo(OLD_KEY)) })

    await poll()

    const attempt = (await record())?.reading?.attempt
    expect(attempt?.newKey).toBeUndefined()
    expect(attempt?.openingGap).toBe('not-found')
  })

  it('keeps the countdown and names no key where the opening read fails or does not decode', async () => {
    const { chain, poll, record } = setUp()
    chain.setState(ACCOUNT, stateWith({ attemptId: 4n, state: 'Waiting', payload: PAYLOAD }))
    chain.setEvents(ACCOUNT, 4n, new Error('logs refused'))

    expect(await poll()).toBe(1)
    expect((await record())?.reading?.attempt).toMatchObject({
      attemptId: 4n,
      openingGap: 'read-failed'
    })
    expect((await record())?.failed).toBeUndefined()

    const undecodable = '0x1234'
    chain.setState(ACCOUNT, stateWith({ attemptId: 5n, state: 'Waiting', payload: undecodable }))
    chain.setEvents(ACCOUNT, 5n, { started: startedEvent(5n, undecodable) })
    await poll()
    const attempt = (await record())?.reading?.attempt
    expect(attempt).toMatchObject({ attemptId: 5n, openingGap: 'undecodable' })
    expect(attempt?.newKey).toBeUndefined()
  })

  it('keeps the last reading, marks it failed and keeps the badge where a read throws', async () => {
    const { chain, poll, record } = setUp()
    chain.setState(ACCOUNT, stateWith({ attemptId: 4n, state: 'Waiting', payload: PAYLOAD }))
    await poll()
    const good = (await record())?.reading

    chain.setState(ACCOUNT, new Error('node down'))
    expect(await poll()).toBe(1)

    const written = await record()
    expect(written?.reading).toEqual(good)
    expect(written?.failed).toEqual({ at: NOW, message: 'node down' })
  })

  it('badges a failed poll of an account with no attempt, never reading it as no attempt', async () => {
    const { chain, poll, record } = setUp()
    chain.setState(ACCOUNT, new Error('node down'))

    expect(await poll()).toBe(1)
    const written = await record()
    expect(written?.reading).toBeUndefined()
    expect(written?.failed?.message).toBe('node down')
  })

  it('reads a poll that does not answer within its limit as failed', async () => {
    const { chain, poll, record } = setUp()
    chain.setState(ACCOUNT, stateWith())
    await poll()
    chain.reads.stateOf.mockImplementationOnce(
      () =>
        new Promise(() => {
          // never answers
        })
    )

    expect(await poll(20)).toBe(1)
    const written = await record()
    expect(written?.failed?.message).toMatch(/No answer in 20 ms/)
    expect(written?.reading?.hasSetup).toBe(true)
  })

  it('clears the failure on the next good poll', async () => {
    const { chain, poll, record } = setUp()
    chain.setState(ACCOUNT, new Error('node down'))
    await poll()

    chain.setState(ACCOUNT, stateWith())
    expect(await poll()).toBe(0)
    expect((await record())?.failed).toBeUndefined()
  })

  it('drops an attempt the next poll no longer reads', async () => {
    const { chain, poll, record } = setUp()
    chain.setState(ACCOUNT, stateWith({ attemptId: 4n, state: 'Waiting', payload: PAYLOAD }))
    await poll()

    chain.setState(ACCOUNT, stateWith())
    expect(await poll()).toBe(0)
    const reading = (await record())?.reading
    expect(reading?.attempt).toBeUndefined()
    expect(reading?.ended).toBeUndefined()
  })

  it('reads a cancelled attempt as ended by its road', async () => {
    const { chain, poll, record } = setUp()
    chain.setState(ACCOUNT, stateWith({ attemptId: 4n, state: 'Cancelled', payload: PAYLOAD }))
    chain.setEvents(ACCOUNT, 4n, { cancelled: cancelledEvent(4n, 'cancelByOwner') })

    expect(await poll()).toBe(0)
    const reading = (await record())?.reading
    expect(reading?.attempt).toBeUndefined()
    expect(reading?.ended).toEqual({
      attemptId: 4n,
      road: 'cancelled',
      cancelledBy: 'cancelByOwner',
      at: ENDED_TIME
    })
  })

  it('reads a consumed attempt as executed, naming the controller and when control moved', async () => {
    const { chain, poll, record } = setUp()
    chain.setState(ACCOUNT, stateWith({ attemptId: 4n, state: 'Consumed', payload: PAYLOAD }))
    chain.setEvents(ACCOUNT, 4n, {
      started: startedEvent(4n, PAYLOAD),
      consumed: consumedEvent(4n)
    })

    expect(await poll()).toBe(0)
    expect((await record())?.reading?.ended).toEqual({
      attemptId: 4n,
      road: 'executed',
      controller: NEW_KEY,
      at: ENDED_TIME
    })
  })

  it('reads an ending whose logs did not answer with the road alone, and reads them again', async () => {
    const { chain, poll, record } = setUp()
    chain.setState(ACCOUNT, stateWith({ attemptId: 4n, state: 'Consumed', payload: PAYLOAD }))
    chain.setEvents(ACCOUNT, 4n, new Error('logs refused'))
    await poll()
    expect((await record())?.reading?.ended).toEqual({ attemptId: 4n, road: 'executed' })

    chain.setEvents(ACCOUNT, 4n, {
      started: startedEvent(4n, PAYLOAD),
      consumed: consumedEvent(4n)
    })
    await poll()
    expect((await record())?.reading?.ended).toMatchObject({ controller: NEW_KEY, at: ENDED_TIME })
  })

  it('reads a wait that ended with nobody executing as execution due', async () => {
    const { chain, poll, record } = setUp()
    chain.setState(
      ACCOUNT,
      stateWith({ attemptId: 4n, state: 'Waiting', payload: PAYLOAD, consumableAfter: HEAD_TIME })
    )

    expect(await poll()).toBe(1)
    expect((await record())?.reading?.attempt?.executionDue).toBe(true)
  })

  it('reads a setup the account no longer authorizes as dormant', async () => {
    const { chain, poll, record } = setUp()
    chain.setState(ACCOUNT, stateWith({ attemptId: 4n, state: 'Waiting', payload: PAYLOAD }))
    chain.unauthorize(ACCOUNT)

    await poll()
    const reading = (await record())?.reading
    expect(reading?.dormant).toBe(true)
    expect(reading?.attempt?.attemptId).toBe(4n)
  })

  it('reads an account with no code as holding no setup, without asking the registry', async () => {
    const chain = scriptedChain()
    const storage = memoryStorage()
    await pollAccounts({
      reads: chain.reads,
      accounts: [ACCOUNT],
      chainId: SEPOLIA,
      storage,
      now: () => NOW,
      limitMs: 1_000
    })

    expect(chain.reads.stateOf).not.toHaveBeenCalled()
    expect((await readWatcherRecord(storage, SEPOLIA, ACCOUNT))?.reading).toMatchObject({
      hasSetup: false,
      dormant: false
    })
  })

  it('stops counting a dismissed attempt on the badge, and counts the next attempt', async () => {
    const { chain, storage, poll, record } = setUp()
    chain.setState(ACCOUNT, stateWith({ attemptId: 4n, state: 'Waiting', payload: PAYLOAD }))
    expect(await poll()).toBe(1)

    await dismissAttempt(SEPOLIA, ACCOUNT, 4n, storage)
    expect(await poll()).toBe(0)
    expect((await record())?.reading?.attempt?.attemptId).toBe(4n)
    expect((await record())?.dismissed).toEqual([4n])

    chain.setState(ACCOUNT, stateWith({ attemptId: 5n, state: 'Waiting', payload: PAYLOAD }))
    expect(await poll()).toBe(1)
  })

  it('writes one record per watched account', async () => {
    const { chain, poll, record } = setUp([ACCOUNT, OTHER_ACCOUNT])
    chain.setState(ACCOUNT, stateWith({ attemptId: 4n, state: 'Waiting', payload: PAYLOAD }))
    chain.setState(OTHER_ACCOUNT, stateWith())

    expect(await poll()).toBe(1)
    expect((await record(ACCOUNT))?.reading?.attempt?.attemptId).toBe(4n)
    expect((await record(OTHER_ACCOUNT))?.reading?.account).toBe(OTHER_ACCOUNT)
    expect((await record(OTHER_ACCOUNT))?.reading?.attempt).toBeUndefined()
  })
})
