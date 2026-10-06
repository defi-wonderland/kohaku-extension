/**
 * What the holder typed in the account field: an address, a name to resolve,
 * or neither. A value that starts like an address but is not a complete one,
 * or whose mixed case fails its checksum, is refused before any read; so is a
 * value with no dot, which no name service resolves.
 */
import { isAddress } from 'viem'

import type { LookupInput } from './types'

const HEX_PREFIX = /^0x/i

export const lookupInputOf = (value: string): LookupInput => {
  const trimmed = value.trim()
  if (trimmed === '') {
    return { kind: 'empty' }
  }
  if (HEX_PREFIX.test(trimmed)) {
    return isAddress(trimmed, { strict: true })
      ? { kind: 'address', address: trimmed }
      : { kind: 'malformed' }
  }
  if (!trimmed.includes('.') || /\s/.test(trimmed)) {
    return { kind: 'malformed' }
  }
  return { kind: 'name', name: trimmed }
}
