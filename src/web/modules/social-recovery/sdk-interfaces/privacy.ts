/**
 * The privacy levels the setup screen offers, mirrored from
 * docs/social-recovery/design/ux-interfaces.md D-375 as written. These are the
 * extension's and the SDK's encoding over the two metadata fields of the setup
 * event; the contract defines no levels and reads neither field.
 *
 * Copied at design commit bd8780f7ad59a451035b15920c00015a2eee6e9b of
 * defi-wonderland/mast-social-recovery-2. Whether a screen offers two levels or
 * three is a screen decision (cut-q-23), not this file's.
 *
 * - private, the default: shape and values encrypted into the private field,
 *   nothing readable in the public one.
 * - shape-visible: the shape in the clear in the public field, the values
 *   encrypted in the private one.
 * - public: everything in the clear and no recovery password.
 */
export const PRIVACY_LEVELS = ['private', 'shape-visible', 'public'] as const
export type PrivacyLevel = typeof PRIVACY_LEVELS[number]

/** The default level, D-375. */
export const DEFAULT_PRIVACY_LEVEL: PrivacyLevel = 'private'
