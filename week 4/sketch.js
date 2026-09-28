const video = document.getElementById("video");
const stop = document.getElementById("stop");
const colorSlider = document.getElementById("cplay");
const colorOverlay = document.getElementById("colorOverlay");
const intenseSlider = document.getElementById("iplay");
const colorStops = [
  { position: 0,   rgb: [255, 0, 0] },   // red
  { position: 20,  rgb: [255, 165, 0] }, // orange
  { position: 50,  rgb: [0, 128, 0] },   // green
  { position: 100, rgb: [0, 0, 255] }   // blue
];

video.muted = true;
video.loop = true;

video.play(); 

stop.addEventListener("click", () => {
  if (video.paused) {
    video.play();
    stop.textContent = "Stop";
  } else {
    video.pause();
    stop.textContent = "Play";
  }
});

function editOverlay() {
  const colorValue = Number(colorSlider.value);
  const opacity = Number(intenseSlider.value) / 150;

  for (let i = 0; i < colorStops.length - 1; i++) {
    const start = colorStops[i];
    const end = colorStops[i + 1];

    if (colorValue <= end.position) {
      const amount =
        (colorValue - start.position) /
        (end.position - start.position);

      const rgb = start.rgb.map((channel, index) =>
        Math.round(channel + (end.rgb[index] - channel) * amount)
      );

      colorOverlay.style.backgroundColor =
        `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${opacity})`;
      break;
    }
  }
}

colorSlider.addEventListener("input", editOverlay);
intenseSlider.addEventListener("input", editOverlay);
editOverlay();


//saving video to png
document.getElementById("save").addEventListener("click", () => {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext("2d");

  // current video
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // colorlayer
  ctx.fillStyle = getComputedStyle(colorOverlay).backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const link = document.createElement("a");
  link.download = "video-frame.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
});
