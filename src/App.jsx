import { useState, useEffect, useRef, useCallback } from "react";

// ─── Config ───────────────────────────────────────────────────────────────────
const ROAD_WIDTH = 520;
const LANE_COUNT  = 3;
const LANE_WIDTH  = ROAD_WIDTH / LANE_COUNT;
const CAR_W = 54, CAR_H = 90;
const CANVAS_W = 600, CANVAS_H = 700;
const ROAD_LEFT = (CANVAS_W - ROAD_WIDTH) / 2;
const Y_MIN = 80, Y_MAX = CANVAS_H - CAR_H - 20, Y_DEFAULT = CANVAS_H - CAR_H - 30;
const JUMP_POWER = -14, GRAVITY = 0.65, JUMP_COOLDOWN = 40;

// ── Car catalog ───────────────────────────────────────────────────────────────
const CARS = [
  { id: "red",    name: "VIPER",    cost: 0,    speedBonus: 0,   colors: { body:"#e74c3c", roof:"#c0392b", window:"#85c1e9" } },
  { id: "gold",   name: "GOLDEN",   cost: 80,   speedBonus: 1.2, colors: { body:"#f39c12", roof:"#d68910", window:"#fef9e7" } },
  { id: "cyber",  name: "CYBER-X",  cost: 200,  speedBonus: 2.5, colors: { body:"#00cfff", roof:"#0099bb", window:"#e0faff" } },
  { id: "shadow", name: "SHADOW",   cost: 400,  speedBonus: 4.0, colors: { body:"#9b59b6", roof:"#6c3483", window:"#d7bde2" } },
];

// ── Enemy palette ──────────────────────────────────────────────────────────────
const ENEMY_COLORS = [
  { body:"#3498db", roof:"#2980b9", window:"#aed6f1" },
  { body:"#2ecc71", roof:"#27ae60", window:"#a9dfbf" },
  { body:"#e74c3c", roof:"#c0392b", window:"#fadbd8" },
  { body:"#1abc9c", roof:"#17a589", window:"#a2d9ce" },
  { body:"#e67e22", roof:"#ca6f1e", window:"#fdebd0" },
];

// ── API — relative path, works on Vercel (prod) and via Vite proxy (local dev) ─
const API = "/api";

// ─── Utils ────────────────────────────────────────────────────────────────────
const lerp  = (a, b, t) => a + (b - a) * t;
const rand  = (lo, hi)  => Math.random() * (hi - lo) + lo;
const randI = (lo, hi)  => Math.floor(rand(lo, hi + 1));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ─── Web Audio Sound Engine ───────────────────────────────────────────────────
function createSoundEngine() {
  let ctx = null;
  let engineNode = null, engineGain = null;
  let started = false;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function startEngine() {
    if (started) return;
    started = true;
    const ac = getCtx();
    engineNode = ac.createOscillator();
    engineGain = ac.createGain();
    engineNode.type = "sawtooth";
    engineNode.frequency.value = 80;
    engineGain.gain.value = 0.04;
    engineNode.connect(engineGain);
    engineGain.connect(ac.destination);
    engineNode.start();
  }

  function setEngineSpeed(speed) {
    if (!engineNode) return;
    const ac = getCtx();
    engineNode.frequency.setTargetAtTime(60 + speed * 18, ac.currentTime, 0.1);
    engineGain.gain.setTargetAtTime(0.03 + speed * 0.004, ac.currentTime, 0.1);
  }

  function stopEngine() {
    if (!engineNode) return;
    engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    setTimeout(() => {
      try { engineNode.stop(); } catch {}
      engineNode = null; engineGain = null; started = false;
    }, 500);
  }

  function playCrash() {
    const ac = getCtx();
    // White noise burst
    const bufSize = ac.sampleRate * 0.4;
    const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 2);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const g = ac.createGain(); g.gain.value = 0.6;
    src.connect(g); g.connect(ac.destination);
    src.start();
    // Low thud
    const osc = ac.createOscillator();
    const og = ac.createGain();
    osc.frequency.value = 80;
    og.gain.setValueAtTime(0.5, ac.currentTime);
    og.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.35);
    osc.connect(og); og.connect(ac.destination);
    osc.start(); osc.stop(ac.currentTime + 0.35);
  }

  function playCoin() {
    const ac = getCtx();
    const osc = ac.createOscillator();
    const g   = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ac.currentTime + 0.08);
    g.gain.setValueAtTime(0.25, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.18);
    osc.connect(g); g.connect(ac.destination);
    osc.start(); osc.stop(ac.currentTime + 0.18);
  }

  function playJump() {
    const ac = getCtx();
    const osc = ac.createOscillator();
    const g   = ac.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(300, ac.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, ac.currentTime + 0.12);
    g.gain.setValueAtTime(0.15, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.15);
    osc.connect(g); g.connect(ac.destination);
    osc.start(); osc.stop(ac.currentTime + 0.15);
  }

  return { startEngine, setEngineSpeed, stopEngine, playCrash, playCoin, playJump };
}

