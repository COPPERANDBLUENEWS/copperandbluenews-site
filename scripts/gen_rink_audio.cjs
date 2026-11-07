// Original synthesized rink sounds. Not a team, arena, or other recording.
// Run: node scripts/gen_rink_audio.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const RATE = 22050;

function wav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((s < 0 ? s * 32768 : s * 32767) | 0, 44 + i * 2);
  }
  return buf;
}
function wave(type, phase) {
  const p = ((phase % 1) + 1) % 1;
  if (type === 'sine') return Math.sin(2 * Math.PI * p);
  if (type === 'square') return p < 0.5 ? 1 : -1;
  if (type === 'sawtooth') return 2 * p - 1;
  return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
}
function normalize(samples, peak) {
  let m = 0;
  for (let i = 0; i < samples.length; i++) m = Math.max(m, Math.abs(samples[i]));
  const g = m > 1e-8 ? peak / m : 0;
  const fade = Math.max(2, Math.floor(RATE * 0.0015));
  for (let i = 0; i < samples.length; i++) {
    let e = 1;
    if (i < fade) e = i / fade;
    if (i > samples.length - fade) e = Math.min(e, (samples.length - i) / fade);
    samples[i] *= g * e;
  }
  return samples;
}
function brightness(samples) {
  let hp = 0, prev = 0, hi = 0, all = 0;
  const a = Math.exp(-2 * Math.PI * 1500 / RATE);
  for (let i = 0; i < samples.length; i++) {
    hp = a * (hp + samples[i] - prev);
    prev = samples[i];
    hi += hp * hp;
    all += samples[i] * samples[i];
  }
  return hi / (all || 1);
}
function horn() {
  const dur = 2.8, n = Math.floor(RATE * dur);
  const dry = new Float32Array(n);
  const layers = [[104, 'sawtooth', .2], [105.6, 'sawtooth', .16], [130, 'sine', .14], [156, 'square', .09], [157.4, 'square', .07], [196, 'triangle', .05]];
  const phase = layers.map(() => Math.random() * 0.2);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let x = 0;
    for (let k = 0; k < layers.length; k++) {
      const [hz, type, vol] = layers[k];
      phase[k] += hz / RATE;
      x += wave(type, phase[k]) * vol;
    }
    const cut = t < 0.26 ? 260 * Math.pow(740 / 260, t / 0.26) : 740 * Math.pow(340 / 740, Math.min(1, (t - 0.26) / (dur - 0.26)));
    const a = 1 - Math.exp(-2 * Math.PI * cut / RATE);
    lp += a * (x - lp);
    const shaped = Math.tanh(2.1 * lp) / Math.tanh(2.1);
    let env;
    if (t < 0.22) env = 0.0001 + (0.9 - 0.0001) * (t / 0.22);
    else if (t < 1.7) env = 0.9 + (0.8 - 0.9) * ((t - 0.22) / 1.48);
    else env = 0.8 * Math.pow(1 - Math.min(1, (t - 1.7) / 1.1), 1.6);
    dry[i] = shaped * env;
  }
  const delayN = Math.floor(RATE * 0.09);
  const out = new Float32Array(n);
  const line = new Float32Array(delayN);
  let w = 0;
  for (let i = 0; i < n; i++) {
    const echo = line[w];
    out[i] = dry[i] + echo * 0.22;
    line[w] = dry[i] + echo * 0.24;
    w = (w + 1) % delayN;
  }
  return normalize(out, 0.82);
}
function aww() {
  const dur = 0.5, n = Math.floor(RATE * dur);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = 180 * Math.pow(96 / 180, Math.min(1, t / 0.42));
    phase += f / RATE;
    const env = Math.min(1, t / 0.03) * Math.exp(-Math.max(0, t - 0.04) * 6.5);
    out[i] = wave('triangle', phase) * env;
  }
  return normalize(out, 0.48);
}
function noiseBurst(dur, toneHz, decay, cutoff, clickHz, toneMix) {
  const n = Math.floor(RATE * dur);
  const out = new Float32Array(n);
  let seed = 0x9e3779b9, lp = 0, phase = 0, click = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const white = seed / 4294967296 * 2 - 1;
    const a = 1 - Math.exp(-2 * Math.PI * cutoff / RATE);
    lp += a * (white - lp);
    phase += toneHz / RATE;
    click += clickHz / RATE;
    const env = Math.exp(-t * decay);
    const snap = Math.sin(2 * Math.PI * click) * Math.exp(-t * decay * 2.4);
    out[i] = (lp * (1 - toneMix) + wave('sine', phase) * toneMix + snap * 0.85) * env;
  }
  return out;
}
const outDir = path.join(__dirname, '..', 'audio');
fs.mkdirSync(outDir, {recursive: true});
const files = {
  'goal-horn.wav': horn(),
  'copper-aww.wav': aww(),
  'puck-clack.wav': normalize(noiseBurst(0.07, 980, 48, 3200, 2400, 0.35), 0.9),
  'board-thud.wav': normalize(noiseBurst(0.13, 120, 16, 320, 180, 0.72), 0.9)
};
for (const [name, samples] of Object.entries(files)) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, wav(samples));
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  console.log(`${name} ${(samples.length / RATE).toFixed(3)}s peak ${peak.toFixed(2)} bright ${brightness(samples).toFixed(3)} bytes ${fs.statSync(file).size}`);
}
if (!(brightness(files['puck-clack.wav']) > brightness(files['board-thud.wav']) * 1.5)) {
  console.error('clack should be clearly brighter than the thud');
  process.exitCode = 1;
}
