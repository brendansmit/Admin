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
- Done: added real sidebar sections for Overview, Time, Birthdays, Calendar/events and Settings. Added birthday data model, CSV/Excel import via `xlsx`, deterministic name/birthdate column detection, batch tags, relationship tags, editable birthday rows, filters and recurring birthday reminders through ServerChan.
- Verification: birthday unit tests passed for CSV import, upcoming birthday sorting and once-per-day reminder selection. Local API smoke test logged in, imported two CSV birthdays with `'27`, filtered them, displayed upcoming birthdays in dashboard data and edited one record. npm reports one high-severity advisory in `xlsx`; no automatic fix was applied to avoid dependency churn.
- Done: added a separate reminder cron token so the daily server-side reminder job can run without a browser session while public reminder API calls still require login.
- Verification: local smoke test confirmed `/api/notifications/run` rejects admin-token-only calls without a session and accepts the same call when `x-cron-token` is present.
- Done: deployed the password wall, navigation, birthday import/management and cron-token reminder runner to the droplet. Updated PM2 env with generated `ADMIN_PASSWORD`, `SESSION_SECRET` and `REMINDER_CRON_TOKEN`; updated `/opt/admin-platform/run-reminders.sh`.
- Verification: live `/` redirects to `/login`, unauthenticated `/api/dashboard` returns `401`, login succeeds with the generated admin password, authenticated dashboard and birthday APIs return data, public `/api/notifications/run` rejects admin-token-only calls and the remote cron dry run returns `{"sent":0,"events":[]}`.

## 2026-06-30

- Request: `admin.inkheron.app` was down.
- Cause: `/login` returned `500` because the login route passed a shallow-copied request object into the static-file helper, losing `headers`.
- Done: added a `pathname` override option to `serveStatic()` and used the real request object for `/login`.
- Verification: local syntax and unit tests passed. Local `/login` smoke test returned `200 OK` with login HTML.

## 2026-06-30

- Request: change the admin dashboard password.
- Done: updated the live PM2 `ADMIN_PASSWORD`, restarted `admin-platform` and updated the local temp secrets note at `/private/tmp/inkheron-admin-live-secrets.txt`.
- Verification: old password now returns `401`, new password returns `200`, `/api/health` is OK and authenticated `/api/dashboard` works.

## 2026-06-30

- Request: troubleshoot why the iPhone Shortcuts arrive automation only fired while editing the location radius.
- Done: identified this as iOS geofence trigger behavior rather than a webhook failure because manual Shortcut runs reached `/api/work-log`.
- Decision: recommend testing by leaving the geofence fully and re-entering, using a wider radius or separate NFC backup if iOS remains unreliable.

## 2026-06-30

- Request: fix buggy time tracking totals and raw event display.
- Done: changed work summaries to use the `Asia/Shanghai` time zone by default, pair work sessions by location, include open sessions in totals and ignore duplicated or explicitly ignored events.
- Done: normalized iPhone Shortcut payload keys and values so accidental trailing spaces no longer make `source` or `device` show as `unknown`.
- Done: changed the Time page to show paired sessions first, keep raw webhook events in a collapsible debug section and added Ignore/Restore actions for bad events.
- Verification: unit tests and syntax checks passed. Local smoke test reproduced the 07:32 arrive, 12:08 leave and stray arrive case; after ignoring the stray arrive, Today/Week/Month all showed 4 h 36 min.

## 2026-06-30

- Request: deploy the time tracking fix and clean the live bad timing data.
- Done: pushed the fix to GitHub `main` and `codex/admin-dashboard`, rsynced it to `/opt/admin-platform` and restarted PM2 `admin-platform`.
- Done: marked the live stray `2026-06-30T04:03:05.048Z` arrive event ignored, leaving the real `07:32` to `12:03` session intact. Backfilled old arrive events so `source` and `device` display as `iphone_shortcuts` and `Brendan iPhone`.
- Verification: live dashboard API reports `todayMinutes: 271`, `weekMinutes: 276`, `monthMinutes: 276`, no open session and no warning sessions.

## 2026-06-30

- Request: rethink the Shortcut/time-tracking design because geofence leave may fire during the day and Shortcuts still may not run reliably.
- Decision: leaving the radius should be treated as a signal, not as final day completion. A better model is pending leave with a grace window, NFC/manual confirmation as the reliable path and geofence/Wi-Fi as backup hints.
- Decision: Apple supports Arrive, Leave, Wi-Fi and NFC automations running automatically, but location triggers remain unreliable in practice because iOS decides when to deliver them.
