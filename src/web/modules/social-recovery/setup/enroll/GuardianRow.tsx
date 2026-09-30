/**
 * The guardian row. The publication line renders before the field; the field
 * takes an address or a name, with light advisory checks that never hold the
 * enrollment or the save. The wallet stores no name for a guardian. The access
 * test signs a challenge on this device through the request queue where the
 * wallet holds the key, or through the offline block, and the row reads not
 * tested until the challenge comes back signed.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { isAddress } from 'viem'

import Avatar from '@common/components/Avatar'
import Button from '@common/components/Button'
import Input from '@common/components/Input'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import spacings from '@common/styles/spacings'
import flexbox from '@common/styles/utils/flexbox'
import type { Address, Hex } from '@web/modules/social-recovery/sdk-interfaces'
import {
  browserErrorNameOf,
  enrollHost,
  noteKeyOfOutcome,
  notSupported,
  outcomeOfThrown
} from '@web/modules/social-recovery/shared/ceremony'
import type { CeremonyOutcome } from '@web/modules/social-recovery/shared/ceremony'
import { isSignerNotWired, isSignFlowFailure } from '@web/modules/social-recovery/shared/client'
import {
  renderChip,
  renderFullAddress,
  renderNoun,
  renderResolvedName,
  renderShortAddress
} from '@web/modules/social-recovery/shared/display'
import type { Enrollment } from '@web/modules/social-recovery/shared/records'

import {
  checkGuardianSignature,
  checkLinesOf,
  codeCheckOf,
  guardianAddressOf,
  guardianDevice,
  guardianTargetOf,
  heldKeyOf,
  isTypedDataToSign,
  outcomeOfSignError,
  seedCheckOf
} from './guardian'
import OfflineBlock from './OfflineBlock'
import { causeOf, testLineKeyOf, testNoteKeysOf, testVerdictOf } from './outcome'
import { testRequestOf } from './testRequest'
import { TEST_CHIPS } from './types'
import type { GuardianChallenge, GuardianChecks, NameCheck, RowProps } from './types'
import { placeEnrollment, recordTest } from './writes'

/** How long the field rests before a name resolves. */
const RESOLVE_DELAY_MS = 400

