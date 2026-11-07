const fs = require('fs');
const path = require('path');

const SR = 48000;
const OUT = path.join(__dirname, '..', 'assets', 'sounds');
const TAU = Math.PI * 2;

let seed = 1234567;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const buf = sec => [new Float32Array(Math.ceil(sec * SR)), new Float32Array(Math.ceil(sec * SR))];
const note = n => 440 * Math.pow(2, (n - 69) / 12);
const env = (t, a, d) => (t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d));

function bell(L, R, start, freq, dur, gain, pan = 0, decay = 0.35, partials = [[1, 1], [2.01, 0.35], [3.02, 0.18], [4.95, 0.08]]) {
  const s0 = Math.floor(start * SR), n = Math.floor(dur * SR);
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n && s0 + i < L.length; i++) {
    const t = i / SR;
    let v = 0;
    for (const [m, a] of partials) v += a * Math.sin(TAU * freq * m * t) * env(t, 0.002, decay / Math.sqrt(m));
    L[s0 + i] += v * gl; R[s0 + i] += v * gr;
  }
}
function square(L, R, start, freq, dur, gain) {
  const s0 = Math.floor(start * SR), n = Math.floor(dur * SR);
  for (let i = 0; i < n && s0 + i < L.length; i++) {
    const t = i / SR;
    let v = 0;
    for (let h = 1; h * freq < 12000; h += 2) v += Math.sin(TAU * freq * h * t) / h;
    const e = Math.min(1, t / 0.003) * (t > dur - 0.02 ? Math.max(0, (dur - t) / 0.02) : 1);
    L[s0 + i] += v * gain * e * 0.8; R[s0 + i] += v * gain * e * 0.8;
  }
}
function noise(L, R, start, dur, gain, { a = 0.001, d = 0.02, lp = 0.5, hp = 0.02, sweep = 0 } = {}) {
  const s0 = Math.floor(start * SR), n = Math.floor(dur * SR);
  let low = 0, high = 0, prev = 0;
  for (let i = 0; i < n && s0 + i < L.length; i++) {
    const t = i / SR, x = rnd();
    const k = Math.min(0.99, lp + sweep * (t / dur));
    low += k * (x - low);
    high = (1 - hp) * (high + low - prev); prev = low;
    const v = high * gain * env(t, a, d);
    L[s0 + i] += v * (1 + 0.15 * rnd()); R[s0 + i] += v * (1 + 0.15 * rnd());
  }
}
function fm(L, R, start, freq, ratio, index, dur, gain, pan = 0, decay = 0.5) {
  const s0 = Math.floor(start * SR), n = Math.floor(dur * SR);
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n && s0 + i < L.length; i++) {
    const t = i / SR, e = env(t, 0.001, decay);
    const v = Math.sin(TAU * freq * t + index * e * Math.sin(TAU * freq * ratio * t)) * e;
    L[s0 + i] += v * gl; R[s0 + i] += v * gr;
  }
}
function reverb([L, R], wet = 0.25, size = 1) {
  const combs = [1557, 1617, 1491, 1422].map(n => Math.round(n * size));
  const out = [new Float32Array(L.length), new Float32Array(L.length)];
  [L, R].forEach((ch, c) => {
    const o = out[c];
    for (const [j, len0] of combs.entries()) {
      const len = len0 + c * 23 + j * 7, line = new Float32Array(len);
      let idx = 0, damp = 0;
      for (let i = 0; i < ch.length; i++) {
        const y = line[idx];
        damp = y * 0.6 + damp * 0.4;
        line[idx] = ch[i] + damp * 0.78;
        o[i] += y / combs.length;
        idx = (idx + 1) % len;
      }
    }
    for (const len of [225, 556]) {
      const line = new Float32Array(len + c * 11); let idx = 0;
      for (let i = 0; i < o.length; i++) { const b = line[idx], x = o[i]; const y = -x + b; line[idx] = x + b * 0.5; o[i] = y; idx = (idx + 1) % line.length; }
    }
  });
  for (let i = 0; i < L.length; i++) { L[i] = L[i] * (1 - wet * 0.5) + out[0][i] * wet; R[i] = R[i] * (1 - wet * 0.5) + out[1][i] * wet; }
  return [L, R];
}
function fadeOut([L, R], sec) {
  const n = Math.floor(sec * SR);
  for (let i = 0; i < n; i++) { const k = i / n; L[L.length - 1 - i] *= k; R[R.length - 1 - i] *= k; }
}
function write(name, [L, R], peakDb = -1.5) {
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = peak ? Math.pow(10, peakDb / 20) / peak : 1;
  const data = Buffer.alloc(L.length * 4);
  for (let i = 0; i < L.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path.join(OUT, `${name}.wav`), Buffer.concat([h, data]));
  console.log(`assets/sounds/${name}.wav  ${(L.length / SR).toFixed(2)} s`);
}

