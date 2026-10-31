
// ===================================================
// Overlay Lab
// Layers: each timeline row is one layer with its own
// effect (Grain / Light Leak), its own settings and
// its own blend mode. The selected (lime) layer is the
// one the Effect Controls adjust.
// ===================================================

const canvas = document.getElementById("oCanvas");
const ctx = canvas.getContext("2d");

// Full HD canvas (16:9)
canvas.width = 1920;
canvas.height = 1080;

// Preview image (bottom of the stack)
const previewImage = new Image();
previewImage.src = "rootfolder/preview.jpg";
let previewOn = false;


// ---------------------------------------------------
// Effect settings
// Each effect lists the control ids it uses. A layer
// stores its own copy of these values.
// ---------------------------------------------------

const EFFECTS = {
  grain: {
    name: "Grain",
    panel: document.getElementById("Graineffect"),
    controls: ["intense", "Grainsize", "speed", "color", "grainHue"],
    blend: "overlay"
  },
  lightLeak: {
    name: "Light Leak",
    panel: document.getElementById("LightLeakeffect"),
    controls: ["llSpread", "llIntensity", "llCore", "llCover", "llDuration", "llColor"],
    blend: "overlay"
  },
  particles: {
    name: "Particles",
    panel: document.getElementById("Particleeffect"),
    controls: ["ptSize", "ptSpeed", "ptDirection", "ptCount", "ptBlur", "ptHue"],
    blend: "overlay"
  }
};

// Default values = whatever the controls start with in index.html
const DEFAULTS = {};
for (const key in EFFECTS) {
  DEFAULTS[key] = {};
  EFFECTS[key].controls.forEach(id => {
    DEFAULTS[key][id] = document.getElementById(id).value;
  });
}


// ---------------------------------------------------
// Grain (one offscreen canvas per layer)
// ---------------------------------------------------

function createGrainBuffer() {
  const c = document.createElement("canvas");
  c.width = canvas.width;
  c.height = canvas.height;
  const g = c.getContext("2d");
  return { canvas: c, ctx: g, image: g.createImageData(c.width, c.height), lastFrame: 0 };
}

