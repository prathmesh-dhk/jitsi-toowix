# Toowix Meet — Full Product Context

> **Purpose**: This document is the single source of truth for the Toowix Meet product vision, milestone plan, and architecture constraints. Reference it in every session.

---

## Product Vision

Build **meet.toowix.com** as a **SaaS product on top of Jitsi**, comparable to Google Meet, with:

- Company accounts & workspaces
- Company admins and users with role-based access
- Meeting scheduling with recurring support
- Guest and private meetings
- Recording with retention policies
- Company-level controls and policies
- Toowix Super Admin for platform governance
- Future-ready subscription/plans architecture (no payment gateway in V1)

---

## Architecture Principle

```
┌─────────────────────────────────────────────────────┐
│               Toowix SaaS Layer                     │
│  Auth · Companies · Users · Teams · Scheduling      │
│  Policies · Recording Mgmt · Admin Panels           │
├─────────────────────────────────────────────────────┤
│             Jitsi Meeting Engine                    │
│  Prosody · Jicofo · JVB · lib-jitsi-meet            │
└─────────────────────────────────────────────────────┘
```

- **Jitsi remains the meeting engine.** Do NOT heavily modify Jitsi core.
- Build all SaaS features as a **separate application layer**.
- This keeps future Jitsi upgrades and maintenance easy.

---

## Stage-wise Development Milestones

### Milestone 1 — Jitsi Base Setup & White-Labeling

**Objective**: Get the core meeting engine stable, branded, and deployed.

