// api/leaderboard.js
// Vercel Serverless Function — GET + POST leaderboard via Upstash Redis
// @vercel/kv zrange with withScores returns [{member: string, score: number}]

import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET — top 10 ──────────────────────────────────────────────────────────
  if (req.method === "GET") {
    try {
      // Returns [{member: string, score: number}, ...] highest first
      const raw = await kv.zrange("leaderboard", 0, 9, {
        rev: true,
        withScores: true,
      });

      // Guard against unexpected shape
      if (!Array.isArray(raw)) {
        return res.status(200).json([]);
      }

      // Each element is {member, score} — rename to {name, score}
      const entries = raw.map(item => ({
        name:  item.member ?? String(item),
        score: Math.floor(Number(item.score ?? 0)),
      }));

      return res.status(200).json(entries);
    } catch (err) {
      console.error("KV GET error:", err.message);
      return res.status(500).json({ error: "Failed to fetch leaderboard" });
    }
  }

  // ── POST — submit score ────────────────────────────────────────────────────
  if (req.method === "POST") {
    const { name, score } = req.body ?? {};

    if (!name || typeof score !== "number") {
      return res.status(400).json({ error: "name (string) and score (number) required" });
    }

    const safeName  = String(name).trim().slice(0, 16).replace(/[^a-zA-Z0-9_ ]/g, "") || "Anon";
    const safeScore = Math.max(0, Math.floor(score));

    try {
      // Only store if this beats the player's existing best
      const existing = await kv.zscore("leaderboard", safeName);
      if (existing === null || safeScore > Number(existing)) {
        await kv.zadd("leaderboard", { score: safeScore, member: safeName });
      }

      // zrevrank = position from top (0-indexed) → +1 for human rank
      const rankRaw = await kv.zrevrank("leaderboard", safeName);
      const rank    = rankRaw !== null ? rankRaw + 1 : null;
      const total   = await kv.zcard("leaderboard");

      return res.status(200).json({ ok: true, rank, total });
    } catch (err) {
      console.error("KV POST error:", err.message);
      return res.status(500).json({ error: "Failed to submit score" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