// Hue (0-360) -> [r, g, b] in 0..1
function hueToRGB(hue) {
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

// Hue slider value (0-360) -> { hue, sat }
// 0 is white; 0-10 fades from white into red; 10-360 runs through the rainbow.
const WHITE_ZONE = 10;

function readHue(value) {
  const v = Number(value);
  return {
    hue: Math.max(0, v - WHITE_ZONE) / (360 - WHITE_ZONE) * 360,
    sat: Math.min(1, v / WHITE_ZONE)
  };
}

// CSS color for a Hue slider value (used for the knob)
function hueCSS(value, lightness) {
  const { hue, sat } = readHue(value);
  const l = lightness + (100 - lightness) * (1 - sat) * 0.9;
  return `hsl(${hue}, ${Math.round(sat * 100)}%, ${l}%)`;
}

// Color modes:
//   BW             black and white grain
//   VHS            colored chroma noise that smears sideways, like tape
//   colorcustomize grain tinted with the Hue slider
function generateGrain(buffer, settings) {

  const size = Math.max(1, Number(settings.Grainsize));
  const intensity = Number(settings.intense) / 100;
  const mode = settings.color;
  const { hue, sat } = readHue(settings.grainHue);
  const tint = hueToRGB(hue).map(c => 1 + (c - 1) * sat);   // 0 = white tint

  const w = buffer.canvas.width;
  const h = buffer.canvas.height;
  const data = buffer.image.data;

  // Write pixels directly (much faster than fillRect at 1920x1080)
  for (let y = 0; y < h; y += size) {

    // VHS color noise changes slowly along each line (horizontal smear)
    let cr = 0, cb = 0, blocks = 0;

    for (let x = 0; x < w; x += size) {

      const randomGray = Math.random() * 256;
      const gray = 128 + (randomGray - 128) * intensity;

      let r = gray, g = gray, b = gray;

      if (mode === "VHS") {

        if (blocks % 6 === 0) {
          cr = (Math.random() - 0.5) * 220 * intensity;
          cb = (Math.random() - 0.5) * 220 * intensity;
        }
        blocks++;

        r = gray + cr;
        b = gray + cb;
        g = gray - (cr + cb) * 0.5;

      } else if (mode === "colorcustomize") {

        // Keep the grain's brightness, color it with the chosen hue
        const k = gray / 128;
        r = 128 * tint[0] * k + (gray - 128) * 0.35;
        g = 128 * tint[1] * k + (gray - 128) * 0.35;
        b = 128 * tint[2] * k + (gray - 128) * 0.35;
      }

      r = Math.max(0, Math.min(255, r)) | 0;
      g = Math.max(0, Math.min(255, g)) | 0;
      b = Math.max(0, Math.min(255, b)) | 0;

      // Fill one size x size block
      for (let by = y; by < Math.min(y + size, h); by++) {
        let i = (by * w + x) * 4;
        for (let bx = x; bx < Math.min(x + size, w); bx++) {
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = 255;
          i += 4;
        }
      }
    }
  }

  buffer.ctx.putImageData(buffer.image, 0, 0);
}


// ---------------------------------------------------
// Layers
// ---------------------------------------------------

const layersBox = document.getElementById("timelineLayers");
const layers = [];        // in timeline order (top row first)
let selected = null;      // the selected layer object
let layerCount = 0;       // used for "Effect 1, Effect 2, ..."

// New gray bars start at 0:00 and end at the Total shown in index.html (0:30)
const DEFAULT_CLIP_END = 30;

// Build the HTML for one timeline row
function createRow(name) {

  const row = document.createElement("div");
  row.className = "timelineRow layerRow";
  row.innerHTML = `
    <button class="layerToggle" role="switch" aria-checked="true" aria-label="Show this layer">
      <span class="toggleTrack"><span class="toggleKnob"></span></span>
    </button>

    <div class="effectName"></div>

    <select class="overlayMode">
      <option value="source-over">Normal</option>
      <option value="overlay">Overlay</option>
      <option value="screen">Screen</option>
      <option value="multiply">Multiply</option>
      <option value="soft-light">Soft Light</option>
    </select>

    <div class="timelineTrack">
      <div class="effectClip">
        <div class="resizeHandle start"></div>
        <div class="resizeHandle end"></div>
      </div>
      <button class="trashButton">Trash</button>
    </div>
  `;
  row.querySelector(".effectName").textContent = name;
  row.querySelector(".overlayMode").value = "overlay";
  return row;
}

function addLayer(existingRow) {

  layerCount += 1;
  const name = "Effect " + layerCount;
  const row = existingRow || createRow(name);

  const layer = {
    row,
    name,
    effect: null,          // "grain", "lightLeak" or null
    settings: {},          // control values for this layer's effect
    grain: null,           // grain buffer (only for grain layers)
    startedAt: performance.now(),
    clipStart: 0,          // gray bar on the timeline, in seconds
    clipEnd: DEFAULT_CLIP_END,
    visible: true          // layer toggle: off = hidden on canvas and in export
  };

  row.querySelector(".effectName").textContent = name;
  if (!existingRow) layersBox.appendChild(row);

  // Blend mode dropdown
  const mode = row.querySelector(".overlayMode");
  mode.addEventListener("change", () => { layer.blend = mode.value; });
  layer.blend = mode.value;

  // Trash
  row.querySelector(".trashButton").addEventListener("click", () => removeLayer(layer));

  // On/off toggle
  const toggle = row.querySelector(".layerToggle");
  toggle.addEventListener("click", () => {
    layer.visible = !layer.visible;
    toggle.setAttribute("aria-checked", layer.visible);
    toggle.setAttribute("aria-label", layer.visible ? "Hide this layer" : "Show this layer");
    row.classList.toggle("layerOff", !layer.visible);
  });

  // Click the row to select it
  row.addEventListener("click", (event) => {
    if (event.target.closest("select, button")) return;
    selectLayer(layer);
  });

  // Drag the gray bar
  enableClipDrag(layer);

  layers.push(layer);
  selectLayer(layer);
  layoutClip(layer);
  updateTotal();
  return layer;
}

function removeLayer(layer) {

  const index = layers.indexOf(layer);
  if (index === -1) return;

  layers.splice(index, 1);
  layer.row.remove();

  if (selected === layer) {
    selected = null;
    const next = layers[index] || layers[index - 1];
    if (next) selectLayer(next); else showControls(null);
  }

  updateTotal();
}

function selectLayer(layer) {

  selected = layer;

  layers.forEach(l => l.row.classList.toggle("selected", l === layer));

  showControls(layer);
}

// Give the selected layer an effect (from the Effect Library)
function setEffect(layer, effect) {

  if (!layer) return;

  // Picking a different effect starts from that effect's defaults
  if (layer.effect !== effect) {
    layer.effect = effect;
    layer.settings = { ...DEFAULTS[effect] };
    layer.row.querySelector(".overlayMode").value = EFFECTS[effect].blend;
    layer.blend = EFFECTS[effect].blend;
  }

  layer.row.querySelector(".effectName").textContent = EFFECTS[effect].name;

  if (effect === "grain") {
    layer.grain = layer.grain || createGrainBuffer();
    generateGrain(layer.grain, layer.settings);
  } else if (effect === "lightLeak") {
    layer.startedAt = performance.now();   // light leak starts from the left
  } else if (effect === "particles") {
    layer.particles = layer.particles || Particles.create();
  }

  showControls(layer);
}


// ---------------------------------------------------
// Effect Controls: show and edit the selected layer
// ---------------------------------------------------

const libraryButtons = {
  grain: document.getElementById("grainButton"),
  lightLeak: document.getElementById("lightLeakButton"),
  particles: document.getElementById("particleButton")
};

function showControls(layer) {

  const effect = layer ? layer.effect : null;

  for (const key in EFFECTS) {
    EFFECTS[key].panel.hidden = key !== effect;

    libraryButtons[key].classList.toggle("selected", key === effect);
    libraryButtons[key].setAttribute("aria-pressed", key === effect);
  }

  if (!effect) return;

  // Load this layer's values into the sliders and number boxes
  EFFECTS[effect].controls.forEach(id => {
    const input = document.getElementById(id);
    input.value = layer.settings[id];
    const number = document.getElementById(id + "Value");
    if (number) number.value = input.value;
  });

  updateHueControl();
}

// Show the Hue slider only for Color = Customize,
// and paint its knob with the chosen color
const grainColor = document.getElementById("color");
const grainHue = document.getElementById("grainHue");
const particleHue = document.getElementById("ptHue");

function updateHueControl() {

  const custom = grainColor.value === "colorcustomize";

  document.querySelectorAll(".hueOnly").forEach(el => { el.hidden = !custom; });

  grainHue.style.setProperty("--hue-color", hueCSS(grainHue.value, 50));
  particleHue.style.setProperty("--hue-color", hueCSS(particleHue.value, 74));
}

grainColor.addEventListener("input", updateHueControl);
grainHue.addEventListener("input", updateHueControl);
particleHue.addEventListener("input", updateHueControl);

// When a control changes, save it into the selected layer
for (const key in EFFECTS) {
  EFFECTS[key].controls.forEach(id => {

    const input = document.getElementById(id);

    input.addEventListener("input", () => {

      if (!selected || selected.effect !== key) return;

      selected.settings[id] = input.value;

      if (key === "grain") generateGrain(selected.grain, selected.settings);
    });
  });
}


// ---------------------------------------------------
// Drawing
// ---------------------------------------------------

// Draw the preview image to fill the canvas (like CSS "cover")
function drawPreviewImage(target = ctx) {

  const scale = Math.max(
    canvas.width / previewImage.naturalWidth,
    canvas.height / previewImage.naturalHeight
  );

  const w = previewImage.naturalWidth * scale;
  const h = previewImage.naturalHeight * scale;

  target.drawImage(previewImage, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

// Draw layers onto a 2D context.
// Like After Effects, the top row is drawn on top (layers go from the bottom row up).
//   target   the context to draw on
//   options.preview  draw the preview photo underneath
//   options.time     timeline time in seconds: only layers whose gray bar
//                    covers this time are drawn (null = draw all, for the live view)
//   options.only     draw just this one layer (ignores its on/off toggle)
function drawLayers(target, options = {}) {

  const { preview = false, time = null, only = null } = options;
  const W = target.canvas.width;
  const H = target.canvas.height;

  target.globalCompositeOperation = "source-over";
  target.clearRect(0, 0, W, H);

  let somethingBelow = false;
  const showPhoto = preview && previewImage.complete && previewImage.naturalWidth > 0;

  if (showPhoto) {
    drawPreviewImage(target);
    somethingBelow = true;
  }

  for (let i = layers.length - 1; i >= 0; i--) {

    const layer = layers[i];
    if (!layer.effect) continue;
    if (only ? layer !== only : !layer.visible) continue;
    if (time !== null && (time < layer.clipStart || time >= layer.clipEnd)) continue;

    // The first thing drawn has nothing to blend with
    target.globalCompositeOperation = somethingBelow ? layer.blend : "source-over";

    if (layer.effect === "grain") {
      target.drawImage(layer.grain.canvas, 0, 0, W, H);
    } else if (layer.effect === "lightLeak") {
      // In an export the light leak starts where its gray bar starts
      const startedAt = time === null
        ? layer.startedAt
        : performance.now() - (time - layer.clipStart) * 1000;
      LightLeak.draw(target, layer.settings, startedAt);
    } else if (layer.effect === "particles") {
      Particles.draw(target, layer.particles, layer.settings);
    }

    somethingBelow = true;
  }

  // No photo underneath: put the effects on black, exactly like the exported video
  if (!showPhoto) {
    target.globalCompositeOperation = "destination-over";
    target.fillStyle = "#000";
    target.fillRect(0, 0, W, H);
  }

  target.globalCompositeOperation = "source-over";
}

// Live view in the editor
function renderFrame() {
  drawLayers(ctx, { preview: previewOn });
}

let lastTime = performance.now();

function animate(currentTime) {

  // Seconds since the last frame (capped so a paused tab doesn't jump)
  const dt = Math.min(0.1, Math.max(0, (currentTime - lastTime) / 1000));
  lastTime = currentTime;

  // While exporting, the export moves the effects frame by frame
  if (exporting) {
    requestAnimationFrame(animate);
    return;
  }

  // Move each particle layer
  layers.forEach(layer => {
    if (layer.effect === "particles") {
      Particles.update(layer.particles, layer.settings, dt, canvas.width, canvas.height);
    }
  });

  // Refresh each grain layer at its own speed (FPS)
  layers.forEach(layer => {

    if (layer.effect !== "grain") return;

    const fps = Number(layer.settings.speed);
    if (fps <= 0) return;

    if (currentTime - layer.grain.lastFrame >= 1000 / fps) {
      generateGrain(layer.grain, layer.settings);
      layer.grain.lastFrame = currentTime;
    }
  });

  renderFrame();
  requestAnimationFrame(animate);
}


// ---------------------------------------------------
// Slider <-> number box
// ---------------------------------------------------

function connectSlider(sliderId, numberId) {

    const slider = document.getElementById(sliderId);
    const number = document.getElementById(numberId);

    // Slider → Number
    slider.addEventListener("input", () => {
        number.value = slider.value;
    });

    // Number → Slider
    number.addEventListener("input", () => {

        if (number.value === "") return;

        const value = Number(number.value);

        if (value < Number(slider.min) ||
            value > Number(slider.max)) return;

        slider.value = value;

        slider.dispatchEvent(new Event("input"));
    });

    // Keep values within the allowed range
    number.addEventListener("change", () => {
        const value = Number(number.value);

        if (number.value === "" || !Number.isFinite(value)) {
            number.value = slider.value;
            return;
        }

        slider.value = Math.max(
            Number(slider.min),
            Math.min(Number(slider.max), value)
        );

        number.value = slider.value;
        slider.dispatchEvent(new Event("input"));
    });
}

connectSlider("intense", "intenseValue");
connectSlider("Grainsize", "GrainsizeValue");
connectSlider("speed", "speedValue");
connectSlider("grainHue", "grainHueValue");
connectSlider("ptHue", "ptHueValue");
connectSlider("llSpread", "llSpreadValue");
connectSlider("llIntensity", "llIntensityValue");
connectSlider("llCore", "llCoreValue");
connectSlider("llCover", "llCoverValue");
connectSlider("llDuration", "llDurationValue");
connectSlider("ptSize", "ptSizeValue");
connectSlider("ptSpeed", "ptSpeedValue");
connectSlider("ptDirection", "ptDirectionValue");
connectSlider("ptCount", "ptCountValue");
connectSlider("ptBlur", "ptBlurValue");


// ---------------------------------------------------
// Buttons
// ---------------------------------------------------

// Effect Library: put the effect on the selected layer
libraryButtons.grain.addEventListener("click", () => setEffect(selected, "grain"));
libraryButtons.lightLeak.addEventListener("click", () => setEffect(selected, "lightLeak"));
libraryButtons.particles.addEventListener("click", () => setEffect(selected, "particles"));

// + Add Layer: new "Effect N" row under the others
document.getElementById("addLayer").addEventListener("click", () => addLayer());

// Preview toggle
const previewButton = document.getElementById("previewButton");

previewButton.addEventListener("click", () => {
    previewOn = !previewOn;
    previewButton.setAttribute("aria-checked", previewOn);
});

previewImage.addEventListener("error", () => {
    console.warn("Preview: could not load rootfolder/preview.jpg");
});


// ---------------------------------------------------
// Time ruler
// ---------------------------------------------------

const timeRuler = document.getElementById("timeRuler");

// One tick every 5 seconds, a longer tick every 30 seconds
for (let i = 0; i <= 24; i++) {

    const mark = document.createElement("div");
    mark.className = i % 6 === 0 ? "rulerMark major" : "rulerMark";
    mark.style.left = (i / 24) * 100 + "%";

    timeRuler.appendChild(mark);
}



// ---------------------------------------------------
// Gray bars (clips) and Total
// Each layer's gray bar marks the part of the timeline
// it exports. Total = where the last bar ends
// (the length of the exported video).
// ---------------------------------------------------

const TIMELINE_SECONDS = 120;   // the ruler shows 0:00 - 2:00
const MIN_CLIP = 3;             // shortest bar, in seconds
const exportDuration = document.getElementById("exportDuration");

// "1:30" -> 90, "45" -> 45, anything else -> null
function parseTime(text) {

    const match = text.trim().match(/^(?:(\d+):)?(\d{1,2})$/);
    if (!match) return null;

    const minutes = Number(match[1] || 0);
    const seconds = Number(match[2]);
    if (match[1] !== undefined && seconds > 59) return null;

    return minutes * 60 + seconds;
}

function formatTime(totalSeconds) {
    const t = Math.round(totalSeconds);
    const m = Math.floor(t / 60);
    const s = String(t % 60).padStart(2, "0");
    return m + ":" + s;
}

// Place a layer's gray bar from its start/end seconds
function layoutClip(layer) {
    const clip = layer.row.querySelector(".effectClip");
    clip.style.left = (layer.clipStart / TIMELINE_SECONDS) * 100 + "%";
    clip.style.width = ((layer.clipEnd - layer.clipStart) / TIMELINE_SECONDS) * 100 + "%";
}

// Total = end of the last bar
function exportLength() {
    return layers.reduce((max, l) => Math.max(max, l.clipEnd), 0);
}

function updateTotal() {
    exportDuration.value = formatTime(exportLength());
}

// Dragging: middle moves the bar, ends change its length.
// Snaps to whole seconds.
function enableClipDrag(layer) {

    const clip = layer.row.querySelector(".effectClip");
    const track = layer.row.querySelector(".timelineTrack");

    clip.addEventListener("pointerdown", (event) => {

        event.preventDefault();

        const mode = event.target.classList.contains("start") ? "start"
                   : event.target.classList.contains("end")   ? "end"
                   : "move";

        const startX = event.clientX;
        const pxPerSecond = track.getBoundingClientRect().width / TIMELINE_SECONDS;
        const from = { start: layer.clipStart, end: layer.clipEnd };

        clip.setPointerCapture(event.pointerId);
        clip.classList.add("dragging");
        selectLayer(layer);

        function onMove(e) {

            const delta = Math.round((e.clientX - startX) / pxPerSecond);

            if (mode === "move") {
                const length = from.end - from.start;
                const start = Math.max(0, Math.min(TIMELINE_SECONDS - length, from.start + delta));
                layer.clipStart = start;
                layer.clipEnd = start + length;
            } else if (mode === "start") {
                layer.clipStart = Math.max(0, Math.min(from.end - MIN_CLIP, from.start + delta));
            } else {
                layer.clipEnd = Math.min(TIMELINE_SECONDS, Math.max(from.start + MIN_CLIP, from.end + delta));
            }

            layoutClip(layer);
            updateTotal();
        }

        function onUp() {
            clip.classList.remove("dragging");
            clip.removeEventListener("pointermove", onMove);
            clip.removeEventListener("pointerup", onUp);
            clip.removeEventListener("pointercancel", onUp);
        }

        clip.addEventListener("pointermove", onMove);
        clip.addEventListener("pointerup", onUp);
        clip.addEventListener("pointercancel", onUp);
    });
}

// Typing a Total: bars that run past it are cut to it;
// if it is longer than every bar, the selected bar is stretched to it.
exportDuration.addEventListener("change", () => {

    const seconds = parseTime(exportDuration.value);

    if (seconds !== null && layers.length) {

        const total = Math.max(MIN_CLIP, Math.min(TIMELINE_SECONDS, seconds));

        layers.forEach(l => {
            if (l.clipEnd > total) {
                l.clipEnd = total;
                l.clipStart = Math.min(l.clipStart, total - MIN_CLIP);
            }
        });

        const target = selected || layers[layers.length - 1];
        if (exportLength() < total) target.clipEnd = total;

        layers.forEach(layoutClip);
    }

    updateTotal();
});

exportDuration.addEventListener("keydown", (event) => {
    if (event.key === "Enter") exportDuration.blur();
});


// ---------------------------------------------------
// Export (MP4)
//   Export button  -> every layer that is switched on, in one video,
//                     from 0:00 to Total
//   triangle menu  -> one layer on its own, for the length of its gray bar
// Frames are rendered one by one and encoded to H.264 (WebCodecs + mp4-muxer),
// so it doesn't have to run in real time.
// The preview photo is not included; empty areas are black.
// ---------------------------------------------------

const exportButton = document.getElementById("export");
const exportMenuButton = document.getElementById("exportMenuButton");
const exportMenu = document.getElementById("exportMenu");
const EXPORT_FPS = 30;

// Video quality (average bits per second). Picked in the Export menu.
// Grain is random noise on every pixel, so it needs a lot of data to stay
// crisp; light leaks and particles look fine even on Standard.
const EXPORT_QUALITIES = [
  { name: "Standard", bitrate: 10_000_000, note: "~75 MB/min" },
  { name: "High",     bitrate: 40_000_000, note: "~300 MB/min" },
  { name: "Max",      bitrate: 80_000_000, note: "~600 MB/min" }
];
let exportQuality = EXPORT_QUALITIES[1];   // High by default
let exporting = false;

// Best video format this browser can record (MP4 first)
function pickVideoFormat() {
  const types = [
    "video/mp4;codecs=avc1.640028",
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm"
  ];
  return types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || null;
}

function showExportMessage(text, ms = 2500) {
  exportButton.textContent = text;
  if (ms) setTimeout(() => { if (!exporting) exportButton.textContent = "Export"; }, ms);
}

// Save a Blob as a file on the user's computer
function downloadBlob(blob, name) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

function setExportBusy(busy) {
  exporting = busy;
  exportButton.disabled = busy;
  exportMenuButton.disabled = busy;
}

// Draw one export frame: layers at `time`, on black
function drawExportFrame(outCtx, time, only) {
  drawLayers(outCtx, { time, only });
  outCtx.globalCompositeOperation = "destination-over";
  outCtx.fillStyle = "#000";
  outCtx.fillRect(0, 0, outCtx.canvas.width, outCtx.canvas.height);
  outCtx.globalCompositeOperation = "source-over";
}

// Move effects forward by exactly one export frame
function stepEffectsForExport(time, dt) {
  layers.forEach(layer => {

    if (layer.effect === "particles") {
      Particles.update(layer.particles, layer.settings, dt, canvas.width, canvas.height);
    }

    if (layer.effect === "grain") {
      const fps = Number(layer.settings.speed);
      const index = fps > 0 ? Math.floor((time - layer.clipStart) * fps) : 0;
      if (index !== layer.grain.exportIndex) {
        generateGrain(layer.grain, layer.settings);
        layer.grain.exportIndex = index;
      }
    }
  });
}

// Find an H.264 setting this browser's encoder accepts
async function pickEncoderConfig(width, height) {

  // H.264 first (plays everywhere), VP9 as a backup
  const codecs = [
    { codec: "avc1.640028", muxer: "avc" },   // H.264 High
    { codec: "avc1.4d0028", muxer: "avc" },   // H.264 Main
    { codec: "avc1.42e028", muxer: "avc" },   // H.264 Baseline
    { codec: "vp09.00.40.08", muxer: "vp9" }  // VP9
  ];

  for (const { codec, muxer } of codecs) {
    const config = {
      codec,
      width,
      height,
      bitrate: exportQuality.bitrate,
      bitrateMode: "variable",
      framerate: EXPORT_FPS,
      latencyMode: "quality"           // take the time to do every frame well
    };
    if (muxer === "avc") config.avc = { format: "avc" };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(config);
      if (supported) return { config, muxer };
    } catch (e) { /* try the next one */ }
  }
  return null;
}

// Render from `from` to `to` seconds of the timeline, frame by frame,
// encode it as H.264 and save an MP4. Not tied to real time: each frame
// is finished before the next, so every frame gets the same quality.
async function recordVideo({ from, to, only = null, fileName }) {

  const canEncode = window.VideoEncoder && window.VideoFrame && window.Mp4Muxer;
  const picked = canEncode ? await pickEncoderConfig(canvas.width, canvas.height) : null;

  if (!picked) {
    recordVideoLive({ from, to, only, fileName });   // older browsers
    return;
  }

  setExportBusy(true);

  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const outCtx = out.getContext("2d");

  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: picked.muxer, width: out.width, height: out.height, frameRate: EXPORT_FPS },
    fastStart: "in-memory"
  });

  let failed = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failed = e; }
  });
  encoder.configure(picked.config);

  const dt = 1 / EXPORT_FPS;
  const totalFrames = Math.max(1, Math.round((to - from) * EXPORT_FPS));
  const length = to - from;

  // Grain starts fresh for the export
  layers.forEach(l => { if (l.grain) l.grain.exportIndex = null; });

  try {

    for (let i = 0; i < totalFrames; i++) {

      if (failed) throw failed;

      const time = from + i * dt;

      stepEffectsForExport(time, dt);
      drawExportFrame(outCtx, time, only);

      const frame = new VideoFrame(out, {
        timestamp: Math.round(i * 1e6 / EXPORT_FPS),   // microseconds
        duration: Math.round(1e6 / EXPORT_FPS)
      });
      encoder.encode(frame, { keyFrame: i % (EXPORT_FPS * 2) === 0 });   // keyframe every 2 s
      frame.close();

      // Let the encoder catch up, and keep the page responsive
      while (encoder.encodeQueueSize > 8) {
        await new Promise(r => setTimeout(r, 5));
      }
      if (i % 5 === 0) {
        exportButton.textContent = "Exporting " + Math.round((i / totalFrames) * 100) + "%";
        await new Promise(r => setTimeout(r, 0));
      }
    }

    await encoder.flush();
    encoder.close();
    muxer.finalize();

    downloadBlob(new Blob([muxer.target.buffer], { type: "video/mp4" }), fileName + ".mp4");
    setExportBusy(false);
    showExportMessage("Saved");

  } catch (e) {
    console.error("Export failed:", e);
    try { encoder.close(); } catch (_) {}
    setExportBusy(false);
    showExportMessage("Export failed");
  }
}

