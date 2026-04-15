# Serbian Transparency Initiative

Anti-corruption reporting platform — Church & Trucking industry focus.

## Running Locally

```bash
node server.js
```

Then open http://localhost:3000

No dependencies to install — runs on pure Node.js (v18+).

## Receiving Report Emails

By default, reports are saved to `data/db.json` but no emails are sent.

To receive every submission in your inbox:

1. Copy `.env.example` to `.env`
2. Fill in your SMTP credentials

### Easiest setup: Gmail

1. Enable 2-Step Verification on your Google account
2. Generate an App Password at https://myaccount.google.com/apppasswords
3. Put it in `.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=you@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx
NOTIFY_TO=where-reports-go@example.com
```

Restart the server. You'll see `Email delivery: ENABLED` at startup.

## Deployment

- **Railway.app / Render.com**: push the folder, it runs `node server.js`. Free tier works.
- **Any VPS**: `node server.js` behind nginx + PM2 or systemd.
- Set environment variables via your host's dashboard instead of `.env`.

## Data

- Reports: `data/db.json`
- Evidence uploads: `data/uploads/`

Back up these two paths — they contain everything submitted.
