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