// Fallback for browsers without WebCodecs: record the canvas live, in real time
function recordVideoLive({ from, to, only = null, fileName }) {

  const mimeType = pickVideoFormat();
  if (!mimeType) {
    showExportMessage("Can't record here");
    return;
  }

  exporting = true;
  exportButton.disabled = true;
  exportMenuButton.disabled = true;

  // Separate canvas so the editor view isn't recorded
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const outCtx = out.getContext("2d");

  const stream = out.captureStream(EXPORT_FPS);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: exportQuality.bitrate });
  const chunks = [];

  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  recorder.onstop = () => {

    stream.getTracks().forEach(t => t.stop());

    const ext = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
    const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName + "." + ext;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);

    exporting = false;
    exportButton.disabled = false;
    exportMenuButton.disabled = false;
    showExportMessage(ext === "mp4" ? "Saved" : "Saved (WebM)");
  };

  const length = to - from;
  const startNow = performance.now();

  function frame() {

    const elapsed = (performance.now() - startNow) / 1000;

    if (elapsed >= length) {
      recorder.stop();
      return;
    }

    // Effects are paused in animate() while exporting, so move them here
    stepEffectsForExport(from + elapsed, 1 / 60);

    // Black background, then the layers on top
    drawLayers(outCtx, { time: from + elapsed, only });
    outCtx.globalCompositeOperation = "destination-over";
    outCtx.fillStyle = "#000";
    outCtx.fillRect(0, 0, out.width, out.height);
    outCtx.globalCompositeOperation = "source-over";

    exportButton.textContent = "Exporting " + formatTime(elapsed) + " / " + formatTime(length);
    requestAnimationFrame(frame);
  }

  recorder.start(500);
  frame();
}

