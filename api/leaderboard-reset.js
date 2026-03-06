// api/leaderboard-reset.js
// DELETE all leaderboard entries — only call this once to clear bad test data
// Visit: https://your-app.vercel.app/api/leaderboard-reset
// Remove this file after use!

import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  await kv.del("leaderboard");
  return res.status(200).json({ ok: true, message: "Leaderboard cleared" });
}
