// api/leaderboard.js
// Vercel Serverless Function — handles GET and POST for the leaderboard
// Uses Vercel KV (Upstash Redis under the hood)
// Redis sorted set key: "leaderboard"
//   ZADD leaderboard <score> <name>   — add/update entry
//   ZRANGE leaderboard 0 9 WITHSCORES REV — top 10 descending

import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  // ── CORS headers (allow your Vercel frontend domain) ───────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET — return top 10 ────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      // ZRANGE with REV + WITHSCORES returns [name, score, name, score, ...]
      const raw = await kv.zrange("leaderboard", 0, 9, {
        rev: true,
        withScores: true,
      });

      // Parse interleaved array into [{name, score}]
      const entries = [];
      for (let i = 0; i < raw.length; i += 2) {
        entries.push({
          name: raw[i],
          score: parseInt(raw[i + 1], 10),
        });
      }

      return res.status(200).json(entries);
    } catch (err) {
      console.error("KV GET error:", err);
      return res.status(500).json({ error: "Failed to fetch leaderboard" });
    }
  }

  // ── POST — submit a score ──────────────────────────────────────────────────
  if (req.method === "POST") {
    const { name, score } = req.body;

    if (!name || typeof score !== "number") {
      return res.status(400).json({ error: "name (string) and score (number) are required" });
    }

    const safeName  = String(name).trim().slice(0, 16).replace(/[^a-zA-Z0-9_ ]/g, "") || "Anon";
    const safeScore = Math.max(0, Math.floor(score));

    try {
      // ZADD with NX|GT: only update if new score is greater than existing
      // Using XX + GT combo — update only if new score beats old one
      const existing = await kv.zscore("leaderboard", safeName);

      if (existing === null || safeScore > existing) {
        await kv.zadd("leaderboard", { score: safeScore, member: safeName });
      }

      // Get rank (0-indexed from top, so rank = position + 1)
      const rankRaw = await kv.zrank("leaderboard", safeName, { reverse: true });
      const rank    = rankRaw !== null ? rankRaw + 1 : null;
      const total   = await kv.zcard("leaderboard");

      return res.status(200).json({ ok: true, rank, total });
    } catch (err) {
      console.error("KV POST error:", err);
      return res.status(500).json({ error: "Failed to submit score" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
