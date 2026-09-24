/**
 * Shared primitives of the SDK interfaces.
 *
 * Hand-written from docs/social-recovery/design/sdk.md, frozen at design commit
 * bd8780f7ad59a451035b15920c00015a2eee6e9b of defi-wonderland/mast-social-recovery-2.
 * Imported from no SDK package. Types only.
 */

/** A 20-byte address, `0x` prefixed. */
export type Address = `0x${string}`

/** Bytes as `0x` prefixed hex. */
export type Hex = `0x${string}`

/**
 * The tag a read pins at (sdk.md D-203, D-208): `latest` for a screen somebody
 * waits at, `finalized` for a watcher, or a block number a caller resolved.
 * sdk.md names these two tags and no other.
 */
export type BlockTag = 'latest' | 'finalized' | number

/**
 * One block's number, timestamp and hash, what `IProvider.block(tag)` returns
 * and every pinned record carries (sdk.md D-201, D-202, D-208).
 */
export interface BlockHeader {
  number: number
  timestamp: number
  hash: Hex
}

/**
 * A module read that says whether it was answered at all beside what it
 * answered, so a provider that failed is told from a contract that replied
 * (sdk.md D-201, D-202 "The read surface"). Illustrative shape, sdk.md D-201.
 */
export type ReadResult<T> = { answered: true; value: T } | { answered: false }