// ─── Drawing ──────────────────────────────────────────────────────────────────
function drawCar(ctx, x, y, w, h, colors, isPlayer, flip, jumpZ = 0) {
  const bw = w, bh = h;
  const shadowScale = Math.max(0.15, 1 - jumpZ / 110);
  ctx.save();
  ctx.translate(x + w/2, y + h/2 + jumpZ*0.25);
  ctx.globalAlpha = 0.35 * shadowScale;
  ctx.fillStyle = "#000";
  ctx.beginPath(); ctx.ellipse(0, bh/2-4, (bw/2-2)*shadowScale, 8*shadowScale, 0,0,Math.PI*2); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(x + w/2, y + h/2 - jumpZ);
  if (flip) ctx.scale(1, -1);
  ctx.globalAlpha = 1;

  ctx.fillStyle = colors.body;
  ctx.beginPath(); ctx.roundRect(-bw/2,-bh/2,bw,bh,10); ctx.fill();
  ctx.fillStyle = colors.roof;
  ctx.beginPath(); ctx.roundRect(-bw/2+6,-bh/2+bh*.2,bw-12,bh*.38,6); ctx.fill();
  ctx.fillStyle = colors.window; ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.roundRect(-bw/2+10,-bh/2+bh*.22,bw-20,bh*.16,4); ctx.fill();
  ctx.globalAlpha = 0.65;
  ctx.beginPath(); ctx.roundRect(-bw/2+10,-bh/2+bh*.52,bw-20,bh*.12,4); ctx.fill();
  ctx.globalAlpha = 1;

  const wx=bw/2-6,wy1=-bh/2+12,wy2=bh/2-18,ww=12,wh=20;
  [[-wx,wy1],[wx-ww,wy1],[-wx,wy2],[wx-ww,wy2]].forEach(([wx2,wy2])=>{
    ctx.fillStyle="#111"; ctx.beginPath(); ctx.roundRect(wx2,wy2,ww,wh,4); ctx.fill();
    ctx.fillStyle="#555"; ctx.beginPath(); ctx.arc(wx2+ww/2,wy2+wh/2,4,0,Math.PI*2); ctx.fill();
  });

  if (isPlayer) { ctx.fillStyle="#fff7a1"; ctx.shadowColor="#fff"; ctx.shadowBlur=10; }
  else          { ctx.fillStyle="#ff4444"; ctx.shadowColor="#f00"; ctx.shadowBlur=8; }
  ctx.beginPath(); ctx.roundRect(-bw/2+6,-bh/2+3,10,7,3); ctx.fill();
  ctx.beginPath(); ctx.roundRect(bw/2-16,-bh/2+3,10,7,3); ctx.fill();
  ctx.shadowBlur = 0;

  if (jumpZ > 8) {
    ctx.strokeStyle = `rgba(0,200,255,${Math.min(jumpZ/55,0.8)})`;
    ctx.lineWidth = 3; ctx.shadowColor="#00cfff"; ctx.shadowBlur=14;
    ctx.beginPath(); ctx.ellipse(0,bh/2+4,bw/2+5,10,0,0,Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function drawCoin(ctx, x, y, r, pulse) {
  ctx.save();
  ctx.translate(x, y);
  const scale = 1 + Math.sin(pulse) * 0.12;
  ctx.scale(scale, scale);
  // Outer ring
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2);
  ctx.fillStyle = "#f5c518";
  ctx.shadowColor = "#f5c518"; ctx.shadowBlur = 10;
  ctx.fill();
  // Inner shine
  ctx.beginPath(); ctx.arc(-r*0.2,-r*0.2,r*0.4,0,Math.PI*2);
  ctx.fillStyle = "rgba(255,255,220,0.5)"; ctx.shadowBlur = 0; ctx.fill();
  // $ sign
  ctx.fillStyle = "#a07800";
  ctx.font = `bold ${Math.floor(r*1.2)}px 'Courier New'`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("$", 0, 1);
  ctx.restore();
}

function drawRoad(ctx, offset) {
  ctx.fillStyle = "#0d200d"; ctx.fillRect(0,0,CANVAS_W,CANVAS_H);
  ctx.fillStyle = "#1c1c2e"; ctx.fillRect(ROAD_LEFT,0,ROAD_WIDTH,CANVAS_H);
  ctx.fillStyle = "#fff";
  ctx.fillRect(ROAD_LEFT,0,4,CANVAS_H);
  ctx.fillRect(ROAD_LEFT+ROAD_WIDTH-4,0,4,CANVAS_H);
  const dashLen=60,gap=40,period=dashLen+gap;
  ctx.strokeStyle="#f5c518"; ctx.lineWidth=3; ctx.setLineDash([dashLen,gap]);
  for (let ln=1; ln<LANE_COUNT; ln++) {
    const lx=ROAD_LEFT+ln*LANE_WIDTH;
    ctx.beginPath(); ctx.lineDashOffset=-(offset%period);
    ctx.moveTo(lx,0); ctx.lineTo(lx,CANVAS_H); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle="rgba(255,255,255,0.015)";
  ctx.fillRect(ROAD_LEFT+ROAD_WIDTH*.3,0,ROAD_WIDTH*.1,CANVAS_H);
}

function drawStars(ctx, stars, offset) {
  stars.forEach(s=>{
    const y=(s.y+offset*s.speed*.1)%CANVAS_H;
    ctx.fillStyle=`rgba(255,255,255,${s.a})`;
    ctx.beginPath(); ctx.arc(s.x,y,s.r,0,Math.PI*2); ctx.fill();
  });
}

function drawSpeedLines(ctx, speed) {
  if (speed<4) return;
  const i=Math.min((speed-4)/8,1);
  ctx.strokeStyle=`rgba(255,255,255,${0.04*i})`; ctx.lineWidth=1;
  for(let j=0;j<12;j++){
    const x=rand(ROAD_LEFT,ROAD_LEFT+ROAD_WIDTH),len=rand(30,90)*i;
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,len); ctx.stroke();
  }
}

function drawHUD(ctx, { score, level, lives, speed, combo, jumpReady, coins, carName }) {
  // Score panel
  ctx.fillStyle="rgba(0,0,0,0.65)";
  ctx.beginPath(); ctx.roundRect(14,14,210,150,10); ctx.fill();

  ctx.fillStyle="#f5c518"; ctx.font="bold 13px 'Courier New',monospace"; ctx.fillText("SCORE",28,38);
  ctx.fillStyle="#fff"; ctx.font="bold 26px 'Courier New',monospace";
  ctx.fillText(score.toString().padStart(6,"0"),28,66);
  ctx.fillStyle="#aaa"; ctx.font="bold 12px 'Courier New',monospace";
  ctx.fillText(`LVL ${level}  ❤ ${lives}`,28,90);
  ctx.fillStyle="#f5c518"; ctx.font="bold 11px 'Courier New',monospace";
  ctx.fillText(`${Math.floor(speed*40)} km/h  [${carName}]`,28,112);
  ctx.fillStyle=jumpReady?"#00cfff":"#555";
  ctx.fillText(jumpReady?"⬆ JUMP READY":"⬆ CHARGING...",28,132);

  // Coin counter
  ctx.fillStyle="#f5c518"; ctx.font="bold 13px 'Courier New',monospace";
  ctx.fillText(`🪙 ${coins}`,28,152);

  // Combo
  if (combo>1) {
    ctx.fillStyle=`hsl(${(Date.now()/10)%360},100%,65%)`;
    ctx.font="bold 22px 'Courier New',monospace";
    ctx.fillText(`x${combo} COMBO!`,CANVAS_W/2-60,44);
  }
}

// ─── D-Pad Button ─────────────────────────────────────────────────────────────
function DPadBtn({ label, onPress, onRelease, style={} }) {
  return (
    <button
      onPointerDown={e=>{e.preventDefault();onPress();}}
      onPointerUp={e=>{e.preventDefault();onRelease();}}
      onPointerLeave={e=>{e.preventDefault();onRelease();}}
      style={{ width:54,height:54,background:"rgba(255,255,255,0.07)",
        border:"1px solid rgba(255,255,255,0.16)",borderRadius:12,color:"#fff",
        fontSize:20,display:"flex",alignItems:"center",justifyContent:"center",
        cursor:"pointer",touchAction:"none",userSelect:"none",...style }}
    >{label}</button>
  );
}

// ─── Leaderboard Modal ────────────────────────────────────────────────────────
function LeaderboardModal({ onClose, playerScore }) {
  const [entries, setEntries] = useState([]);
  const [name, setName]       = useState(() => localStorage.getItem("racer_name") || "");
  const [status, setStatus]   = useState("idle"); // idle | submitting | done | error
  const [rank, setRank]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/leaderboard`)
      .then(r => r.json())
      .then(data => { setEntries(data); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, []);

  const submit = async () => {
    if (!name.trim()) return;
    setStatus("submitting");
    localStorage.setItem("racer_name", name.trim());
    try {
      const res = await fetch(`${API}/leaderboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), score: playerScore }),
      });
      const data = await res.json();
      setRank(data.rank);
      setStatus("done");
      // Refresh board
      const lb = await fetch(`${API}/leaderboard`).then(r => r.json());
      setEntries(lb);
    } catch {
      setStatus("error");
    }
  };

  const medal = i => ["🥇","🥈","🥉"][i] || `${i+1}.`;

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",
      alignItems:"center",justifyContent:"center",zIndex:100 }}>
      <div style={{ background:"#0d0d1e",border:"1px solid #f5c51840",borderRadius:20,
        padding:"36px 44px",width:420,maxWidth:"95vw",maxHeight:"90vh",overflowY:"auto",
        boxShadow:"0 0 80px rgba(245,197,24,0.2)" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24 }}>
          <div style={{ fontSize:24,fontWeight:900,color:"#f5c518" }}>🏆 LEADERBOARD</div>
          <button onClick={onClose} style={{ background:"none",border:"none",color:"#aaa",fontSize:20,cursor:"pointer" }}>✕</button>
        </div>

        {/* Submit score */}
        {status !== "done" && (
          <div style={{ marginBottom:24,padding:16,background:"rgba(245,197,24,0.07)",borderRadius:10 }}>
            <div style={{ color:"#aaa",fontSize:12,marginBottom:8 }}>YOUR SCORE: <span style={{ color:"#f5c518",fontWeight:700 }}>{playerScore?.toString().padStart(6,"0") ?? "--"}</span></div>
            <div style={{ display:"flex",gap:8 }}>
              <input value={name} onChange={e=>setName(e.target.value)} maxLength={16}
                placeholder="Enter name..."
                style={{ flex:1,padding:"8px 12px",background:"#1a1a2e",border:"1px solid #333",
                  borderRadius:8,color:"#fff",fontFamily:"'Courier New',monospace",fontSize:13 }} />
              <button onClick={submit} disabled={status==="submitting" || !name.trim()}
                style={{ padding:"8px 18px",background:"#f5c518",border:"none",borderRadius:8,
                  color:"#000",fontWeight:700,cursor:"pointer",fontFamily:"'Courier New',monospace",
                  opacity: (!name.trim()||status==="submitting") ? 0.5 : 1 }}>
                {status==="submitting" ? "..." : "SUBMIT"}
              </button>
            </div>
            {status==="error" && <div style={{ color:"#e74c3c",fontSize:11,marginTop:6 }}>⚠ Could not reach server. Is it running?</div>}
          </div>
        )}
        {status==="done" && rank && (
          <div style={{ marginBottom:20,padding:14,background:"rgba(0,207,255,0.1)",borderRadius:10,
            color:"#00cfff",fontSize:14,textAlign:"center" }}>
            🎉 You ranked <strong>#{rank}</strong> globally!
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div style={{ color:"#555",textAlign:"center",padding:20 }}>Loading...</div>
        ) : entries.length === 0 ? (
          <div style={{ color:"#555",textAlign:"center",padding:20 }}>No scores yet — be the first!</div>
        ) : (
          <table style={{ width:"100%",borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ color:"#555",fontSize:11 }}>
                <th style={{ textAlign:"left",padding:"4px 8px" }}>#</th>
                <th style={{ textAlign:"left",padding:"4px 8px" }}>NAME</th>
                <th style={{ textAlign:"right",padding:"4px 8px" }}>SCORE</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e,i)=>(
                <tr key={i} style={{ borderTop:"1px solid #1a1a2e",
                  background: e.name.toLowerCase()===name.toLowerCase() ? "rgba(245,197,24,0.07)" : "transparent" }}>
                  <td style={{ padding:"8px 8px",color:"#f5c518",fontWeight:700 }}>{medal(i)}</td>
                  <td style={{ padding:"8px 8px",color:"#fff" }}>{e.name}</td>
                  <td style={{ padding:"8px 8px",color:"#f5c518",textAlign:"right",fontWeight:700 }}>
                    {e.score.toString().padStart(6,"0")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Garage / Car Shop Modal ──────────────────────────────────────────────────
function GarageModal({ coins, unlockedCars, selectedCar, onBuy, onSelect, onClose }) {
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",display:"flex",
      alignItems:"center",justifyContent:"center",zIndex:100 }}>
      <div style={{ background:"#0d0d1e",border:"1px solid #9b59b640",borderRadius:20,
        padding:"36px 44px",width:480,maxWidth:"95vw",
        boxShadow:"0 0 80px rgba(155,89,182,0.2)" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6 }}>
          <div style={{ fontSize:24,fontWeight:900,color:"#9b59b6" }}>🏎 GARAGE</div>
          <button onClick={onClose} style={{ background:"none",border:"none",color:"#aaa",fontSize:20,cursor:"pointer" }}>✕</button>
        </div>
        <div style={{ color:"#f5c518",fontSize:14,marginBottom:24 }}>🪙 {coins} coins available</div>

        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14 }}>
          {CARS.map(car => {
            const owned    = unlockedCars.includes(car.id);
            const selected = selectedCar === car.id;
            const canBuy   = !owned && coins >= car.cost;
            return (
              <div key={car.id} style={{ padding:16,borderRadius:12,
                border: selected ? `2px solid ${car.colors.body}` : "1px solid #222",
                background: selected ? `${car.colors.body}18` : "#111",
                opacity: (!owned && !canBuy) ? 0.5 : 1,
                transition:"all 0.2s" }}>
                {/* Mini car swatch */}
                <div style={{ width:40,height:64,borderRadius:8,marginBottom:10,
                  background:`linear-gradient(160deg,${car.colors.body},${car.colors.roof})`,
                  boxShadow: selected ? `0 0 20px ${car.colors.body}88` : "none",
                  margin:"0 auto 10px" }} />
                <div style={{ color:"#fff",fontWeight:700,fontSize:14,textAlign:"center",marginBottom:4 }}>{car.name}</div>
                <div style={{ color:"#aaa",fontSize:11,textAlign:"center",marginBottom:10 }}>
                  +{car.speedBonus.toFixed(1)} speed bonus
                </div>
                {owned ? (
                  <button onClick={()=>onSelect(car.id)}
                    style={{ width:"100%",padding:"8px 0",borderRadius:8,border:"none",cursor:"pointer",
                      fontWeight:700,fontSize:12,fontFamily:"'Courier New',monospace",
                      background: selected ? car.colors.body : "#1a1a2e",
                      color: selected ? "#000" : "#aaa" }}>
                    {selected ? "✓ SELECTED" : "SELECT"}
                  </button>
                ) : (
                  <button onClick={()=>onBuy(car.id)} disabled={!canBuy}
                    style={{ width:"100%",padding:"8px 0",borderRadius:8,border:"none",
                      cursor: canBuy?"pointer":"not-allowed",
                      fontWeight:700,fontSize:12,fontFamily:"'Courier New',monospace",
                      background: canBuy ? "#f5c518" : "#222", color: canBuy ? "#000" : "#555" }}>
                    🪙 {car.cost} UNLOCK
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const canvasRef  = useRef(null);
  const stateRef   = useRef(null);
  const animRef    = useRef(null);
  const keysRef    = useRef({});
  const soundRef   = useRef(null);

  const [screen,     setScreen]     = useState("menu");
  const [finalScore, setFinalScore] = useState(0);
  const [highScore,  setHighScore]  = useState(() => parseInt(localStorage.getItem("racer_hs") || "0"));
  const [totalCoins, setTotalCoins] = useState(() => parseInt(localStorage.getItem("racer_coins") || "0"));
  const [unlockedCars, setUnlocked] = useState(() => JSON.parse(localStorage.getItem("racer_unlocked") || '["red"]'));
  const [selectedCar,  setSelected] = useState(() => localStorage.getItem("racer_car") || "red");
  const [modal,      setModal]      = useState(null); // null | "leaderboard" | "garage"

  // Persist
  useEffect(() => { localStorage.setItem("racer_hs",      highScore); },   [highScore]);
  useEffect(() => { localStorage.setItem("racer_coins",   totalCoins); },  [totalCoins]);
  useEffect(() => { localStorage.setItem("racer_unlocked",JSON.stringify(unlockedCars)); }, [unlockedCars]);
  useEffect(() => { localStorage.setItem("racer_car",     selectedCar); }, [selectedCar]);

  // Sound engine singleton
  useEffect(() => { soundRef.current = createSoundEngine(); }, []);

  const carData = CARS.find(c => c.id === selectedCar) || CARS[0];

  const initState = useCallback(() => ({
    player: { x: ROAD_LEFT+LANE_WIDTH+(LANE_WIDTH-CAR_W)/2, y:Y_DEFAULT, targetLane:1,
      vy:0, jumpZ:0, jumpVel:0, isJumping:false, jumpCooldown:0 },
    enemies:[], coins:[], particles:[], roadOffset:0,
    score:0, level:1, lives:3,
    speed: 4 + carData.speedBonus,
    baseSpeed: 4 + carData.speedBonus,
    combo:1, comboTimer:0, spawnTimer:0, spawnInterval:90,
    coinSpawnTimer:0, coinPulse:0,
    sessionCoins:0,
    invincible:0, shake:0, running:true,
    stars: Array.from({length:80},()=>({ x:rand(0,CANVAS_W),y:rand(0,CANVAS_H),r:rand(.5,2),a:rand(.3,.9),speed:rand(.5,1.5) })),
  }), [carData.speedBonus]);

  const startGame = useCallback(() => {
    stateRef.current = initState();
    setScreen("playing");
    soundRef.current?.startEngine();
  }, [initState]);

  // Keyboard
  useEffect(() => {
    const dn = e => {
      keysRef.current[e.key]=true;
      if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," "].includes(e.key)) e.preventDefault();
    };
    const up = e => { keysRef.current[e.key]=false; };
    window.addEventListener("keydown",dn);
    window.addEventListener("keyup",up);
    return ()=>{ window.removeEventListener("keydown",dn); window.removeEventListener("keyup",up); };
  }, []);

  const press   = key => () => { keysRef.current[key]=true; };
  const release = key => () => { keysRef.current[key]=false; };

  // ── Game loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== "playing") return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const snd = soundRef.current;
    let laneCd=0, jumpEdge=false;

    const spawnEnemy = s => {
      const lane=randI(0,LANE_COUNT-1);
      s.enemies.push({ x:ROAD_LEFT+lane*LANE_WIDTH+(LANE_WIDTH-CAR_W)/2,
        y:-CAR_H-20, lane, speed:rand(s.speed*.4,s.speed*.75),
        colors:ENEMY_COLORS[randI(0,ENEMY_COLORS.length-1)] });
    };

    const spawnCoin = s => {
      const lane=randI(0,LANE_COUNT-1);
      s.coins.push({ x:ROAD_LEFT+lane*LANE_WIDTH+LANE_WIDTH/2, y:-20, r:14 });
    };

    const burst = (x,y,color,n=14) => {
      for(let i=0;i<n;i++){
        const a=rand(0,Math.PI*2),sp=rand(2,7);
        stateRef.current.particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1,color,r:rand(3,8)});
      }
    };

    const loop = () => {
      const s = stateRef.current;
      if (!s||!s.running) return;
      const k=keysRef.current, p=s.player;

      // Lane
      if(laneCd>0) laneCd--;
      if((k["ArrowLeft"]||k["_L"])&&laneCd===0&&p.targetLane>0){ p.targetLane--;laneCd=18; }
      if((k["ArrowRight"]||k["_R"])&&laneCd===0&&p.targetLane<LANE_COUNT-1){ p.targetLane++;laneCd=18; }
      p.x=lerp(p.x,ROAD_LEFT+p.targetLane*LANE_WIDTH+(LANE_WIDTH-CAR_W)/2,0.18);

      // Forward/Back
      if(k["ArrowUp"]||k["_U"])        p.vy=lerp(p.vy,-4.5,.25);
      else if(k["ArrowDown"]||k["_D"]) p.vy=lerp(p.vy,4.5,.25);
      else                              p.vy=lerp(p.vy,0,.22);
      p.y=clamp(p.y+p.vy,Y_MIN,Y_MAX);

      // Jump
      const jumpHeld=k[" "]||k["_J"];
      if(p.jumpCooldown>0) p.jumpCooldown--;
      if(jumpHeld&&!jumpEdge&&!p.isJumping&&p.jumpCooldown===0){
        p.jumpVel=JUMP_POWER; p.isJumping=true; jumpEdge=true;
        burst(p.x+CAR_W/2,p.y+CAR_H,"#00cfff",10);
        snd?.playJump();
      }
      if(!jumpHeld) jumpEdge=false;
      if(p.isJumping){
        p.jumpVel+=GRAVITY; p.jumpZ-=p.jumpVel;
        if(p.jumpZ<=0){ p.jumpZ=0;p.jumpVel=0;p.isJumping=false;p.jumpCooldown=JUMP_COOLDOWN; burst(p.x+CAR_W/2,p.y+CAR_H,"#aaa",8); }
      }

      // Road / score / speed
      s.roadOffset+=s.speed;
      s.score+=Math.floor(s.speed*.5);
      s.level=Math.floor(s.score/1200)+1;
      s.speed=s.baseSpeed+s.level*.7;
      snd?.setEngineSpeed(s.speed);

      // Enemy spawn
      s.spawnTimer++; s.spawnInterval=Math.max(35,90-s.level*5);
      if(s.spawnTimer>=s.spawnInterval){ spawnEnemy(s);s.spawnTimer=0; }

      // Coin spawn — every ~180 frames
      s.coinSpawnTimer++;
      if(s.coinSpawnTimer>=180){ spawnCoin(s);s.coinSpawnTimer=randI(0,40); }
      s.coinPulse+=0.12;

      // Move enemies
      for(let i=s.enemies.length-1;i>=0;i--){
        const e=s.enemies[i]; e.y+=s.speed-e.speed;
        if(e.y>CANVAS_H+CAR_H){ s.enemies.splice(i,1); s.combo=Math.min(s.combo+1,8);s.comboTimer=120;s.score+=s.combo*50; }
      }
      if(s.comboTimer>0) s.comboTimer--; else s.combo=1;

      // Move coins & pickup
      for(let i=s.coins.length-1;i>=0;i--){
        const c=s.coins[i]; c.y+=s.speed*.85;
        if(c.y>CANVAS_H+30){ s.coins.splice(i,1); continue; }
        // Collect
        const dx=p.x+CAR_W/2-c.x, dy=p.y+CAR_H/2-c.y;
        if(Math.sqrt(dx*dx+dy*dy)<c.r+CAR_W/2-8){
          s.coins.splice(i,1);
          s.sessionCoins++;
          s.score+=100;
          burst(c.x,c.y,"#f5c518",10);
          snd?.playCoin();
        }
      }

      // Enemy collision
      if(s.invincible>0) s.invincible--;
      else if(p.jumpZ<18){
        for(let i=s.enemies.length-1;i>=0;i--){
          const e=s.enemies[i],mg=12;
          if(p.x<e.x+CAR_W-mg&&p.x+CAR_W>e.x+mg&&p.y<e.y+CAR_H-mg&&p.y+CAR_H>e.y+mg){
            s.enemies.splice(i,1);
            s.lives--;s.invincible=120;s.shake=18;s.combo=1;
            burst(p.x+CAR_W/2,p.y+CAR_H/2,"#e74c3c",20);
            burst(e.x+CAR_W/2,e.y+CAR_H/2,e.colors.body,16);
            snd?.playCrash();
            if(s.lives<=0){
              s.running=false;
              snd?.stopEngine();
              setFinalScore(s.score);
              setHighScore(prev=>{
                const next=Math.max(prev,s.score);
                localStorage.setItem("racer_hs",next);
                return next;
              });
              setTotalCoins(prev=>{
                const next=prev+s.sessionCoins;
                localStorage.setItem("racer_coins",next);
                return next;
              });
              setScreen("gameover");
              return;
            }
            break;
          }
        }
      }

      // Particles
      for(let i=s.particles.length-1;i>=0;i--){
        const pt=s.particles[i];
        pt.x+=pt.vx;pt.y+=pt.vy;pt.vy+=.15;pt.life-=.04;pt.vx*=.95;
        if(pt.life<=0) s.particles.splice(i,1);
      }
      if(s.shake>0) s.shake--;

      // ── Draw ────────────────────────────────────────────────────────────────
      ctx.save();
      if(s.shake>0) ctx.translate(rand(-s.shake*.6,s.shake*.6),rand(-s.shake*.3,s.shake*.3));
      drawStars(ctx,s.stars,s.roadOffset);
      drawRoad(ctx,s.roadOffset);
      drawSpeedLines(ctx,s.speed);

      // Coins
      s.coins.forEach(c=>drawCoin(ctx,c.x,c.y,c.r,s.coinPulse));

      // Enemies
      s.enemies.forEach(e=>drawCar(ctx,e.x,e.y,CAR_W,CAR_H,e.colors,false,true,0));

      // Player
      if(s.invincible===0||Math.floor(s.invincible/8)%2===0){
        drawCar(ctx,p.x,p.y,CAR_W,CAR_H,carData.colors,true,false,p.jumpZ);
        if(s.speed>5&&p.jumpZ<5){
          ctx.fillStyle=`rgba(180,180,255,${rand(.1,.3)})`;
          ctx.beginPath();ctx.ellipse(p.x+10,p.y+CAR_H+4,5,rand(4,12),0,0,Math.PI*2);ctx.fill();
          ctx.beginPath();ctx.ellipse(p.x+CAR_W-10,p.y+CAR_H+4,5,rand(4,12),0,0,Math.PI*2);ctx.fill();
        }
      }

      // Particles
      s.particles.forEach(pt=>{
        ctx.globalAlpha=pt.life;ctx.fillStyle=pt.color;
        ctx.beginPath();ctx.arc(pt.x,pt.y,pt.r*pt.life,0,Math.PI*2);ctx.fill();
      });
      ctx.globalAlpha=1;

      drawHUD(ctx,{ score:s.score,level:s.level,lives:s.lives,speed:s.speed,
        combo:s.combo,jumpReady:p.jumpCooldown===0&&!p.isJumping,
        coins:totalCoins+s.sessionCoins, carName:carData.name });
      ctx.restore();

      animRef.current=requestAnimationFrame(loop);
    };

    animRef.current=requestAnimationFrame(loop);
    return ()=>{ cancelAnimationFrame(animRef.current); snd?.stopEngine(); };
  }, [screen, carData]);

  // Garage actions
  const buycar = id => {
    const car=CARS.find(c=>c.id===id);
    if(!car||totalCoins<car.cost) return;
    const next=totalCoins-car.cost;
    setTotalCoins(next);
    localStorage.setItem("racer_coins",next);
    const nl=[...unlockedCars,id];
    setUnlocked(nl);
    localStorage.setItem("racer_unlocked",JSON.stringify(nl));
    setSelected(id);
    localStorage.setItem("racer_car",id);
  };

  const selectCar = id => {
    setSelected(id);
    localStorage.setItem("racer_car",id);
  };

  const btn = { fontFamily:"'Courier New',monospace",border:"none",borderRadius:10,cursor:"pointer",fontSize:18,fontWeight:700,padding:"16px 44px" };

  return (
    <div style={{ minHeight:"100vh",
      background:"radial-gradient(ellipse at 50% 30%,#0d1b3e 0%,#05050f 70%)",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      fontFamily:"'Courier New',monospace",userSelect:"none",overflow:"hidden",position:"relative" }}>

      <div style={{ position:"absolute",inset:0,opacity:.07,pointerEvents:"none",
        backgroundImage:"linear-gradient(#f5c51822 1px,transparent 1px),linear-gradient(90deg,#f5c51822 1px,transparent 1px)",
        backgroundSize:"40px 40px" }} />

      {/* ── Canvas + Dpad ── */}
      <div style={{ position:"relative",display:screen==="playing"?"block":"none" }}>
        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
          style={{ display:"block",borderRadius:16,touchAction:"none",maxWidth:"100vw",
            boxShadow:"0 0 60px rgba(245,197,24,.25),0 0 120px rgba(231,76,60,.15)" }} />

        <div style={{ position:"absolute",bottom:18,left:0,right:0,display:"flex",
          justifyContent:"space-between",alignItems:"flex-end",padding:"0 18px",pointerEvents:"none" }}>
          <div style={{ pointerEvents:"all",display:"grid",
            gridTemplateColumns:"54px 54px 54px",gridTemplateRows:"54px 54px",gap:5 }}>
            <div/><DPadBtn label="▲" onPress={press("_U")} onRelease={release("_U")}/><div/>
            <DPadBtn label="◀" onPress={press("_L")} onRelease={release("_L")}/>
            <DPadBtn label="▼" onPress={press("_D")} onRelease={release("_D")}/>
            <DPadBtn label="▶" onPress={press("_R")} onRelease={release("_R")}/>
          </div>
          <div style={{ pointerEvents:"all",textAlign:"center" }}>
            <DPadBtn label="🚀" onPress={press("_J")} onRelease={release("_J")}
              style={{ width:70,height:70,borderRadius:"50%",fontSize:26,
                background:"rgba(0,207,255,0.15)",border:"2px solid rgba(0,207,255,0.45)",
                boxShadow:"0 0 18px rgba(0,207,255,0.35)" }}/>
            <div style={{ color:"rgba(0,207,255,0.6)",fontSize:10,marginTop:4 }}>JUMP</div>
          </div>
        </div>

        <div style={{ position:"absolute",top:14,right:14,color:"rgba(255,255,255,0.18)",
          fontSize:10,textAlign:"right",lineHeight:1.7,pointerEvents:"none" }}>
          ← → LANES<br/>↑ ↓ MOVE<br/>SPACE JUMP
        </div>
      </div>

      {/* ── MENU ── */}
      {screen==="menu" && (
        <div style={{ textAlign:"center",zIndex:10 }}>
          <div style={{ fontSize:"clamp(42px,10vw,72px)",fontWeight:900,letterSpacing:"0.05em",
            background:"linear-gradient(135deg,#f5c518 0%,#e74c3c 50%,#9b59b6 100%)",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
            marginBottom:8,lineHeight:1.1,filter:"drop-shadow(0 0 30px rgba(245,197,24,0.5))" }}>
            INFINITE<br/>RACER
          </div>
          <div style={{ color:"#aaa",fontSize:14,marginBottom:8,letterSpacing:"0.12em" }}>DODGE. JUMP. SURVIVE.</div>

          <div style={{ display:"flex",gap:24,justifyContent:"center",marginBottom:32 }}>
            <div style={{ color:"#f5c518",fontSize:13 }}>🏆 BEST: {highScore.toString().padStart(6,"0")}</div>
            <div style={{ color:"#f5c518",fontSize:13 }}>🪙 {totalCoins} coins</div>
          </div>

          <div style={{ display:"flex",gap:12,justifyContent:"center",marginBottom:20 }}>
            <button onClick={startGame} style={{ ...btn,fontSize:22,padding:"18px 56px",
              background:"linear-gradient(135deg,#e74c3c,#c0392b)",color:"#fff",
              boxShadow:"0 0 30px rgba(231,76,60,.6)" }}>▶ RACE</button>
          </div>

          <div style={{ display:"flex",gap:12,justifyContent:"center",marginBottom:28 }}>
            <button onClick={()=>setModal("garage")} style={{ ...btn,padding:"12px 28px",fontSize:14,
              background:"rgba(155,89,182,0.2)",color:"#9b59b6",border:"1px solid #9b59b640" }}>🏎 GARAGE</button>
            <button onClick={()=>setModal("leaderboard")} style={{ ...btn,padding:"12px 28px",fontSize:14,
              background:"rgba(245,197,24,0.1)",color:"#f5c518",border:"1px solid #f5c51840" }}>🏆 LEADERBOARD</button>
          </div>

          <div style={{ color:"#555",fontSize:11,lineHeight:2 }}>
            ← → LANES &nbsp;|&nbsp; ↑ ↓ FORWARD/BACK &nbsp;|&nbsp; SPACE JUMP<br/>
            COLLECT 🪙 COINS → UNLOCK FASTER CARS IN GARAGE
          </div>
        </div>
      )}

      {/* ── GAME OVER ── */}
      {screen==="gameover" && (
        <div style={{ textAlign:"center",zIndex:10,background:"rgba(5,5,15,0.92)",
          border:"1px solid #e74c3c44",borderRadius:20,padding:"40px 56px",
          boxShadow:"0 0 80px rgba(231,76,60,.3)" }}>
          <div style={{ fontSize:52,fontWeight:900,color:"#e74c3c",
            filter:"drop-shadow(0 0 20px #e74c3c)",marginBottom:12 }}>GAME OVER</div>
          <div style={{ color:"#fff",fontSize:18,marginBottom:4 }}>
            SCORE: <span style={{ color:"#f5c518",fontWeight:700,fontSize:28 }}>{finalScore.toString().padStart(6,"0")}</span>
          </div>
          {finalScore>=highScore&&finalScore>0&&<div style={{ color:"#f5c518",fontSize:13,marginBottom:4 }}>🏆 NEW HIGH SCORE!</div>}
          <div style={{ color:"#888",fontSize:12,marginBottom:4 }}>BEST: {highScore.toString().padStart(6,"0")}</div>
          <div style={{ color:"#f5c518",fontSize:13,marginBottom:28 }}>🪙 Total coins: {totalCoins}</div>

          <div style={{ display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap" }}>
            <button onClick={startGame} style={{ ...btn,background:"linear-gradient(135deg,#e74c3c,#c0392b)",
              color:"#fff",boxShadow:"0 0 20px rgba(231,76,60,.5)" }}>▶ RETRY</button>
            <button onClick={()=>setModal("leaderboard")} style={{ ...btn,padding:"16px 24px",
              background:"rgba(245,197,24,0.1)",color:"#f5c518",border:"1px solid #f5c51840" }}>🏆 LEADERBOARD</button>
            <button onClick={()=>setScreen("menu")} style={{ ...btn,padding:"16px 24px",
              background:"transparent",color:"#aaa",border:"1px solid #444" }}>MENU</button>
          </div>
        </div>
      )}

      {/* ── MODALS ── */}
      {modal==="leaderboard" && (
        <LeaderboardModal playerScore={screen==="gameover"?finalScore:null} onClose={()=>setModal(null)}/>
      )}
      {modal==="garage" && (
        <GarageModal coins={totalCoins} unlockedCars={unlockedCars}
          selectedCar={selectedCar} onBuy={buycar} onSelect={selectCar} onClose={()=>setModal(null)}/>
      )}
    </div>
  );
}
