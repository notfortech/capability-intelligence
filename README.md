# Vedic Astrology Career Agent — Vercel Deployment

## Deploy in 3 steps

### 1. Push to GitHub
Create a new GitHub repo and push this folder to it.

### 2. Connect to Vercel
- Go to vercel.com → New Project → Import your GitHub repo
- Vercel will auto-detect the configuration

### 3. Add Environment Variables
In Vercel Dashboard → Your Project → Settings → Environment Variables, add:

| Name | Value |
|---|---|
| PROKERALA_CLIENT_ID | your client id |
| PROKERALA_CLIENT_SECRET | your client secret |
| ANTHROPIC_API_KEY | your anthropic key |

Click Deploy. That's it — no server to start manually.

## File structure
```
/
├── api/
│   ├── _helpers.js     ← all shared logic
│   ├── chart.js        ← POST /api/chart
│   └── score.js        ← POST /api/score
├── public/
│   └── index.html      ← the browser app
├── vercel.json         ← routing config
├── package.json
└── .env.example        ← environment variable reference
```

## API timeout note
Chart generation makes multiple API calls and can take 30-60 seconds.
The maxDuration in vercel.json is set to 60s for /api/chart.
Vercel Hobby plan allows up to 60s. Pro plan allows up to 300s.
