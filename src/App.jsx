import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const ROAD_WIDTH = 520;
const LANE_COUNT = 3;
const LANE_WIDTH = ROAD_WIDTH / LANE_COUNT;
const CAR_W = 54;
const CAR_H = 90;
const CANVAS_W = 600;
const CANVAS_H = 700;
const ROAD_LEFT = (CANVAS_W - ROAD_WIDTH) / 2;

const PALETTE = {
  playerCar: { body: "#e74c3c", roof: "#c0392b", window: "#85c1e9" },
  enemyCars: [
    { body: "#3498db", roof: "#2980b9", window: "#aed6f1" },
    { body: "#2ecc71", roof: "#27ae60", window: "#a9dfbf" },
    { body: "#9b59b6", roof: "#8e44ad", window: "#d7bde2" },
    { body: "#f39c12", roof: "#d68910", window: "#fdebd0" },
    { body: "#1abc9c", roof: "#17a589", window: "#a2d9ce" },
  ],
};

function lerp(a, b, t) { return a + (b - a) * t; }
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

function drawCar(ctx, x, y, w, h, colors, isPlayer, flip) {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (flip) ctx.scale(1, -1);
  const bw = w, bh = h;

  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(0, bh / 2 - 4, bw / 2 - 2, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = colors.body;
  ctx.beginPath();
  ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 10);
  ctx.fill();

  ctx.fillStyle = colors.roof;
  ctx.beginPath();
  ctx.roundRect(-bw / 2 + 6, -bh / 2 + bh * 0.2, bw - 12, bh * 0.38, 6);
  ctx.fill();

  ctx.fillStyle = colors.window;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.roundRect(-bw / 2 + 10, -bh / 2 + bh * 0.22, bw - 20, bh * 0.16, 4);
  ctx.fill();
  ctx.globalAlpha = 0.65;
  ctx.beginPath();
  ctx.roundRect(-bw / 2 + 10, -bh / 2 + bh * 0.52, bw - 20, bh * 0.12, 4);
  ctx.fill();
  ctx.globalAlpha = 1;

  const wx = bw / 2 - 6;
  const wy1 = -bh / 2 + 12;
  const wy2 = bh / 2 - 18;
  const ww = 12, wh = 20;
  [[-wx, wy1], [wx - ww, wy1], [-wx, wy2], [wx - ww, wy2]].forEach(([wx2, wy2]) => {
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.roundRect(wx2, wy2, ww, wh, 4);
    ctx.fill();
    ctx.fillStyle = "#555";
    ctx.beginPath();
    ctx.arc(wx2 + ww / 2, wy2 + wh / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  if (isPlayer) {
    ctx.fillStyle = "#fff7a1";
    ctx.shadowColor = "#fff";
    ctx.shadowBlur = 10;
  } else {
    ctx.fillStyle = "#ff4444";
    ctx.shadowColor = "#f00";
    ctx.shadowBlur = 8;
  }
  ctx.beginPath();
  ctx.roundRect(-bw / 2 + 6, -bh / 2 + 3, 10, 7, 3);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(bw / 2 - 16, -bh / 2 + 3, 10, 7, 3);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawRoad(ctx, offset) {
  ctx.fillStyle = "#0d200d";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = "#1c1c2e";
  ctx.fillRect(ROAD_LEFT, 0, ROAD_WIDTH, CANVAS_H);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(ROAD_LEFT, 0, 4, CANVAS_H);
  ctx.fillRect(ROAD_LEFT + ROAD_WIDTH - 4, 0, 4, CANVAS_H);

  const dashLen = 60, gap = 40;
  const period = dashLen + gap;
  ctx.strokeStyle = "#f5c518";
  ctx.lineWidth = 3;
  ctx.setLineDash([dashLen, gap]);
  for (let lane = 1; lane < LANE_COUNT; lane++) {
    const lx = ROAD_LEFT + lane * LANE_WIDTH;
    ctx.beginPath();
    ctx.lineDashOffset = -(offset % period);
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx, CANVAS_H);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(255,255,255,0.015)";
  ctx.fillRect(ROAD_LEFT + ROAD_WIDTH * 0.3, 0, ROAD_WIDTH * 0.1, CANVAS_H);
}

function drawStars(ctx, stars, offset) {
  stars.forEach(s => {
    const y = (s.y + offset * s.speed * 0.1) % CANVAS_H;
    ctx.fillStyle = `rgba(255,255,255,${s.a})`;
    ctx.beginPath();
    ctx.arc(s.x, y, s.r, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawSpeedLines(ctx, speed) {
  if (speed < 4) return;
  const intensity = Math.min((speed - 4) / 8, 1);
  ctx.strokeStyle = `rgba(255,255,255,${0.04 * intensity})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const x = rand(ROAD_LEFT, ROAD_LEFT + ROAD_WIDTH);
    const len = rand(30, 90) * intensity;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, len);
    ctx.stroke();
  }
}

function drawHUD(ctx, score, level, lives, speed, combo) {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.roundRect(14, 14, 180, 110, 10);
  ctx.fill();

  ctx.fillStyle = "#f5c518";
  ctx.font = "bold 13px 'Courier New', monospace";
  ctx.fillText("SCORE", 28, 38);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 26px 'Courier New', monospace";
  ctx.fillText(score.toString().padStart(6, "0"), 28, 66);
  ctx.fillStyle = "#aaa";
  ctx.font = "bold 12px 'Courier New', monospace";
  ctx.fillText(`LVL ${level}  ❤ ${lives}`, 28, 90);
  ctx.fillStyle = "#f5c518";
  ctx.font = "bold 11px 'Courier New', monospace";
  ctx.fillText(`${Math.floor(speed * 40)} km/h`, 28, 112);

  if (combo > 1) {
    ctx.fillStyle = `hsl(${(Date.now() / 10) % 360}, 100%, 65%)`;
    ctx.font = "bold 22px 'Courier New', monospace";
    ctx.fillText(`x${combo} COMBO!`, CANVAS_W / 2 - 60, 44);
  }
}

export default function App() {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const animRef = useRef(null);
  const keysRef = useRef({});
  const [screen, setScreen] = useState("menu");
  const [finalScore, setFinalScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const touchRef = useRef(null);

  const initState = useCallback(() => {
    const stars = Array.from({ length: 80 }, () => ({
      x: rand(0, CANVAS_W), y: rand(0, CANVAS_H),
      r: rand(0.5, 2), a: rand(0.3, 0.9), speed: rand(0.5, 1.5),
    }));
    return {
      player: { x: ROAD_LEFT + LANE_WIDTH + (LANE_WIDTH - CAR_W) / 2, y: CANVAS_H - CAR_H - 30, targetLane: 1 },
      enemies: [], particles: [], roadOffset: 0,
      score: 0, level: 1, lives: 3, speed: 4,
      combo: 1, comboTimer: 0, spawnTimer: 0, spawnInterval: 90,
      invincible: 0, shake: 0, stars, running: true,
    };
  }, []);

  const startGame = useCallback(() => {
    stateRef.current = initState();
    setScreen("playing");
  }, [initState]);

  useEffect(() => {
    const down = (e) => {
      keysRef.current[e.key] = true;
      if (["ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
    };
    const up = (e) => { keysRef.current[e.key] = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const handleTouchStart = useCallback((e) => {
    touchRef.current = { x: e.touches[0].clientX };
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (!touchRef.current) return;
    const t = e.changedTouches[0];
    if (t.clientX < window.innerWidth / 2) keysRef.current["_tapLeft"] = true;
    else keysRef.current["_tapRight"] = true;
    setTimeout(() => { keysRef.current["_tapLeft"] = false; keysRef.current["_tapRight"] = false; }, 80);
  }, []);

  useEffect(() => {
    if (screen !== "playing") return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let laneMoveCooldown = 0;

    const spawnEnemy = (s) => {
      const lane = randInt(0, LANE_COUNT - 1);
      s.enemies.push({
        x: ROAD_LEFT + lane * LANE_WIDTH + (LANE_WIDTH - CAR_W) / 2,
        y: -CAR_H - 20, lane,
        speed: rand(s.speed * 0.4, s.speed * 0.75),
        colors: PALETTE.enemyCars[randInt(0, PALETTE.enemyCars.length - 1)],
        id: Math.random(),
      });
    };

    const spawnParticles = (x, y, color, count = 14) => {
      for (let i = 0; i < count; i++) {
        const angle = rand(0, Math.PI * 2);
        const spd = rand(2, 7);
        stateRef.current.particles.push({
          x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd,
          life: 1, color, r: rand(3, 8),
        });
      }
    };

    const loop = () => {
      const s = stateRef.current;
      if (!s || !s.running) return;

      if (laneMoveCooldown > 0) laneMoveCooldown--;
      if ((keysRef.current["ArrowLeft"] || keysRef.current["_tapLeft"]) && laneMoveCooldown === 0) {
        if (s.player.targetLane > 0) { s.player.targetLane--; laneMoveCooldown = 18; }
      }
      if ((keysRef.current["ArrowRight"] || keysRef.current["_tapRight"]) && laneMoveCooldown === 0) {
        if (s.player.targetLane < LANE_COUNT - 1) { s.player.targetLane++; laneMoveCooldown = 18; }
      }

      const targetX = ROAD_LEFT + s.player.targetLane * LANE_WIDTH + (LANE_WIDTH - CAR_W) / 2;
      s.player.x = lerp(s.player.x, targetX, 0.18);

      s.roadOffset += s.speed;
      s.score += Math.floor(s.speed * 0.5);
      s.level = Math.floor(s.score / 1200) + 1;
      s.speed = 4 + s.level * 0.7;

      s.spawnTimer++;
      s.spawnInterval = Math.max(35, 90 - s.level * 5);
      if (s.spawnTimer >= s.spawnInterval) { spawnEnemy(s); s.spawnTimer = 0; }

      for (let i = s.enemies.length - 1; i >= 0; i--) {
        const e = s.enemies[i];
        e.y += s.speed - e.speed;
        if (e.y > CANVAS_H + CAR_H) {
          s.enemies.splice(i, 1);
          s.combo = Math.min(s.combo + 1, 8);
          s.comboTimer = 120;
          s.score += s.combo * 50;
        }
      }

      if (s.comboTimer > 0) s.comboTimer--; else s.combo = 1;

      if (s.invincible > 0) s.invincible--;
      else {
        for (let i = s.enemies.length - 1; i >= 0; i--) {
          const e = s.enemies[i];
          const margin = 12;
          if (
            s.player.x < e.x + CAR_W - margin && s.player.x + CAR_W > e.x + margin &&
            s.player.y < e.y + CAR_H - margin && s.player.y + CAR_H > e.y + margin
          ) {
            s.enemies.splice(i, 1);
            s.lives--;
            s.invincible = 120;
            s.shake = 18;
            s.combo = 1;
            spawnParticles(s.player.x + CAR_W / 2, s.player.y + CAR_H / 2, "#e74c3c", 20);
            spawnParticles(e.x + CAR_W / 2, e.y + CAR_H / 2, e.colors.body, 16);
            if (s.lives <= 0) {
              s.running = false;
              setFinalScore(s.score);
              setHighScore(prev => Math.max(prev, s.score));
              setScreen("gameover");
              return;
            }
            break;
          }
        }
      }

      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life -= 0.04; p.vx *= 0.95;
        if (p.life <= 0) s.particles.splice(i, 1);
      }
      if (s.shake > 0) s.shake--;

      ctx.save();
      if (s.shake > 0) ctx.translate(rand(-s.shake * 0.6, s.shake * 0.6), rand(-s.shake * 0.3, s.shake * 0.3));

      drawStars(ctx, s.stars, s.roadOffset);
      drawRoad(ctx, s.roadOffset);
      drawSpeedLines(ctx, s.speed);
      s.enemies.forEach(e => drawCar(ctx, e.x, e.y, CAR_W, CAR_H, e.colors, false, true));

      if (s.invincible === 0 || Math.floor(s.invincible / 8) % 2 === 0) {
        drawCar(ctx, s.player.x, s.player.y, CAR_W, CAR_H, PALETTE.playerCar, true, false);
        if (s.speed > 5) {
          ctx.fillStyle = `rgba(180,180,255,${rand(0.1, 0.3)})`;
          ctx.beginPath();
          ctx.ellipse(s.player.x + 10, s.player.y + CAR_H + 4, 5, rand(4, 12), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(s.player.x + CAR_W - 10, s.player.y + CAR_H + 4, 5, rand(4, 12), 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      s.particles.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      drawHUD(ctx, s.score, s.level, s.lives, s.speed, s.combo);

      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.font = "11px 'Courier New', monospace";
      ctx.fillText("← → ARROW KEYS", CANVAS_W - 148, CANVAS_H - 14);
      ctx.restore();

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [screen]);

  const btnBase = {
    fontFamily: "'Courier New', monospace",
    border: "none", borderRadius: 10, cursor: "pointer",
    fontSize: 18, fontWeight: 700, padding: "16px 44px",
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "radial-gradient(ellipse at 50% 30%, #0d1b3e 0%, #05050f 70%)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Courier New', monospace", userSelect: "none", overflow: "hidden", position: "relative",
    }}>
      <div style={{
        position: "absolute", inset: 0, opacity: 0.07, pointerEvents: "none",
        backgroundImage: "linear-gradient(#f5c51822 1px, transparent 1px), linear-gradient(90deg, #f5c51822 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }} />

      <canvas
        ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
        style={{
          display: screen === "playing" ? "block" : "none",
          borderRadius: 16,
          boxShadow: "0 0 60px rgba(245,197,24,0.25), 0 0 120px rgba(231,76,60,0.15)",
          touchAction: "none", maxWidth: "100vw",
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      />

      {screen === "menu" && (
        <div style={{ textAlign: "center", zIndex: 10 }}>
          <div style={{
            fontSize: "clamp(42px, 10vw, 72px)", fontWeight: 900, letterSpacing: "0.05em",
            background: "linear-gradient(135deg, #f5c518 0%, #e74c3c 50%, #9b59b6 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            marginBottom: 8, lineHeight: 1.1,
            filter: "drop-shadow(0 0 30px rgba(245,197,24,0.5))",
          }}>INFINITE<br />RACER</div>
          <div style={{ color: "#aaa", fontSize: 15, marginBottom: 48, letterSpacing: "0.15em" }}>
            DODGE. SURVIVE. DOMINATE.
          </div>
          {highScore > 0 && (
            <div style={{ color: "#f5c518", fontSize: 14, marginBottom: 20 }}>
              🏆 BEST: {highScore.toString().padStart(6, "0")}
            </div>
          )}
          <button onClick={startGame} style={{
            ...btnBase, fontSize: 22, padding: "18px 64px",
            background: "linear-gradient(135deg, #e74c3c, #c0392b)", color: "#fff",
            boxShadow: "0 0 30px rgba(231,76,60,0.6)",
          }}>▶ START</button>
          <div style={{ color: "#555", fontSize: 12, marginTop: 32 }}>
            USE ← → ARROW KEYS TO CHANGE LANES<br />
            TAP LEFT / RIGHT SIDE ON MOBILE
          </div>
        </div>
      )}

      {screen === "gameover" && (
        <div style={{
          textAlign: "center", zIndex: 10,
          background: "rgba(5,5,15,0.92)", border: "1px solid #e74c3c44",
          borderRadius: 20, padding: "48px 60px",
          boxShadow: "0 0 80px rgba(231,76,60,0.3)",
        }}>
          <div style={{
            fontSize: 52, fontWeight: 900, color: "#e74c3c",
            filter: "drop-shadow(0 0 20px #e74c3c)", marginBottom: 12,
          }}>GAME OVER</div>
          <div style={{ color: "#fff", fontSize: 18, marginBottom: 6 }}>
            SCORE: <span style={{ color: "#f5c518", fontWeight: 700, fontSize: 28 }}>
              {finalScore.toString().padStart(6, "0")}
            </span>
          </div>
          {finalScore >= highScore && finalScore > 0 && (
            <div style={{ color: "#f5c518", fontSize: 14, marginBottom: 8 }}>🏆 NEW HIGH SCORE!</div>
          )}
          <div style={{ color: "#888", fontSize: 13, marginBottom: 36 }}>
            BEST: {highScore.toString().padStart(6, "0")}
          </div>
          <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
            <button onClick={startGame} style={{
              ...btnBase, background: "linear-gradient(135deg, #e74c3c, #c0392b)",
              color: "#fff", boxShadow: "0 0 20px rgba(231,76,60,0.5)",
            }}>▶ RETRY</button>
            <button onClick={() => setScreen("menu")} style={{
              ...btnBase, background: "transparent", color: "#aaa", border: "1px solid #444",
            }}>MENU</button>
          </div>
        </div>
      )}
    </div>
  );
}
