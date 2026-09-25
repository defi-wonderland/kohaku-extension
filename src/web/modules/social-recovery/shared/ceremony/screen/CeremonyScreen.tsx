/**
 * The ceremony tab: the full tab every ceremony that dies on focus loss runs
 * in. It reads its ceremony from the route's search params, resolves it
 * through the injected source, runs the host of its call, reports the outcome
 * through the return channel once the tab is visible, and returns to
 * `returnTo` where the caller named one.
 *
 * A report that storage refuses stays in memory: the tab shows the delivery
 * failure and offers a retry that writes the report again and runs no second
 * ceremony.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { useLocation, useNavigate } from 'react-router-dom'

import Button from '@common/components/Button'
import Panel from '@common/components/Panel'
import Spinner from '@common/components/Spinner'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import useTheme from '@common/hooks/useTheme'
import Header from '@common/modules/header/components/Header'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import {
  TabLayoutContainer,
  TabLayoutWrapperMainContent
} from '@web/components/TabLayoutWrapper/TabLayoutWrapper'
import type { DeviceBinding } from '@web/modules/social-recovery/sdk-interfaces'
import { renderChip, renderHash } from '@web/modules/social-recovery/shared/display'
import { getUiType } from '@web/utils/uiType'

import { sendCeremonyReport, sweepCeremonyReports } from '../channel'
import type { CeremonyStep } from '../device'
import type { ClaimValue, EnrollValue, TestAccessValue } from '../hosts'
import { lossLineKeyOf, renderKindLine } from '../kindLine'
import { CeremonyParams, parseCeremonySearch } from '../request'
import { ceremonyMayRun, ResolvedCeremony, runCeremony } from '../run'
import {
  browserErrorNameOf,
  CeremonyOutcome,
  chipOfOutcome,
  lineKeyOfOutcome,
  notSupported,
  noteKeyOfOutcome,
  unavailable
} from '../verdicts'
import { createVisibilityGate, VisibilityGate, whenVisible } from '../visibility'
import {
  browserPasskeyDevice,
  browserReportKeys,
  browserReportStore,
  pagePasskeysServed,
  pagePlatform
} from './browserDefaults'
import { useCeremonySource } from './CeremonySource'

type Phase = 'resolving' | 'running' | 'reporting' | 'undelivered' | 'done' | 'nothing'

const hashOfValue = (value: unknown): string | null => {
  const v = value as Partial<TestAccessValue & ClaimValue>
  if (v?.proof) return renderHash(v.proof)
  if (v?.reply?.proof) return renderHash(v.reply.proof)
  return null
}

const CeremonyScreen = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const source = useCeremonySource()

  const parsed = useMemo(() => parseCeremonySearch(location.search), [location.search])
  const mayRun = useMemo(() => ceremonyMayRun(getUiType()), [])

  const [phase, setPhase] = useState<Phase>('resolving')
  const [step, setStep] = useState<CeremonyStep>('preparing')
  const [binding, setBinding] = useState<DeviceBinding | null>(null)
  const [outcome, setOutcome] = useState<CeremonyOutcome<unknown> | null>(null)
  const [reportHeld, setReportHeld] = useState(false)

  const mounted = useRef(true)
  const started = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const gate = useRef<VisibilityGate | null>(null)
  const visibility = source.visibility ?? (typeof document !== 'undefined' ? document : undefined)

  useEffect(() => {
    mounted.current = true
    if (visibility) gate.current = createVisibilityGate(visibility)
    // Reports nobody took within their expiry leave storage. A removal is a
    // storage write, so it waits for the tab to be shown.
    const store = source.store ?? browserReportStore
    const sweep = () => browserReportKeys().then((keys) => sweepCeremonyReports(store, keys))
    const sweeping = gate.current ? gate.current.dispatch(sweep) : sweep()
    sweeping.catch(() => undefined)
    return () => {
      mounted.current = false
      abort.current?.abort()
      gate.current?.dispose()
      gate.current = null
    }
  }, [visibility, source.store])

  /**
   * Writes the report of `result` and returns to `returnTo`. A write that
   * storage refuses while the tab stays open leaves `result` in memory and
   * shows the delivery failure, whose retry calls this again with the same
   * result and runs no second ceremony.
   */
  const deliver = useCallback(
    async (params: CeremonyParams, result: CeremonyOutcome<unknown>) => {
      const held = gate.current
      if (!mounted.current || !held) return
      setPhase('reporting')

      // The report is stamped inside the gate, when it is written.
      const sending = sendCeremonyReport(params, result, {
        store: source.store ?? browserReportStore,
        gate: held
      })
      setReportHeld(held.pending() > 0)
      try {
        await sending
      } catch {
        // The tab closed first, and its gate dropped the held write.
        if (!mounted.current) return
        // The tab stays open: storage refused the write, or the gate it waited
        // in was replaced. The retry writes through the current gate.
        setReportHeld(false)
        setPhase('undelivered')
        return
      }
      if (!mounted.current) return
      setReportHeld(false)
      setPhase('done')
      if (params.returnTo) navigate(params.returnTo, { replace: true })
    },
    [source.store, navigate]
  )

  const start = useCallback(async () => {
    if (!parsed.ok || !mayRun) return
    const { params } = parsed
    const controller = new AbortController()
    abort.current = controller
    setOutcome(null)
    setStep('preparing')
    setPhase('resolving')

    // A hidden tab dispatches nothing: not the resolve, not the prompt, which
    // the browser refuses without focus anyway.
    if (visibility) await whenVisible(visibility)
    if (!mounted.current) return

    // No resolver wired: this build holds no implementation to run.
    let result: CeremonyOutcome<unknown> = notSupported('no-implementation')
    if (source.resolve) {
      let resolved: ResolvedCeremony | null | undefined
      try {
        resolved = await source.resolve(params)
      } catch {
        // The records or the client did not answer: retry may find them.
        result = unavailable('service-unanswered')
      }
      if (resolved === null) {
        if (mounted.current) setPhase('nothing')
        return
      }
      if (resolved) {
        if (!mounted.current) return
        setBinding(resolved.method.deviceBinding)
        if (visibility) await whenVisible(visibility)
        if (!mounted.current) return
        setPhase('running')
        result = await runCeremony(params, resolved, {
          devices: { 'browser-authenticator': browserPasskeyDevice() },
          signal: controller.signal,
          onStep: (next) => {
            if (mounted.current) setStep(next)
          }
        })
      }
    }
    if (!mounted.current || !gate.current) return
    setOutcome(result)
    await deliver(params, result)
  }, [parsed, mayRun, source, visibility, deliver])

  useEffect(() => {
    if (started.current) return
    started.current = true
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    start()
  }, [start])

  const renderRunning = () => (
    <View style={[flexbox.alignCenter]}>
      {step === 'waitingForPhone' ? (
        <>
          <Text weight="semiBold" fontSize={18} style={spacings.mbSm}>
            {t('socialRecovery.ceremony.continueOnPhone')}
          </Text>
          <Text appearance="secondaryText" style={[spacings.mbLg, { textAlign: 'center' }]}>
            {t('socialRecovery.ceremony.scanCode')}
          </Text>
          <Spinner style={spacings.mbSm} />
          <Text style={spacings.mbSm}>{t('socialRecovery.ceremony.waitingForPhone')}</Text>
          <Text appearance="secondaryText" style={{ textAlign: 'center' }}>
            {t('socialRecovery.ceremony.keepTabOpen')}
          </Text>
          {binding === 'external-app' && parsed.ok && parsed.params.call === 'createClaim' && (
            <Text appearance="secondaryText" style={[spacings.mtSm, { textAlign: 'center' }]}>
              {t('socialRecovery.ceremony.phoneReads')}
            </Text>
          )}
        </>
      ) : (
        <>
          <Spinner style={spacings.mbSm} />
          <Text>{renderChip('method', 'inProgress')}</Text>
        </>
      )}
      <Button
        type="secondary"
        text={t('socialRecovery.ceremony.cancelAction')}
        onPress={() => abort.current?.abort()}
        style={spacings.mtLg}
      />
    </View>
  )

  const renderOutcome = (shown: CeremonyOutcome<unknown>) => {
    if (!parsed.ok) return null
    const { params } = parsed
    const { call, returnTo } = params
    const chip = chipOfOutcome(shown, call)
    const noteKey = noteKeyOfOutcome(shown, call)
    const lineKey = lineKeyOfOutcome(shown, call)
    const passedEnroll = shown.kind === 'verdict' && shown.verdict === 'passed' && call === 'enroll'
    const facts = passedEnroll ? (shown.value as EnrollValue).facts : undefined
    const hash =
      shown.kind === 'verdict' && shown.verdict === 'passed' ? hashOfValue(shown.value) : null
    // The one raw cause text a screen shows: the browser's own error name.
    const errorName = browserErrorNameOf(shown)
    const mayRetry = shown.kind === 'dismissed' || shown.retry
    const chromeOnly = binding === 'browser-authenticator' && !pagePasskeysServed()
    return (
      <View>
        {chip && (
          <Text weight="semiBold" style={spacings.mbSm}>
            {chip.set === 'method'
              ? renderChip('method', chip.chip)
              : renderChip('collection', chip.chip)}
          </Text>
        )}
        {chromeOnly ? (
          <Text style={spacings.mbSm}>{t('socialRecovery.ceremony.chromeOnly')}</Text>
        ) : (
          noteKey && <Text style={spacings.mbSm}>{t(noteKey, { hash })}</Text>
        )}
        {errorName && (
          <Text appearance="secondaryText" fontSize={12} style={spacings.mbSm}>
            {errorName}
          </Text>
        )}
        {lineKey && !chromeOnly && (
          <Text appearance="secondaryText" style={spacings.mbSm}>
            {t(lineKey)}
          </Text>
        )}
        {facts && (
          <>
            <Text weight="medium" style={spacings.mbSm}>
              {renderKindLine(facts, pagePlatform(), t)}
            </Text>
            <Text appearance="secondaryText" style={spacings.mbSm}>
              {t(lossLineKeyOf(facts))}
            </Text>
          </>
        )}
        {passedEnroll && binding === 'browser-authenticator' && (
          <Text appearance="secondaryText" style={spacings.mbSm}>
            {t('socialRecovery.ceremony.passkeyOrigin')}
          </Text>
        )}
        {reportHeld && (
          <Text appearance="secondaryText" style={spacings.mbSm}>
            {t('socialRecovery.ceremony.keepTabOpen')}
          </Text>
        )}
        {phase === 'undelivered' && (
          <>
            <Text style={spacings.mbSm}>{t('socialRecovery.ceremony.undeliveredNote')}</Text>
            <View style={[flexbox.directionRow, spacings.mtLg]}>
              <Button
                type="secondary"
                text={t('socialRecovery.ceremony.backAction')}
                onPress={() => navigate(-1)}
              />
              <Button
                type="primary"
                text={t('socialRecovery.ceremony.tryAgainAction')}
                // eslint-disable-next-line @typescript-eslint/no-misused-promises
                onPress={() => deliver(params, shown)}
                style={spacings.mlSm}
              />
            </View>
          </>
        )}
        {phase === 'done' && !returnTo && (
          <View style={[flexbox.directionRow, spacings.mtLg]}>
            <Button
              type="secondary"
              text={t('socialRecovery.ceremony.backAction')}
              onPress={() => navigate(-1)}
            />
            {mayRetry && (
              <Button
                type="primary"
                text={t('socialRecovery.ceremony.tryAgainAction')}
                // eslint-disable-next-line @typescript-eslint/no-misused-promises
                onPress={start}
                style={spacings.mlSm}
              />
            )}
          </View>
        )}
      </View>
    )
  }

  const renderBody = () => {
    if (!mayRun) return <Text>{t('socialRecovery.ceremony.tabOnly')}</Text>
    if (!parsed.ok || phase === 'nothing') {
      return (
        <View>
          <Text style={spacings.mbLg}>{t('socialRecovery.ceremony.nothingToRun')}</Text>
          <Button
            type="secondary"
            text={t('socialRecovery.ceremony.backAction')}
            onPress={() => navigate(-1)}
          />
        </View>
      )
    }
    if (outcome) return renderOutcome(outcome)
    return renderRunning()
  }

  return (
    <TabLayoutContainer
      backgroundColor={theme.secondaryBackground}
      header={<Header mode="custom-inner-content" withAmbireLogo />}
    >
      <TabLayoutWrapperMainContent withScroll={false}>
        <Panel spacingsSize="small">{renderBody()}</Panel>
      </TabLayoutWrapperMainContent>
    </TabLayoutContainer>
  )
}

export default React.memo(CeremonyScreen)
