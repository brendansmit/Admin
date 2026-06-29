# InkHeron Admin

Admin dashboard for `admin.inkheron.app`.

Phase 1 covers:

- Work arrival and leave logging from iPhone Shortcuts or NFC fallback.
- Timesheet summaries with duplicate and missing-event handling.
- Manual event corrections.
- Birthday and calendar event reminders.
- ServerChan WeChat notifications with a dashboard-managed key.

## Local use

```sh
npm start
```

Open `http://127.0.0.1:3468`.

## Configuration

Optional environment variables:

- `PORT`: server port, defaults to `3468`.
- `ADMIN_TOKEN`: bearer token for protected write APIs. Defaults to `dev-admin-token` in local development.
- `WEBHOOK_TOKEN`: bearer token for Shortcut and NFC work-log webhooks. Defaults to `dev-webhook-token` in local development.

Do not commit real ServerChan keys. Add them in the dashboard settings page or provide them through deployment secrets later.

