// Tabs
const tabButtons = document.querySelectorAll(".tab-btn");
const panels = { name: document.getElementById("name-panel"), image: document.getElementById("image-panel") };
for (const btn of tabButtons) {
  btn.addEventListener("click", () => {
    for (const b of tabButtons) b.classList.remove("active");
    btn.classList.add("active");
    for (const key of Object.keys(panels)) panels[key].classList.toggle("active", key === btn.dataset.tab);
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderResults(container, hits, { showConfidence } = {}) {
  container.innerHTML = "";
  if (hits.length === 0) {
    container.innerHTML = `<p class="hint">No results.</p>`;
    return;
  }
  for (const hit of hits) {
    const cover = hit.images[0]?.url ?? "";
    const card = document.createElement("a");
    card.className = "card";
    card.href = hit.url || "#";
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    const confidenceBadge =
      showConfidence && typeof hit.confidence === "number"
        ? `<span class="confidence-badge">${Math.round(hit.confidence * 100)}% match</span>`
        : "";
    card.innerHTML = `
      ${cover ? `<img src="${cover}" alt="" loading="lazy" />` : `<div class="card-img-placeholder"></div>`}
      <div class="card-body">
        <p class="card-name">${escapeHtml(hit.name || "(untitled)")}</p>
        <p class="card-meta">by ${escapeHtml(hit.ownerName || "unknown")} &middot; ${hit.tracksTotal} tracks</p>
        ${confidenceBadge}
      </div>`;
    container.appendChild(card);
  }
}

// --- Owner-preset <select> wiring (both panes) ---
// Selecting "custom" reveals a free-text regex input; any preset fills that
// same hidden input with its pattern so form submission only ever reads one field.
function wireOwnerPreset(prefix) {
  const select = document.getElementById(`${prefix}-owner-preset`);
  const custom = document.getElementById(`${prefix}-owner-custom`);
  select.addEventListener("change", () => {
    if (select.value === "custom") {
      custom.hidden = false;
      custom.value = "";
      custom.focus();
    } else {
      custom.hidden = true;
      custom.value = select.value;
    }
  });
}
wireOwnerPreset("name");
wireOwnerPreset("image");

function ownerPatternFor(prefix) {
  const select = document.getElementById(`${prefix}-owner-preset`);
  const custom = document.getElementById(`${prefix}-owner-custom`);
  return select.value === "custom" ? custom.value.trim() : select.value;
}

// --- Name search ---
const nameForm = document.getElementById("name-form");
const nameStatus = document.getElementById("name-status");
const nameResults = document.getElementById("name-results");

nameForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("name-title").value;
  const keywords = document.getElementById("name-keywords").value;
  const exact = document.getElementById("name-exact").checked;
  const ownerPattern = ownerPatternFor("name");

  nameStatus.textContent = `Searching for "${title}"...`;
  nameResults.innerHTML = "";
  try {
    const res = await fetch("/api/search-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, keywords, exact: String(exact), ownerPattern }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    nameStatus.textContent = `${data.hits.length} match${data.hits.length === 1 ? "" : "es"} for "${title}".`;
    renderResults(nameResults, data.hits);
  } catch (err) {
    nameStatus.textContent = `Search failed: ${err.message}`;
  }
});

// --- Image search + cropper ---
const fileInput = document.getElementById("image-file");
const cropperWrap = document.getElementById("cropper-wrap");
const canvas = document.getElementById("cropper-canvas");
const ctx = canvas.getContext("2d");
const imageForm = document.getElementById("image-form");
const imageSubmit = document.getElementById("image-submit");
const imageStatus = document.getElementById("image-status");
const imageResults = document.getElementById("image-results");

const MAX_CANVAS_WIDTH = 640;
let sourceImage = null; // HTMLImageElement, natural resolution
let scale = 1; // canvas px -> natural px factor is 1/scale
let selection = null; // {x,y,w,h} in canvas px
let dragStart = null;

function drawCropper() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
  if (selection) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, canvas.width, selection.y);
    ctx.fillRect(0, selection.y + selection.h, canvas.width, canvas.height - selection.y - selection.h);
    ctx.fillRect(0, selection.y, selection.x, selection.h);
    ctx.fillRect(selection.x + selection.w, selection.y, canvas.width - selection.x - selection.w, selection.h);
    ctx.strokeStyle = "#1db954";
    ctx.lineWidth = 2;
    ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    sourceImage = img;
    scale = Math.min(1, MAX_CANVAS_WIDTH / img.naturalWidth);
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    selection = { x: 0, y: 0, w: canvas.width, h: canvas.height };
    cropperWrap.hidden = false;
    imageSubmit.disabled = false;
    drawCropper();
    URL.revokeObjectURL(url);
  };
  img.src = url;
});

function canvasPoint(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: Math.max(0, Math.min(canvas.width, (evt.clientX - rect.left) * scaleX)),
    y: Math.max(0, Math.min(canvas.height, (evt.clientY - rect.top) * scaleY)),
  };
}

canvas.addEventListener("pointerdown", (evt) => {
  if (!sourceImage) return;
  dragStart = canvasPoint(evt);
  canvas.setPointerCapture(evt.pointerId);
});

canvas.addEventListener("pointermove", (evt) => {
  if (!dragStart) return;
  const p = canvasPoint(evt);
  const x = Math.min(dragStart.x, p.x);
  const y = Math.min(dragStart.y, p.y);
  const w = Math.abs(p.x - dragStart.x);
  const h = Math.abs(p.y - dragStart.y);
  selection = { x, y, w, h };
  drawCropper();
});

function finishDrag() {
  if (!dragStart) return;
  dragStart = null;
  if (!selection || selection.w < 6 || selection.h < 6) {
    selection = { x: 0, y: 0, w: canvas.width, h: canvas.height };
    drawCropper();
  }
}
canvas.addEventListener("pointerup", finishDrag);
canvas.addEventListener("pointercancel", finishDrag);

function extractCropBlob() {
  return new Promise((resolve, reject) => {
    if (!sourceImage || !selection) return reject(new Error("No crop selected"));
    const sx = selection.x / scale;
    const sy = selection.y / scale;
    const sw = selection.w / scale;
    const sh = selection.h / scale;
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(sw));
    out.height = Math.max(1, Math.round(sh));
    const outCtx = out.getContext("2d");
    outCtx.drawImage(sourceImage, sx, sy, sw, sh, 0, 0, out.width, out.height);
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Crop export failed"))), "image/png");
  });
}

imageForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("image-title").value;
  const keywords = document.getElementById("image-keywords").value;
  const exact = document.getElementById("image-exact").checked;
  const ownerPattern = ownerPatternFor("image");

  imageStatus.textContent = "Cropping and searching...";
  imageResults.innerHTML = "";
  try {
    const blob = await extractCropBlob();
    const form = new FormData();
    form.append("image", blob, "crop.png");
    form.append("title", title);
    form.append("keywords", keywords);
    form.append("exact", String(exact));
    form.append("ownerPattern", ownerPattern);
    const res = await fetch("/api/search-image", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    imageStatus.textContent = `${data.hits.length} candidate${data.hits.length === 1 ? "" : "s"} ranked by cover-art similarity for "${title}".`;
    renderResults(imageResults, data.hits, { showConfidence: true });
  } catch (err) {
    imageStatus.textContent = `Search failed: ${err.message}`;
  }
});
