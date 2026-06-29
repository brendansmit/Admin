# Session Notes

## 2026-06-29

- Request: create the first version of `admin.inkheron.app` for work time tracking and ServerChan birthday/event reminders.
- Decision: cloned the empty `brendansmit/Admin` repo into the writable workspace and created branch `codex/admin-dashboard`.
- Done: scaffolded a dependency-light Node admin app with a static dashboard shell, health API, ServerChan key placeholder and ignored runtime data.
- Verification: `node --check src/server.js` passed and `GET /api/health` returned OK from the local server.
- Done: added JSON persistence, protected `/api/work-log`, manual dashboard event creation, duplicate detection and session pairing.
- Verification: work-log unit tests passed under bundled Node. API smoke test posted 08:02 arrive and 16:41 leave, then `/api/dashboard` returned 519 minutes.
- Done: added calendar reminder storage, ServerChan key saving, due-reminder selection, notification runner endpoint, month totals and dashboard forms for manual corrections and reminders.
- Verification: calendar and work-log unit tests passed under bundled Node. API smoke test saved a fake ServerChan key, added a staff birthday and returned it as `nextReminder`.
- Verification: opened `http://127.0.0.1:3468/` in the in-app browser and confirmed the rendered dashboard, online server status, calendar form and notification settings are present.

## 2026-06-29

- Request: push the admin dashboard to GitHub and deploy it to `admin.inkheron.app` for tomorrow's iPhone Shortcut testing.
- Done: pushed the current Admin repo HEAD to GitHub `main` and branch `codex/admin-dashboard`.
- Done: deployed the app to the droplet at `/opt/admin-platform`, started it with PM2 as `admin-platform` on port `3474`, added nginx config for `admin.inkheron.app` and issued a Let's Encrypt certificate with certbot.
- Done: added remote cron job `10 0 * * * /opt/admin-platform/run-reminders.sh`, which runs daily at 08:10 China time and calls `/api/notifications/run`.
- Decision: generated strong live `ADMIN_TOKEN` and `WEBHOOK_TOKEN`, stored only in remote PM2 config and local temporary note `/private/tmp/inkheron-admin-live-secrets.txt`, not in Git.
- Verification: `https://admin.inkheron.app/api/health` returned OK, `/api/dashboard` returned an empty dashboard, HTTP redirected to HTTPS, unauthenticated `/api/work-log` returned `401` and the cron script dry run returned `{"sent":0,"events":[]}`.

## 2026-06-29

- Request: add a temporary ServerChan notification for arrival so tomorrow's geofence test is visible without opening the dashboard.
- Done: added arrive-only notification after successful `/api/work-log` saves. Duplicate arrivals and leave events do not notify. ServerChan failures are logged but do not block work logging.
- Decision: because the live dashboard had no ServerChan key saved, use the previously supplied ServerChan key server-side for the test and still recommend rotating it later.
- Verification: syntax check and all unit tests passed. Local smoke test posted an arrive event and returned a saved event with notification skipped when no key was configured. Live app returned healthy and confirmed `hasServerChanKey: true`. Did not fire a live arrive test because it would send the real WeChat notification and add a fake work event.

## 2026-06-29

- Request: add a single-password wall, fix navigation and build birthday CSV/Excel import and management.
- Done: added server-side single-password login with signed HttpOnly session cookie, logout and session checks. `/api/work-log` remains open only to the Shortcut bearer token. Dashboard static files and dashboard APIs now require login, with admin-token checks retained on protected write APIs.
- Verification: syntax check and unit tests passed. Local smoke test confirmed unauthenticated `/` redirects to `/login`, `/api/dashboard` returns `401`, login sets a session cookie, authenticated `/api/dashboard` works and `/api/work-log` still accepts bearer-token Shortcut posts without a login session.