// Export button: all switched-on layers, 0:00 -> Total
exportButton.addEventListener("click", () => {

  if (exporting) return;

  const hasVisible = layers.some(l => l.effect && l.visible);
  if (!hasVisible) {
    showExportMessage("No layers on");
    return;
  }

  const total = exportLength();
  recordVideo({ from: 0, to: total, fileName: "overlay-lab_all_" + formatTime(total).replace(":", "m") + "s" });
});

// Triangle: list of layers to export one at a time
function buildExportMenu() {

  exportMenu.innerHTML = "";

  // Quality picker (applies to Export and to single layers)
  const qualityItem = document.createElement("li");
  qualityItem.className = "qualityRow";
  qualityItem.innerHTML = `<span class="qualityLabel">Quality</span><div class="qualityOptions"></div>`;

  EXPORT_QUALITIES.forEach(q => {
    const option = document.createElement("button");
    option.className = "qualityOption";
    option.textContent = q.name;
    option.title = (q.bitrate / 1_000_000) + " Mbps, " + q.note;
    option.setAttribute("aria-pressed", q === exportQuality);
    option.addEventListener("click", (event) => {
      event.stopPropagation();
      exportQuality = q;
      buildExportMenu();          // redraw to show the new choice
    });
    qualityItem.querySelector(".qualityOptions").appendChild(option);
  });

  const qualityNote = document.createElement("div");
  qualityNote.className = "qualityNote";
  qualityNote.textContent = (exportQuality.bitrate / 1_000_000) + " Mbps · " + exportQuality.note;
  qualityItem.appendChild(qualityNote);

  exportMenu.appendChild(qualityItem);

  layers.forEach((layer, i) => {

    const item = document.createElement("li");
    const button = document.createElement("button");
    const label = layer.effect ? EFFECTS[layer.effect].name : "Empty";

    button.innerHTML = `<span></span><span class="menuDetail"></span>`;
    button.children[0].textContent = "Layer " + (i + 1) + " · " + label;
    button.children[1].textContent = formatTime(layer.clipStart) + "–" + formatTime(layer.clipEnd);
    button.disabled = !layer.effect;

    button.addEventListener("click", () => {
      closeExportMenu();
      recordVideo({
        from: layer.clipStart,
        to: layer.clipEnd,
        only: layer,
        fileName: "overlay-lab_layer" + (i + 1) + "_" + EFFECTS[layer.effect].name.replace(/\s+/g, "-").toLowerCase()
      });
    });

    item.appendChild(button);
    exportMenu.appendChild(item);
  });
}

function openExportMenu() {
  buildExportMenu();
  exportMenu.hidden = false;
  exportMenuButton.setAttribute("aria-expanded", "true");
}

function closeExportMenu() {
  exportMenu.hidden = true;
  exportMenuButton.setAttribute("aria-expanded", "false");
}

exportMenuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  if (exporting) return;
  exportMenu.hidden ? openExportMenu() : closeExportMenu();
});

// Click anywhere else (or press Esc) to close the menu
document.addEventListener("click", (event) => {
  if (!exportMenu.hidden && !event.target.closest("#exportGroup")) closeExportMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !exportMenu.hidden) closeExportMenu();
});


// ---------------------------------------------------
// Start
// ---------------------------------------------------

// The first row in index.html becomes "Effect 1"
addLayer(document.querySelector(".layerRow"));
requestAnimationFrame(animate);
