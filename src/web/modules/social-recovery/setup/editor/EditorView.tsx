/**
 * The setup editor over the draft record. Every edit runs one of the pure
 * operations, writes the draft and the path together, and keeps the path equal
 * to the draft's clauses. A credential the path already holds is refused
 * before the record changes. Continue runs the SDK's path check on the draft
 * and opens the waiting period only when the check finds no error.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'

import Button from '@common/components/Button'
import Text from '@common/components/Text'
import { useTranslation } from '@common/config/localization'
import { WEB_ROUTES } from '@common/modules/router/constants/common'
import spacings from '@common/styles/spacings'
import type {
  Clause,
  Credential,
  Finding,
  SetupDraft
} from '@web/modules/social-recovery/sdk-interfaces'
import { defaultSetupDraft } from '@web/modules/social-recovery/shared/records'
import type { SlotKind } from '@web/modules/social-recovery/shared/records'
import { getRuleLines } from '@web/modules/social-recovery/shared/rule-lines'

import EditorActions from './EditorActions'
import EditorHeader from './EditorHeader'
import GroupList from './GroupList'
import MemberPicker from './MemberPicker'
import {
  addGroup,
  blocksContinue,
  emptySlotOf,
  enrollSearchOf,
  kindOf,
  makeItAGroup,
  makeItAGroupRoles,
  makeRequired,
  methodCountOf,
  methodKindOf,
  moveToGroup,
  PICKER_KINDS,
  pickerEntriesOf,
  placeAt,
  placedRoles,
  removeClause,
  removeMember,
  rolesOf,
  SECOND_METHOD_KINDS,
  setThreshold,
  withClauses,
  withoutRole
} from './operations'
import RequiredRows from './RequiredRows'
import SecondMethodOffer from './SecondMethodOffer'
import type {
  ClauseRole,
  ClientRefusal,
  EditorLoad,
  EditorViewProps,
  EditResult,
  PickerTarget,
  SlotPosition
} from './types'

const EditorView = ({ records, client, addressBook, navigate }: EditorViewProps) => {
  const { t } = useTranslation()
  const [load, setLoad] = useState<EditorLoad | null>(null)
  const [refused, setRefused] = useState(false)
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const [movingRow, setMovingRow] = useState<number | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [checking, setChecking] = useState(false)
  const [checkFailed, setCheckFailed] = useState(false)
  const checkingRef = useRef(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [writeFailed, setWriteFailed] = useState(false)
  const writeFailedRef = useRef(false)
  const mounted = useRef(true)
  const loadRef = useRef<EditorLoad | null>(null)
  const writes = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    mounted.current = true
    Promise.all([records.setupDraft.read(), records.enrollments.read()])
      .then(([draft, enrollments]) => {
        const stored = draft.status === 'present' ? draft.value : defaultSetupDraft()
        const next: EditorLoad = {
          draft: stored,
          enrollments: enrollments.status === 'present' ? enrollments.value : [],
          mode: stored.clauses.length > 0 ? 'adjust' : 'build',
          roles: rolesOf(stored.clauses)
        }
        loadRef.current = next
        if (mounted.current) setLoad(next)
      })
      .catch(() => {
        if (mounted.current) setLoadFailed(true)
      })
    return () => {
      mounted.current = false
    }
  }, [records, loadAttempt])

  const retryLoad = () => {
    setLoadFailed(false)
    setLoadAttempt((attempt) => attempt + 1)
  }

  const clauses = useMemo(() => load?.draft.clauses ?? [], [load])

  // The draft and the path land together, each write after the one before; a
  // failed write holds continue until a later write lands.
  const persist = useCallback(
    (draft: SetupDraft) => {
      writes.current = writes.current.then(async () => {
        try {
          await records.writeDraftAndPath(draft)
          writeFailedRef.current = false
        } catch {
          writeFailedRef.current = true
        }
        if (mounted.current) setWriteFailed(writeFailedRef.current)
      })
    },
    [records]
  )

  const retryWrite = () => {
    const current = loadRef.current
    if (!current || checkingRef.current) return
    persist(current.draft)
  }

  // A clause keeps the role the edit that made it gave it, so a group that
  // loses members down to one stays a group while the holder edits.
  const commit = useCallback(
    (next: Clause[], roles: ClauseRole[]) => {
      const current = loadRef.current
      if (!current || checkingRef.current) return
      const draft = withClauses(current.draft, next)
      const updated = { ...current, draft, roles }
      loadRef.current = updated
      setLoad(updated)
      setRefused(false)
      setFindings([])
      setCheckFailed(false)
      setMovingRow(null)
      persist(draft)
    },
    [persist]
  )

  const apply = useCallback(
    (result: EditResult, rolesAt: (at: SlotPosition) => ClauseRole[]) => {
      if (checkingRef.current) return null
      if (result.status === 'refused') {
        setRefused(true)
        return null
      }
      commit(result.clauses, rolesAt(result.at))
      return result.at
    },
    [commit]
  )

  const current = () => loadRef.current?.draft.clauses ?? []
  const currentRoles = () => loadRef.current?.roles ?? []

  const closePicker = () => {
    setPicker(null)
    setRefused(false)
  }

  const onPick = (credential: Credential) => {
    if (!picker) return
    const target = picker
    const placed = apply(placeAt(current(), target, credential), (at) =>
      placedRoles(currentRoles(), target, at)
    )
    if (placed) closePicker()
  }

  const onEnrollNew = (kind: SlotKind) => {
    if (!picker || checkingRef.current) return
    const at =
      picker.place === 'slot'
        ? { clause: picker.clause, member: picker.member }
        : apply(placeAt(current(), picker, emptySlotOf(kind)), (placed) =>
            placedRoles(currentRoles(), picker, placed)
          )
    if (!at) return
    closePicker()
    // The enroll screen reads the slot from the stored draft, so it opens once the write lands.
    writes.current
      .then(() => {
        if (mounted.current && !writeFailedRef.current) {
          navigate(`${WEB_ROUTES.socialRecoverySetupEnroll}${enrollSearchOf(kind, at)}`)
        }
      })
      .catch(() => undefined)
  }

  const onMove = (row: number, group: number) =>
    apply(moveToGroup(current(), row, group), () => withoutRole(currentRoles(), row))

  // Every edit holds while the check runs, so the check runs on the draft
  // the holder goes on with.
  const endCheck = () => {
    checkingRef.current = false
    if (mounted.current) setChecking(false)
  }

  const onContinue = async () => {
    if (client.status !== 'ready' || !loadRef.current || checkingRef.current) return
    checkingRef.current = true
    setChecking(true)
    setCheckFailed(false)
    setFindings([])
    try {
      await writes.current
      if (writeFailedRef.current) {
        endCheck()
        return
      }
      const draft = loadRef.current.draft
      const result = await client.setup.validateSetup(draft)
      if (!mounted.current) return
      if (blocksContinue(result)) {
        setFindings(result.errors)
        endCheck()
        return
      }
      navigate(WEB_ROUTES.socialRecoverySetupWaitingPeriod)
    } catch {
      if (mounted.current) setCheckFailed(true)
      endCheck()
    }
  }

  const ruleLines = useMemo(
    () =>
      getRuleLines(clauses, {
        skipMemberlessClauses: true,
        kindOfMethod: (method) => methodKindOf(method, addressBook)
      }),
    [clauses, addressBook]
  )
  const entries = useMemo(
    () => pickerEntriesOf(load?.enrollments ?? [], clauses, addressBook),
    [load, clauses, addressBook]
  )

  if (!load) {
    if (!loadFailed) return <ActivityIndicator testID="editor-spinner" />
    return (
      <View testID="editor">
        <Text
          fontSize={14}
          appearance="errorText"
          style={spacings.mbMd}
          testID="editor-load-failed"
        >
          {t('socialRecovery.records.loadFailed')}
        </Text>
        <Button
          testID="editor-load-retry"
          type="outline"
          text={t('socialRecovery.writes.tryAgain')}
          onPress={retryLoad}
          hasBottomSpacing={false}
        />
      </View>
    )
  }

  const indexed = clauses.map((clause, index) => ({ clause, index }))
  const rows = indexed.filter(({ index }) => load.roles[index] === 'required')
  const groups = indexed.filter(({ index }) => load.roles[index] === 'group')
  const methodCount = methodCountOf(clauses)
  let clientRefusal: ClientRefusal | null = null
  if (client.status === 'update-the-wallet') clientRefusal = 'update-the-wallet'
  else if (client.status === 'failed' || (client.status === 'ready' && checkFailed)) {
    clientRefusal = 'unavailable'
  }

  const pickerKinds = (target: PickerTarget): readonly SlotKind[] => {
    if (target.place === 'second') return SECOND_METHOD_KINDS
    return target.place === 'slot' && target.kind ? [target.kind] : PICKER_KINDS
  }

  const openSlot = (clause: number, member: number) => {
    const credential = clauses[clause].credentials[member]
    setPicker({ place: 'slot', clause, member, kind: kindOf(credential, addressBook) })
  }

  return (
    <View testID="editor">
      <EditorHeader mode={load.mode} refused={refused} clientRefusal={clientRefusal} />

      <RequiredRows
        rows={rows}
        groups={groups}
        movingRow={movingRow}
        addressBook={addressBook}
        enrollments={load.enrollments}
        checking={checking}
        onOpenSlot={openSlot}
        onMove={onMove}
        onChooseGroup={setMovingRow}
        onRemove={(index) =>
          commit(removeClause(current(), index), withoutRole(currentRoles(), index))
        }
        onAdd={() => setPicker({ place: 'required' })}
      />

      <GroupList
        groups={groups}
        addressBook={addressBook}
        enrollments={load.enrollments}
        checking={checking}
        onOpenSlot={openSlot}
        onThreshold={(index, threshold) =>
          commit(setThreshold(current(), index, threshold), currentRoles())
        }
        onMakeRequired={(index, member) =>
          apply(makeRequired(current(), index, member), () => [...currentRoles(), 'required'])
        }
        onRemoveMember={(index, member) =>
          commit(removeMember(current(), index, member), currentRoles())
        }
        onAddMember={(index) => setPicker({ place: 'member', clause: index })}
        onRemoveGroup={(index) =>
          commit(removeClause(current(), index), withoutRole(currentRoles(), index))
        }
        onAddGroup={() => commit(addGroup(current()), [...currentRoles(), 'group'])}
      />

      {!!picker && (
        <MemberPicker
          entries={entries}
          kinds={pickerKinds(picker)}
          addressBook={addressBook}
          onPick={onPick}
          onEnrollNew={onEnrollNew}
          onClose={closePicker}
          disabled={checking}
        />
      )}

      {ruleLines.length > 0 && (
        <SecondMethodOffer
          ruleLines={ruleLines}
          checking={checking}
          // The sizing line counts required rows by their stored shape, so
          // the press gathers every clause that shape reads as a row.
          onMakeItAGroup={() =>
            commit(makeItAGroup(current()), makeItAGroupRoles(rolesOf(current())))
          }
          onAddSecondMethod={() => setPicker({ place: 'second' })}
        />
      )}

      <EditorActions
        client={client}
        findings={findings}
        methodCount={methodCount}
        checking={checking}
        checkFailed={checkFailed}
        writeFailed={writeFailed}
        onRetryWrite={retryWrite}
        onContinue={onContinue}
        onBack={() => navigate(WEB_ROUTES.socialRecoverySetup)}
      />
    </View>
  )
}

export default React.memo(EditorView)
