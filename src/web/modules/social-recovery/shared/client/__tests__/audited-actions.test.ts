/**
 * PT-038 done entry 4: the table of the kit's audited actions with their
 * publishers is the extension's own and is the only source of the action a
 * screen offers or names (ux.md D-319, sdk.md D-208 `auditedActions`). The two
 * deployment descriptors of D-208 are the lane's plain data, with named
 * placeholder addresses under cut-q-7 (brief delta 1).
 */
import * as fs from 'fs'
import * as path from 'path'

import type { Address, DeploymentDescriptor } from '@web/modules/social-recovery/sdk-interfaces'

import {
  AUDITED_ACTIONS,
  auditedActionOf,
  DEPLOYMENTS,
  DESCRIPTOR_FIELDS,
  MAINNET,
  SEPOLIA,
  UNKNOWN_ACTION
} from './harness'

const ABSENT = '0x9999999999999999999999999999999999999999' as Address

type Entry = { address: Address; publisher: string; chainId?: number }

const entries = (): Entry[] =>
  (Array.isArray(AUDITED_ACTIONS)
    ? AUDITED_ACTIONS
    : Object.values(AUDITED_ACTIONS as Record<string, unknown>).flat()) as Entry[]

const descriptors = (): DeploymentDescriptor[] =>
  Object.values(DEPLOYMENTS as Record<number, DeploymentDescriptor>)

describe('the audited-actions table', () => {
  it('lists at least one action, each with its address and its publisher', () => {
    expect(entries().length).toBeGreaterThan(0)
    entries().forEach((e) => {
      expect(e.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(typeof e.publisher).toBe('string')
      expect(e.publisher.length).toBeGreaterThan(0)
    })
  })

  it('answers the table entry for an address in the table, whatever its letter case', () => {
    entries().forEach((e) => {
      expect(auditedActionOf(e.address)).toMatchObject({
        address: e.address,
        publisher: e.publisher
      })
      expect(auditedActionOf(e.address.toLowerCase() as Address)).toMatchObject({
        publisher: e.publisher
      })
    })
  })

  it('answers the explicit unknown-action value for an address absent from the table', () => {
    expect(UNKNOWN_ACTION).toBeDefined()
    expect(auditedActionOf(ABSENT)).toBe(UNKNOWN_ACTION)
  })

  it('is the one source of each descriptor action and audited set', () => {
    const tableAddresses = entries().map((e) => e.address.toLowerCase())
    descriptors().forEach((d) => {
      expect(tableAddresses).toContain(d.action.toLowerCase())
      d.auditedActions.forEach((a) => expect(tableAddresses).toContain(a.toLowerCase()))
      expect(auditedActionOf(d.action)).not.toBe(UNKNOWN_ACTION)
    })
  })
})

describe('the deployment descriptors of D-208', () => {
  it('carries one descriptor for Sepolia and one for Ethereum mainnet', () => {
    const chains = descriptors()
      .map((d) => d.chainId)
      .sort((a, b) => a - b)
    expect(chains).toEqual([MAINNET, SEPOLIA])
    expect(DEPLOYMENTS[SEPOLIA].chainId).toBe(SEPOLIA)
    expect(DEPLOYMENTS[MAINNET].chainId).toBe(MAINNET)
  })

  it('fills every one of the thirteen fields on both descriptors', () => {
    descriptors().forEach((d) => {
      DESCRIPTOR_FIELDS.forEach((f) => {
        expect(d[f]).toBeDefined()
        expect(d[f]).not.toBeNull()
      })
      expect(d.shippedMethods.map((a) => a.toLowerCase()).sort()).toEqual(
        [d.methodEcdsa, d.methodPasskey, d.methodAadhaar, d.methodZkpassport]
          .map((a) => a.toLowerCase())
          .sort()
      )
    })
  })

  it('names cut-q-7 beside the placeholder addresses', () => {
    const lane = path.resolve(__dirname, '..')
    const sources = fs
      .readdirSync(lane, { recursive: true } as never)
      .map(String)
      .filter((f) => /\.tsx?$/.test(f) && !f.includes('__tests__'))
      .map((f) => fs.readFileSync(path.join(lane, f), 'utf8'))
    expect(sources.some((s) => s.includes('cut-q-7'))).toBe(true)
  })
})
