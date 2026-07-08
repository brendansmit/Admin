# InkHeron Serve

Locked-down server control panel for `serve.inkheron.app`.

## Controls

- Health/status checks for allowlisted apps.
- Recent logs for allowlisted apps.
- Restart with CSRF protection and typed host confirmation.
- Deploy with CSRF protection and typed host confirmation.

There is no shell, terminal opener or custom command runner.

## Required environment

- `PORT`: defaults to `3469`.
- `SERVE_ADMIN_PASSWORD`: required in production.
- `SERVE_SESSION_SECRET`: required in production.
- `SERVE_ALLOWED_EMAILS`: optional comma-separated Cloudflare Access email allowlist.
- `SERVE_AUDIT_LOG`: optional audit log path, defaults to `serve/data/audit.jsonl`.
- `SERVE_USE_SUDO`: set to `1` only if the `serve` process user needs sudo for systemd commands.

## PM2 start

```sh
cd /opt/admin-platform
PORT=3469 \
SERVE_ADMIN_PASSWORD='replace-me' \
SERVE_SESSION_SECRET='replace-me' \
SERVE_ALLOWED_EMAILS='you@example.com' \
pm2 start serve/server.js --name inkheron-serve --update-env
```

## Nginx proxy

```nginx
server {
    listen 80;
    server_name serve.inkheron.app;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name serve.inkheron.app;

    location / {
        proxy_pass http://127.0.0.1:3469;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header CF-Access-Authenticated-User-Email $http_cf_access_authenticated_user_email;
    }
}
```

Put Cloudflare Access in front of the subdomain before exposing it publicly.
