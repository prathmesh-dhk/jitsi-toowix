# Website verification

Run from the repository root in your local terminal:

```powershell
node scripts/test-website.cjs
```

Checks source conflict markers, frontend TypeScript, the production frontend build,
backend compilation, and the existing isolated backend security regression suite.
The security suite uses mocked database models and authentication. It does not
prove production database integration. Each run writes logs and a JSON summary
to a new `toowix-website-test-*` directory under your system temporary directory.
The report path is printed on completion. Failed checks exit with code 1.

With frontend and backend already running, add read-only HTTP checks:

```powershell
node scripts/test-website.cjs --web http://localhost:3000 --api http://localhost:4000
```

HTTP checks cover public page shells, backend/database health, missing meeting
responses and authentication gates. A page shell responding is not proof that
its interactive features work.

Optional real browser rendering checks (requires `playwright` installed in the
frontend or root package, plus its Chromium browser):

```powershell
node scripts/test-website.cjs --web http://localhost:3000 --api http://localhost:4000 --browser
```

This checks public pages in light/dark themes at mobile width, uncaught browser
exceptions, overflow and the expired-link heading. It does not submit forms.
`--strict` exits with code 1 if any coverage is skipped, as well as on failures.

## Coverage still requiring a dedicated environment

This script is a verification baseline, not an exhaustive website acceptance test.
Signed-in dashboard/settings/contact management, meeting creation and scheduling,
accept/decline RSVP, sharing-permission changes, email delivery, two-participant
Jitsi calls, moderator actions, camera toggles, real PiP and Jibri recording through
playback require test accounts and running services. They are explicitly reported
as skipped. Existing scripts that create accounts or modify databases are not
automatically executed. No push, deployment or test email is performed.
