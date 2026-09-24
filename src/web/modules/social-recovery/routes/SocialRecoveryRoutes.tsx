import React from 'react'
import { Route, Routes } from 'react-router-dom'

import AuthenticatedRoute from '@web/modules/router/components/AuthenticatedRoute'
import KeystoreUnlockedRoute from '@web/modules/router/components/KeystoreUnlockedRoute'
import CeremonyScreen from '@web/modules/social-recovery/shared/ceremony/screen'

/**
 * The route registry of the account recovery module.
 *
 * MainRoutes mounts this element once at `social-recovery/*` inside its
 * TabOnlyRoute group, so every recovery surface opens in a full tab (ux.md
 * D-316) and this file owns the guards. The paths below are relative to that
 * mount: a screen's path is its WEB_ROUTES value without the `social-recovery/`
 * prefix, for example `setup` for WEB_ROUTES.socialRecoverySetup.
 *
 * A task adds exactly one <Route> line for its screen inside the group its
 * surface belongs to, and nothing else in this file.
 */
const SocialRecoveryRoutes = () => (
  <Routes>
    {/*
      The bare module path renders nothing until a task mounts a landing screen.
      React Router 6.8 matches a layout group only through a leaf, so without
      this index route `social-recovery` itself matches no route at all.
    */}
    <Route index element={null} />

    {/* The owner's surfaces: the keystore is unlocked and an account exists. */}
    <Route element={<KeystoreUnlockedRoute />}>
      <Route element={<AuthenticatedRoute />}>
        {/*
          Keys that mount here: socialRecoverySetup (M-7), socialRecoveryManage
          (PT-067, PT-068), socialRecoveryCancel (PT-066), socialRecoveryCreate
          (PT-042), socialRecoveryRecovery (PT-054 to PT-062).
        */}
      </Route>
    </Route>

    {/* The open surfaces: no guard, since the guardian page and the fast track run without a keystore. */}
    <Route>
      {/*
        Keys that mount here: socialRecoveryApprove (PT-063, PT-064),
        socialRecoveryFastTrack (PT-053), socialRecoveryRecover (PT-052).
        socialRecoveryCeremony (PT-041) mounts in the group its callers need.
      */}
      {/*
        PT-041, the ceremony tab. Open group: its callers are the enrollment
        rows (D-305, owner) and the checklist rows (D-392), and the fast track
        reaches the checklist from a fresh install (D-303), so the tab must not
        depend on an account being selected. The tab reads no keystore, holds
        no signer and runs only a ceremony its caller's record names. A guard
        would also send a tab waiting on a phone hand-off to the unlock screen
        on auto-lock and drop the result D-316 says arrives when the tab returns.
      */}
      <Route path="ceremony" element={<CeremonyScreen />} />
    </Route>
  </Routes>
)

export default SocialRecoveryRoutes
