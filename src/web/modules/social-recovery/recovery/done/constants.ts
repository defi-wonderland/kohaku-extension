import { dedicatedToOneSAPriv } from '@ambire-common/interfaces/keystore'

/**
 * The privilege the recovered account's creation is computed with where no
 * privilege event names the value the removed key held: the one the wallet's
 * picker gives the key of a smart account it creates. Where the account was
 * created with another value, the computed creation does not reproduce the
 * deployed account's address and stands in for the record the wallet lacks.
 */
export const CREATION_STAND_IN = dedicatedToOneSAPriv

/** How long the add of the recovered account may take before it reads as failed, in ms. */
export const ADD_LIMIT_MS = 20_000

/** The kinds of method that prove an identity, whose identifier stays the same across setups. */
export const IDENTITY_KINDS = ['zkpassport', 'aadhaar'] as const
