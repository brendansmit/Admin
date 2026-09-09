# InkHeron Admin

The login gate for `admin.inkheron.app`.

The site itself is Grade Importer, which now sits at the root of the host. This
service is only what has to live outside it:

- The login page, the session cookie, and the `auth-check` endpoint nginx uses
  to gate every other request.
- Changing the password.
- Storing a ServerChan send key. Nothing sends with it yet, it is parked for
  whenever grade release or student submission notifications get built.

Time tracking, birthdays and calendar reminders were removed on 2026-09-09.
That work belongs to Cadence now. Their data is still in `data/store.json`.

## Local use

```sh
npm start
```

Open `http://127.0.0.1:3468/login`. Everything else redirects to `/`, which in
production is Grade Importer.

## Configuration

Optional environment variables:

- `PORT`: server port, defaults to `3468`.
- `SESSION_SECRET`: signs the session cookie. Changing it logs everyone out.
- `ADMIN_DATA_PATH`: where `store.json` lives, defaults to `data/store.json`.

Do not commit real ServerChan keys.
