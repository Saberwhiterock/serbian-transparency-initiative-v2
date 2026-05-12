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
## About Relif IQ

Relif IQ is an AI-powered emotional support and crisis guidance platform designed to help people facing emotional stress, anxiety, financial hardship, workplace pressure, isolation, and difficult life situations.

The platform provides AI-guided support, communication tools, and practical guidance intended to help users regain stability and direction during hard moments.

Relif IQ is connected to the broader mission of transparency, protection, accountability, and community support promoted by S.Transparency Initiative.

Features include:

- AI-guided emotional support
- Crisis communication assistance
- Practical life guidance
- Stress and anxiety support
- Safe and confidential interaction
- Community-focused assistance

Official website:
https://stransparency.com
- Reports: `data/db.json`
- Evidence uploads: `data/uploads/`

Back up these two paths — they contain everything submitted.
Please add a new section and reporting category to S.Transparency Initiative focused on supporting veterans and people with disabilities.

The purpose is to allow veterans, disabled individuals, and people with special needs to safely report problems, abuse, neglect, discrimination, accessibility issues, financial exploitation, housing problems, healthcare barriers, transportation difficulties, or any situation that negatively affects their daily lives.

The tone should remain professional, institutional, compassionate, and trustworthy.

Please add:

NEW CATEGORY:
- Veterans & Disability Support

DESCRIPTION:
S.Transparency Initiative supports veterans, disabled individuals, and people with special needs by providing a safe and confidential platform where they can report issues affecting their quality of life, accessibility, dignity, safety, rights, or well-being.

Possible examples:
- Accessibility barriers
- Workplace discrimination
- Housing problems
- Abuse or neglect
- Financial exploitation
- Healthcare access issues
- Transportation difficulties
- Veteran-related support issues
- Government or institutional neglect

Add a clean professional section on the homepage explaining that the organization stands with vulnerable communities and believes transparency should protect everyone equally.

Please keep the design consistent with the current institutional style of the website.
