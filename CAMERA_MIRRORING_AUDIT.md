# Camera Mirroring Audit — Toowix Meet

**Date:** 2026-10-12
**Scope:** `toowix-web-app` (frontend) and `toowix-backend` (settings schema/API)
**Method:** full-repo search for `mirror`, `Mirror`, `scaleX`, `flip`, `selfView`, plus `git log` across the full history for every commit touching mirroring.

---

## 1. Current state (as of this audit)

**No video is software-mirrored anywhere in the app today.** Every camera view — self-view, remote participants, prejoin lobby preview, pinned/stage view, grid tiles, the screen-share sidebar thumbnail, and the `/meet-direct` page — renders the camera's raw, unflipped capture.

**Update (2026-10-12, same day):** the dead "Mirror my video" toggle described below has since been **removed** from Settings → Meetings (Option A in §6 was chosen and implemented). The rest of this document is kept as-is as the historical record of the investigation; §6 now reflects the resolution rather than an open question.

---

## 2. What mirroring means here

"Mirroring" = applying `transform: scaleX(-1)` to a `<video>` element so your own camera feed is flipped horizontally, the way a bathroom mirror (or most video-calling apps' self-view) shows you. It's purely a local rendering choice — it never changes what's actually sent over the wire to other participants, who always see the real, unflipped orientation.

---

## 3. Every code location that can affect mirroring

| File | Role |
|---|---|
| `toowix-web-app/src/components/MeetingParticipantCard.tsx` | **The only place in the app that can apply `scaleX(-1)`.** Gated behind a `mirrored?: boolean` prop, which **defaults to `false`**. |
| `toowix-web-app/src/pages/MeetingRoomPage.tsx` | Renders `MeetingParticipantCard` at 3 sites (local self-view tile, remote participant grid, pinned-view "other participants" filmstrip). **None pass `mirrored`.** Also renders the 2 prejoin preview `<video>` elements (compact + full lobby layouts) — neither has a `transform`. |
| `toowix-web-app/src/components/meeting/ParticipantGallery.tsx` | Renders `MeetingParticipantCard` at 2 sites (extracted from `MeetingRoomPage.tsx` during the later MVC refactor). **Neither passes `mirrored`.** |
| `toowix-web-app/src/pages/DirectMeetingRoomPage.tsx` | The `/meet-direct` entry point. Contains no `scaleX`, `rotateY`, or `mirror` reference at all. |
| `toowix-web-app/src/components/settings/MeetingsSection.tsx` | The Settings → Meetings page. Declares `mirrorMyVideo` in its form `DEFAULTS` (currently `false`) and renders a `<Toggle label="Mirror my video" .../>` bound to it. **This value is read nowhere else in the frontend** — it is saved to the backend and then never consulted again. |
| `toowix-backend/src/models/User.ts` | Mongoose schema: `meetingDefaults.mirrorMyVideo: { type: Boolean, default: false }`, plus the matching `IUserMeetingDefaults` TS interface field. This is pure, inert data storage — no backend logic branches on it either. |
| `toowix-backend/src/settings/settings.service.ts` | Generic settings read/write service; persists whatever `meetingDefaults` object the frontend sends, `mirrorMyVideo` included, without interpreting it. |
| `toowix-web-app/tests/video-mirroring.test.cjs` | Regression suite (added 2026-10-10) that pins all of the above as intentional, tested behavior — see §6. |

**Searched and confirmed absent:** no CSS class, stylesheet rule, or `index.css` entry applies mirroring; no "flip" toggle exists anywhere in the UI (the word "flip" only appears in unrelated comments — e.g. "flips `joined` to true" — not a mirroring feature); no PiP-specific mirroring logic.

---

## 4. How this was verified (not assumed)

The frontend regression test `toowix-web-app/tests/video-mirroring.test.cjs` statically asserts, by reading the actual source files:

1. `MeetingParticipantCard`'s `mirrored` prop defaults to `false`, and `scaleX(-1)` stays gated behind it (no unconditional mirroring).
2. **None** of the ≥3 `<MeetingParticipantCard ... />` render sites in `MeetingRoomPage.tsx` pass `mirrored={true}` (scans every render block with a regex, not a manual spot-check).
3. **Neither** of the 2 prejoin preview `<video ref={videoPreviewRef} ...>` elements has any `transform` at all.
4. `DirectMeetingRoomPage.tsx` contains no `scaleX`, `rotateY`, or `mirror` reference.
5. `mirrorMyVideo` defaults to `false` on **both** the frontend form (`MeetingsSection.tsx`) and the backend Mongoose schema (`User.ts`) — checked for drift between the two.

This test currently passes, meaning the "no mirroring anywhere" state is the actively-enforced, intentional state of the codebase, not an untested assumption.

---

## 5. History — how it got here

Found via `git log --all -i --grep="mirror"` across the full repository history:

| Commit | Date | What changed |
|---|---|---|
| `52e1bfe` — *"unmirror self-view camera, preload Jitsi scripts, honest join progress"* | 2026-10-08 | **The real fix.** Removed hardcoded `transform: 'scaleX(-1)'` and `mirrored` props from every self-view surface: lobby preview, in-call pinned stage, grid tile, screen-share sidebar, and the direct-call page. Before this commit, self-view **was** mirrored everywhere, unconditionally (not behind any toggle). |
| `eed673e` — *"disable mirrorMyVideo by default; it was a dead setting with no effect on rendering"* | 2026-10-10 | **The cleanup fix.** At this point `mirrorMyVideo` had defaulted to `true` (frontend form and backend schema both) while being completely disconnected from the already-unmirrored rendering from `52e1bfe` — i.e. the toggle claimed "on" while doing nothing. Flipped both defaults to `false` so the dead setting at least doesn't misleadingly default to "on," and added `video-mirroring.test.cjs` to guard the whole surface from silently regressing. |

**Net effect of the two commits together:** mirroring went from *"on everywhere, unconditionally, no user control"* → *"off everywhere, with a Settings toggle that looks like it controls it but doesn't."*

---

## 6. Resolution (2026-10-12)

This audit originally presented two options and deliberately didn't pick one. **Option A was chosen**: the dead "Mirror my video" toggle has been removed from `MeetingsSection.tsx` (both the `DEFAULTS` field and the rendered `Toggle`) rather than wired up.

What stayed, deliberately:

- **`MeetingParticipantCard.tsx`'s `mirrored` prop and `scaleX(-1)` rendering path are untouched.** That capability was kept intact in `52e1bfe` and remains available if a real mirroring feature is ever built properly — it's just not driven by anything right now.
- **The backend schema field (`toowix-backend/src/models/User.ts`, `meetingDefaults.mirrorMyVideo`) was kept**, not removed, for backward compatibility with any already-stored user documents that have a saved value. It's inert — no code reads it — but removing it was judged not proven safe to do in the same pass as the frontend cleanup.
- No other frontend file ever referenced `mirrorMyVideo` (confirmed by a fresh repo-wide search before removal), so removing the Settings UI was a complete, self-contained deletion with no dangling references.

`tests/video-mirroring.test.cjs` was updated accordingly: it now asserts the toggle and the `mirrorMyVideo` string are entirely absent from `MeetingsSection.tsx`, while a separate test confirms the backend schema field is still present. A new test was also added covering `ParticipantGallery.tsx` (the post-refactor gallery render sites), which predated this audit's original test file and wasn't covered by it.

---

## 7. Quick reference — answering common questions

- **"Is my self-view flipped like a mirror right now?"** No. It shows your real camera orientation, same as what others see.
- **"Does the Settings toggle do anything if I click it?"** The toggle no longer exists — it was removed (§6) after this audit confirmed it never did anything.
- **"Do remote participants ever get mirrored?"** No, never — confirmed by the same test suite, and there's no code path that could do this even if `mirrorMyVideo` were wired up (mirroring is, and should remain, a local-only, self-view-only concept).
- **"Is this a regression or intentional?"** Intentional. Two deliberate commits (§5) got the app to this exact state, with a test suite enforcing it.