fs.mkdirSync(OUT, { recursive: true });

{
  const b = buf(1.1); const [L, R] = b;
  [84, 88, 91, 96].forEach((n, i) => bell(L, R, i * 0.055, note(n), 0.9, 0.5 - i * 0.04, -0.6 + i * 0.4, 0.28));
  for (let i = 0; i < 6; i++) bell(L, R, 0.2 + i * 0.035, note(103 + (i % 3) * 2), 0.25, 0.08, i % 2 ? 0.7 : -0.7, 0.06, [[1, 1]]);
  reverb(b, 0.3, 0.8); fadeOut(b, 0.15); write('sparkle', b);
}
{
  const b = buf(0.42); const [L, R] = b;
  noise(L, R, 0.0, 0.05, 1.0, { a: 0.0005, d: 0.006, lp: 0.9, hp: 0.15 });
  bell(L, R, 0.0, 180, 0.08, 0.6, 0, 0.02, [[1, 1], [2.3, 0.3]]);
  noise(L, R, 0.075, 0.06, 0.8, { a: 0.0005, d: 0.009, lp: 0.7, hp: 0.1 });
  bell(L, R, 0.075, 140, 0.1, 0.5, 0, 0.025, [[1, 1], [2.7, 0.25]]);
  bell(L, R, 0.11, note(88), 0.3, 0.12, 0, 0.08, [[1, 1], [2, 0.2]]);
  reverb(b, 0.12, 0.5); fadeOut(b, 0.05); write('shutter', b);
}
{
  const b = buf(0.5); const [L, R] = b;
  square(L, R, 0.0, note(83), 0.07, 0.5);
  square(L, R, 0.07, note(88), 0.36, 0.5);
  for (let i = Math.floor(0.07 * SR); i < L.length; i++) { const k = Math.exp(-(i / SR - 0.07) / 0.14); L[i] *= k; R[i] *= k; }
  reverb(b, 0.12, 0.6); fadeOut(b, 0.04); write('coin', b);
}
{
  const b = buf(1.2); const [L, R] = b;
  noise(L, R, 0.0, 0.32, 0.55, { a: 0.22, d: 0.05, lp: 0.03, hp: 0.01, sweep: 0.5 });
  bell(L, R, 0.24, note(86), 0.95, 0.55, -0.15, 0.4, [[1, 1], [2.76, 0.22], [5.4, 0.06]]);
  bell(L, R, 0.245, note(93), 0.8, 0.22, 0.25, 0.32, [[1, 1], [2.76, 0.15]]);
  reverb(b, 0.32, 1.0); fadeOut(b, 0.2); write('whoosh', b);
}
{
  const b = buf(1.0); const [L, R] = b;
  fm(L, R, 0.0, note(93), 3.5, 2.4, 0.95, 0.55, 0, 0.32);
  fm(L, R, 0.012, note(100), 2.41, 1.2, 0.6, 0.18, 0.5, 0.18);
  [0.05, 0.09, 0.14, 0.2].forEach((t, i) => fm(L, R, t, note(105 + i), 1.5, 0.6, 0.15, 0.08, i % 2 ? -0.8 : 0.8, 0.04));
  reverb(b, 0.35, 0.7); fadeOut(b, 0.15); write('glint', b);
}
{
  const b = buf(0.36); const [L, R] = b;
  bell(L, R, 0.0, note(64), 0.16, 0.45, 0, 0.05, [[1, 1], [2, 0.12]]);
  bell(L, R, 0.11, note(59), 0.22, 0.45, 0, 0.07, [[1, 1], [2, 0.1]]);
  for (let i = 0; i < L.length; i++) { L[i] = Math.tanh(L[i] * 1.2) * 0.9; R[i] = Math.tanh(R[i] * 1.2) * 0.9; }
  reverb(b, 0.1, 0.4); fadeOut(b, 0.05); write('nope', b, -6);
}
