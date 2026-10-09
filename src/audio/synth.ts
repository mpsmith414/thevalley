/** Sample generators for the soundscape's synthesised stand-ins (pure: they fill arrays from a seeded random source). */

/**
 * Make `x` (length `n + fade`) loop seamlessly as its first `n` samples: the last `fade` samples are crossfaded (equal power)
 * over the first `fade`, so the loop's end runs straight on into its start.
 */
export function seamless(x: Float32Array, n: number): Float32Array {
  const fade = x.length - n, out = x.slice(0, n);
  for (let i = 0; i < fade; i++) {
    const t = (i + 0.5) / fade;
    out[i] = x[i] * Math.sin((t * Math.PI) / 2) + x[n + i] * Math.cos((t * Math.PI) / 2);
  }
  return out;
}

/** White noise in [-1, 1). */
export function whiteNoise(len: number, rng: () => number): Float32Array {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** Pink noise (Paul Kellet's refined filter), about the same loudness as the white noise it comes from. */
export function pinkNoise(len: number, rng: () => number): Float32Array {
  const out = new Float32Array(len);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}

/** Brown (red) noise: leaky integrated white noise, scaled to about the loudness of white noise. */
export function brownNoise(len: number, rng: () => number): Float32Array {
  const out = new Float32Array(len);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (rng() * 2 - 1)) / 1.02;
    out[i] = last * 3.5;
  }
  return out;
}

/**
 * A chorus of `count` crickets, `len` samples long and seamless as a loop: each sings ~4.5 kHz sine pulses at 15 Hz in groups
 * of 3–6, resting 0.25–0.8 s between groups (pulses past the end wrap round to the start).
 */
export function crickets(len: number, rate: number, rng: () => number, count = 3): Float32Array {
  const out = new Float32Array(len), pulse = Math.round(0.03 * rate), period = rate / 15;
  for (let c = 0; c < count; c++) {
    const f = 4500 + (rng() - 0.5) * 300, amp = 0.18 + 0.12 * rng(), w = (2 * Math.PI * f) / rate;
    let t = rng() * rate; // this cricket's first group
    while (t < len) {
      const pulses = 3 + Math.floor(rng() * 4);
      for (let p = 0; p < pulses; p++) {
        const s0 = Math.round(t + p * period);
        for (let i = 0; i < pulse; i++) {
          const env = Math.sin((Math.PI * i) / pulse) ** 2;
          out[(s0 + i) % len] += amp * env * Math.sin(w * (s0 + i));
        }
      }
      t += pulses * period + (0.25 + 0.55 * rng()) * rate;
    }
  }
  return out;
}
