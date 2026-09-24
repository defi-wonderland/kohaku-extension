/**
 * The cut-q-22 seam (brief delta 4): the three members that are not SDK members,
 * the verify per pasted reply (ux-interfaces.md D-373, D-374), the read naming
 * the key a recovery would remove (D-371, D-373) and the fit check against the
 * code the account will carry (D-371), scripted under one extension-owned seam
 * with a doc comment naming cut-q-22.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

import type { IWalletReadsDouble } from '@web/modules/social-recovery/sdk-doubles'
import type { Address, CreationRecord, Verdict } from '@web/modules/social-recovery/sdk-interfaces'

import { createWorld, eachIt, expectThrown, fillAll, membersOf, openRecovery } from './harness'

const CREATION: CreationRecord = {
  factory: '0x00000000000000000000000000000000000000fa',
  bytecode: '0x60',
  salt: `0x${'00'.repeat(32)}`,
  block: 950
}

describe('the cut-q-22 seam', () => {
  it('is declared under a doc comment naming cut-q-22', () => {
    const source = readFileSync(join(__dirname, '..', 'wallet-reads.ts'), 'utf8')
    const at = source.indexOf('export interface IWalletReadsDouble')
    expect(at).toBeGreaterThan(-1)
    const comment = source.slice(source.lastIndexOf('/**', at), at)
    expect(comment).toContain('cut-q-22')
  })

  it('exposes the three members', () => {
    const reads: IWalletReadsDouble = createWorld().walletReads()
    const members = membersOf(reads)
    ;['verifyReply', 'removedKey', 'fitCheck'].forEach((name) => expect(members).toContain(name))
  })

  describe('verifyReply', () => {
    it('satisfies a pasted reply that proves the request and rejects one that does not', async () => {
      const opened = await openRecovery()
      const filled = await fillAll(opened)
      const request = opened.requests[0]!
      const reply = filled.replies.find((r) => r.place === request.place)!
      const reads = opened.world.walletReads()
      const good: Verdict = await reads.verifyReply(request, reply)
      expect(good).toBe('satisfied')
      const forged = { ...reply, proof: `0x${'ab'.repeat(65)}` as const }
      expect(await reads.verifyReply(request, forged)).toBe('rejected')
    })
  })

  describe('removedKey', () => {
    it('names the one key where the configuration carries a creation record', async () => {
      const world = createWorld()
      expect(await world.walletReads({ creation: CREATION }).removedKey()).toEqual({
        kind: 'named',
        key: world.keys.held
      })
    })

    it('says why it names none without a creation record', async () => {
      expect(await createWorld().walletReads().removedKey()).toEqual({
        kind: 'unavailable',
        cause: 'no-creation-record'
      })
    })

    it('says why it names none where several keys hold a key value', async () => {
      const world = createWorld()
      world.chain.setAuthorities([world.keys.held, world.keys.fresh])
      expect(await world.walletReads({ creation: CREATION }).removedKey()).toEqual({
        kind: 'unavailable',
        cause: 'several-key-entries'
      })
    })
  })

  describe('fitCheck', () => {
    it('judges deployed code by supportsAccount', async () => {
      const world = createWorld()
      world.script.code(true)
      expect(await world.walletReads().fitCheck()).toEqual({ basis: 'deployed-code', fits: true })
    })

    it('judges an account with no code by the implementation it will carry', async () => {
      const world = createWorld()
      world.script.code(false)
      const served = world.descriptor.servedImplementation
      const other: Address = '0x00000000000000000000000000000000000000bb'
      const reads = world.walletReads()
      expect(await reads.fitCheck(served)).toEqual({
        basis: 'code-to-be',
        implementation: served,
        fits: true
      })
      expect(await reads.fitCheck(other)).toEqual({
        basis: 'code-to-be',
        implementation: other,
        fits: false
      })
      expect(await reads.fitCheck()).toEqual({ basis: 'no-code', fits: false })
    })
  })

  eachIt(['verifyReply', 'removedKey', 'fitCheck'] as const)(
    'throws a scripted %s read failure',
    async (member) => {
      const opened = await openRecovery()
      const request = opened.requests[0]!
      const filled = await fillAll(opened)
      const reply = filled.replies.find((r) => r.place === request.place)!
      opened.world.script.failRead(`walletReads.${member}`)
      const reads = opened.world.walletReads({ creation: CREATION })
      const run = {
        verifyReply: () => reads.verifyReply(request, reply),
        removedKey: () => reads.removedKey(),
        fitCheck: () => reads.fitCheck()
      }
      await expectThrown(run[member])
    }
  )
})
