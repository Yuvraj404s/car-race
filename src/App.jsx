import { useState, useEffect, useRef, useCallback } from "react";

// ─── Game State Machine ───────────────────────────────────────────────────────
const GS = Object.freeze({ START_MENU:"START_MENU", PLAYING:"PLAYING", GAME_OVER:"GAME_OVER", PAUSED:"PAUSED" });

// ─── Config ───────────────────────────────────────────────────────────────────
const LANE_COUNT = 3;
const CAR_W = 48, CAR_H = 88;
const CANVAS_W = 420, CANVAS_H = 700;   // narrower = more mobile-friendly
const ROAD_W   = CANVAS_W;              // full-width road, no grass
const LANE_W   = ROAD_W / LANE_COUNT;
const ROAD_L   = 0;
const Y_MIN = 60, Y_MAX = CANVAS_H - CAR_H - 10, Y_DEFAULT = CANVAS_H - CAR_H - 20;
const JUMP_POWER = -13, GRAVITY = 0.6, JUMP_CD = 40;

// ─── Car Catalog — each car has a unique body TYPE driving the shape renderer ──
// type: "coupe" | "muscle" | "formula" | "cyber"
const CARS = [
  { id:"viper",   name:"VIPER GT",   cost:0,   speedBonus:0,   type:"coupe",
    primary:"#e74c3c", accent:"#ff9999", glow:"255,80,80",
    desc:"Classic sports coupe" },
  { id:"phantom", name:"PHANTOM",    cost:80,  speedBonus:1.2, type:"muscle",
    primary:"#9b59b6", accent:"#d7aefb", glow:"180,80,255",
    desc:"Brawny muscle car" },
  { id:"cyber",   name:"CYBER-X",    cost:200, speedBonus:2.5, type:"formula",
    primary:"#00cfff", accent:"#aaf0ff", glow:"0,200,255",
    desc:"Low Formula racer" },
  { id:"shadow",  name:"SHADOW MK2", cost:400, speedBonus:4.0, type:"cyber",
    primary:"#2ecc71", accent:"#aaffcc", glow:"0,220,100",
    desc:"Futuristic concept" },
];
// Enemy cars use random types for visual variety
const ENEMY_POOL = [
  { primary:"#3498db", accent:"#88ccff", glow:"52,152,219",  type:"coupe"   },
  { primary:"#e67e22", accent:"#ffbb66", glow:"230,126,34",  type:"muscle"  },
  { primary:"#e74c3c", accent:"#ff8888", glow:"231,76,60",   type:"formula" },
  { primary:"#f1c40f", accent:"#fff0aa", glow:"241,196,15",  type:"coupe"   },
  { primary:"#1abc9c", accent:"#66ffdd", glow:"26,188,156",  type:"cyber"   },
];

const API = "/api";

// ─── Ad Break / Monetisation ──────────────────────────────────────────────────
let _deathCount = 0;
function triggerAdBreak() {
  _deathCount++;
  if (_deathCount % 3 === 0) {
    console.log("%c[AD_TRIGGERED]", "color:#ff6b00;font-weight:bold");
    // TODO: inject Jio/AdMob SDK call here
  }
}
function showInterstitialAd(cb = () => {}) {
  const t = window.aiptag;
  if (t?.adplayer) { t.cmd.player.push(() => t.adplayer.startPreRoll({ onAdComplete:cb, onAdSkipped:cb, onAdError:cb })); }
  else cb();
}
function showRewardedAd({ onComplete, onSkip, onError }) {
  const t = window.aiptag;
  if (t?.adplayer) { t.cmd.player.push(() => t.adplayer.startPreRoll({ onAdComplete:onComplete, onAdSkipped:onSkip, onAdError:onError })); }
  else { console.log("[Ad] dev fallback"); onComplete(); }
}

// ─── Utils ────────────────────────────────────────────────────────────────────
const lerp  = (a,b,t) => a+(b-a)*t;
const rand  = (lo,hi) => Math.random()*(hi-lo)+lo;
const randI = (lo,hi) => Math.floor(rand(lo,hi+1));
const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));

// ─── Web Audio: Sound + Music Engine ─────────────────────────────────────────
function createAudio() {
  let ctx = null;
  let engineOsc = null, engineGain = null;
  let musicNodes = [], musicGainNode = null;
  let sfxVol = 0.6, musicVol = 0.4;
  let engineRunning = false;
  let musicRunning = false;

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  // ── Engine hum ──────────────────────────────────────────────────────────────
  function startEngine() {
    if (engineRunning) return;
    engineRunning = true;
    const c = ac();
    engineOsc  = c.createOscillator();
    engineGain = c.createGain();
    engineOsc.type = "sawtooth";
    engineOsc.frequency.value = 80;
    engineGain.gain.value = sfxVol * 0.06;
    engineOsc.connect(engineGain);
    engineGain.connect(c.destination);
    engineOsc.start();
  }
  function setEngineRPM(speed) {
    if (!engineOsc) return;
    const c = ac();
    engineOsc.frequency.setTargetAtTime(55 + speed * 20, c.currentTime, 0.12);
    engineGain.gain.setTargetAtTime(sfxVol * (0.025 + speed * 0.003), c.currentTime, 0.12);
  }
  function stopEngine() {
    if (!engineOsc) return;
    engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    setTimeout(() => { try { engineOsc.stop(); } catch {} engineOsc = null; engineRunning = false; }, 500);
  }
  function pauseEngine() { if (engineGain) engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1); }
  function resumeEngine(speed) { if (engineGain) engineGain.gain.setTargetAtTime(sfxVol*(0.025+speed*0.003), ctx.currentTime, 0.1); }

  // ── Procedural chiptune music ─────────────────────────────────────────────
  // A simple looping arpeggio using oscillators — no files needed
  function startMusic() {
    if (musicRunning) return;
    musicRunning = true;
    const c = ac();
    musicGainNode = c.createGain();
    musicGainNode.gain.value = musicVol * 0.18;
    musicGainNode.connect(c.destination);

    // Notes for a pumping minor pentatonic loop
    const notes  = [220, 261, 294, 349, 392, 440, 349, 294, 261, 220, 196, 220];
    const bassBeat = [55, 0, 55, 0, 58, 0, 58, 0];
    let step = 0, bassStep = 0;
    const bpm = 138, interval = (60/bpm)*0.5*1000;

    function playNote(freq, dur, type="square", vol=1) {
      if (!musicGainNode) return;
      const osc = c.createOscillator();
      const g   = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(musicVol * 0.15 * vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur/1000);
      osc.connect(g); g.connect(musicGainNode);
      osc.start(); osc.stop(c.currentTime + dur/1000);
      musicNodes.push(osc, g);
    }

    const tick = setInterval(() => {
      if (!musicRunning) { clearInterval(tick); return; }
      // Melody
      const f = notes[step % notes.length];
      playNote(f, interval * 0.6, "square", 0.8);
      // Bassline every other step
      if (bassStep % 2 === 0) {
        const b = bassBeat[bassStep % bassBeat.length];
        if (b) playNote(b, interval * 0.9, "sawtooth", 0.5);
        bassStep++;
      } else bassStep++;
      // Hi-hat feel
      if (step % 2 === 0) playNote(880, interval * 0.1, "square", 0.1);
      step++;
      // Prune old nodes
      if (musicNodes.length > 60) musicNodes.splice(0, 30);
    }, interval);
    musicNodes.push({ stop: () => clearInterval(tick) });
  }

  function stopMusic() {
    musicRunning = false;
    musicNodes.forEach(n => { try { n.stop?.(); } catch {} });
    musicNodes = [];
    if (musicGainNode) { musicGainNode.gain.setTargetAtTime(0, ctx.currentTime, 0.3); musicGainNode = null; }
  }
  function setMusicVol(v) {
    musicVol = v;
    if (musicGainNode) musicGainNode.gain.setTargetAtTime(v * 0.18, ctx.currentTime, 0.1);
  }
  function setSfxVol(v) {
    sfxVol = v;
    if (engineGain) engineGain.gain.setTargetAtTime(v * 0.04, ctx.currentTime, 0.1);
  }

  // ── One-shot SFX ─────────────────────────────────────────────────────────
  function playCrash() {
    const c = ac(); const bufSz = c.sampleRate * 0.35;
    const buf = c.createBuffer(1, bufSz, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i=0;i<bufSz;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/bufSz,1.5);
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.value = sfxVol * 0.8;
    src.connect(g); g.connect(c.destination); src.start();
    const o = c.createOscillator(), og = c.createGain();
    o.frequency.value = 70; og.gain.setValueAtTime(sfxVol*0.5, c.currentTime);
    og.gain.exponentialRampToValueAtTime(0.001, c.currentTime+0.3);
    o.connect(og); og.connect(c.destination); o.start(); o.stop(c.currentTime+0.3);
  }
  function playCoin() {
    const c = ac(); const o = c.createOscillator(), g = c.createGain();
    o.type="sine"; o.frequency.setValueAtTime(880,c.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320,c.currentTime+0.08);
    g.gain.setValueAtTime(sfxVol*0.3,c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+0.15);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime+0.15);
  }
  function playJump() {
    const c = ac(); const o = c.createOscillator(), g = c.createGain();
    o.type="square"; o.frequency.setValueAtTime(280,c.currentTime);
    o.frequency.exponentialRampToValueAtTime(560,c.currentTime+0.1);
    g.gain.setValueAtTime(sfxVol*0.18,c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+0.13);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime+0.13);
  }
  function getMusicVol() { return musicVol; }
  function getSfxVol()   { return sfxVol; }
  return { startEngine,setEngineRPM,stopEngine,pauseEngine,resumeEngine,startMusic,stopMusic,setMusicVol,setSfxVol,getMusicVol,getSfxVol,playCrash,playCoin,playJump };
}

