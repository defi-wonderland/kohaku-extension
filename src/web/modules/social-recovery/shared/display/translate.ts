/**
 * The translate function every renderer here takes.
 *
 * A renderer is a pure function of its inputs and of `t`: it reads no clock,
 * no zone and no storage of its own. The default `t` reads the app's i18next
 * instance, so a screen calls a renderer without passing one and a test runs
 * it under Jest's node environment with the real strings of en.json.
 */
import i18n from '@common/config/localization'

/** Reads one key of en.json, with i18next interpolation options. */
export type Translate = (key: string, options?: Record<string, unknown>) => string

/** The app's own `t`, reading `socialRecovery.*` from en.json. */
export const appTranslate: Translate = (key, options) => String(i18n.t(key, options))
