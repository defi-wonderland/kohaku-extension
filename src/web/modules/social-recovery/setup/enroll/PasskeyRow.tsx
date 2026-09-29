/**
 * The passkey row. The ceremony tab creates the credential on this device or
 * over the browser's phone hand-off, in this same full tab, and returns here
 * with its report. The access test is offered right after and never enforced;
 * the row records the synced or device-bound kind from the ceremony's own
 * facts whatever the holder does with the test.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'

import Button from '@common/components/Button'
import Input from '@common/components/Input'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import {
  browserErrorNameOf,
  ceremonyPath,
  failed,
  listenForCeremonyReport,
  lossLineKeyOf,
  noteKeyOfOutcome,
  renderKindLine,
  takeCeremonyReport
} from '@web/modules/social-recovery/shared/ceremony'
import type {
  CeremonyOutcome,
  CeremonyReport,
  ReportIdentity
} from '@web/modules/social-recovery/shared/ceremony'
import {
  NAME_MAX_LENGTH,
  renderChip,
  renderHash
} from '@web/modules/social-recovery/shared/display'

import { causeOf, testLineKeyOf, testNoteKeysOf, testVerdictOf } from './outcome'
import {
  clipName,
  defaultPasskeyName,
  enrollRequestOf,
  enrollValueOf,
  kindNameKeyOf,
  passkeyEnrollmentOf,
  passkeyRequestOf,
  PASSKEY_SLUG,
  testRequestRecordOf,
  testValueOf
} from './passkey'
import { enrollPathOf } from './search'
import { testRequestOf } from './testRequest'
import { TEST_CHIPS } from './types'
import type { PasskeyCeremonyRequest, PasskeyMemory, RowProps } from './types'
import { placeEnrollment, recordTest } from './writes'

const PASSKEY = 'socialRecovery.enroll.passkey'

const PasskeyRow = ({
  records,
  setup,
  chainId,
  account,
  navigate,
  search,
  book,
  client,
  deps,
  enrollment,
  onEnrollment
}: RowProps) => {
  const { t } = useTranslation()
  const defaultName = defaultPasskeyName(deps.platform, t)
  const [name, setName] = useState(defaultName)
  const [explainer, setExplainer] = useState(false)
  const [memory, setMemory] = useState<PasskeyMemory>({})
  const [enrollOutcome, setEnrollOutcome] = useState<CeremonyOutcome<unknown> | null>(null)
  const [testOutcome, setTestOutcome] = useState<CeremonyOutcome<unknown> | null>(null)
  const [skipped, setSkipped] = useState(false)
  const [undelivered, setUndelivered] = useState(false)
  const [writeFailed, setWriteFailed] = useState(false)
  const [duplicate, setDuplicate] = useState(false)
  const [busy, setBusy] = useState(false)

  const enrollmentRef = useRef(enrollment)
  enrollmentRef.current = enrollment

  const applyEnroll = useCallback(
    async (outcome: CeremonyOutcome<unknown>, userName: string) => {
      setName(userName)
      if (outcome.kind !== 'verdict' || outcome.verdict !== 'passed') {
        setEnrollOutcome(outcome)
        return
      }
      const value = enrollValueOf(outcome.value)
      if (!value) {
        setEnrollOutcome(failed('material-rejected'))
        return
      }
      const created = passkeyEnrollmentOf(value, book.methods.passkey, userName)
      try {
        const placed = await placeEnrollment(setup, search, book, created)
        if (placed.status !== 'placed') {
          setDuplicate(placed.status === 'duplicate')
          setWriteFailed(placed.status === 'slot-taken')
          return
        }
      } catch {
        setWriteFailed(true)
        return
      }
      setWriteFailed(false)
      setDuplicate(false)
      setEnrollOutcome(null)
      setTestOutcome(null)
      setSkipped(false)
      setMemory({
        ...(value.facts ? { facts: value.facts } : {}),
        ...(value.credentialId ? { credentialId: value.credentialId } : {})
      })
      onEnrollment(created)
    },
    [book, setup, search, onEnrollment]
  )

  const applyTest = useCallback(
    async (outcome: CeremonyOutcome<unknown>, asked: PasskeyCeremonyRequest) => {
      if (asked.call !== 'testAccess') return
      const current = enrollmentRef.current
      setMemory((held) => ({ ...held, credentialId: asked.credentialId ?? held.credentialId }))
      setTestOutcome(outcome)
      const verdict = testVerdictOf(outcome)
      if (!current || !verdict) return
      if (verdict === 'passed') {
        const value =
          outcome.kind === 'verdict' && outcome.verdict === 'passed'
            ? testValueOf(outcome.value)
            : null
        setMemory((held) => ({
          ...held,
          salt: asked.request.salt,
          ...(value?.facts ? { facts: value.facts } : {})
        }))
      }
      try {
        const updated = await recordTest(setup, current.credential, verdict, causeOf(outcome))
        setWriteFailed(false)
        if (updated) onEnrollment(updated)
      } catch {
        setWriteFailed(true)
      }
    },
    [setup, onEnrollment]
  )

  const applyReport = useCallback(
    (report: CeremonyReport, asked: PasskeyCeremonyRequest) =>
      asked.call === 'enroll'
        ? applyEnroll(report.outcome, asked.userName ?? defaultName)
        : applyTest(report.outcome, asked),
    [applyEnroll, applyTest, defaultName]
  )
  const applyRef = useRef(applyReport)
  applyRef.current = applyReport

  // The report of the ceremony this tab returned from is taken once, then its
  // request is wiped and the search loses the id, so a reload waits for
  // nothing. A report that lands after the mount arrives through the listener.
  const taking = useRef<string | null>(null)
  const ceremonyId = search.ceremony
  useEffect(() => {
    if (!ceremonyId || taking.current === ceremonyId) return undefined
    taking.current = ceremonyId
    let live = true
    let unsubscribe: (() => void) | undefined
    const done = (report: CeremonyReport, asked: PasskeyCeremonyRequest) => {
      records
        .ceremonyRequest(ceremonyId)
        .wipe()
        .catch(() => undefined)
      setUndelivered(false)
      applyRef.current(report, asked).catch(() => setWriteFailed(true))
      navigate(enrollPathOf(search), { replace: true })
    }
    const take = async () => {
      const stored = await records.ceremonyRequest(ceremonyId).read()
      const asked = stored.status === 'present' ? passkeyRequestOf(stored.value) : null
      if (!asked) {
        navigate(enrollPathOf(search), { replace: true })
        return
      }
      const identity: ReportIdentity = { id: ceremonyId, call: asked.call, method: PASSKEY_SLUG }
      const report = await takeCeremonyReport(identity, deps.reportStore, deps.now())
      if (report) {
        done(report, asked)
        return
      }
      setUndelivered(true)
      if (!live) return
      unsubscribe = listenForCeremonyReport(
        identity,
        deps.reportSubscribe,
        deps.reportStore,
        (late) => done(late, asked),
        deps.now
      )
    }
    take().catch(() => setUndelivered(true))
    return () => {
      live = false
      unsubscribe?.()
    }
    // The search's slot is fixed for this row; only a new ceremony id runs this again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ceremonyId])

  const create = useCallback(
    async (handOff: boolean) => {
      const userName = clipName(name.trim()) || defaultName
      const id = deps.newRequestId()
      setBusy(true)
      try {
        await records
          .ceremonyRequest(id)
          .write(
            enrollRequestOf({ account, chainId, methodAddress: book.methods.passkey, userName })
          )
      } catch {
        setWriteFailed(true)
        setBusy(false)
        return
      }
      navigate(
        ceremonyPath({
          call: 'enroll',
          method: PASSKEY_SLUG,
          id,
          handOff,
          returnTo: enrollPathOf(search, id)
        })
      )
    },
    [name, defaultName, deps, records, account, chainId, book, navigate, search]
  )

  const runTest = useCallback(async () => {
    if (client.status !== 'ready' || !enrollment) return
    const request = testRequestOf({
      descriptor: client.client.descriptor,
      chainId,
      account,
      method: book.methods.passkey,
      config: enrollment.credential.config,
      now: deps.now(),
      randomBytes: deps.randomBytes
    })
    const id = deps.newRequestId()
    setBusy(true)
    try {
      await records
        .ceremonyRequest(id)
        .write(
          testRequestRecordOf({ account, chainId, request, credentialId: memory.credentialId })
        )
    } catch {
      setWriteFailed(true)
      setBusy(false)
      return
    }
    navigate(
      ceremonyPath({
        call: 'testAccess',
        method: PASSKEY_SLUG,
        id,
        handOff: false,
        returnTo: enrollPathOf(search, id)
      })
    )
  }, [client, enrollment, chainId, account, book, deps, records, memory, navigate, search])

  const enrollNote = enrollOutcome ? noteKeyOfOutcome(enrollOutcome, 'enroll') : null
  const enrollError = enrollOutcome ? browserErrorNameOf(enrollOutcome) : null
  // A phone that never connected is the one outcome that says the holder chose the hand-off.
  const handOffTried =
    enrollOutcome?.kind === 'verdict' &&
    enrollOutcome.verdict === 'unavailable' &&
    enrollOutcome.cause === 'unreachable'
  const enrollRetry = !!enrollOutcome && (enrollOutcome.kind === 'dismissed' || enrollOutcome.retry)
  const lineKey = enrollment ? testLineKeyOf(enrollment, skipped, `${PASSKEY}.testPassed`) : null
  const testNotes = testOutcome ? testNoteKeysOf(testOutcome, lineKey) : []
  const testError = testOutcome ? browserErrorNameOf(testOutcome) : null
  const canTest = deps.passkeysServed && client.status === 'ready' && !busy

  return (
    <View testID="enroll-passkey">
      <Text fontSize={20} weight="semiBold" style={spacings.mbTy}>
        {t('socialRecovery.enroll.passkey.title')}
      </Text>
      <Text testID="passkey-kind-name" fontSize={16} weight="medium" style={spacings.mbTy}>
        {t(kindNameKeyOf(memory.facts ?? (handOffTried ? { place: 'phone' } : undefined)))}
      </Text>
      {!deps.passkeysServed && (
        <Text
          testID="passkey-chrome-only"
          fontSize={14}
          appearance="errorText"
          style={spacings.mbSm}
        >
          {t('socialRecovery.ceremony.chromeOnly')}
        </Text>
      )}

      {!enrollment && (
        <View testID="passkey-create">
          <Text fontSize={14} appearance="secondaryText" style={spacings.mbTy}>
            {t('socialRecovery.enroll.passkey.authenticators')}
          </Text>
          <Button
            testID="passkey-learn-more"
            type="ghost"
            text={t('socialRecovery.actions.learnMore')}
            onPress={() => setExplainer((open) => !open)}
            hasBottomSpacing={false}
          />
          {explainer && (
            <Text testID="passkey-explainer" fontSize={14} style={spacings.mbSm}>
              {t('socialRecovery.enroll.passkey.explainer')}
            </Text>
          )}
          <Input
            testID="passkey-name"
            label={t('socialRecovery.enroll.passkey.nameLabel')}
            value={name}
            maxLength={NAME_MAX_LENGTH}
            onChangeText={(text: string) => setName(clipName(text))}
          />
          <Text testID="passkey-none-yet" fontSize={14} weight="medium" style={spacings.mbTy}>
            {t('socialRecovery.enroll.passkey.noneYet')}
          </Text>
          {!!enrollNote && (
            <Text testID="passkey-enroll-note" fontSize={14} appearance="errorText">
              {t(enrollNote)}
            </Text>
          )}
          {!!enrollError && (
            <Text testID="passkey-enroll-error" fontSize={12} appearance="secondaryText">
              {enrollError}
            </Text>
          )}
          {enrollRetry && deps.passkeysServed && (
            <Button
              testID="passkey-try-again"
              type="outline"
              text={t('socialRecovery.ceremony.tryAgainAction')}
              disabled={busy}
              onPress={() => create(handOffTried)}
              hasBottomSpacing={false}
            />
          )}
          {deps.passkeysServed && (
            <>
              <Text fontSize={14} appearance="secondaryText" style={spacings.mbSm}>
                {t('socialRecovery.enroll.passkey.createLine')}
              </Text>
              <View style={[flexbox.directionRow, flexbox.alignCenter, spacings.mbSm]}>
                <Button
                  testID="passkey-create-here"
                  type="primary"
                  text={t('socialRecovery.enroll.passkey.create')}
                  disabled={busy}
                  onPress={() => create(false)}
                  hasBottomSpacing={false}
                  style={spacings.mrSm}
                />
                <Button
                  testID="passkey-create-on-phone"
                  type="ghost"
                  text={t('socialRecovery.enroll.passkey.createOnPhoneInstead')}
                  disabled={busy}
                  onPress={() => create(true)}
                  hasBottomSpacing={false}
                />
              </View>
              <Text fontSize={12} appearance="secondaryText">
                {t('socialRecovery.enroll.passkey.testOffered')}
              </Text>
            </>
          )}
        </View>
      )}

      {!!enrollment && (
        <View testID="passkey-enrolled">
          <View style={[flexbox.directionRow, flexbox.alignCenter, spacings.mbTy]}>
            <Text testID="passkey-label" fontSize={16} weight="medium" style={spacings.mrSm}>
              {enrollment.credential.label}
            </Text>
            <Text testID="passkey-chip" fontSize={12} weight="medium" appearance="secondaryText">
              {renderChip('method', TEST_CHIPS[enrollment.test], t)}
            </Text>
          </View>
          {!!memory.facts && (
            <Text testID="passkey-kind-line" fontSize={14} weight="medium">
              {renderKindLine(memory.facts, deps.platform, t)}
            </Text>
          )}
          {!!(memory.facts ?? enrollment.backup) && (
            <Text testID="passkey-loss-line" fontSize={14} style={spacings.mbTy}>
              {t(lossLineKeyOf({ kind: memory.facts?.kind ?? enrollment.backup ?? 'synced' }))}
            </Text>
          )}
          <Text
            testID="passkey-origin"
            fontSize={12}
            appearance="secondaryText"
            style={spacings.mbSm}
          >
            {t('socialRecovery.ceremony.passkeyOrigin')}
          </Text>

          <View testID="passkey-test" style={spacings.mbSm}>
            <View style={[flexbox.directionRow, flexbox.alignCenter, spacings.mbTy]}>
              <Text fontSize={14} weight="semiBold" style={spacings.mrSm}>
                {t('socialRecovery.enroll.accessTest')}
              </Text>
              <Text fontSize={12} appearance="secondaryText">
                {t('socialRecovery.enroll.recommended')}
              </Text>
            </View>
            {enrollment.test === 'not-tested' && !skipped && (
              <>
                <Text fontSize={14} style={spacings.mbTy}>
                  {t('socialRecovery.enroll.passkey.testLead')}
                </Text>
                <View style={[flexbox.directionRow, flexbox.alignCenter]}>
                  <Button
                    testID="passkey-run-test"
                    type="primary"
                    text={t('socialRecovery.actions.runTheTest')}
                    disabled={!canTest}
                    onPress={runTest}
                    hasBottomSpacing={false}
                    style={spacings.mrSm}
                  />
                  <Button
                    testID="passkey-skip-test"
                    type="ghost"
                    text={t('socialRecovery.actions.skipTheTest')}
                    onPress={() => setSkipped(true)}
                    hasBottomSpacing={false}
                  />
                </View>
              </>
            )}
            {!!lineKey && (
              <Text testID="passkey-test-line" fontSize={14}>
                {t(lineKey)}
              </Text>
            )}
            {enrollment.test === 'passed' && !!memory.salt && (
              <Text testID="passkey-signed-note" fontSize={12} appearance="secondaryText">
                {t('socialRecovery.enroll.passkey.signedNote', { hash: renderHash(memory.salt) })}
              </Text>
            )}
            {testNotes.map((note) => (
              <Text key={note} testID="passkey-test-note" fontSize={12} appearance="secondaryText">
                {t(note)}
              </Text>
            ))}
            {!!testError && (
              <Text testID="passkey-test-error" fontSize={12} appearance="secondaryText">
                {testError}
              </Text>
            )}
            {enrollment.test === 'passed' && (
              <Button
                testID="passkey-run-test-again"
                type="outline"
                text={t('socialRecovery.actions.runTheTestAgain')}
                disabled={!canTest}
                onPress={runTest}
                hasBottomSpacing={false}
              />
            )}
            {enrollment.test === 'not-tested' && skipped && (
              <Button
                testID="passkey-run-test"
                type="outline"
                text={t('socialRecovery.actions.runTheTest')}
                disabled={!canTest}
                onPress={runTest}
                hasBottomSpacing={false}
              />
            )}
            {(enrollment.test === 'failed' || enrollment.test === 'unavailable') && (
              <View style={[flexbox.directionRow, flexbox.alignCenter]}>
                <Button
                  testID="passkey-test-retry"
                  type="outline"
                  text={t('socialRecovery.writes.tryAgain')}
                  disabled={!canTest}
                  onPress={runTest}
                  hasBottomSpacing={false}
                  style={spacings.mrSm}
                />
                {enrollment.test === 'failed' && (
                  <Button
                    testID="passkey-create-new"
                    type="ghost"
                    text={t('socialRecovery.enroll.passkey.createNew')}
                    disabled={!deps.passkeysServed || busy}
                    onPress={() => create(false)}
                    hasBottomSpacing={false}
                  />
                )}
              </View>
            )}
          </View>
        </View>
      )}

      {undelivered && (
        <Text testID="passkey-undelivered" fontSize={14} appearance="errorText">
          {t('socialRecovery.ceremony.undeliveredNote')}
        </Text>
      )}
      {duplicate && (
        <Text testID="passkey-duplicate" fontSize={14} appearance="errorText">
          {t('socialRecovery.editor.duplicate')}
        </Text>
      )}
      {writeFailed && (
        <Text testID="enroll-write-failed" fontSize={14} appearance="errorText">
          {t('socialRecovery.records.writeFailed')}
        </Text>
      )}
    </View>
  )
}

export default React.memo(PasskeyRow)