const GuardianRow = ({
  setup,
  chainId,
  account,
  search,
  book,
  client,
  deps,
  enrollment,
  onEnrollment
}: RowProps) => {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [nameCheck, setNameCheck] = useState<NameCheck | undefined>()
  const [code, setCode] = useState<'none' | 'contract' | undefined>()
  const [resolvedName, setResolvedName] = useState<string | undefined>()
  const [addOutcome, setAddOutcome] = useState<CeremonyOutcome<unknown> | null>(null)
  const [testOutcome, setTestOutcome] = useState<CeremonyOutcome<unknown> | null>(null)
  const [challenge, setChallenge] = useState<GuardianChallenge | null>(null)
  const [offline, setOffline] = useState(false)
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const pending = useRef<AbortController | null>(null)
  const [writeFailed, setWriteFailed] = useState(false)
  const [duplicate, setDuplicate] = useState(false)

  const target = useMemo(() => guardianTargetOf(value), [value])
  const { resolveName } = deps

  // A request still queued when the row goes away is withdrawn.
  useEffect(
    () => () => {
      pending.current?.abort()
    },
    []
  )

  useEffect(() => {
    if (enrollment || target.kind !== 'name') {
      setNameCheck(undefined)
      return undefined
    }
    let live = true
    setNameCheck({ status: 'resolving' })
    const timer = setTimeout(() => {
      resolveName(target.name)
        .then((resolved) => {
          if (!live) {
            return
          }
          setNameCheck(
            isAddress(resolved, { strict: false })
              ? { status: 'resolved', name: target.name, address: resolved }
              : { status: 'unresolved' }
          )
        })
        .catch(() => {
          if (live) {
            setNameCheck({ status: 'unresolved' })
          }
        })
    }, RESOLVE_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [enrollment, target, resolveName])

  const enrolledAddress = useMemo(
    () => (enrollment ? guardianAddressOf(enrollment.credential.config) : undefined),
    [enrollment]
  )
  let address: Address | undefined
  if (enrollment) {
    address = enrolledAddress
  } else if (target.kind === 'address') {
    address = target.address
  } else if (nameCheck?.status === 'resolved') {
    address = nameCheck.address
  }

  useEffect(() => {
    setCode(undefined)
    if (!address || !deps.chain) {
      return undefined
    }
    let live = true
    deps.chain
      .readCode(address)
      .then((read) => {
        if (live) {
          setCode(codeCheckOf(read))
        }
      })
      // A read the node did not answer renders neither code line.
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [address, deps.chain])

  const checks: GuardianChecks = {
    ...(!enrollment && target.kind === 'address' ? { checksum: target.checksum } : {}),
    ...(!enrollment && nameCheck ? { name: nameCheck } : {}),
    ...(code ? { code } : {}),
    ...(address ? { seed: seedCheckOf(deps.keys, address) } : {})
  }
  const checkLines = checkLinesOf(checks)

  const add = useCallback(async () => {
    if (client.status !== 'ready' || !address) {
      return
    }
    const method = client.client.methodFor('ecdsa')
    if (!method) {
      setAddOutcome(notSupported('no-implementation'))
      return
    }
    setBusy(true)
    try {
      const outcome = await enrollHost({
        orchestrator: client.client.approving,
        method,
        methodAddress: book.methods.ecdsa,
        params: { address },
        device: guardianDevice
      })
      if (outcome.kind !== 'verdict' || outcome.verdict !== 'passed') {
        setAddOutcome(outcome)
        return
      }
      const created: Enrollment = {
        credential: { method: book.methods.ecdsa, config: outcome.value.config, label: '' },
        test: 'not-tested'
      }
      const placed = await placeEnrollment(setup, search, book, created)
      setDuplicate(placed.status === 'duplicate')
      setWriteFailed(placed.status === 'slot-taken')
      if (placed.status !== 'placed') {
        return
      }
      setAddOutcome(null)
      setResolvedName(nameCheck?.status === 'resolved' ? nameCheck.name : undefined)
      onEnrollment(created)
    } catch {
      setWriteFailed(true)
    } finally {
      setBusy(false)
    }
  }, [client, address, book, setup, search, nameCheck, onEnrollment])

  const applyTest = useCallback(
    async (outcome: CeremonyOutcome<unknown>) => {
      setTestOutcome(outcome)
      const verdict = testVerdictOf(outcome)
      if (!enrollment || !verdict) {
        return
      }
      if (verdict === 'passed') {
        setOffline(false)
      }
      try {
        const updated = await recordTest(setup, enrollment.credential, verdict, causeOf(outcome))
        setWriteFailed(false)
        if (updated) {
          onEnrollment(updated)
        }
      } catch {
        setWriteFailed(true)
      }
    },
    [enrollment, setup, onEnrollment]
  )

  const check = useCallback(
    async (signed: GuardianChallenge, signature: Hex) => {
      if (!address) {
        return
      }
      setBusy(true)
      try {
        await applyTest(
          await checkGuardianSignature({
            typedData: signed.typedData,
            signature,
            address,
            chain: deps.chain
          })
        )
      } finally {
        setBusy(false)
      }
    },
    [address, deps.chain, applyTest]
  )

  // The offline block serves any key; a key the wallet holds signs on this
  // device unless the holder asks for the offline block.
  const runTest = useCallback(
    async (offlineOnly: boolean) => {
      if (client.status !== 'ready' || !enrollment || !address) {
        return
      }
      const request = testRequestOf({
        descriptor: client.client.descriptor,
        chainId,
        account,
        method: book.methods.ecdsa,
        config: enrollment.credential.config,
        now: deps.now(),
        randomBytes: deps.randomBytes
      })
      let typedData: unknown
      try {
        typedData = client.client.approving.signingInput(request)
      } catch (error: unknown) {
        setTestOutcome(outcomeOfThrown(error))
        return
      }
      if (!isTypedDataToSign(typedData)) {
        setTestOutcome(notSupported('no-implementation'))
        return
      }
      const next: GuardianChallenge = { request, typedData }
      setChallenge(next)
      setTestOutcome(null)
      const held = heldKeyOf(deps.keys, address)
      if (!held || offlineOnly) {
        setOffline(true)
        return
      }
      const controller = new AbortController()
      pending.current = controller
      setBusy(true)
      setWaiting(true)
      let signature: Hex
      try {
        signature = await deps.signTypedData({ addr: held.addr, type: held.type }, typedData, {
          signal: controller.signal
        })
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          return
        }
        pending.current = null
        setWaiting(false)
        setBusy(false)
        // A key the request queue cannot sign for, or a request withdrawn from
        // the queue, is carried to the offline block.
        if (isSignerNotWired(error) || (isSignFlowFailure(error) && error.reason === 'withdrawn')) {
          setOffline(true)
        } else {
          await applyTest(outcomeOfSignError(error))
        }
        return
      }
      // A signature that arrives after the holder withdrew the request is dropped.
      if (controller.signal.aborted) {
        return
      }
      pending.current = null
      setWaiting(false)
      setBusy(false)
      await check(next, signature)
    },
    [client, enrollment, address, chainId, account, book, deps, applyTest, check]
  )

  const withdraw = useCallback(() => {
    pending.current?.abort()
    pending.current = null
    setWaiting(false)
    setBusy(false)
    setOffline(true)
  }, [])

  const paste = useCallback(() => {
    deps
      .readClipboard?.()
      .then((text) => setValue(text.trim()))
      // A refused clipboard leaves the field as it was.
      .catch(() => undefined)
  }, [deps])

  const addNote = addOutcome ? noteKeyOfOutcome(addOutcome, 'enroll') : null
  const lineKey = enrollment
    ? testLineKeyOf(enrollment, false, 'socialRecovery.enroll.guardian.testedLine')
    : null
  const testNotes = testOutcome ? testNoteKeysOf(testOutcome, lineKey) : []
  const testError = testOutcome ? browserErrorNameOf(testOutcome) : null
  const resolved = resolvedName ? renderResolvedName(resolvedName, 'besideAddressToCheck', t) : null
  const heldKey = address ? heldKeyOf(deps.keys, address) : undefined
  const fieldResolved =
    !enrollment && nameCheck?.status === 'resolved'
      ? renderResolvedName(nameCheck.name, 'besideAddressToCheck', t)
      : null

  return (
    <View testID="enroll-guardian">
      <Text fontSize={20} weight="semiBold" style={spacings.mbTy}>
        {t('socialRecovery.enroll.guardian.title')}
      </Text>
      <Text fontSize={14} style={spacings.mbSm}>
        {t('socialRecovery.enroll.guardian.lead')}
      </Text>
      <Text testID="guardian-publication" fontSize={14} style={spacings.mbSm}>
        {t('socialRecovery.disclosures.guardianPublication')}
      </Text>

      {!enrollment && (
        <View testID="guardian-field">
          <Input
            testID="guardian-address"
            value={value}
            onChangeText={setValue}
            button={deps.readClipboard ? t('socialRecovery.actions.paste') : null}
            onButtonPress={paste}
          />
          <Text fontSize={12} appearance="secondaryText" style={spacings.mbSm}>
            {t('socialRecovery.enroll.guardian.pasteHint')}
          </Text>
          {!!fieldResolved && !!address && (
            <View testID="guardian-resolved" style={spacings.mbSm}>
              <Text fontSize={14} selectable>
                {renderFullAddress(address)}
              </Text>
              {!!fieldResolved.caveat && (
                <Text fontSize={12} appearance="secondaryText">
                  {fieldResolved.caveat}
                </Text>
              )}
            </View>
          )}
        </View>
      )}

      {!!enrollment && !!address && (
        <View testID="guardian-enrolled" style={spacings.mbSm}>
          <View style={[flexbox.directionRow, flexbox.alignCenter, spacings.mbTy]}>
            <Avatar pfp={address} isSmart={false} size={32} displayTypeBadge={false} />
            <Text testID="guardian-name" fontSize={16} weight="medium" style={spacings.mrSm}>
              {resolved ? resolved.name : renderShortAddress(address)}
            </Text>
            <Text fontSize={12} appearance="secondaryText" style={spacings.mrSm}>
              {renderNoun('guardian', t)}
            </Text>
            <Text testID="guardian-chip" fontSize={12} weight="medium" appearance="secondaryText">
              {renderChip('method', TEST_CHIPS[enrollment.test], t)}
            </Text>
          </View>
          {!!resolved && (
            <>
              <Text testID="guardian-full-address" fontSize={14} selectable>
                {renderFullAddress(address)}
              </Text>
              {!!resolved.caveat && (
                <Text fontSize={12} appearance="secondaryText">
                  {resolved.caveat}
                </Text>
              )}
            </>
          )}
        </View>
      )}

      {!!address && (
        <View testID="guardian-lines" style={spacings.mbSm}>
          <Text testID="guardian-smart-account" fontSize={14} style={spacings.mbTy}>
            {t('socialRecovery.disclosures.smartAccount')}
          </Text>
          <Text testID="guardian-call-back" fontSize={14} style={spacings.mbTy}>
            {t('socialRecovery.enroll.guardian.callBack')}
          </Text>
          <Text testID="guardian-owner-answer" fontSize={14}>
            {t('socialRecovery.enroll.guardian.ownerAnswer')}
          </Text>
        </View>
      )}

      {checkLines.length > 0 && (
        <View testID="guardian-checks" style={spacings.mbSm}>
          <Text fontSize={12} weight="medium" appearance="secondaryText" style={spacings.mbTy}>
            {t('socialRecovery.enroll.guardian.checksHeader')}
          </Text>
          {checkLines.map((line) => (
            <Text key={line.key} testID="guardian-check" fontSize={14}>
              {t(line.key, line.values)}
            </Text>
          ))}
          <Text fontSize={12} appearance="secondaryText">
            {t('socialRecovery.enroll.guardian.advisory')}
          </Text>
        </View>
      )}

      {!enrollment && (
        <View style={spacings.mbSm}>
          {!!addNote && (
            <Text testID="guardian-add-note" fontSize={14} appearance="errorText">
              {t(addNote)}
            </Text>
          )}
          <Button
            testID="guardian-add"
            type="primary"
            text={t('socialRecovery.actions.add')}
            disabled={!address || client.status !== 'ready' || busy}
            onPress={add}
            hasBottomSpacing={false}
          />
        </View>
      )}

      {!!enrollment && (
        <View testID="guardian-test-block" style={spacings.mbSm}>
          <Text fontSize={12} appearance="secondaryText" style={spacings.mbSm}>
            {t('socialRecovery.enroll.guardian.howMany')}
          </Text>

          <View style={[flexbox.directionRow, flexbox.alignCenter, spacings.mbTy]}>
            <Text fontSize={14} weight="semiBold" style={spacings.mrSm}>
              {t('socialRecovery.enroll.accessTest')}
            </Text>
            <Text fontSize={12} appearance="secondaryText">
              {t('socialRecovery.enroll.recommended')}
            </Text>
          </View>
          {!!lineKey && (
            <Text testID="guardian-test-line" fontSize={14}>
              {t(lineKey)}
            </Text>
          )}
          {testNotes.map((note) => (
            <Text key={note} testID="guardian-test-note" fontSize={12} appearance="secondaryText">
              {t(note)}
            </Text>
          ))}
          {!!testError && (
            <Text testID="guardian-test-error" fontSize={12} appearance="secondaryText">
              {testError}
            </Text>
          )}
          {enrollment.test !== 'not-supported' && (
            <View style={[flexbox.directionRow, flexbox.alignCenter]}>
              <Button
                testID="guardian-test"
                type="outline"
                text={
                  enrollment.test === 'failed' || enrollment.test === 'unavailable'
                    ? t('socialRecovery.writes.tryAgain')
                    : t('socialRecovery.enroll.guardian.testThisKey')
                }
                disabled={client.status !== 'ready' || busy}
                onPress={() => runTest(false)}
                hasBottomSpacing={false}
                style={spacings.mrSm}
              />
              {!!heldKey && (
                <Button
                  testID="guardian-test-offline"
                  type="ghost"
                  text={t('socialRecovery.enroll.offline.title')}
                  disabled={client.status !== 'ready' || busy}
                  onPress={() => runTest(true)}
                  hasBottomSpacing={false}
                />
              )}
            </View>
          )}
          {waiting && (
            <View testID="guardian-test-waiting" style={spacings.mtSm}>
              <Text fontSize={14} style={spacings.mbTy}>
                {t('socialRecovery.enroll.guardian.waitingForSignScreen')}
              </Text>
              <Button
                testID="guardian-test-withdraw"
                type="ghost"
                text={t('socialRecovery.enroll.guardian.testOfflineInstead')}
                onPress={withdraw}
                hasBottomSpacing={false}
              />
            </View>
          )}
        </View>
      )}

      {!!enrollment && offline && !!challenge && (
        <OfflineBlock
          key={challenge.request.salt}
          challenge={challenge}
          busy={busy}
          onCheck={(signature) => check(challenge, signature)}
          saveFile={deps.saveFile}
        />
      )}

      {duplicate && (
        <Text testID="guardian-duplicate" fontSize={14} appearance="errorText">
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

export default React.memo(GuardianRow)