// ─── Drawing Helpers ─────────────────────────────────────────────────────────
// Each car type has a unique shape drawn top-down with canvas paths.
// Ground shadow + neon aura are shared across all types.

// ── Shared: shadow + aura wrapper ───────────────────────────────────────────
function carShadow(ctx, w, h, jumpZ, shadowScale) {
  ctx.save();
  ctx.translate(0, h*0.42 + jumpZ*0.2);
  ctx.globalAlpha = 0.5 * shadowScale;
  const sg = ctx.createRadialGradient(0,0,1,0,0,w*0.55*shadowScale);
  sg.addColorStop(0,"rgba(0,0,0,0.9)"); sg.addColorStop(1,"transparent");
  ctx.fillStyle=sg; ctx.beginPath();
  ctx.ellipse(0,0, w*0.55*shadowScale, 9*shadowScale, 0,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

function carJumpAura(ctx, w, h, jumpZ, glow) {
  if(jumpZ<8) return;
  const alpha=Math.min(jumpZ/48,0.9);
  ctx.strokeStyle=`rgba(${glow},${alpha})`; ctx.lineWidth=3;
  ctx.shadowColor=`rgb(${glow})`; ctx.shadowBlur=20;
  ctx.beginPath(); ctx.ellipse(0,h/2-6, w/2+8, 10, 0,0,Math.PI*2); ctx.stroke();
  ctx.shadowBlur=0;
}

// ── Type 1: COUPE — sleek sports coupe, long hood, short cabin ──────────────
function drawCoupe(ctx, bw, bh, p, a, gr, isPlayer) {
  // Main body — long tapered shape
  const bodyG = ctx.createLinearGradient(0,-bh/2, 0,bh/2);
  bodyG.addColorStop(0, a); bodyG.addColorStop(0.5, p); bodyG.addColorStop(1,"#111");
  ctx.fillStyle=bodyG;
  ctx.beginPath();
  ctx.moveTo(-bw/2+8,  -bh/2+4);   // front-left nose
  ctx.lineTo( bw/2-8,  -bh/2+4);   // front-right nose
  ctx.lineTo( bw/2,    -bh/2+18);   // front shoulder R
  ctx.lineTo( bw/2+2,   bh/2-8);   // rear-right
  ctx.lineTo(-bw/2-2,   bh/2-8);   // rear-left
  ctx.lineTo(-bw/2,    -bh/2+18);   // front shoulder L
  ctx.closePath(); ctx.fill();

  // Cabin glass — sits in mid section
  const cabinW=bw*0.68, cabinTop=-bh*0.1, cabinBot=bh*0.18;
  const glassG=ctx.createLinearGradient(0,cabinTop,0,cabinBot);
  glassG.addColorStop(0,`rgba(${gr},0.85)`); glassG.addColorStop(1,`rgba(20,30,60,0.9)`);
  ctx.fillStyle=glassG; ctx.globalAlpha=0.9;
  ctx.beginPath();
  ctx.moveTo(-cabinW/2+4, cabinTop+2);
  ctx.lineTo( cabinW/2-4, cabinTop+2);
  ctx.lineTo( cabinW/2,   cabinBot);
  ctx.lineTo(-cabinW/2,   cabinBot);
  ctx.closePath(); ctx.fill(); ctx.globalAlpha=1;

  // Roof
  ctx.fillStyle="rgba(10,10,20,0.95)";
  ctx.beginPath();
  ctx.moveTo(-bw*0.28, cabinTop); ctx.lineTo(bw*0.28, cabinTop);
  ctx.lineTo(bw*0.25, cabinTop-bh*0.15); ctx.lineTo(-bw*0.25, cabinTop-bh*0.15);
  ctx.closePath(); ctx.fill();

  // Body stripe
  ctx.strokeStyle=`rgba(${gr},0.7)`; ctx.lineWidth=2;
  ctx.shadowColor=`rgb(${gr})`; ctx.shadowBlur=6;
  ctx.beginPath(); ctx.moveTo(-bw/2+2, bh*0.05); ctx.lineTo(bw/2-2, bh*0.05); ctx.stroke();
  ctx.shadowBlur=0;

  // Hood vents (front)
  ctx.strokeStyle=`rgba(${gr},0.5)`; ctx.lineWidth=1.2;
  [-bw*0.12, 0, bw*0.12].forEach(vx=>{
    ctx.beginPath(); ctx.moveTo(vx,-bh/2+7); ctx.lineTo(vx,-bh/2+14); ctx.stroke();
  });

  // Headlights
  ctx.fillStyle=isPlayer?"#ffe8a0":"#ff2222";
  ctx.shadowColor=isPlayer?"#fff":"#ff0000"; ctx.shadowBlur=14;
  [[-bw/2+5,-bh/2+8],[bw/2-5,-bh/2+8]].forEach(([lx,ly])=>{
    ctx.beginPath(); ctx.ellipse(lx,ly,6,3,0,0,Math.PI*2); ctx.fill();
  });
  ctx.shadowBlur=0;

  // Brake lights
  ctx.fillStyle=isPlayer?"#ff2222":"rgba(255,30,30,0.6)"; ctx.shadowBlur=0;
  [[-bw/2+5,bh/2-10],[bw/2-5,bh/2-10]].forEach(([lx,ly])=>{
    ctx.beginPath(); ctx.roundRect(lx-5,ly-3,10,5,2); ctx.fill();
  });

  // Wheels
  drawWheels(ctx, bw, bh, gr);
  // Underglow
  drawUnderglow(ctx, bw, bh, gr);
}

// ── Type 2: MUSCLE — wide, boxy, tall stance, hood scoop ────────────────────
function drawMuscle(ctx, bw, bh, p, a, gr, isPlayer) {
  const bodyG=ctx.createLinearGradient(-bw/2,0,bw/2,0);
  bodyG.addColorStop(0,"#111"); bodyG.addColorStop(0.15,a);
  bodyG.addColorStop(0.5,p); bodyG.addColorStop(0.85,a); bodyG.addColorStop(1,"#111");
  ctx.fillStyle=bodyG;
  // Wide boxy body
  ctx.beginPath();
  ctx.moveTo(-bw/2-3, -bh/2+12);
  ctx.lineTo( bw/2+3, -bh/2+12);
  ctx.lineTo( bw/2+3,  bh/2-6);
  ctx.lineTo(-bw/2-3,  bh/2-6);
  ctx.closePath(); ctx.fill();

  // Hood scoop
  ctx.fillStyle=`rgba(0,0,0,0.7)`;
  ctx.beginPath();
  ctx.moveTo(-bw*0.18,-bh/2+12); ctx.lineTo(bw*0.18,-bh/2+12);
  ctx.lineTo(bw*0.14,-bh/2+3); ctx.lineTo(-bw*0.14,-bh/2+3);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle=`rgba(${gr},0.8)`; ctx.lineWidth=1.5;
  ctx.beginPath();
  ctx.moveTo(-bw*0.1,-bh/2+5); ctx.lineTo(bw*0.1,-bh/2+5); ctx.stroke();

  // Tall cabin
  ctx.fillStyle="rgba(8,8,18,0.95)";
  ctx.beginPath(); ctx.roundRect(-bw*0.3,-bh*0.1,bw*0.6,bh*0.35,4); ctx.fill();

  // Glass
  const glassG=ctx.createLinearGradient(0,-bh*0.08,0,bh*0.12);
  glassG.addColorStop(0,`rgba(${gr},0.8)`); glassG.addColorStop(1,`rgba(30,30,80,0.85)`);
  ctx.fillStyle=glassG; ctx.globalAlpha=0.85;
  ctx.beginPath(); ctx.roundRect(-bw*0.26,-bh*0.07,bw*0.52,bh*0.28,3); ctx.fill();
  ctx.globalAlpha=1;

  // Side exhaust stripes
  ctx.strokeStyle=`rgba(${gr},0.65)`; ctx.lineWidth=2.5;
  ctx.shadowColor=`rgb(${gr})`; ctx.shadowBlur=5;
  [[-bw/2-1,bh*0.08],[bw/2+1,bh*0.08]].forEach(([ex,ey])=>{
    ctx.beginPath(); ctx.moveTo(ex,ey-10); ctx.lineTo(ex,ey+10); ctx.stroke();
  });
  ctx.shadowBlur=0;

  // Headlights — wide bar style
  ctx.fillStyle=isPlayer?"#ffe080":"#ff1111";
  ctx.shadowColor=isPlayer?"#fff":"#f00"; ctx.shadowBlur=16;
  ctx.beginPath(); ctx.roundRect(-bw/2+2,-bh/2+14,bw-4,5,2); ctx.fill();
  ctx.shadowBlur=0;

  drawWheels(ctx, bw, bh, gr, true); // wider wheels
  drawUnderglow(ctx, bw, bh, gr);
}

// ── Type 3: FORMULA — ultra-low, wide wings, F1-style ───────────────────────
function drawFormula(ctx, bw, bh, p, a, gr, isPlayer) {
  const fw = bw*1.5; // much wider due to wings

  // Front wing
  ctx.fillStyle=p;
  ctx.beginPath();
  ctx.moveTo(-fw/2,-bh/2+6); ctx.lineTo(fw/2,-bh/2+6);
  ctx.lineTo(fw/2-6,-bh/2+14); ctx.lineTo(-fw/2+6,-bh/2+14);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle=`rgba(${gr},0.8)`; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(-fw/2,-bh/2+10); ctx.lineTo(fw/2,-bh/2+10); ctx.stroke();

  // Rear wing
  ctx.fillStyle=a;
  ctx.beginPath();
  ctx.moveTo(-fw/2+2,bh/2-14); ctx.lineTo(fw/2-2,bh/2-14);
  ctx.lineTo(fw/2-8,bh/2-6); ctx.lineTo(-fw/2+8,bh/2-6);
  ctx.closePath(); ctx.fill();

  // Central body — narrow pod
  const bodyG=ctx.createLinearGradient(0,-bh/2,0,bh/2);
  bodyG.addColorStop(0,a); bodyG.addColorStop(0.3,p); bodyG.addColorStop(1,"#000");
  ctx.fillStyle=bodyG;
  ctx.beginPath();
  ctx.moveTo(-bw*0.28,-bh/2+14);
  ctx.lineTo( bw*0.28,-bh/2+14);
  ctx.lineTo( bw*0.35, bh/2-14);
  ctx.lineTo(-bw*0.35, bh/2-14);
  ctx.closePath(); ctx.fill();

  // Cockpit bubble
  const cockpitG=ctx.createRadialGradient(0,-bh*0.05,2,0,-bh*0.05,bw*0.28);
  cockpitG.addColorStop(0,`rgba(${gr},0.95)`); cockpitG.addColorStop(0.6,`rgba(0,30,80,0.8)`); cockpitG.addColorStop(1,"rgba(0,0,0,0.9)");
  ctx.fillStyle=cockpitG; ctx.globalAlpha=0.9;
  ctx.beginPath(); ctx.ellipse(0,-bh*0.05, bw*0.24, bh*0.18, 0,0,Math.PI*2); ctx.fill();
  ctx.globalAlpha=1;

  // HALO bar
  ctx.strokeStyle=p; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(-bw*0.2,-bh*0.18); ctx.lineTo(0,-bh*0.25); ctx.lineTo(bw*0.2,-bh*0.18); ctx.stroke();

  // Engine glow
  ctx.fillStyle=`rgba(${gr},0.6)`; ctx.shadowColor=`rgb(${gr})`; ctx.shadowBlur=10;
  ctx.beginPath(); ctx.ellipse(0,bh*0.38,bw*0.12,bh*0.06,0,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;

  // Headlights
  ctx.fillStyle=isPlayer?"#fff0a0":"#ff1111"; ctx.shadowColor=isPlayer?"#fff":"#f00"; ctx.shadowBlur=14;
  [[-bw*0.18,-bh/2+10],[bw*0.18,-bh/2+10]].forEach(([lx,ly])=>{
    ctx.beginPath(); ctx.ellipse(lx,ly,4,2.5,0,0,Math.PI*2); ctx.fill();
  });
  ctx.shadowBlur=0;

  // Formula wheels — large exposed discs
  const fy=[-bh/2+14, bh/2-14];
  const fx=[-fw*0.34, fw*0.34];
  fx.forEach(wx=>fy.forEach(wy=>{
    ctx.fillStyle="#0a0a0a";
    ctx.beginPath(); ctx.ellipse(wx,wy,9,10,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=`rgba(${gr},0.8)`; ctx.lineWidth=2;
    ctx.beginPath(); ctx.ellipse(wx,wy,5,6,0,0,Math.PI*2); ctx.stroke();
  }));
}

// ── Type 4: CYBER — angular cyberpunk concept ────────────────────────────────
function drawCyber(ctx, bw, bh, p, a, gr, isPlayer) {
  // Outer angular shell
  const bodyG=ctx.createLinearGradient(-bw/2,-bh/2,bw/2,bh/2);
  bodyG.addColorStop(0,"#0a0a12"); bodyG.addColorStop(0.3,p); bodyG.addColorStop(0.7,a); bodyG.addColorStop(1,"#0a0a12");
  ctx.fillStyle=bodyG;
  ctx.beginPath();
  ctx.moveTo(-bw*0.3, -bh/2);      // top-left
  ctx.lineTo( bw*0.3, -bh/2);      // top-right
  ctx.lineTo( bw/2+4, -bh*0.12);   // shoulder R
  ctx.lineTo( bw/2+6,  bh*0.3);    // mid R
  ctx.lineTo( bw*0.2,  bh/2);      // rear-right
  ctx.lineTo(-bw*0.2,  bh/2);      // rear-left
  ctx.lineTo(-bw/2-6,  bh*0.3);    // mid L
  ctx.lineTo(-bw/2-4, -bh*0.12);   // shoulder L
  ctx.closePath(); ctx.fill();

  // Hex panel details
  ctx.strokeStyle=`rgba(${gr},0.4)`; ctx.lineWidth=1;
  const hexes=[[-bw*0.1,-bh*0.15],[bw*0.1,-bh*0.15],[0,-bh*0.3],[-bw*0.1,bh*0.1],[bw*0.1,bh*0.1]];
  hexes.forEach(([hx,hy])=>{
    ctx.beginPath();
    for(let i=0;i<6;i++){
      const angle=Math.PI/3*i-Math.PI/6;
      const hSize=bw*0.1;
      if(i===0) ctx.moveTo(hx+Math.cos(angle)*hSize,hy+Math.sin(angle)*hSize);
      else ctx.lineTo(hx+Math.cos(angle)*hSize,hy+Math.sin(angle)*hSize);
    }
    ctx.closePath(); ctx.stroke();
  });

  // Cockpit — angular glass
  ctx.fillStyle="rgba(5,5,20,0.92)";
  ctx.beginPath();
  ctx.moveTo(-bw*0.22,-bh*0.32); ctx.lineTo(bw*0.22,-bh*0.32);
  ctx.lineTo(bw*0.3,bh*0.05); ctx.lineTo(-bw*0.3,bh*0.05);
  ctx.closePath(); ctx.fill();

  const glassG=ctx.createLinearGradient(0,-bh*0.3,0,bh*0.05);
  glassG.addColorStop(0,`rgba(${gr},0.9)`); glassG.addColorStop(1,`rgba(${gr},0.1)`);
  ctx.fillStyle=glassG; ctx.globalAlpha=0.75;
  ctx.beginPath();
  ctx.moveTo(-bw*0.19,-bh*0.28); ctx.lineTo(bw*0.19,-bh*0.28);
  ctx.lineTo(bw*0.26,bh*0.02); ctx.lineTo(-bw*0.26,bh*0.02);
  ctx.closePath(); ctx.fill(); ctx.globalAlpha=1;

  // Neon trim lines
  ctx.strokeStyle=`rgba(${gr},0.9)`; ctx.lineWidth=1.5;
  ctx.shadowColor=`rgb(${gr})`; ctx.shadowBlur=10;
  // Front edge
  ctx.beginPath(); ctx.moveTo(-bw*0.3,-bh/2); ctx.lineTo(bw*0.3,-bh/2); ctx.stroke();
  // Side lines
  ctx.beginPath(); ctx.moveTo(-bw/2-4,-bh*0.1); ctx.lineTo(-bw/2-6,bh*0.28); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bw/2+4,-bh*0.1); ctx.lineTo(bw/2+6,bh*0.28); ctx.stroke();
  ctx.shadowBlur=0;

  // Matrix-style front LED bar
  ctx.fillStyle=isPlayer?"#e0ffe0":"#ff2200"; ctx.shadowColor=isPlayer?`rgba(${gr},1)`:"#ff0000"; ctx.shadowBlur=18;
  ctx.beginPath(); ctx.roundRect(-bw*0.25,-bh/2+2, bw*0.5, 4, 2); ctx.fill();
  ctx.shadowBlur=0;

  // Rear light bar
  ctx.fillStyle=`rgba(${gr},0.8)`; ctx.shadowColor=`rgb(${gr})`; ctx.shadowBlur=12;
  ctx.beginPath(); ctx.roundRect(-bw*0.3,bh/2-5, bw*0.6,3,1); ctx.fill();
  ctx.shadowBlur=0;

  drawWheels(ctx, bw, bh, gr);
  drawUnderglow(ctx, bw, bh, gr);
}

// ── Shared wheel renderer ─────────────────────────────────────────────────────
function drawWheels(ctx, bw, bh, gr, wide=false) {
  const ww=wide?13:10, wh=wide?16:13;
  const positions=[
    [-bw/2-ww+2, -bh*0.36],
    [ bw/2-2,    -bh*0.36],
    [-bw/2-ww+2,  bh*0.36],
    [ bw/2-2,     bh*0.36],
  ];
  positions.forEach(([wx,wy])=>{
    // Tyre
    ctx.fillStyle="#0d0d0d";
    ctx.beginPath(); ctx.roundRect(wx,wy-wh/2,ww,wh,3); ctx.fill();
    ctx.strokeStyle="#1a1a1a"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.roundRect(wx,wy-wh/2,ww,wh,3); ctx.stroke();
    // Rim spokes
    ctx.strokeStyle=`rgba(${gr},0.7)`; ctx.lineWidth=1.5;
    const rcx=wx+ww/2, rcy=wy, rr=wh*0.35;
    for(let s=0;s<4;s++){
      const angle=(Math.PI/2)*s;
      ctx.beginPath(); ctx.moveTo(rcx,rcy);
      ctx.lineTo(rcx+Math.cos(angle)*rr, rcy+Math.sin(angle)*rr); ctx.stroke();
    }
    ctx.strokeStyle=`rgba(${gr},0.5)`; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(rcx,rcy,rr,0,Math.PI*2); ctx.stroke();
  });
}

function drawUnderglow(ctx, bw, bh, gr) {
  ctx.strokeStyle=`rgba(${gr},0.7)`; ctx.lineWidth=2;
  ctx.shadowColor=`rgb(${gr})`; ctx.shadowBlur=10;
  ctx.beginPath(); ctx.moveTo(-bw/2+2,bh/2-4); ctx.lineTo(bw/2-2,bh/2-4); ctx.stroke();
  ctx.shadowBlur=0;
}

// ── Main dispatch ─────────────────────────────────────────────────────────────
function drawCar(ctx, x, y, w, h, car, isPlayer, flip, jumpZ=0) {
  const shadowScale=Math.max(0.1,1-jumpZ/100);

  ctx.save(); ctx.translate(x+w/2, y+h/2);
  carShadow(ctx, w, h, jumpZ, shadowScale);
  ctx.restore();

  ctx.save();
  ctx.translate(x+w/2, y+h/2-jumpZ);
  if(flip) ctx.scale(1,-1);
  ctx.globalAlpha=1;

  const {primary:p, accent:a, glow:gr, type} = car;
  switch(type){
    case "muscle":  drawMuscle (ctx,w,h,p,a,gr,isPlayer); break;
    case "formula": drawFormula(ctx,w,h,p,a,gr,isPlayer); break;
    case "cyber":   drawCyber  (ctx,w,h,p,a,gr,isPlayer); break;
    default:        drawCoupe  (ctx,w,h,p,a,gr,isPlayer); break;
  }
  carJumpAura(ctx,w,h,jumpZ,gr);
  ctx.restore();
}

function drawParticles(ctx, particles) {
  particles.forEach(p=>{
    ctx.globalAlpha=p.life*0.9;
    ctx.fillStyle=p.color;
    ctx.shadowColor=p.color; ctx.shadowBlur=6;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r*p.life,0,Math.PI*2); ctx.fill();
  });
  ctx.globalAlpha=1; ctx.shadowBlur=0;
}

function drawCoin(ctx, x, y, r, pulse) {
  ctx.save(); ctx.translate(x,y);
  const sc=1+Math.sin(pulse)*0.1; ctx.scale(sc,sc);
  const g=ctx.createRadialGradient(0,0,1,0,0,r);
  g.addColorStop(0,"#fffde0"); g.addColorStop(0.5,"#f5c518"); g.addColorStop(1,"#a07800");
  ctx.fillStyle=g; ctx.shadowColor="#f5c518"; ctx.shadowBlur=12;
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;
  ctx.fillStyle="#6b4800"; ctx.font=`bold ${Math.floor(r*1.1)}px sans-serif`;
  ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("$",0,1);
  ctx.restore();
}

function drawSpeedLines(ctx, speed) {
  if(speed<5) return;
  const intensity=Math.min((speed-5)/10,1);
  ctx.strokeStyle=`rgba(0,180,255,${0.06*intensity})`; ctx.lineWidth=1;
  for(let i=0;i<8;i++){
    const x=rand(0,CANVAS_W);
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,rand(40,100)*intensity); ctx.stroke();
  }
}

function drawHUD(ctx, {score,level,lives,speed,combo,coins,multiplier=1}) {
  // Glassmorphism HUD panel
  ctx.save();
  ctx.fillStyle="rgba(5,10,30,0.55)";
  ctx.beginPath(); ctx.roundRect(8,8,160,100,12); ctx.fill();
  ctx.strokeStyle="rgba(0,200,255,0.2)"; ctx.lineWidth=1;
  ctx.beginPath(); ctx.roundRect(8,8,160,100,12); ctx.stroke();

  ctx.fillStyle="#fff"; ctx.font="bold 22px 'Courier New',monospace";
  ctx.fillText(score.toString().padStart(6,"0"),18,38);
  ctx.fillStyle="rgba(0,200,255,0.8)"; ctx.font="bold 11px 'Courier New',monospace";
  ctx.fillText(`LVL ${level}`,18,56);
  ctx.fillStyle="#fff"; ctx.fillText(`❤ ${lives}`,70,56);
  ctx.fillStyle="rgba(255,200,0,0.9)"; ctx.fillText(`🪙 ${coins}`,18,74);
  ctx.fillStyle="rgba(255,255,255,0.5)"; ctx.font="10px 'Courier New',monospace";
  ctx.fillText(`${Math.floor(speed*38)}km/h`,18,90);
  if(multiplier>1){
    ctx.fillStyle=multiplier>=2?"#ff4444":"#ff9900";
    ctx.font="bold 10px 'Courier New',monospace";
    ctx.fillText(`🔥${multiplier.toFixed(1)}x`,100,90);
  }
  ctx.restore();

  if(combo>1){
    ctx.save();
    ctx.fillStyle=`hsl(${(Date.now()/8)%360},100%,65%)`;
    ctx.font="bold 18px 'Courier New',monospace";
    ctx.textAlign="right";
    ctx.fillText(`x${combo} COMBO`,CANVAS_W-10,38);
    ctx.restore();
  }
}

// ─── Glassmorphism CSS-in-JS helpers ─────────────────────────────────────────
const glass = (extra={}) => ({
  background:"rgba(8,12,35,0.72)",
  backdropFilter:"blur(20px)",
  WebkitBackdropFilter:"blur(20px)",
  border:"1px solid rgba(0,200,255,0.18)",
  borderRadius:20,
  ...extra,
});

// ─── Leaderboard Modal ────────────────────────────────────────────────────────
function LeaderboardModal({ onClose, playerScore }) {
  const [entries,  setEntries]  = useState([]);
  const [name,     setName]     = useState(()=>localStorage.getItem("racer_name")||"");
  const [status,   setStatus]   = useState("idle");
  const [rank,     setRank]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [err,      setErr]      = useState("");
  const hasScore = typeof playerScore==="number" && playerScore>0;

  const load = async()=>{
    try{
      const d=await fetch(`${API}/leaderboard`).then(r=>r.json());
      setEntries(Array.isArray(d)?d:[]);
    }catch{ setEntries([]); }
    finally{ setLoading(false); }
  };
  useEffect(()=>{load();},[]);

  const submit=async()=>{
    if(!name.trim()||!hasScore) return;
    setStatus("submitting"); setErr("");
    localStorage.setItem("racer_name",name.trim());
    try{
      const r=await fetch(`${API}/leaderboard`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim(),score:Number(playerScore)})});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const d=await r.json(); setRank(d.rank); setStatus("done"); await load();
    }catch(e){ setErr(e.message); setStatus("error"); }
  };
  const medal=i=>["🥇","🥈","🥉"][i]||`${i+1}.`;
  const fmt=v=>Number(v).toString().padStart(6,"0");

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,10,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
      <div style={{...glass(),padding:"28px 32px",width:400,maxWidth:"94vw",maxHeight:"88vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div style={{fontSize:20,fontWeight:900,color:"#00cfff",fontFamily:"'Courier New',monospace"}}>🏆 LEADERBOARD</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#aaa",fontSize:18,cursor:"pointer"}}>✕</button>
        </div>
        {hasScore&&status!=="done"&&(
          <div style={{marginBottom:18,padding:14,background:"rgba(0,200,255,0.07)",borderRadius:12}}>
            <div style={{color:"rgba(255,255,255,0.5)",fontSize:11,marginBottom:6}}>YOUR SCORE: <span style={{color:"#00cfff",fontWeight:700,fontSize:16}}>{fmt(playerScore)}</span></div>
            <div style={{display:"flex",gap:8}}>
              <input value={name} onChange={e=>setName(e.target.value)} maxLength={16} placeholder="Your name..."
                style={{flex:1,padding:"8px 10px",background:"rgba(0,200,255,0.08)",border:"1px solid rgba(0,200,255,0.25)",borderRadius:8,color:"#fff",fontFamily:"'Courier New',monospace",fontSize:12,outline:"none"}}/>
              <button onClick={submit} disabled={!name.trim()||status==="submitting"}
                style={{padding:"8px 16px",background:"#00cfff",border:"none",borderRadius:8,color:"#000",fontWeight:700,cursor:"pointer",fontFamily:"'Courier New',monospace",fontSize:12,opacity:(!name.trim()||status==="submitting")?0.5:1}}>
                {status==="submitting"?"...":"SUBMIT"}
              </button>
            </div>
            {err&&<div style={{color:"#ff4444",fontSize:11,marginTop:6}}>{err}</div>}
          </div>
        )}
        {status==="done"&&rank&&<div style={{marginBottom:14,padding:10,background:"rgba(0,200,255,0.1)",borderRadius:10,color:"#00cfff",fontSize:13,textAlign:"center"}}>🎉 Ranked <strong>#{rank}</strong> globally!</div>}
        {loading?<div style={{color:"#444",textAlign:"center",padding:20}}>Loading...</div>:
         entries.length===0?<div style={{color:"#444",textAlign:"center",padding:20}}>No scores yet!</div>:(
          <div>
            <div style={{display:"grid",gridTemplateColumns:"36px 1fr 90px",padding:"4px 6px",color:"rgba(255,255,255,0.3)",fontSize:10,fontFamily:"'Courier New',monospace"}}>
              <span>#</span><span>NAME</span><span style={{textAlign:"right"}}>SCORE</span>
            </div>
            {entries.map((e,i)=>{
              const isMe=name.trim()&&e.name?.toLowerCase()===name.trim().toLowerCase();
              return(
                <div key={i} style={{display:"grid",gridTemplateColumns:"36px 1fr 90px",padding:"9px 6px",borderTop:"1px solid rgba(255,255,255,0.05)",background:isMe?"rgba(0,200,255,0.08)":"transparent",alignItems:"center",fontFamily:"'Courier New',monospace"}}>
                  <span style={{color:"#00cfff",fontWeight:700,fontSize:13}}>{medal(i)}</span>
                  <span style={{color:isMe?"#00cfff":"#ddd",fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:8}}>{e.name}</span>
                  <span style={{color:"#00cfff",fontWeight:700,fontSize:13,textAlign:"right"}}>{fmt(e.score)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Garage Modal ─────────────────────────────────────────────────────────────
function GarageModal({ coins, unlockedCars, selectedCar, onBuy, onSelect, onClose }) {
  const [preview, setPreview] = useState(null);
  const cvRef = useRef(null);

  useEffect(()=>{
    const cv=cvRef.current; if(!cv) return;
    const ctx=cv.getContext("2d");
    const car=preview||CARS.find(c=>c.id===selectedCar)||CARS[0];
    ctx.clearRect(0,0,cv.width,cv.height);
    // Subtle grid bg
    ctx.fillStyle="rgba(10,14,35,0.0)"; ctx.fillRect(0,0,cv.width,cv.height);
    ctx.strokeStyle="rgba(0,200,255,0.07)"; ctx.lineWidth=1;
    for(let gx=0;gx<cv.width;gx+=20){ ctx.beginPath(); ctx.moveTo(gx,0); ctx.lineTo(gx,cv.height); ctx.stroke(); }
    for(let gy=0;gy<cv.height;gy+=20){ ctx.beginPath(); ctx.moveTo(0,gy); ctx.lineTo(cv.width,gy); ctx.stroke(); }
    // Preview — use type-specific proportions
    const isFormula=car.type==="formula";
    const pw=isFormula?CAR_W*1.8:CAR_W*2.4, ph=CAR_H*2.4;
    const px=cv.width/2-pw/2, py=cv.height/2-ph/2-6;
    drawCar(ctx, px, py, pw, ph, car, true, false, 0);
    // Label
    ctx.fillStyle=car.accent; ctx.font="bold 11px 'Courier New',monospace";
    ctx.textAlign="center"; ctx.fillText(car.name, cv.width/2, cv.height-8);
  },[preview,selectedCar]);

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,10,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
      <div style={{...glass(),padding:"24px 28px",width:460,maxWidth:"96vw",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontSize:20,fontWeight:900,color:"#00cfff",fontFamily:"'Courier New',monospace"}}>🏎 GARAGE</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#aaa",fontSize:18,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{color:"rgba(255,200,0,0.8)",fontSize:13,marginBottom:16,fontFamily:"'Courier New',monospace"}}>🪙 {coins} coins</div>

        {/* Large car preview canvas */}
        <canvas ref={cvRef} width={220} height={180}
          style={{display:"block",margin:"0 auto 16px",borderRadius:16,
            background:"rgba(10,15,40,0.6)",border:"1px solid rgba(0,200,255,0.15)",
            boxShadow:"0 0 30px rgba(0,200,255,0.06)"}}/>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {CARS.map(car=>{
            const owned=unlockedCars.includes(car.id);
            const sel=selectedCar===car.id;
            const canBuy=!owned&&coins>=car.cost;
            const typeLabel={coupe:"Sports Coupe",muscle:"Muscle Car",formula:"Formula",cyber:"Cyber Concept"}[car.type]||car.type;
            return(
              <div key={car.id}
                onPointerEnter={()=>setPreview(car)} onPointerLeave={()=>setPreview(null)}
                style={{padding:12,borderRadius:14,cursor:"pointer",transition:"all 0.18s",
                  background:sel?`rgba(${car.glow},0.12)`:"rgba(255,255,255,0.04)",
                  border:sel?`1px solid rgba(${car.glow},0.55)`:"1px solid rgba(255,255,255,0.08)",
                  opacity:(!owned&&!canBuy)?0.4:1}}>
                {/* Colour swatch + type tag */}
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                  <div style={{width:28,height:6,borderRadius:3,
                    background:`linear-gradient(90deg,${car.primary},${car.accent})`,
                    boxShadow:`0 0 8px ${car.primary}`}}/>
                  <span style={{color:"rgba(255,255,255,0.3)",fontSize:9,fontFamily:"'Courier New',monospace"}}>{typeLabel}</span>
                </div>
                <div style={{color:sel?car.accent:"#fff",fontWeight:700,fontSize:12,fontFamily:"'Courier New',monospace",marginBottom:2}}>{car.name}</div>
                <div style={{color:"rgba(255,255,255,0.35)",fontSize:9,marginBottom:8,fontFamily:"'Courier New',monospace"}}>{car.desc}</div>
                <div style={{color:"rgba(255,255,255,0.4)",fontSize:10,marginBottom:8,fontFamily:"'Courier New',monospace"}}>⚡ +{car.speedBonus.toFixed(1)} speed</div>
                {owned?(
                  <button onClick={()=>onSelect(car.id)} style={{width:"100%",padding:"7px 0",borderRadius:8,border:"none",cursor:"pointer",
                    fontWeight:700,fontSize:10,fontFamily:"'Courier New',monospace",
                    background:sel?car.primary:"rgba(255,255,255,0.08)",color:sel?"#fff":"#888"}}>
                    {sel?"✓ SELECTED":"SELECT"}
                  </button>
                ):(
                  <button onClick={()=>onBuy(car.id)} disabled={!canBuy} style={{width:"100%",padding:"7px 0",borderRadius:8,border:"none",
                    cursor:canBuy?"pointer":"not-allowed",fontWeight:700,fontSize:10,fontFamily:"'Courier New',monospace",
                    background:canBuy?"rgba(255,200,0,0.85)":"rgba(255,255,255,0.05)",
                    color:canBuy?"#000":"#555"}}>
                    🪙 {car.cost===0?"FREE":`${car.cost}`}
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

// ─── Sound Settings Modal ─────────────────────────────────────────────────────
function SoundModal({ audio, onClose }) {
  const [mv, setMv] = useState(audio.getMusicVol());
  const [sv, setSv] = useState(audio.getSfxVol());
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,10,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
      <div style={{...glass(),padding:"28px 36px",width:320,maxWidth:"90vw"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
          <div style={{fontSize:18,fontWeight:900,color:"#00cfff",fontFamily:"'Courier New',monospace"}}>🔊 AUDIO</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#aaa",fontSize:18,cursor:"pointer"}}>✕</button>
        </div>
        {[["🎵 Music",mv,v=>{setMv(v);audio.setMusicVol(v);}],["⚡ SFX",sv,v=>{setSv(v);audio.setSfxVol(v);}]].map(([label,val,set])=>(
          <div key={label} style={{marginBottom:20}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <span style={{color:"#ddd",fontSize:13,fontFamily:"'Courier New',monospace"}}>{label}</span>
              <span style={{color:"#00cfff",fontSize:12,fontFamily:"'Courier New',monospace"}}>{Math.round(val*100)}%</span>
            </div>
            <input type="range" min={0} max={1} step={0.05} value={val}
              onChange={e=>set(parseFloat(e.target.value))}
              style={{width:"100%",accentColor:"#00cfff"}}/>
          </div>
        ))}
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
  const audioRef   = useRef(null);
  const retryCount = useRef(0);
  const reviveUsed = useRef(false);

  const [screen,       setScreen]   = useState(GS.START_MENU);
  const [finalScore,   setFinal]    = useState(0);
  const [highScore,    setHS]       = useState(()=>parseInt(localStorage.getItem("racer_hs")||"0"));
  const [totalCoins,   setCoins]    = useState(()=>parseInt(localStorage.getItem("racer_coins")||"0"));
  const [unlockedCars, setUnlocked] = useState(()=>JSON.parse(localStorage.getItem("racer_unlocked")||'["viper"]'));
  const [selectedCar,  setSelected] = useState(()=>localStorage.getItem("racer_car")||"viper");
  const [modal,        setModal]    = useState(null);
  const [isReviving,   setReviving] = useState(false);
  const [adState,      setAdState]  = useState("idle");
  const [quitWarn,     setQuitWarn] = useState(false); // pause → quit warning

  // Scale canvas to fill viewport on mobile
  const [scale, setScale] = useState(1);
  useEffect(()=>{
    const resize=()=>{
      const s=Math.min(window.innerWidth/CANVAS_W, window.innerHeight/CANVAS_H, 1.4);
      setScale(s);
    };
    resize(); window.addEventListener("resize",resize);
    return()=>window.removeEventListener("resize",resize);
  },[]);

  // Persist
  useEffect(()=>{ localStorage.setItem("racer_hs",highScore); },[highScore]);
  useEffect(()=>{ localStorage.setItem("racer_coins",totalCoins); },[totalCoins]);
  useEffect(()=>{ localStorage.setItem("racer_unlocked",JSON.stringify(unlockedCars)); },[unlockedCars]);
  useEffect(()=>{ localStorage.setItem("racer_car",selectedCar); },[selectedCar]);

  // Audio singleton
  useEffect(()=>{ audioRef.current=createAudio(); },[]);

  const carData = CARS.find(c=>c.id===selectedCar)||CARS[0];

  const initState = useCallback(()=>({
    player:{ x:ROAD_L+LANE_W+(LANE_W-CAR_W)/2, y:Y_DEFAULT, targetLane:1, vy:0, jumpZ:0, jumpVel:0, isJumping:false, jumpCooldown:0 },
    enemies:[],coins:[],particles:[],roadOffset:0,
    score:0,level:1,lives:3,
    speed:4+carData.speedBonus, baseSpeed:4+carData.speedBonus,
    speedMultiplier:1.0, elapsedMs:0,
    combo:1,comboTimer:0,spawnTimer:0,spawnInterval:90,
    coinSpawnTimer:0,coinPulse:0,sessionCoins:0,
    invincible:0,shake:0,running:true,
  }),[carData.speedBonus]);

  const startGame = useCallback((isRetry=false)=>{
    if(isRetry){
      retryCount.current++;
      reviveUsed.current=false;
      if(retryCount.current%3===0){
        showInterstitialAd(()=>{ stateRef.current=initState(); setReviving(false); setScreen(GS.PLAYING); audioRef.current?.startEngine(); audioRef.current?.startMusic(); });
        return;
      }
    }
    stateRef.current=initState();
    setReviving(false);
    setScreen(GS.PLAYING);
    audioRef.current?.startEngine();
    audioRef.current?.startMusic();
  },[initState]);

  const doRevive = useCallback(()=>{
    const s=stateRef.current; if(!s) return;
    Object.assign(s.player,{ x:ROAD_L+LANE_W+(LANE_W-CAR_W)/2, y:Y_DEFAULT, targetLane:1, vy:0, jumpZ:0, jumpVel:0, isJumping:false, jumpCooldown:0 });
    s.lives=1; s.enemies=[]; s.invincible=180; s.shake=0; s.running=true;
    reviveUsed.current=true;
    setReviving(false); setAdState("idle");
    audioRef.current?.startEngine();
  },[]);

  const handleRevive=useCallback(()=>{
    if(adState==="loading"||reviveUsed.current) return;
    setAdState("loading");
    showRewardedAd({ onComplete:()=>{ doRevive(); }, onSkip:()=>setAdState("skipped"), onError:()=>setAdState("error") });
  },[adState,doRevive]);

  const triggerGameOver=useCallback(()=>{
    const s=stateRef.current;
    const sc=s?.score??0;
    setFinal(sc);
    setHS(prev=>{ const n=Math.max(prev,sc); localStorage.setItem("racer_hs",n); return n; });
    setCoins(prev=>{ const n=prev+(s?.sessionCoins??0); localStorage.setItem("racer_coins",n); return n; });
    setReviving(false); setAdState("idle"); setScreen(GS.GAME_OVER);
    audioRef.current?.stopMusic();
  },[]);

  const togglePause=useCallback(()=>{
    const s=stateRef.current; if(!s) return;
    if(screen===GS.PLAYING){
      s.running=false;
      setScreen(GS.PAUSED);
      audioRef.current?.pauseEngine();
    } else if(screen===GS.PAUSED){
      s.running=true;
      setScreen(GS.PLAYING);
      audioRef.current?.resumeEngine(s.speed);
    }
  },[screen]);

  // Keyboard
  useEffect(()=>{
    const dn=e=>{
      keysRef.current[e.key]=true;
      if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," "].includes(e.key)) e.preventDefault();
      if(e.key==="Escape"||e.key==="p") togglePause();
    };
    const up=e=>{ keysRef.current[e.key]=false; };
    window.addEventListener("keydown",dn); window.addEventListener("keyup",up);
    return()=>{ window.removeEventListener("keydown",dn); window.removeEventListener("keyup",up); };
  },[togglePause]);

  // Global touch → tap left/right to steer (invisible)
  const handleTouch=useCallback((e)=>{
    if(screen!==GS.PLAYING) return;
    const target=e.target;
    if(target.tagName==="BUTTON"||target.closest?.("button")) return;
    e.preventDefault();
    const mid=window.innerWidth/2;
    Array.from(e.changedTouches).forEach(t=>{
      if(t.clientX<mid) keysRef.current["_tapL"]=true;
      else               keysRef.current["_tapR"]=true;
    });
  },[screen]);

  // ── Game loop ──────────────────────────────────────────────────────────────
  useEffect(()=>{
    if(screen!==GS.PLAYING) return;
    const canvas=canvasRef.current;
    const ctx=canvas.getContext("2d",{alpha:false});
    const snd=audioRef.current;
    let laneCd=0, jumpEdge=false, lastTime=0, acc=0;
    const STEP=1000/60;

    const spawnEnemy=s=>{
      const lane=randI(0,LANE_COUNT-1);
      s.enemies.push({ x:ROAD_L+lane*LANE_W+(LANE_W-CAR_W)/2, y:-CAR_H-20, lane,
        speed:rand(s.speed*0.4,s.speed*0.72),
        colors:ENEMY_POOL[randI(0,ENEMY_POOL.length-1)] });
    };
    const spawnCoin=s=>{ const lane=randI(0,LANE_COUNT-1); s.coins.push({x:ROAD_L+lane*LANE_W+LANE_W/2,y:-20,r:13}); };
    const burst=(x,y,color,n=12)=>{
      for(let i=0;i<n;i++){
        const a=rand(0,Math.PI*2),sp=rand(2,6);
        stateRef.current.particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1,color,r:rand(2,6)});
      }
    };

    const step=()=>{
      const s=stateRef.current; if(!s||!s.running) return;
      const k=keysRef.current, p=s.player;

      // Lane change — keyboard + invisible tap
      if(laneCd>0) laneCd--;
      if((k["ArrowLeft"]||k["_L"]||k["_tapL"])&&laneCd===0&&p.targetLane>0){ p.targetLane--;laneCd=18; }
      if((k["ArrowRight"]||k["_R"]||k["_tapR"])&&laneCd===0&&p.targetLane<LANE_COUNT-1){ p.targetLane++;laneCd=18; }
      k["_tapL"]=false; k["_tapR"]=false;
      p.x=lerp(p.x, ROAD_L+p.targetLane*LANE_W+(LANE_W-CAR_W)/2, 0.2);

      // Forward/back — keyboard only (no visual control)
      if(k["ArrowUp"]||k["_U"])         p.vy=lerp(p.vy,-4.5,0.25);
      else if(k["ArrowDown"]||k["_D"])  p.vy=lerp(p.vy, 4.5,0.25);
      else                               p.vy=lerp(p.vy,   0,0.22);
      p.y=clamp(p.y+p.vy,Y_MIN,Y_MAX);

      // Jump
      const jumpHeld=k[" "]||k["_J"];
      if(p.jumpCooldown>0) p.jumpCooldown--;
      if(jumpHeld&&!jumpEdge&&!p.isJumping&&p.jumpCooldown===0){
        p.jumpVel=JUMP_POWER; p.isJumping=true; jumpEdge=true;
        burst(p.x+CAR_W/2,p.y+CAR_H,"#00cfff",10); snd?.playJump();
      }
      if(!jumpHeld) jumpEdge=false;
      if(p.isJumping){
        p.jumpVel+=GRAVITY; p.jumpZ-=p.jumpVel;
        if(p.jumpZ<=0){ p.jumpZ=0;p.jumpVel=0;p.isJumping=false;p.jumpCooldown=JUMP_CD; burst(p.x+CAR_W/2,p.y+CAR_H,"rgba(0,200,255,0.8)",8); }
      }

      // Speed + difficulty
      s.roadOffset+=s.speed;
      s.score+=Math.floor(s.speed*0.5);
      s.level=Math.floor(s.score/1200)+1;
      s.speed=s.baseSpeed+s.level*0.65;
      snd?.setEngineRPM(s.speed);

      s.elapsedMs+=STEP;
      const sec=Math.floor(s.elapsedMs/1000);
      const em=1.0+Math.floor(sec/15)*0.1;
      if(em>s.speedMultiplier){ s.speedMultiplier=parseFloat(em.toFixed(1)); }

      s.spawnTimer++;
      s.spawnInterval=Math.max(22,Math.floor((90-s.level*5)/s.speedMultiplier));
      if(s.spawnTimer>=s.spawnInterval){ spawnEnemy(s);s.spawnTimer=0; }

      s.coinSpawnTimer++;
      if(s.coinSpawnTimer>=170){ spawnCoin(s);s.coinSpawnTimer=randI(0,40); }
      s.coinPulse+=0.12;

      // Move enemies
      for(let i=s.enemies.length-1;i>=0;i--){
        const e=s.enemies[i]; e.y+=s.speed-e.speed;
        if(e.y>CANVAS_H+CAR_H){ s.enemies.splice(i,1); s.combo=Math.min(s.combo+1,8);s.comboTimer=110;s.score+=s.combo*50; }
      }
      if(s.comboTimer>0) s.comboTimer--; else s.combo=1;

      // Coins
      for(let i=s.coins.length-1;i>=0;i--){
        const c=s.coins[i]; c.y+=s.speed*0.82;
        if(c.y>CANVAS_H+30){ s.coins.splice(i,1); continue; }
        const dx=p.x+CAR_W/2-c.x, dy=p.y+CAR_H/2-c.y;
        if(Math.sqrt(dx*dx+dy*dy)<c.r+CAR_W/2-6){
          s.coins.splice(i,1); s.sessionCoins++; s.score+=100;
          burst(c.x,c.y,"#f5c518",8); snd?.playCoin();
        }
      }

      // Collision
      if(s.invincible>0) s.invincible--;
      else if(p.jumpZ<18){
        for(let i=s.enemies.length-1;i>=0;i--){
          const e=s.enemies[i],mg=10;
          if(p.x<e.x+CAR_W-mg&&p.x+CAR_W>e.x+mg&&p.y<e.y+CAR_H-mg&&p.y+CAR_H>e.y+mg){
            s.enemies.splice(i,1);
            s.lives--;s.invincible=120;s.shake=16;s.combo=1;
            burst(p.x+CAR_W/2,p.y+CAR_H/2,carData.primary,18);
            burst(e.x+CAR_W/2,e.y+CAR_H/2,e.colors.primary,14);
            snd?.playCrash();
            if(s.lives<=0){
              s.running=false; snd?.stopEngine();
              setFinal(s.score); setReviving(true); triggerAdBreak();
              return;
            }
            break;
          }
        }
      }

      // Particles
      for(let i=s.particles.length-1;i>=0;i--){
        const pt=s.particles[i];
        pt.x+=pt.vx;pt.y+=pt.vy;pt.vy+=0.14;pt.life-=0.038;pt.vx*=0.94;
        if(pt.life<=0) s.particles.splice(i,1);
      }
      if(s.shake>0) s.shake--;
    };

    const draw=(s)=>{
      const p=s.player;
      ctx.save();
      if(s.shake>0) ctx.translate(rand(-s.shake*0.5,s.shake*0.5),rand(-s.shake*0.25,s.shake*0.25));
      drawRoad(ctx,s.roadOffset);
      drawSpeedLines(ctx,s.speed);
      s.coins.forEach(c=>drawCoin(ctx,c.x,c.y,c.r,s.coinPulse));
      s.enemies.forEach(e=>drawCar(ctx,e.x,e.y,CAR_W,CAR_H,e.colors,false,true,0));
      if(s.invincible===0||Math.floor(s.invincible/7)%2===0){
        drawCar(ctx,p.x,p.y,CAR_W,CAR_H,carData,true,false,p.jumpZ);
        if(s.speed>5&&p.jumpZ<4){
          ctx.fillStyle=`rgba(${carData.glow},${rand(0.1,0.25)})`;
          ctx.beginPath();ctx.ellipse(p.x+CAR_W*0.3,p.y+CAR_H+3,4,rand(4,10),0,0,Math.PI*2);ctx.fill();
          ctx.beginPath();ctx.ellipse(p.x+CAR_W*0.7,p.y+CAR_H+3,4,rand(4,10),0,0,Math.PI*2);ctx.fill();
        }
      }
      drawParticles(ctx,s.particles);
      drawHUD(ctx,{score:s.score,level:s.level,lives:s.lives,speed:s.speed,combo:s.combo,coins:totalCoins+s.sessionCoins,multiplier:s.speedMultiplier});
      ctx.restore();
    };

    const loop=(ts)=>{
      const s=stateRef.current; if(!s) return;
      if(!s.running){ animRef.current=requestAnimationFrame(loop); return; }
      const delta=Math.min(ts-(lastTime||ts),100);
      lastTime=ts; acc+=delta;
      while(acc>=STEP){ step(); acc-=STEP; }
      draw(s);
      animRef.current=requestAnimationFrame(loop);
    };
    animRef.current=requestAnimationFrame(loop);
    return()=>{ cancelAnimationFrame(animRef.current); snd?.stopEngine(); };
  },[screen,carData,totalCoins,triggerGameOver]);

  // Garage
  const buycar=id=>{ const car=CARS.find(c=>c.id===id); if(!car||totalCoins<car.cost) return;
    setCoins(p=>{ const n=p-car.cost; localStorage.setItem("racer_coins",n); return n; });
    const nl=[...unlockedCars,id]; setUnlocked(nl); localStorage.setItem("racer_unlocked",JSON.stringify(nl));
    setSelected(id); localStorage.setItem("racer_car",id);
  };
  const selectCar=id=>{ setSelected(id); localStorage.setItem("racer_car",id); };

  // ── Shared styles ─────────────────────────────────────────────────────────
  const bigBtn=(extra={})=>({ padding:"16px 0", width:"100%", fontSize:18, fontWeight:900,
    border:"none", borderRadius:50, cursor:"pointer", fontFamily:"'Courier New',monospace",
    letterSpacing:"0.08em", transition:"opacity 0.15s", ...extra });

  return (
    <div
      onTouchStart={handleTouch}
      style={{ minHeight:"100vh", background:"#030308",
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        fontFamily:"'Courier New',monospace", userSelect:"none", overflow:"hidden",
        touchAction:"none" }}>

      {/* ── Canvas + Pause Button (always rendered, hidden when not playing) ── */}
      <div style={{
        position:"relative",
        display: screen===GS.PLAYING||screen===GS.PAUSED ? "block" : "none",
        transform:`scale(${scale})`, transformOrigin:"top center",
      }}>
        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
          style={{ display:"block", borderRadius:0, touchAction:"none",
            boxShadow:"0 0 80px rgba(0,200,255,0.15), 0 0 200px rgba(0,100,255,0.08)" }}/>

        {/* Pause button — top right, minimal */}
        <button onClick={togglePause} style={{
          position:"absolute", top:12, right:12, width:36, height:36,
          background:"rgba(5,10,30,0.6)", border:"1px solid rgba(0,200,255,0.25)",
          borderRadius:"50%", color:"rgba(0,200,255,0.8)", fontSize:14, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center",
          backdropFilter:"blur(8px)", zIndex:10,
        }}>⏸</button>

        {/* ── Revive overlay (shown on canvas) ── */}
        {isReviving && screen===GS.PLAYING && (
          <div style={{ position:"absolute",inset:0,display:"flex",flexDirection:"column",
            alignItems:"center",justifyContent:"center",gap:14,
            background:"rgba(2,4,20,0.82)",backdropFilter:"blur(4px)" }}>
            <div style={{fontSize:52,lineHeight:1}}>💀</div>
            <div style={{fontSize:28,fontWeight:900,color:"#ff3366",letterSpacing:"0.08em",textShadow:"0 0 20px #ff3366"}}>YOU DIED</div>
            <div style={{color:"rgba(255,200,0,0.9)",fontSize:14}}>SCORE: <strong>{finalScore.toString().padStart(6,"0")}</strong></div>
            {adState==="idle"&&!reviveUsed.current&&(
              <button onClick={handleRevive} style={{padding:"14px 40px",fontSize:17,fontWeight:900,
                background:"linear-gradient(135deg,#00c853,#00691a)",color:"#fff",border:"none",
                borderRadius:40,cursor:"pointer",boxShadow:"0 0 24px rgba(0,200,83,0.5)"}}>
                📺 WATCH AD → REVIVE
              </button>
            )}
            {adState==="loading"&&<div style={{color:"#00c853",fontSize:14}}>⏳ Loading ad...</div>}
            {(adState==="skipped"||adState==="error")&&(
              <div style={{textAlign:"center"}}>
                <div style={{color:"#ff6600",fontSize:12,marginBottom:8}}>{adState==="skipped"?"Ad skipped":"No ad available"}</div>
                <button onClick={()=>setAdState("idle")} style={{padding:"10px 28px",fontSize:13,fontWeight:700,background:"rgba(255,255,255,0.08)",color:"#aaa",border:"1px solid #333",borderRadius:20,cursor:"pointer"}}>Retry</button>
              </div>
            )}
            <div style={{color:"rgba(255,255,255,0.25)",fontSize:10}}>ad watched = revive granted</div>
            <button onClick={triggerGameOver} style={{padding:"8px 24px",fontSize:12,background:"transparent",color:"rgba(255,255,255,0.25)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:16,cursor:"pointer"}}>End Run</button>
          </div>
        )}

        {/* ── Pause overlay ── */}
        {screen===GS.PAUSED && (
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",
            alignItems:"center",justifyContent:"center",gap:16,
            background:"rgba(2,4,20,0.88)",backdropFilter:"blur(8px)"}}>
            <div style={{fontSize:28,fontWeight:900,color:"#00cfff",letterSpacing:"0.1em",textShadow:"0 0 20px #00cfff"}}>PAUSED</div>
            {[
              ["▶ RESUME",  ()=>togglePause(), "#00cfff","#000"],
              ["🔊 AUDIO",  ()=>setModal("sound"), "rgba(255,255,255,0.12)","#fff"],
              ["⚠ QUIT",   ()=>setQuitWarn(true), "rgba(255,50,50,0.15)","#ff6666"],
            ].map(([label,fn,bg,color])=>(
              <button key={label} onClick={fn} style={{width:200,padding:"13px 0",fontSize:15,fontWeight:700,
                background:bg,color,border:`1px solid ${color==="000"?"#00cfff":"rgba(255,255,255,0.1)"}`,
                borderRadius:40,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>
                {label}
              </button>
            ))}
            {/* Quit warning */}
            {quitWarn&&(
              <div style={{...glass({borderRadius:16}),padding:"20px 28px",textAlign:"center",position:"absolute"}}>
                <div style={{color:"#fff",fontSize:14,marginBottom:16}}>Quit to main menu?<br/><span style={{color:"rgba(255,255,255,0.4)",fontSize:11}}>Your current run will end.</span></div>
                <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                  <button onClick={()=>{setQuitWarn(false);togglePause();audioRef.current?.stopMusic();audioRef.current?.stopEngine();setScreen(GS.START_MENU);}} style={{padding:"10px 24px",fontSize:13,fontWeight:700,background:"rgba(255,50,50,0.2)",color:"#ff6666",border:"1px solid rgba(255,50,50,0.3)",borderRadius:20,cursor:"pointer"}}>QUIT</button>
                  <button onClick={()=>setQuitWarn(false)} style={{padding:"10px 24px",fontSize:13,fontWeight:700,background:"rgba(0,200,255,0.15)",color:"#00cfff",border:"1px solid rgba(0,200,255,0.3)",borderRadius:20,cursor:"pointer"}}>CANCEL</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══════════════════ START MENU ══════════════════ */}
      {screen===GS.START_MENU&&(
        <div style={{position:"fixed",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
          background:"radial-gradient(ellipse at 50% 40%,#060c28 0%,#020308 70%)"}}>
          {/* Ambient glow orbs */}
          <div style={{position:"absolute",width:400,height:400,borderRadius:"50%",background:"radial-gradient(circle,rgba(0,100,255,0.08),transparent 70%)",top:"10%",left:"50%",transform:"translateX(-50%)",pointerEvents:"none"}}/>
          <div style={{position:"absolute",width:300,height:300,borderRadius:"50%",background:"radial-gradient(circle,rgba(0,200,255,0.06),transparent 70%)",bottom:"5%",right:"10%",pointerEvents:"none"}}/>

          <div style={{fontSize:"clamp(38px,9vw,64px)",fontWeight:900,letterSpacing:"0.08em",lineHeight:1.1,
            textAlign:"center",marginBottom:6,
            background:"linear-gradient(135deg,#00cfff 0%,#ffffff 50%,#00cfff 100%)",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
            textShadow:"none",filter:"drop-shadow(0 0 30px rgba(0,200,255,0.4))"}}>
            INFINITE<br/>RACER
          </div>
          <div style={{color:"rgba(0,200,255,0.5)",fontSize:11,letterSpacing:"0.3em",marginBottom:36}}>ENDLESS · FAST · FUTURISTIC</div>

          {/* High score */}
          <div style={{...glass({padding:"12px 28px",borderRadius:12,marginBottom:32,minWidth:200,textAlign:"center"})}}>
            <div style={{color:"rgba(0,200,255,0.5)",fontSize:10,letterSpacing:"0.2em",marginBottom:4}}>HIGH SCORE</div>
            <div style={{color:"#fff",fontSize:30,fontWeight:900,letterSpacing:"0.05em"}}>{highScore.toString().padStart(6,"0")}</div>
          </div>

          {/* PLAY */}
          <button onClick={()=>startGame(false)} style={{
            padding:"18px 72px",fontSize:22,fontWeight:900,
            background:"linear-gradient(135deg,rgba(0,200,255,0.15),rgba(0,100,200,0.25))",
            color:"#00cfff",border:"2px solid rgba(0,200,255,0.5)",borderRadius:60,cursor:"pointer",
            fontFamily:"'Courier New',monospace",letterSpacing:"0.12em",marginBottom:20,
            boxShadow:"0 0 30px rgba(0,200,255,0.2), inset 0 0 20px rgba(0,200,255,0.05)",
            backdropFilter:"blur(10px)",
          }}>▶ PLAY</button>

          <div style={{display:"flex",gap:10,marginBottom:16}}>
            {[
              ["🏎 GARAGE",()=>setModal("garage")],
              ["🏆 SCORES",()=>setModal("leaderboard")],
              ["🔊 AUDIO", ()=>setModal("sound")],
            ].map(([l,fn])=>(
              <button key={l} onClick={fn} style={{
                padding:"10px 16px",fontSize:12,fontWeight:700,
                background:"rgba(0,200,255,0.07)",color:"rgba(0,200,255,0.7)",
                border:"1px solid rgba(0,200,255,0.2)",borderRadius:24,cursor:"pointer",
                fontFamily:"'Courier New',monospace",backdropFilter:"blur(8px)"}}>
                {l}
              </button>
            ))}
          </div>

          <div style={{color:"rgba(255,255,255,0.2)",fontSize:10,letterSpacing:"0.1em",textAlign:"center"}}>
            TAP LEFT / RIGHT TO STEER · JUMP ANYWHERE · ← → ↑ ↓ SPACE ON KEYBOARD
          </div>
          <div style={{color:"rgba(255,255,255,0.12)",fontSize:10,marginTop:4}}>🪙 {totalCoins} coins</div>
        </div>
      )}

      {/* ══════════════════ GAME OVER ══════════════════ */}
      {screen===GS.GAME_OVER&&(
        <div style={{position:"fixed",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
          background:"radial-gradient(ellipse at 50% 40%,#120008 0%,#020308 70%)"}}>
          <div style={{fontSize:"clamp(30px,8vw,52px)",fontWeight:900,color:"#ff3366",letterSpacing:"0.06em",
            textShadow:"0 0 40px rgba(255,50,100,0.6)",marginBottom:8}}>GAME OVER</div>

          <div style={{color:"rgba(255,255,255,0.4)",fontSize:11,letterSpacing:"0.2em",marginBottom:4}}>FINAL SCORE</div>
          <div style={{fontSize:"clamp(36px,9vw,60px)",fontWeight:900,color:"#fff",
            textShadow:"0 0 20px rgba(0,200,255,0.5)",marginBottom:8}}>
            {finalScore.toString().padStart(6,"0")}
          </div>

          {finalScore>=highScore&&finalScore>0&&(
            <div style={{color:"#00cfff",fontSize:12,letterSpacing:"0.15em",marginBottom:6,
              textShadow:"0 0 10px rgba(0,200,255,0.8)"}}>✦ NEW HIGH SCORE ✦</div>
          )}
          <div style={{color:"rgba(255,255,255,0.25)",fontSize:11,marginBottom:32}}>
            BEST {highScore.toString().padStart(6,"0")} · 🪙 {totalCoins}
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:12,width:280}}>
            <button onClick={()=>startGame(true)} style={{...bigBtn({
              background:"linear-gradient(135deg,rgba(0,200,255,0.15),rgba(0,100,200,0.25))",
              color:"#00cfff",border:"2px solid rgba(0,200,255,0.45)",
              boxShadow:"0 0 20px rgba(0,200,255,0.15)",backdropFilter:"blur(8px)"})}}>
              ▶ RETRY
            </button>
            {!reviveUsed.current&&(
              <button onClick={()=>{stateRef.current&&(stateRef.current.running=false);setReviving(true);setScreen(GS.PLAYING);}} style={{...bigBtn({
                background:"rgba(0,200,83,0.1)",color:"#00c853",
                border:"1px solid rgba(0,200,83,0.3)",backdropFilter:"blur(8px)"})}}>
                📺 WATCH AD & REVIVE
              </button>
            )}
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setModal("leaderboard")} style={{flex:1,padding:"12px 0",fontSize:13,fontWeight:700,
                background:"rgba(0,200,255,0.07)",color:"rgba(0,200,255,0.6)",border:"1px solid rgba(0,200,255,0.15)",
                borderRadius:40,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>🏆</button>
              <button onClick={()=>{audioRef.current?.stopMusic();setScreen(GS.START_MENU);}} style={{flex:1,padding:"12px 0",fontSize:13,fontWeight:700,
                background:"rgba(255,255,255,0.04)",color:"rgba(255,255,255,0.3)",border:"1px solid rgba(255,255,255,0.08)",
                borderRadius:40,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>MENU</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {modal==="leaderboard"&&<LeaderboardModal playerScore={screen===GS.GAME_OVER?finalScore:null} onClose={()=>setModal(null)}/>}
      {modal==="garage"&&<GarageModal coins={totalCoins} unlockedCars={unlockedCars} selectedCar={selectedCar} onBuy={buycar} onSelect={selectCar} onClose={()=>setModal(null)}/>}
      {modal==="sound"&&audioRef.current&&<SoundModal audio={audioRef.current} onClose={()=>setModal(null)}/>}
    </div>
  );
}
