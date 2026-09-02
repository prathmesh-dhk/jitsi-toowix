# Feature Comparison: Google Meet vs Jitsi (base) vs MiroTalk vs Toowix

Legend: ✅ Available &nbsp; ⚠️ Partial &nbsp; ❌ Missing

| Feature | Google Meet | Jitsi (base engine) | MiroTalk | **Toowix (ours, current)** |
|---|---|---|---|---|
| **Core meeting** |
| Instant / unique meeting ID | ✅ | ✅ | ✅ | ✅ |
| Custom room name | ✅ | ✅ | ✅ | ✅ |
| Scheduled meetings (calendar) | ✅ | ⚠️ (calendar-sync, read-only) | ❌ | ✅ (built this session — full calendar UI) |
| Waiting room / Lobby | ✅ | ✅ | ⚠️ (basic) | ❌ (Jitsi has it, not exposed in our dashboard yet) |
| Screen sharing | ✅ | ✅ | ✅ | ✅ (inherited from Jitsi) |
| In-meeting chat | ✅ | ✅ | ✅ (public + private) | ✅ (inherited) |
| Raise hand / reactions | ✅ | ✅ | ⚠️ | ✅ (inherited) |
| Virtual background / blur | ✅ | ✅ | ❌ | ✅ (inherited) |
| Live captions | ✅ (multi-language + AI translate) | ✅ (subtitles/transcribing) | ❌ | ⚠️ (inherited, not verified wired) |
| Recording | ✅ (to Drive, transcripts) | ⚠️ (Jibri/Dropbox, needs infra) | ✅ (client-side blob recording) | ❌ (no storage/retention backend) |
| Whiteboard | ⚠️ (Jamboard integration, being retired) | ❌ | ✅ (built-in) | ❌ |
| File sharing in-call | ✅ (via chat) | ⚠️ | ✅ | ⚠️ (inherited via chat) |
| Live streaming / broadcast (RTMP) | ✅ (YouTube) | ✅ | ✅ | ❌ (not wired) |
| **Host / moderation controls** |
| Mute participant / mute all | ✅ | ✅ | ✅ | ✅ (inherited) |
| Lock mic (prevent unmute) | ✅ | ✅ (AV moderation) | ⚠️ | ✅ (inherited) |
| Remove / kick participant | ✅ | ✅ | ✅ | ✅ (inherited) |
| Assign co-host / transfer host | ✅ | ⚠️ (via Prosody moderator rights) | ❌ | ⚠️ (inherited, server-dependent) |
| Admit/reject from lobby | ✅ | ✅ | ⚠️ | ❌ (not exposed in our dashboard) |
| End meeting for all | ✅ | ✅ | ⚠️ | ✅ (inherited) |
| **Engagement tools** |
| Breakout rooms | ✅ | ✅ (react/features/breakout-rooms exists) | ❌ | ❌ (not exposed/tested in our build) |
| Polls | ✅ (Business+ plans) | ✅ (`polls` feature exists) | ❌ | ❌ (not exposed) |
| Q&A | ✅ (Business+ plans) | ❌ | ❌ | ❌ |
| Noise suppression | ✅ | ✅ | ✅ | ✅ (inherited) |
| **SaaS / platform layer (the part we're actually building)** |
| Signup / Login | ✅ (Google account) | ❌ (needs external auth) | ❌ | ✅ (Firebase email + Google SSO) |
| Company / org registration + approval workflow | ✅ (Workspace admin) | ❌ | ❌ | ✅ (built — Super Admin approve/reject, Firebase account disabled until approved) |
| Super Admin dashboard | ✅ (Admin console) | ❌ | ❌ | ✅ (separate Superadmin app: companies, users, suspend/reactivate) |
| Company Admin dashboard (team mgmt, branding, limits) | ✅ | ❌ | ❌ | ❌ |
| User dashboard (home, join/create, live meeting list) | ✅ | ⚠️ (basic recent-list only) | ⚠️ (single-room focus) | ✅ (built — real data, not mock) |
| Meeting scheduling UI (calendar, pick date/time) | ✅ | ❌ (read-only calendar-sync) | ❌ | ✅ (built this session) |
| Recordings library (view/share/download, retention policy) | ✅ (Drive + retention rules) | ❌ | ⚠️ (local blob only, no library) | ❌ |
| Usage / storage dashboards | ✅ (Workspace admin) | ❌ | ❌ | ❌ |
| People / Teams management page | ✅ | ❌ | ❌ | ⚠️ (nav tabs exist, no backend) |
| 2FA | ✅ | ❌ | ❌ | ⚠️ (schema field exists, no TOTP flow) |
| Billing / plans | ✅ | ❌ | ❌ | ❌ (Company model has `plan` field, no billing logic) |

---

## Biggest gaps vs. Google Meet, in priority order

1. **Lobby / waiting-room admit-reject UI** — Jitsi has the engine, we just haven't surfaced host controls for it in the Toowix dashboard.
2. **Recordings library** — no storage backend, retention policy, or list/download UI at all.
3. **Breakout rooms & Polls** — both exist in Jitsi's feature set already, just not exposed/tested through our wrapper.
4. **Company Admin dashboard** — team management, logo upload, per-company limits — nothing built yet.
5. **Whiteboard** — neither Jitsi nor Toowix has one; MiroTalk does. Would need a third-party embed or custom build.
6. **Usage/storage dashboards & billing** — needed for a real SaaS but entirely unbuilt.

## What Toowix already does that plain Jitsi doesn't
- Full multi-tenant company approval pipeline (PENDING → Super Admin review → ACTIVE), enforced at the Firebase auth layer, not just app-level.
- Real Super Admin panel for platform-wide company/user management.
- Live, database-backed meeting list and calendar scheduling (Jitsi's own calendar-sync is read-only against external calendars, not a real scheduler).

Sources:
- [Using Breakout Rooms, Polling, Q&A, and Host Controls in Google Meet](https://clt.champlain.edu/kb/using-breakout-rooms-polling-qa-and-host-controls-in-google-meet/)
- [Google Meet Review 2026: Pricing, Features, Pros & Cons](https://lasotifa.com/google-meet-review/)
- [Google Meet - Google for Education](https://edu.google.com/intl/ALL_us/workspace-for-education/products/meet/)
- [MiroTalk GitHub](https://github.com/miroslavpejic85/mirotalk)
- [MiroTalk SFU](https://sfu.mirotalk.com/)
