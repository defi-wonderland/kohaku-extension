/**
 * The translate function every renderer here takes.
 *
 * A renderer is a pure function of its inputs and of `t`: it reads no clock,
 * no zone and no storage of its own. The default `t` is the app's i18next `t`,
 * so a screen calls a renderer without passing one and a test runs it under
 * Jest's node environment with the real strings of en.json.
 */

/** Reads one key of en.json, with i18next interpolation options. */
export type Translate = (key: string, options?: Record<string, unknown>) => string
