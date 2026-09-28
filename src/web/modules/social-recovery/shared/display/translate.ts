/** Reads one key of en.json, with i18next interpolation options. */
export type Translate = (key: string, options?: Record<string, unknown>) => string
