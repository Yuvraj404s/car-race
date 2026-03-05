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

const Y_MIN = 80;
const Y_MAX = CANVAS_H - CAR_H - 20;
const Y_DEFAULT = CANVAS_H - CAR_H - 30;

const JUMP_POWER = -14;
const GRAVITY = 0.65;
const JUMP_COOLDOWN = 40;

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
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─── Draw car with optional jumpZ (airborne height) ──────────────────────────
function drawCar(ctx, x, y, w, h, colors, isPlayer, flip, jumpZ = 0) {
  const bw = w, bh = h;

  // Shadow stays on road, shrinks when car is airborne
  const shadowScale = Math.max(0.15, 1 - jumpZ / 110);
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2 + jumpZ * 0.25);
  ctx.globalAlpha = 0.35 * shadowScale;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(0, bh / 2 - 4, (bw / 2 - 2) * shadowScale, 8 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Car body lifted by jumpZ
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2 - jumpZ);
  if (flip) ctx.scale(1, -1);
  ctx.globalAlpha = 1;

  ctx.fillStyle = colors.body;
  ctx.beginPath(); ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 10); ctx.fill();

  ctx.fillStyle = colors.roof;
  ctx.beginPath(); ctx.roundRect(-bw / 2 + 6, -bh / 2 + bh * 0.2, bw - 12, bh * 0.38, 6); ctx.fill();

  ctx.fillStyle = colors.window;
  ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.roundRect(-bw / 2 + 10, -bh / 2 + bh * 0.22, bw - 20, bh * 0.16, 4); ctx.fill();
  ctx.globalAlpha = 0.65;
  ctx.beginPath(); ctx.roundRect(-bw / 2 + 10, -bh / 2 + bh * 0.52, bw - 20, bh * 0.12, 4); ctx.fill();
  ctx.globalAlpha = 1;

  const wx = bw / 2 - 6, wy1 = -bh / 2 + 12, wy2 = bh / 2 - 18, ww = 12, wh = 20;
  [[-wx, wy1], [wx - ww, wy1], [-wx, wy2], [wx - ww, wy2]].forEach(([wx2, wy2]) => {
    ctx.fillStyle = "#111"; ctx.beginPath(); ctx.roundRect(wx2, wy2, ww, wh, 4); ctx.fill();
    ctx.fillStyle = "#555"; ctx.beginPath(); ctx.arc(wx2 + ww / 2, wy2 + wh / 2, 4, 0, Math.PI * 2); ctx.fill();
  });

  if (isPlayer) { ctx.fillStyle = "#fff7a1"; ctx.shadowColor = "#fff"; ctx.shadowBlur = 10; }
  else          { ctx.fillStyle = "#ff4444"; ctx.shadowColor = "#f00"; ctx.shadowBlur = 8; }
  ctx.beginPath(); ctx.roundRect(-bw / 2 + 6, -bh / 2 + 3, 10, 7, 3); ctx.fill();
  ctx.beginPath(); ctx.roundRect(bw / 2 - 16, -bh / 2 + 3, 10, 7, 3); ctx.fill();
  ctx.shadowBlur = 0;

  // Cyan glow ring when airborne
  if (jumpZ > 8) {
    ctx.strokeStyle = `rgba(0,200,255,${Math.min(jumpZ / 55, 0.8)})`;
    ctx.lineWidth = 3;
    ctx.shadowColor = "#00cfff"; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.ellipse(0, bh / 2 + 4, bw / 2 + 5, 10, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

function drawRoad(ctx, offset) {
  ctx.fillStyle = "#0d200d"; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = "#1c1c2e"; ctx.fillRect(ROAD_LEFT, 0, ROAD_WIDTH, CANVAS_H);
  ctx.fillStyle = "#fff";
  ctx.fillRect(ROAD_LEFT, 0, 4, CANVAS_H);
  ctx.fillRect(ROAD_LEFT + ROAD_WIDTH - 4, 0, 4, CANVAS_H);

  const dashLen = 60, gap = 40, period = dashLen + gap;
  ctx.strokeStyle = "#f5c518"; ctx.lineWidth = 3; ctx.setLineDash([dashLen, gap]);
  for (let lane = 1; lane < LANE_COUNT; lane++) {
    const lx = ROAD_LEFT + lane * LANE_WIDTH;
    ctx.beginPath(); ctx.lineDashOffset = -(offset % period);
    ctx.moveTo(lx, 0); ctx.lineTo(lx, CANVAS_H); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,0.015)";
  ctx.fillRect(ROAD_LEFT + ROAD_WIDTH * 0.3, 0, ROAD_WIDTH * 0.1, CANVAS_H);
}

function drawStars(ctx, stars, offset) {
  stars.forEach(s => {
    const y = (s.y + offset * s.speed * 0.1) % CANVAS_H;
    ctx.fillStyle = `rgba(255,255,255,${s.a})`;
    ctx.beginPath(); ctx.arc(s.x, y, s.r, 0, Math.PI * 2); ctx.fill();
  });
}

function drawSpeedLines(ctx, speed) {
  if (speed < 4) return;
  const intensity = Math.min((speed - 4) / 8, 1);
  ctx.strokeStyle = `rgba(255,255,255,${0.04 * intensity})`; ctx.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const x = rand(ROAD_LEFT, ROAD_LEFT + ROAD_WIDTH), len = rand(30, 90) * intensity;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, len); ctx.stroke();
  }
}

