/**
 * The source the ceremony screen reads its ceremony from, injected through
 * React context. The screen imports no SDK double: PT-038's follow-up provides
 * a resolver over its client and PT-040's records, and a test provides its own.
 * With no provider the screen runs nothing and reports not supported, since
 * this build then holds no implementation for any method.
 */
import React, { createContext, ReactNode, useContext, useMemo } from 'react'

import type { ReportStore, ReportSubscribe } from '../channel'
import type { CeremonyResolver } from '../run'
import type { VisibilitySource } from '../visibility'

export interface CeremonySource {
  /** Finds the ceremony a request id names. */
  resolve?: CeremonyResolver
  /** Where the tab writes its report; the extension's local storage by default. */
  store?: ReportStore
  /** How a caller listens for a report; storage change events by default. */
  subscribe?: ReportSubscribe
  /** The document the visibility gate reads; `document` by default. */
  visibility?: VisibilitySource
}

const CeremonySourceContext = createContext<CeremonySource>({})

export const CeremonySourceProvider = ({
  source,
  children
}: {
  source: CeremonySource
  children: ReactNode
}) => {
  const value = useMemo(() => source, [source])
  return <CeremonySourceContext.Provider value={value}>{children}</CeremonySourceContext.Provider>
}

export const useCeremonySource = (): CeremonySource => useContext(CeremonySourceContext)
