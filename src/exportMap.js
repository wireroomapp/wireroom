// Export the current map view (with the user's markers, lines, notes and live layers)
// as a PNG with a Wire Room header and footer. No server involved: the browser turns
// the map's SVG into an image and either downloads it or opens the phone's share sheet.

const SVG_NS = "http://www.w3.org/2000/svg";
const SITE = "wireroom.onrender.com";

// The app styles the map with CSS classes. An SVG turned into an image can't see the
// page's CSS, so the rules the map needs are copied in here. The animated pulse rings
// around country dots are left out of the still image.
const EXPORT_CSS = `
svg{font-family:Arial,sans-serif}
.ocean{fill:#0b1725;stroke:#21334a}
.grid{fill:none;stroke:#142233;stroke-width:.5}
.land{fill:#142230;stroke:#2a3c50;stroke-width:.65}
.dot{fill:#c9974b}
.dot.active{fill:#e8e3d8;stroke:#c9974b;stroke-width:2}
.pulse{display:none}
.marker text{font:8px monospace;fill:#8a98aa;text-anchor:middle}
`;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not render the map image"));
    img.src = url;
  });
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

function humanUtc(d) {
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

// Text that doesn't fit is shortened with an ellipsis instead of running off the image.
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

export async function renderMapPng(mapEl, { width, height, credits = [], annotated = false, now = new Date() }) {
  // The new map (MapLibre) is already a drawn canvas; the classic map is an SVG to turn into an image.
  const img = typeof HTMLCanvasElement !== "undefined" && mapEl instanceof HTMLCanvasElement ? mapEl : await svgToImage(mapEl, width, height);
  return compose(img, { width, height, credits, annotated, now });
}

async function svgToImage(svgEl, width, height) {
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.removeAttribute("class");
  const style = document.createElementNS(SVG_NS, "style");
  style.textContent = EXPORT_CSS;
  clone.insertBefore(style, clone.firstChild);

  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  try {
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Shown on exports that include the person's own drawings, so a shared image can't pass
// their markings off as Wire Room data.
export const ANNOTATION_NOTE = "Markings and notes are the author's own analysis, not Wire Room data.";

async function compose(img, { width, height, credits, annotated, now }) {
  const scale = 2; // sharp on phones and in documents
  const band = annotated ? 20 : 0;
  const header = 46 + band;
  const footer = 30;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round((height + header + footer) * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  ctx.fillStyle = "#071019";
  ctx.fillRect(0, 0, width, height + header + footer);
  ctx.drawImage(img, 0, header, width, height);

  // Header: brand on the left, time on the right.
  ctx.textBaseline = "middle";
  ctx.font = "800 20px Arial, sans-serif";
  ctx.fillStyle = "#e8e3d8";
  const row = (header - band) / 2;
  ctx.fillText("WIRE", 16, row);
  const wireW = ctx.measureText("WIRE ").width;
  ctx.fillStyle = "#c9974b";
  ctx.fillText("ROOM", 16 + wireW, row);
  ctx.font = "11px monospace";
  ctx.fillStyle = "#718198";
  ctx.textAlign = "right";
  const top = header - band; // the brand row
  ctx.fillText(humanUtc(now), width - 16, top / 2);
  ctx.textAlign = "left";
  ctx.strokeStyle = "#1c2a3b";
  ctx.lineWidth = 1;
  if (band) {
    ctx.fillStyle = "#0c1724";
    ctx.fillRect(0, top, width, band);
    ctx.font = "10px monospace";
    ctx.fillStyle = "#c9974b";
    ctx.fillText(fitText(ctx, ANNOTATION_NOTE, width - 32), 16, top + band / 2);
    ctx.beginPath(); ctx.moveTo(0, top - 0.5); ctx.lineTo(width, top - 0.5); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(0, header - 0.5); ctx.lineTo(width, header - 0.5); ctx.stroke();

  // Footer: where it was made, and the data credits the sources ask for.
  const fy = header + height;
  ctx.beginPath(); ctx.moveTo(0, fy + 0.5); ctx.lineTo(width, fy + 0.5); ctx.stroke();
  ctx.font = "10px monospace";
  ctx.fillStyle = "#c9974b";
  const made = `Made with Wire Room · ${SITE}`;
  ctx.fillText(made, 16, fy + footer / 2);
  if (credits.length) {
    const madeW = ctx.measureText(made).width;
    ctx.fillStyle = "#718198";
    ctx.textAlign = "right";
    ctx.fillText(fitText(ctx, credits.join(" · "), Math.max(0, width - madeW - 48)), width - 16, fy + footer / 2);
    ctx.textAlign = "left";
  }

  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create the image"))), "image/png")
  );
  return { blob, filename: `wire-room-map-${stamp(now)}.png` };
}

// Phones: open the share sheet (post it, message it, save it). Desktop: download the file.
export async function exportMapImage(mapEl, opts) {
  const { blob, filename } = await renderMapPng(mapEl, opts);
  const file = typeof File !== "undefined" ? new File([blob], filename, { type: "image/png" }) : null;
  const touch = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  if (touch && file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Wire Room map" });
      return "shared";
    } catch (e) {
      if (e && e.name === "AbortError") return "cancelled";
      // Share failed for another reason: fall back to a download below.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "downloaded";
}