function drawHUD(ctx, score, level, lives, speed, combo, jumpReady) {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath(); ctx.roundRect(14, 14, 200, 132, 10); ctx.fill();

  ctx.fillStyle = "#f5c518"; ctx.font = "bold 13px 'Courier New', monospace"; ctx.fillText("SCORE", 28, 38);
  ctx.fillStyle = "#fff"; ctx.font = "bold 26px 'Courier New', monospace";
  ctx.fillText(score.toString().padStart(6, "0"), 28, 66);
  ctx.fillStyle = "#aaa"; ctx.font = "bold 12px 'Courier New', monospace";
  ctx.fillText(`LVL ${level}  ❤ ${lives}`, 28, 90);
  ctx.fillStyle = "#f5c518"; ctx.font = "bold 11px 'Courier New', monospace";
  ctx.fillText(`${Math.floor(speed * 40)} km/h`, 28, 112);
  ctx.fillStyle = jumpReady ? "#00cfff" : "#555";
  ctx.fillText(jumpReady ? "⬆ JUMP READY" : "⬆ CHARGING...", 28, 132);

  if (combo > 1) {
    ctx.fillStyle = `hsl(${(Date.now() / 10) % 360}, 100%, 65%)`;
    ctx.font = "bold 22px 'Courier New', monospace";
    ctx.fillText(`x${combo} COMBO!`, CANVAS_W / 2 - 60, 44);
  }
}

