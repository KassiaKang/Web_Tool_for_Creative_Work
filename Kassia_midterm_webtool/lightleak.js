// Light Leak effect (light sweep)
// A clean, soft vertical band of colored light that sweeps across the frame left to right,
// slowing down as it leaves (ease-out), then rests off-screen before the next pass.
// Rendered with WebGL on an offscreen canvas, then drawn onto the 2D canvas it's given.
//
// Settings (from the Light Leak controls):
//   llSpread     width of the band
//   llIntensity  brightness
//   llCore       white line in the middle of the band
//   llCover      strength (opacity) of the band
//   llDuration   seconds for one sweep + rest
//   llColor      color preset

const LightLeak = (() => {

  // Color presets: [outer color, mid color, inner color]
  const PALETTES = {
    ember:  ["#6e0d05", "#e8401c", "#ffb347"],
    golden: ["#6b2a05", "#f08a24", "#ffe39a"],
    rose:   ["#5a0a2a", "#e5487a", "#ffc2a8"],
    cyan:   ["#062a4a", "#1e8fd8", "#b8f4ff"],
    uv:     ["#2a0a5a", "#8b3ff0", "#ffb3f0"]
  };

  // Look of the sweep
  const SWEEP_PART = 0.85;           // first 85% of Duration: sweep. Rest: short pause.

  // Controls (used when no per-layer settings are passed in)
  const spreadInput    = document.getElementById("llSpread");
  const intensityInput = document.getElementById("llIntensity");
  const coreInput      = document.getElementById("llCore");
  const coverInput     = document.getElementById("llCover");
  const durationInput  = document.getElementById("llDuration");
  const colorInput     = document.getElementById("llColor");

  // Offscreen WebGL canvas
  const glCanvas = document.createElement("canvas");
  const gl = glCanvas.getContext("webgl", { preserveDrawingBuffer: true });

  if (!gl) {
    console.warn("Light Leak: WebGL is not available in this browser.");
    return { draw() {}, restart() {} };
  }

  const vertexSource = `
    attribute vec2 a;
    void main() { gl_Position = vec4(a, 0.0, 1.0); }
  `;

  const fragmentSource = `
    precision highp float;

    uniform vec2  uRes;
    uniform float uPos;        // band center along the travel direction, from the frame center (frame-height units)
    uniform float uWidth;      // band half-width
    uniform vec2  uDir;        // travel direction (the band stands across it)
    uniform float uStrength;   // Peak Cover x Intensity
    uniform float uCore;       // Core Glow
    uniform float uTime;
    uniform vec3  uC1, uC2, uC3;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {

      vec2 uv = gl_FragCoord.xy / uRes;
      float asp = uRes.x / uRes.y;
      vec2 p = vec2(uv.x * asp, 1.0 - uv.y);

      // Distance along the travel direction, measured from the frame center
      float u = dot(p - vec2(0.5 * asp, 0.5), uDir);
      float d = (u - uPos) / uWidth;            // 0 = middle of the band, +-1 = edges
      float ad = abs(d);

      // Soft band: fades in, flat-ish middle, fades out (like the 10/40/50/80% gradient)
      float band = pow(1.0 - smoothstep(0.05, 1.0, ad), 1.4);

      // A faint, wider glow around it so the light feels luminous, not cut out
      float halo = exp(-ad * ad * 0.6) * 0.18;

      float e = (band + halo) * uStrength;

      // Color: outer -> mid -> inner toward the middle of the band
      float t = 1.0 - exp(-e * 1.05);
      vec3 col = uC1 * smoothstep(0.0, 0.3, t);
      col = mix(col, uC2, smoothstep(0.15, 0.55, t));
      col = mix(col, uC3, smoothstep(0.45, 0.9, t));

      // Thin white line in the middle (Core Glow)
      float core = exp(-d * d * 14.0) * uCore * uStrength * 0.8;
      col = mix(col, vec3(1.0, 0.98, 0.94), 1.0 - exp(-core * 1.4));

      // Fine dithering so the gradient doesn't show steps
      col += (hash(gl_FragCoord.yx * 1.37 + fract(uTime * 1.7) * 57.0) - 0.5) * (2.5 / 255.0);

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aLoc = gl.getAttribLocation(program, "a");
  gl.enableVertexAttribArray(aLoc);
  gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  ["uRes", "uPos", "uWidth", "uDir", "uStrength", "uCore", "uTime", "uC1", "uC2", "uC3"]
    .forEach(name => U[name] = gl.getUniformLocation(program, name));

  const hexToRGB = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

  // CSS "ease-out": fast start, slows down at the end
  const easeOut = t => 1 - Math.pow(1 - t, 1.6);

  let startTime = performance.now();

  // Read the current values from the Light Leak controls
  function readControls() {
    return {
      llSpread: spreadInput.value,
      llIntensity: intensityInput.value,
      llCore: coreInput.value,
      llCover: coverInput.value,
      llDuration: durationInput.value,
      llColor: colorInput.value
    };
  }

  // params:    settings for this layer (falls back to the controls)
  // startedAt: when this layer's sweep started (performance.now() time)
  function draw(ctx, params, startedAt) {

    const p = params || readControls();
    const start = startedAt === undefined ? startTime : startedAt;
    const target = ctx.canvas;

    if (glCanvas.width !== target.width || glCanvas.height !== target.height) {
      glCanvas.width = target.width;
      glCanvas.height = target.height;
    }

    const W = glCanvas.width, H = glCanvas.height;
    const asp = W / H;

    const duration = Math.max(1, Number(p.llDuration));
    const elapsed = Math.max(0, (performance.now() - start) / 1000);
    const phase = (elapsed % duration) / duration;

    // Vertical band traveling left -> right
    const dir = [1, 0];

    // Band size, and how far it travels: from fully off one side to fully off the other
    const width = 0.45 * Number(p.llSpread) / 100;          // half-width, frame heights
    const reach = 0.5 * (asp * Math.abs(dir[0]) + Math.abs(dir[1]));   // frame edge along dir
    const margin = width * 1.15;
    const from = -(reach + margin);
    const to = reach + margin;

    // Sweep during the first part, then rest off-screen
    const move = Math.min(1, phase / SWEEP_PART);
    const pos = from + (to - from) * easeOut(move);

    const colors = PALETTES[p.llColor] || PALETTES.ember;

    gl.viewport(0, 0, W, H);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform1f(U.uPos, pos);
    gl.uniform1f(U.uWidth, width);
    gl.uniform2f(U.uDir, dir[0], dir[1]);
    gl.uniform1f(U.uStrength, (Number(p.llCover) / 100) * (Number(p.llIntensity) / 100));
    gl.uniform1f(U.uCore, Number(p.llCore) / 100);
    gl.uniform1f(U.uTime, elapsed);
    gl.uniform3fv(U.uC1, hexToRGB(colors[0]));
    gl.uniform3fv(U.uC2, hexToRGB(colors[1]));
    gl.uniform3fv(U.uC3, hexToRGB(colors[2]));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    ctx.drawImage(glCanvas, 0, 0, W, H);
  }

  // Start the sweep again from the beginning
  function restart() {
    startTime = performance.now();
  }

  return { draw, restart };

})();
