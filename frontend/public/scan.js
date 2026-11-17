// Camera scan for the lookup page: point the phone at a batch's QR label
// (qr.js) and open its result. Reads the label's link back to a batch ID
// with batchFromScan, so a label carrying a bare ID works too.
//
// Uses the browser's BarcodeDetector where there is one (Chrome, Android).
// Safari has none, so it falls back to jsQR, loaded only when a scan starts.
// Video stays on the device: frames are decoded here and never sent anywhere.

import { batchFromScan } from "./verify-core.js";

const SCAN_EVERY_MS = 150;

// The camera needs a secure page (https or localhost) and a browser that
// offers it. Without either, the Scan button stays hidden.
export function canScan() {
  return Boolean(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

const validId = (id) => {
  const bytes = new TextEncoder().encode(id).length;
  return bytes > 0 && bytes <= 31;
};

async function makeDecoder() {
  if ("BarcodeDetector" in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes("qr_code")) {
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        return async (video) => {
          const codes = await detector.detect(video);
          return codes.length ? codes[0].rawValue : null;
        };
      }
    } catch {
      // Fall through to jsQR.
    }
  }
  const { default: jsQR } = await import("https://esm.sh/jsqr@1.4.0");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    // Decode a scaled-down frame: plenty for a label held near the camera.
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(data, width, height, { inversionAttempts: "dontInvert" });
    return code ? code.data : null;
  };
}

function cameraError(error) {
  const name = error && error.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access is off for this site. Turn it on in your browser settings, or type the batch ID.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found. Type the batch ID instead.";
  if (name === "NotReadableError") return "The camera is in use by another app. Close it and try again.";
  return "The camera couldn't start. Type the batch ID instead.";
}

// Opens the scanner over the page. Calls onResult(batchId) once a batch
// label is read, then closes. Closing by any route turns the camera off.
export function openScanner({ onResult, onError }) {
  const dialog = document.createElement("dialog");
  dialog.className = "scan-dialog";
  dialog.setAttribute("aria-labelledby", "scanHeading");
  dialog.innerHTML = `
    <div class="scan-head">
      <h2 id="scanHeading">Scan a batch label</h2>
      <button type="button" class="scan-close" aria-label="Close scanner">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12"></path><path d="M18 6L6 18"></path></svg>
      </button>
    </div>
    <div class="scan-view">
      <video playsinline muted></video>
      <div class="scan-frame" aria-hidden="true"></div>
    </div>
    <p class="scan-status" role="status" aria-live="polite">Starting the camera…</p>`;
  const video = dialog.querySelector("video");
  const status = dialog.querySelector(".scan-status");
  let stream = null;
  let timer = null;
  let closed = false;

  const stop = () => {
    closed = true;
    clearTimeout(timer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  };
  dialog.addEventListener("close", () => {
    stop();
    dialog.remove();
  });
  dialog.querySelector(".scan-close").addEventListener("click", () => dialog.close());
  document.body.append(dialog);
  dialog.showModal();

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      if (closed) return stop();
      video.srcObject = stream;
      await video.play();
      const decode = await makeDecoder();
      if (closed) return;
      status.textContent = "Hold the QR code inside the frame.";
      let lastBad = "";
      const tick = async () => {
        if (closed) return;
        let raw = null;
        try {
          if (video.readyState >= 2) raw = await decode(video);
        } catch {
          raw = null;
        }
        if (closed) return;
        if (raw) {
          const id = batchFromScan(raw);
          if (validId(id)) {
            dialog.close();
            onResult(id);
            return;
          }
          if (raw !== lastBad) {
            lastBad = raw;
            status.textContent = "That code isn't a batch label. Try the QR code on the package.";
          }
        }
        timer = setTimeout(tick, SCAN_EVERY_MS);
      };
      tick();
    } catch (error) {
      if (closed) return;
      dialog.close();
      if (onError) onError(cameraError(error));
    }
  })();
}