// ─── D-Pad Button ─────────────────────────────────────────────────────────────
function DPadBtn({ label, onPress, onRelease, style = {} }) {
  return (
    <button
      onPointerDown={e => { e.preventDefault(); onPress(); }}
      onPointerUp={e => { e.preventDefault(); onRelease(); }}
      onPointerLeave={e => { e.preventDefault(); onRelease(); }}
      style={{
        width: 54, height: 54,
        background: "rgba(255,255,255,0.07)",
        border: "1px solid rgba(255,255,255,0.16)",
        borderRadius: 12, color: "#fff", fontSize: 20,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", touchAction: "none",
        userSelect: "none", WebkitUserSelect: "none",
        ...style,
      }}
    >{label}</button>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const animRef = useRef(null);
  const keysRef = useRef({});
  const [screen, setScreen] = useState("menu");
  const [finalScore, setFinalScore] = useState(0);
  const [highScore, setHighScore] = useState(0);

  const initState = useCallback(() => ({
    player: {
      x: ROAD_LEFT + LANE_WIDTH + (LANE_WIDTH - CAR_W) / 2,
      y: Y_DEFAULT, targetLane: 1,
      vy: 0,
      jumpZ: 0, jumpVel: 0, isJumping: false, jumpCooldown: 0,
    },
    enemies: [], particles: [],
    roadOffset: 0, score: 0, level: 1, lives: 3, speed: 4,
    combo: 1, comboTimer: 0, spawnTimer: 0, spawnInterval: 90,
    invincible: 0, shake: 0, running: true,
    stars: Array.from({ length: 80 }, () => ({
      x: rand(0, CANVAS_W), y: rand(0, CANVAS_H),
      r: rand(0.5, 2), a: rand(0.3, 0.9), speed: rand(0.5, 1.5),
    })),
  }), []);

  const startGame = useCallback(() => { stateRef.current = initState(); setScreen("playing"); }, [initState]);

  // Keyboard
  useEffect(() => {
    const dn = e => {
      keysRef.current[e.key] = true;
      if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," "].includes(e.key)) e.preventDefault();
    };
    const up = e => { keysRef.current[e.key] = false; };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); };
  }, []);

  // D-pad helpers
  const press   = key => () => { keysRef.current[key] = true; };
  const release = key => () => { keysRef.current[key] = false; };

  // Game loop
  useEffect(() => {
    if (screen !== "playing") return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let laneCd = 0;
    let jumpEdge = false; // edge-detect so one press = one jump

    const spawnEnemy = s => {
      const lane = randInt(0, LANE_COUNT - 1);
      s.enemies.push({
        x: ROAD_LEFT + lane * LANE_WIDTH + (LANE_WIDTH - CAR_W) / 2,
        y: -CAR_H - 20, lane,
        speed: rand(s.speed * 0.4, s.speed * 0.75),
        colors: PALETTE.enemyCars[randInt(0, PALETTE.enemyCars.length - 1)],
      });
    };

    const burst = (x, y, color, n = 14) => {
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2), spd = rand(2, 7);
        stateRef.current.particles.push({ x, y, vx: Math.cos(a)*spd, vy: Math.sin(a)*spd, life: 1, color, r: rand(3,8) });
      }
    };

    const loop = () => {
      const s = stateRef.current;
      if (!s || !s.running) return;
      const k = keysRef.current, p = s.player;

      // Lane change
      if (laneCd > 0) laneCd--;
      if ((k["ArrowLeft"] || k["_L"]) && laneCd === 0 && p.targetLane > 0) { p.targetLane--; laneCd = 18; }
      if ((k["ArrowRight"] || k["_R"]) && laneCd === 0 && p.targetLane < LANE_COUNT - 1) { p.targetLane++; laneCd = 18; }
      p.x = lerp(p.x, ROAD_LEFT + p.targetLane * LANE_WIDTH + (LANE_WIDTH - CAR_W) / 2, 0.18);

      // Forward / Backward (Up/Down arrows or D-pad _U/_D)
      if (k["ArrowUp"] || k["_U"])        p.vy = lerp(p.vy, -4.5, 0.25);
      else if (k["ArrowDown"] || k["_D"]) p.vy = lerp(p.vy,  4.5, 0.25);
      else                                p.vy = lerp(p.vy,    0, 0.22);
      p.y = clamp(p.y + p.vy, Y_MIN, Y_MAX);

      // Jump — Space or _J D-pad button
      const jumpHeld = k[" "] || k["_J"];
      if (p.jumpCooldown > 0) p.jumpCooldown--;
      if (jumpHeld && !jumpEdge && !p.isJumping && p.jumpCooldown === 0) {
        p.jumpVel = JUMP_POWER;
        p.isJumping = true;
        jumpEdge = true;
        burst(p.x + CAR_W / 2, p.y + CAR_H, "#00cfff", 10);
      }
      if (!jumpHeld) jumpEdge = false;

      if (p.isJumping) {
        p.jumpVel += GRAVITY;
        p.jumpZ -= p.jumpVel;
        if (p.jumpZ <= 0) {
          p.jumpZ = 0; p.jumpVel = 0; p.isJumping = false;
          p.jumpCooldown = JUMP_COOLDOWN;
          burst(p.x + CAR_W / 2, p.y + CAR_H, "#aaa", 8);
        }
      }

      // Road & score
      s.roadOffset += s.speed;
      s.score += Math.floor(s.speed * 0.5);
      s.level = Math.floor(s.score / 1200) + 1;
      s.speed = 4 + s.level * 0.7;
      s.spawnTimer++;
      s.spawnInterval = Math.max(35, 90 - s.level * 5);
      if (s.spawnTimer >= s.spawnInterval) { spawnEnemy(s); s.spawnTimer = 0; }

      // Move enemies
      for (let i = s.enemies.length - 1; i >= 0; i--) {
        const e = s.enemies[i];
        e.y += s.speed - e.speed;
        if (e.y > CANVAS_H + CAR_H) {
          s.enemies.splice(i, 1);
          s.combo = Math.min(s.combo + 1, 8); s.comboTimer = 120;
          s.score += s.combo * 50;
        }
      }
      if (s.comboTimer > 0) s.comboTimer--; else s.combo = 1;

      // Collision — immune when airborne (jumpZ > 18)
      if (s.invincible > 0) s.invincible--;
      else if (p.jumpZ < 18) {
        for (let i = s.enemies.length - 1; i >= 0; i--) {
          const e = s.enemies[i], mg = 12;
          if (p.x < e.x + CAR_W - mg && p.x + CAR_W > e.x + mg &&
              p.y < e.y + CAR_H - mg && p.y + CAR_H > e.y + mg) {
            s.enemies.splice(i, 1);
            s.lives--; s.invincible = 120; s.shake = 18; s.combo = 1;
            burst(p.x + CAR_W/2, p.y + CAR_H/2, "#e74c3c", 20);
            burst(e.x + CAR_W/2, e.y + CAR_H/2, e.colors.body, 16);
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

      // Particles
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const pt = s.particles[i];
        pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.15; pt.life -= 0.04; pt.vx *= 0.95;
        if (pt.life <= 0) s.particles.splice(i, 1);
      }
      if (s.shake > 0) s.shake--;

      // Draw
      ctx.save();
      if (s.shake > 0) ctx.translate(rand(-s.shake*.6,s.shake*.6), rand(-s.shake*.3,s.shake*.3));
      drawStars(ctx, s.stars, s.roadOffset);
      drawRoad(ctx, s.roadOffset);
      drawSpeedLines(ctx, s.speed);
      s.enemies.forEach(e => drawCar(ctx, e.x, e.y, CAR_W, CAR_H, e.colors, false, true, 0));

      if (s.invincible === 0 || Math.floor(s.invincible / 8) % 2 === 0) {
        drawCar(ctx, p.x, p.y, CAR_W, CAR_H, PALETTE.playerCar, true, false, p.jumpZ);
        if (s.speed > 5 && p.jumpZ < 5) {
          ctx.fillStyle = `rgba(180,180,255,${rand(.1,.3)})`;
          ctx.beginPath(); ctx.ellipse(p.x+10, p.y+CAR_H+4, 5, rand(4,12), 0,0,Math.PI*2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(p.x+CAR_W-10, p.y+CAR_H+4, 5, rand(4,12), 0,0,Math.PI*2); ctx.fill();
        }
      }

      s.particles.forEach(pt => {
        ctx.globalAlpha = pt.life; ctx.fillStyle = pt.color;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r * pt.life, 0, Math.PI*2); ctx.fill();
      });
      ctx.globalAlpha = 1;

      drawHUD(ctx, s.score, s.level, s.lives, s.speed, s.combo, p.jumpCooldown === 0 && !p.isJumping);
      ctx.restore();
      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [screen]);

  const btn = { fontFamily: "'Courier New', monospace", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 18, fontWeight: 700, padding: "16px 44px" };

  return (
    <div style={{
      minHeight: "100vh",
      background: "radial-gradient(ellipse at 50% 30%, #0d1b3e 0%, #05050f 70%)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Courier New', monospace", userSelect: "none", overflow: "hidden", position: "relative",
    }}>
      <div style={{ position:"absolute", inset:0, opacity:.07, pointerEvents:"none",
        backgroundImage:"linear-gradient(#f5c51822 1px,transparent 1px),linear-gradient(90deg,#f5c51822 1px,transparent 1px)",
        backgroundSize:"40px 40px" }} />

      {/* Canvas + D-pad wrapper */}
      <div style={{ position:"relative", display: screen === "playing" ? "block" : "none" }}>
        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
          style={{ display:"block", borderRadius:16, touchAction:"none", maxWidth:"100vw",
            boxShadow:"0 0 60px rgba(245,197,24,0.25),0 0 120px rgba(231,76,60,0.15)" }} />

        {/* ── Mobile D-Pad ── */}
        <div style={{ position:"absolute", bottom:18, left:0, right:0,
          display:"flex", justifyContent:"space-between", alignItems:"flex-end", padding:"0 18px", pointerEvents:"none" }}>

          {/* Left cluster — arrow cross */}
          <div style={{ pointerEvents:"all", display:"grid",
            gridTemplateColumns:"54px 54px 54px", gridTemplateRows:"54px 54px", gap:5 }}>
            <div/>
            <DPadBtn label="▲" onPress={press("_U")} onRelease={release("_U")} />
            <div/>
            <DPadBtn label="◀" onPress={press("_L")} onRelease={release("_L")} />
            <DPadBtn label="▼" onPress={press("_D")} onRelease={release("_D")} />
            <DPadBtn label="▶" onPress={press("_R")} onRelease={release("_R")} />
          </div>

          {/* Right — Jump button */}
          <div style={{ pointerEvents:"all", textAlign:"center" }}>
            <DPadBtn label="🚀" onPress={press("_J")} onRelease={release("_J")}
              style={{ width:70, height:70, borderRadius:"50%", fontSize:26,
                background:"rgba(0,207,255,0.15)", border:"2px solid rgba(0,207,255,0.45)",
                boxShadow:"0 0 18px rgba(0,207,255,0.35)" }} />
            <div style={{ color:"rgba(0,207,255,0.6)", fontSize:10, marginTop:4 }}>JUMP</div>
          </div>
        </div>

        {/* Keyboard hint top-right */}
        <div style={{ position:"absolute", top:14, right:14, color:"rgba(255,255,255,0.18)",
          fontSize:10, textAlign:"right", lineHeight:1.7, pointerEvents:"none" }}>
          ← → LANES<br/>↑ ↓ MOVE<br/>SPACE JUMP
        </div>
      </div>

      {/* ── MENU ── */}
      {screen === "menu" && (
        <div style={{ textAlign:"center", zIndex:10 }}>
          <div style={{ fontSize:"clamp(42px,10vw,72px)", fontWeight:900, letterSpacing:"0.05em",
            background:"linear-gradient(135deg,#f5c518 0%,#e74c3c 50%,#9b59b6 100%)",
            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            marginBottom:8, lineHeight:1.1, filter:"drop-shadow(0 0 30px rgba(245,197,24,0.5))" }}>
            INFINITE<br/>RACER
          </div>
          <div style={{ color:"#aaa", fontSize:15, marginBottom:48, letterSpacing:"0.15em" }}>
            DODGE. JUMP. SURVIVE.
          </div>
          {highScore > 0 && <div style={{ color:"#f5c518", fontSize:14, marginBottom:20 }}>🏆 BEST: {highScore.toString().padStart(6,"0")}</div>}
          <button onClick={startGame} style={{ ...btn, fontSize:22, padding:"18px 64px",
            background:"linear-gradient(135deg,#e74c3c,#c0392b)", color:"#fff",
            boxShadow:"0 0 30px rgba(231,76,60,0.6)" }}>▶ START</button>
          <div style={{ color:"#555", fontSize:12, marginTop:32, lineHeight:2.2 }}>
            ← → CHANGE LANES &nbsp;|&nbsp; ↑ ↓ MOVE FORWARD / BACK<br/>
            SPACE = JUMP OVER CARS (immune while airborne!)<br/>
            MOBILE: USE THE D-PAD + 🚀 JUMP BUTTON
          </div>
        </div>
      )}

      {/* ── GAME OVER ── */}
      {screen === "gameover" && (
        <div style={{ textAlign:"center", zIndex:10, background:"rgba(5,5,15,0.92)",
          border:"1px solid #e74c3c44", borderRadius:20, padding:"48px 60px",
          boxShadow:"0 0 80px rgba(231,76,60,0.3)" }}>
          <div style={{ fontSize:52, fontWeight:900, color:"#e74c3c",
            filter:"drop-shadow(0 0 20px #e74c3c)", marginBottom:12 }}>GAME OVER</div>
          <div style={{ color:"#fff", fontSize:18, marginBottom:6 }}>
            SCORE: <span style={{ color:"#f5c518", fontWeight:700, fontSize:28 }}>{finalScore.toString().padStart(6,"0")}</span>
          </div>
          {finalScore >= highScore && finalScore > 0 && <div style={{ color:"#f5c518", fontSize:14, marginBottom:8 }}>🏆 NEW HIGH SCORE!</div>}
          <div style={{ color:"#888", fontSize:13, marginBottom:36 }}>BEST: {highScore.toString().padStart(6,"0")}</div>
          <div style={{ display:"flex", gap:16, justifyContent:"center" }}>
            <button onClick={startGame} style={{ ...btn, background:"linear-gradient(135deg,#e74c3c,#c0392b)", color:"#fff", boxShadow:"0 0 20px rgba(231,76,60,0.5)" }}>▶ RETRY</button>
            <button onClick={() => setScreen("menu")} style={{ ...btn, background:"transparent", color:"#aaa", border:"1px solid #444" }}>MENU</button>
          </div>
        </div>
      )}
    </div>
  );
}
