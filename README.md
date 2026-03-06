# 🏎️ Infinite Racer — Full Stack

## Project Structure

```
car-race/
├── src/           ← React + Vite frontend
│   └── App.jsx
├── server/        ← Node.js + Express backend
│   └── index.js
├── index.html
├── vite.config.js
└── package.json
```

---

## Run Locally

### Frontend
```bash
# in /car-race root
npm install
npm run dev         # opens http://localhost:5173
```

### Backend
```bash
cd server
npm install
npm run dev         # runs on http://localhost:3001
```

---

## Deploy Frontend to Vercel

1. Push repo to GitHub
2. Go to https://vercel.com → New Project → Import repo
3. Add environment variable in Vercel dashboard:
   - Key:   VITE_API_URL
   - Value: https://your-backend.railway.app
4. Deploy

---

## Deploy Backend to Railway (free)

1. Go to https://railway.app → New Project → Deploy from GitHub repo
2. Set Root Directory to: server
3. Railway auto-detects Node and runs npm start
4. Copy the generated URL and paste it into Vercel as VITE_API_URL

Alternative free backend hosts: Render.com or Fly.io

---

## Features

- Engine sound  : Web Audio sawtooth oscillator — pitch tracks speed
- Crash sound   : White noise burst + low thud
- Coins         : Spawn on road, collected coins saved to localStorage
- Car garage    : Spend coins to unlock faster cars (4 cars total)
- High score    : localStorage — persists across sessions
- Leaderboard   : Express REST API + JSON file DB, global top 10

---

## Controls

Arrow keys left/right — change lanes
Arrow keys up/down   — move forward/backward
Space                — jump over cars
Mobile               — D-pad + rocket jump button
