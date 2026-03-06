const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;
const DB_FILE = path.join(__dirname, "leaderboard.json");

app.use(cors());
app.use(express.json());

// ── Tiny file-based DB ──────────────────────────────────────────────────────
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return [];
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ── GET /leaderboard — top 10 ───────────────────────────────────────────────
app.get("/leaderboard", (req, res) => {
  const entries = readDB();
  const top = entries
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  res.json(top);
});

// ── POST /leaderboard — submit score ───────────────────────────────────────
app.post("/leaderboard", (req, res) => {
  const { name, score } = req.body;

  if (!name || typeof score !== "number") {
    return res.status(400).json({ error: "name and score required" });
  }

  const safeName = String(name).trim().slice(0, 16).replace(/[^a-zA-Z0-9_ ]/g, "") || "Anon";
  const safeScore = Math.max(0, Math.floor(score));

  const entries = readDB();

  // One entry per name — keep their best score
  const existing = entries.findIndex(e => e.name.toLowerCase() === safeName.toLowerCase());
  if (existing >= 0) {
    if (safeScore > entries[existing].score) {
      entries[existing].score = safeScore;
      entries[existing].date = new Date().toISOString();
    }
  } else {
    entries.push({ name: safeName, score: safeScore, date: new Date().toISOString() });
  }

  writeDB(entries);

  const sorted = entries.sort((a, b) => b.score - a.score);
  const rank = sorted.findIndex(e => e.name.toLowerCase() === safeName.toLowerCase()) + 1;

  res.json({ ok: true, rank, total: entries.length });
});

app.listen(PORT, () => console.log(`🏁 Leaderboard server running on port ${PORT}`));
