// Particles effect
// Glowing particles with depth, like floating dust or bokeh:
//   - far particles are tiny, sharp, glowing points
//   - near particles are bigger, softer, dimmer discs (more so with Blur)
//   - near particles move faster than far ones (parallax)
//   - particles add up like light where they overlap, and twinkle a little
// They drift in one direction and wrap around the edges, so the motion
// never stops. Each layer keeps its own particle list (see sketch.js).
//
// Settings (from the Particles controls):
//   ptSize       particle size
//   ptSpeed      how fast they travel
//   ptDirection  travel direction in degrees (0 = right, 90 = down)
//   ptCount      number of particles
//   ptBlur       depth of field: how soft / out of focus near particles get
//   ptHue        particle color: 0 = white, then through the rainbow

const Particles = (() => {

  // ---------- particles ----------

  function makeParticle(width, height) {

    // Depth: 0 = far away, 1 = close to the camera.
    // Most particles are far (small); a few are close (big).
    const z = Math.pow(Math.random(), 2.2);

    return {
      x: Math.random() * width,
      y: Math.random() * height,
      z,
      sizeScale: 0.7 + Math.random() * 0.6,
      speedScale: 0.7 + Math.random() * 0.6,
      angleOffset: (Math.random() - 0.5) * 0.35,   // small spread in direction
      twinkleRate: 0.6 + Math.random() * 2.2,
      twinklePhase: Math.random() * Math.PI * 2,
      alpha: 0.6 + Math.random() * 0.4
    };
  }

  function create() {
    return { list: [], time: 0, canvas: null, ctx: null };
  }

  // Move every particle forward by dt seconds
  function update(state, settings, dt, width, height) {

    const count = Math.max(0, Math.round(Number(settings.ptCount)));

    // Add or remove particles to match Count
    while (state.list.length < count) state.list.push(makeParticle(width, height));
    if (state.list.length > count) state.list.length = count;

    state.time += dt;

    const speed = Number(settings.ptSpeed) * 40;        // pixels per second
    const baseAngle = Number(settings.ptDirection) * Math.PI / 180;
    const margin = 200;                                 // big bokeh discs need room

    for (const p of state.list) {

      const angle = baseAngle + p.angleOffset;

      // Parallax: near particles move faster
      const v = speed * p.speedScale * (0.35 + 1.3 * p.z);

      p.x += Math.cos(angle) * v * dt;
      p.y += Math.sin(angle) * v * dt;

      // Wrap around the edges
      if (p.x < -margin) p.x += width + margin * 2;
      if (p.x > width + margin) p.x -= width + margin * 2;
      if (p.y < -margin) p.y += height + margin * 2;
      if (p.y > height + margin) p.y -= height + margin * 2;
    }
  }


  // ---------- sprites ----------
  // One small image per color + blur level, drawn once and reused.
  //   blur 0 -> glowing point: bright (slightly white) core + soft halo
  //   blur 1 -> bokeh disc: flat soft circle with a gentle edge

  const SPRITE = 128;
  const LEVELS = 12;            // blur is rounded to this many steps
  const sprites = new Map();

  function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  function getSprite(color, level) {

    const key = color + "|" + level;
    if (sprites.has(key)) return sprites.get(key);

    const b = level / (LEVELS - 1);
    const n = parseInt(color.slice(1), 16);
    const cr = (n >> 16) & 255, cg = (n >> 8) & 255, cb = n & 255;

    const c = document.createElement("canvas");
    c.width = c.height = SPRITE;
    const g = c.getContext("2d");
    const img = g.createImageData(SPRITE, SPRITE);
    const half = SPRITE / 2;

    for (let y = 0; y < SPRITE; y++) {
      for (let x = 0; x < SPRITE; x++) {

        const dx = (x + 0.5 - half) / half;
        const dy = (y + 0.5 - half) / half;
        const d = Math.sqrt(dx * dx + dy * dy);       // 0 center, 1 edge

        // Glowing point: tight core + wide soft halo
        const glow = Math.exp(-d * d * 60) + 0.35 * Math.exp(-d * d * 9);

        // Bokeh disc: soft round glow that fades out gradually (no hard rim)
        const disc = (1 - smoothstep(0.25, 1.0, d)) * 0.5;

        let a = glow * (1 - b) + disc * b;
        a *= 1 - smoothstep(0.92, 1, d);              // always fade to 0 at the edge

        // Hot white-ish center on sharp points
        const white = (1 - b) * Math.exp(-d * d * 220) * 0.7;

        const i = (y * SPRITE + x) * 4;
        img.data[i]     = cr + (255 - cr) * white;
        img.data[i + 1] = cg + (255 - cg) * white;
        img.data[i + 2] = cb + (255 - cb) * white;
        img.data[i + 3] = Math.min(1, a) * 255;
      }
    }

    g.putImageData(img, 0, 0);

    if (sprites.size > 200) sprites.clear();   // keep the cache small
    sprites.set(key, c);
    return c;
  }


  // Hue -> light, glowy hex color (same tone as the default lime)
  // Slider value 0-10 fades from white into red, 10-360 is the rainbow
  function hueToHex(value) {
    const v = Number(value);
    const hue = Math.max(0, v - 10) / 350 * 360;
    const sat = Math.min(1, v / 10);
    const s = 0.94 * sat;
    const l = 0.74 + (1 - 0.74) * (1 - sat) * 0.95;
    const k = (n) => (n + hue / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    const to = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
    return "#" + to(f(0)) + to(f(8)) + to(f(4));
  }

  // ---------- drawing ----------

  // Draw the particles onto ctx (ctx's blend mode is used for the whole layer)
  function draw(ctx, state, settings) {

    const W = ctx.canvas.width;
    const H = ctx.canvas.height;

    // Particles are drawn on their own canvas first, adding up like light,
    // then that canvas is placed with the layer's blend mode.
    if (!state.canvas || state.canvas.width !== W || state.canvas.height !== H) {
      state.canvas = document.createElement("canvas");
      state.canvas.width = W;
      state.canvas.height = H;
      state.ctx = state.canvas.getContext("2d");
    }

    const g = state.ctx;
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = "lighter";

    const size = Number(settings.ptSize);
    const color = hueToHex(Number(settings.ptHue));
    const blur = Math.max(0, Math.min(1, Number(settings.ptBlur ?? 0) / 100));

    for (const p of state.list) {

      // Near particles get the most blur; far ones stay fairly sharp
      const pb = blur * Math.pow(p.z, 0.8);
      const level = Math.round(pb * (LEVELS - 1));

      // Size: far = tiny, near = big; blurrier = wider
      const base = size * p.sizeScale * (0.5 + 2.5 * p.z);
      const r = base * (4 - 2.6 * pb) * (1 + 2.2 * pb);

      // Bigger, blurrier particles are dimmer. Everything twinkles a little.
      const twinkle = 0.75 + 0.25 * Math.sin(state.time * p.twinkleRate + p.twinklePhase);
      g.globalAlpha = p.alpha * (1 - 0.75 * pb) * twinkle;

      const sprite = getSprite(color, level);
      g.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2);
    }

    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";

    ctx.drawImage(state.canvas, 0, 0);
  }

  return { create, update, draw };

})();
