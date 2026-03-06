// api/leaderboard.js
// Upstash Redis via @vercel/kv
// IMPORTANT: kv.zrange with withScores returns a FLAT interleaved array:
// ["playerA", 5000, "playerB", 3000, ...]  — NOT objects

import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET — top 10 ────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      // Returns flat array: ["alice", 5000, "bob", 3000, ...]
      const raw = await kv.zrange("leaderboard", 0, 9, {
        rev: true,
        withScores: true,
      });

      console.log("zrange raw:", JSON.stringify(raw));

      if (!Array.isArray(raw) || raw.length === 0) {
        return res.status(200).json([]);
      }

      // Parse flat interleaved array
      const entries = [];
      for (let i = 0; i < raw.length; i += 2) {
        const name  = String(raw[i]);
        const score = Math.floor(Number(raw[i + 1]));
        entries.push({ name, score });
      }

      return res.status(200).json(entries);
    } catch (err) {
      console.error("GET error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST — submit score ──────────────────────────────────────────────────────
  if (req.method === "POST") {
    const body = req.body ?? {};
    const name  = body.name;
    const score = body.score;

    console.log("POST body:", JSON.stringify(body));

    if (!name || score === undefined || score === null) {
      return res.status(400).json({ error: "name and score required" });
    }

    const safeName  = String(name).trim().slice(0, 16).replace(/[^a-zA-Z0-9_ ]/g, "") || "Anon";
    const safeScore = Math.floor(Number(score));

    if (isNaN(safeScore)) {
      return res.status(400).json({ error: "score must be a valid number" });
    }

    console.log("Saving:", safeName, safeScore);

    try {
      // Only update if new score beats existing
      const existing = await kv.zscore("leaderboard", safeName);
      console.log("Existing score:", existing);

      if (existing === null || safeScore > Number(existing)) {
        await kv.zadd("leaderboard", { score: safeScore, member: safeName });
        console.log("Saved new score:", safeScore);
      } else {
        console.log("Kept existing score:", existing);
      }

      const rankRaw = await kv.zrevrank("leaderboard", safeName);
      const rank    = rankRaw !== null ? rankRaw + 1 : null;
      const total   = await kv.zcard("leaderboard");

      return res.status(200).json({ ok: true, rank, total });
    } catch (err) {
      console.error("POST error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