| Feature | Status |
|---------|--------|
| Deploy latest stable Jitsi | Required |
| Configure `meet.toowix.com` | Required |
| Toowix branding always visible (logos, watermark, favicon, title) | Required |
| Configure secure HTTPS (Let's Encrypt) | Required |
| Create unique meeting IDs | Required |
| Allow custom meeting IDs | Required |
| Desktop & mobile browser compatibility | Required |
| Enable lobby / waiting room | Required |
| Enable meeting chat | Required |
| Enable screen sharing | Required |
| Enable raise hand | Required |
| Enable reactions | Required |
| Enable captions | Required |
| Enable background blur / virtual background | Required |
| Host can mute participants / everyone | Required |
| Host can prevent forcibly muted user from unmuting | Required |
| No forced camera control (privacy rule) | Required |
| Host / co-host can end meeting for everyone | Required |
| Normal participant can leave individually | Required |

**Deliverable**: A stable branded Jitsi meeting system running on `meet.toowix.com`.

---

### Milestone 2 — Signup & Company Registration

**User Flow**: Sign Up → Register Company → Pending Approval → Super Admin Approval → Workspace Activated

| Feature | Notes |
|---------|-------|
| Signup (email/password) | Standard registration |
| Sign in | Email/password login |
| Forgot password | Email-based reset |
| Email verification | Required before access |
| Company registration | Company name, logo upload, main admin account |
| Pending approval screen | Shows status after registration |
| Approved / rejected status | Visual feedback |
| Google SSO | OAuth2 integration |
| Microsoft SSO | OAuth2 integration |
| 2FA support | Optional, configurable |

> **Important**: Registration does NOT automatically activate the company. Only Toowix Super Admin can approve the first company account.

---

### Milestone 3 — Toowix Super Admin Panel

Super Admin capabilities:

| Area | Actions |
|------|---------|
| Company management | View pending, approve, reject, suspend, reactivate, view details |
| User management | View all users, suspend, force password reset |
| Meeting oversight | View company meeting usage |
| Storage & recordings | View storage usage, view/delete recordings |
| Company limits | Configure: max users, max meeting duration, recording storage limit, recording retention, feature access, meeting limits |

> **Important**: No payment gateway required in V1. Plans/limits manually managed by Super Admin.

---

### Milestone 4 — Company Admin Panel

Once a company is approved, its admin gets a dashboard.

| Area | Actions |
|------|---------|
| Company profile | Edit details, upload/change logo |
| User management | Add, invite (any email), remove, suspend, reactivate, force password reset |
| Teams/Departments | Create teams, add users, assign roles |
| Roles | Company Admin (full), Host (create/manage meetings), Member (normal user) |
| Security | Require 2FA, configure meeting policies, configure recording settings |

---

### Milestone 5 — User Dashboard

Google Meet-style dashboard with:

| Section | Content |
|---------|---------|
| Main actions | "New Meeting" button, "Schedule Meeting" button |
| Upcoming Meetings | Scheduled meetings list |
| Past Meetings | Meeting history |
| My Recordings | User's recordings |
| People | Company users directory |
| Teams | Team groupings |
| Meeting History | Full log |

**People directory** lets users: start meeting, schedule meeting, invite to meeting.

---

### Milestone 6 — Meeting Creation

Two meeting types:

| Type | Behavior |
|------|----------|
| **Guest Meeting** | Anyone with link can reach meeting. Host controls entry via lobby. |
| **Private Meeting** | Only invited email IDs can join. |

Meeting creation options: auto-generate ID, custom ID, title, invitees, guest/private toggle, lobby enable/disable.

---

### Milestone 7 — Host & Co-host Controls

| Role | Capabilities |
|------|-------------|
| **Host** | Admit/reject guests, mute participant/everyone, lock microphone, allow microphone again, remove participant, assign co-host, transfer host, end meeting for all |
| **Co-host** | Manage lobby, admit/reject, mute participants, remove participants |

> **Privacy Rule**: Host must NEVER remotely turn ON another user's microphone. Host may only: mute, block unmuting, or allow user to unmute themselves.

---

### Milestone 8 — Meeting Scheduling

| Field | Options |
|-------|---------|
| Meeting title | Free text |
| Date & time | Date picker + time picker |
| Invitees | Email addresses |
| Type | Private / Guest |
| Recurring | Daily, Weekly, Monthly |
| Description | Rich text |
| Modify scope | Only this, this + future, entire series |

---

### Milestone 9 — Calendar Integration

Integrate with:
- Google Calendar
- Microsoft Outlook / Microsoft 365 Calendar

When scheduled: calendar event created → Toowix Meet link added → invitees receive calendar invitation.

---

### Milestone 10 — Recording System

| Feature | Details |
|---------|---------|
| Recording trigger | Manual or automatic (company policy) |
| Ownership | Recording belongs to Host by default |
| Host actions | Watch, download, delete, share |
| Sharing | Recording appears in meeting history/chat for registered company users. Guest-only users cannot access. |
| Admin access | Company Admin can access company recordings. Super Admin has full administration. |

---

### Milestone 11 — Recording Retention & Storage

- Retention options: 30 / 60 / 90 days / custom
- Based on limits set by Super Admin
- Track: total storage, used, remaining

---

### Milestone 12 — Company Meeting Management

Company Admin sees:
- Upcoming/past company meetings
- Meeting host, duration, participants, recording status
- Can edit/cancel scheduled meetings, view history

---

### Milestone 13 — Company Usage Dashboard

Simple V1 dashboard showing:
- Total users / active users
- Total meetings / meeting minutes
- Recording storage used / remaining
- User limit / meeting limits

---

### Milestone 14 — Company Meeting Policies

Company Admin configures:
- Who can host meetings
- Guest access rules
- Lobby requirement
- Recording enabled/disabled/automatic
- Screen sharing permissions
- Microphone controls
- Who can create meetings
- Meeting duration rules
- 2FA requirement

---

### Milestone 15 — Plans Architecture (No Payments)

Database/backend structured for future plans:

| Plan | Description |
|------|-------------|
| Free | Basic limits |
| Business | Higher limits, more recording storage |
| Enterprise | Custom limits |

V1: Super Admin manually assigns plan, users, storage, recording quota, meeting duration, feature permissions. Payment integration (Stripe) comes later.

---

## Development Priority Order

```
Stage 1   Jitsi infrastructure
    ↓
Stage 2   Authentication + Company Registration
    ↓
Stage 3   Super Admin
    ↓
Stage 4   Company Admin + Users + Teams
    ↓
Stage 5   User Dashboard
    ↓
Stage 6   Meeting Creation + Guest/Private Meetings
    ↓
Stage 7   Host Controls
    ↓
Stage 8   Scheduling + Recurring Meetings
    ↓
Stage 9   Google & Microsoft Calendar
    ↓
Stage 10  Recording
    ↓
Stage 11  Admin Meeting Management + Usage
    ↓
Stage 12  Policies + Limits + Plan Architecture
```

---

## Explicitly Out of V1

Do NOT build these now:
- Persistent Teams-style chat
- File sharing inside meeting chat
- Full Microsoft Teams collaboration system
- Payment gateway
- AI meeting summary
- AI transcription workflow
- AI action items
- Advanced attendance reports
- User impersonation
- Custom customer domains

These can be added in later phases.
