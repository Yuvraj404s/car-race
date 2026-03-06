# 🏎️ Infinite Racer

Full-stack infinite racing game.
Frontend: React + Vite  |  Backend: Vercel Serverless Functions + Vercel KV (Upstash Redis)

Everything deploys to ONE Vercel project — no separate server needed, free forever.

---

## Project Structure

```
car-race/
├── api/
│   └── leaderboard.js   ← Vercel serverless function (GET + POST)
├── src/
│   └── App.jsx          ← React game
├── index.html
├── vite.config.js       ← proxies /api to vercel dev locally
├── vercel.json          ← routes /api/* to serverless functions
└── package.json
```

---

## Deploy to Vercel (one-time setup)

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_NAME/car-race.git
git push -u origin main
```

### Step 2 — Create Vercel Project
1. Go to https://vercel.com → New Project → import your repo
2. Framework: Vite (auto-detected)
3. Click Deploy (it will fail the first time — that's OK, we need to add KV next)

### Step 3 — Create Vercel KV Database (free)
1. In your Vercel project dashboard → Storage tab → Create Database
2. Choose KV (powered by Upstash) → Free tier → Create
3. Click "Connect to Project" → select your car-race project
4. Vercel automatically adds these env vars to your project:
     KV_URL
     KV_REST_API_URL
     KV_REST_API_TOKEN
     KV_REST_API_READ_ONLY_TOKEN
   You don't need to set these manually — Vercel does it.

### Step 4 — Redeploy
Go to Deployments → click the three dots on latest → Redeploy.
Now it works. Your leaderboard is live at:
  https://your-app.vercel.app/api/leaderboard

---

## Run Locally

You need the Vercel CLI to emulate serverless functions and KV locally.

```bash
# Install Vercel CLI once
npm i -g vercel

# Link your local repo to your Vercel project (one-time)
vercel link

# Pull env vars from Vercel (KV credentials) into .env.local
vercel env pull .env.local

# Run everything together (Vite + serverless functions)
vercel dev
```

Open http://localhost:3000

The game runs on port 3000 in vercel dev mode (not 5173).
If you want to run Vite separately on 5173, the vite.config.js proxy
will forward /api calls to port 3000.

---

## How Vercel KV works for the Leaderboard

Redis sorted set — the perfect data structure for leaderboards:

  ZADD leaderboard <score> <playerName>   — add or update score
  ZRANGE leaderboard 0 9 REV WITHSCORES  — get top 10

One entry per player name. Only beats their own high score (no duplicates).
Data is persistent — survives redeployments, free forever on Vercel KV free tier.

Free tier limits (very generous for a game):
  - 256 MB storage
  - 500,000 requests/month
  - 30,000 requests/day

---

## Controls

  ← →        Change lanes
  ↑ ↓        Move forward / backward
  SPACE       Jump over cars
  Mobile      D-pad + rocket button

## Features

  Engine sound    Sawtooth oscillator — pitch tracks speed
  Crash sound     White noise burst + bass thud
  Coins           Collect on road → saved to localStorage
  Garage          Spend coins to unlock 4 faster cars
  High score      localStorage — persists across sessions
  Leaderboard     Vercel KV (Upstash Redis) — global top 10
