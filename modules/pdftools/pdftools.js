/* ============================================================
   Module: PDF toolkit (Tools › PDF toolkit) — browser port of
   legacy/pdf_modifier (Flask + PyMuPDF). Everything runs in the browser:
   files never leave the user's computer; works for guests and offline.
     · add PDFs (choose or drop) → page thumbnails (pdf.js)
     · reorder by drag and drop, rotate, delete, select
     · download all pages as one PDF, extract selected, split to pages (.zip)
   Libraries are bundled in assets/vendor (pdf-lib 1.17.1, pdf.js 3.11.174)
   and loaded only when this page is first opened.
   Security: pdf.js documents are opened with isEvalSupported: false
   (mitigation for CVE-2024-4367 in pdf.js < 4.2.67).
   ============================================================ */
(function (RO) {
"use strict";

const { escHtml: esc } = RO.util;
const THUMB_WIDTH = 260;
const MAX_PAGES_PER_FILE = 800;          // as the legacy app
const MAX_FILE_MB = 300;

let ROOT = null, META = null, ACTIONS = null;
let libs = null;                          // Promise of { PDFLib, pdfjsLib }
let sources = [];                         // { id, name, bytes (Uint8Array), pageCount }
let pages = [];                           // { uid, src, page, rotation, thumb (object URL), w, h, selected }
let uid = 0, srcId = 0, busy = false, dragUid = null;

/* ---------- lazy library loading ---------- */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("Could not load " + src));
    document.head.appendChild(s);
  });
}
function ensureLibs() {
  if (!libs) {
    libs = (async () => {
      if (!window.PDFLib) await loadScript("assets/vendor/pdf-lib/pdf-lib.min.js");
      if (!window.pdfjsLib) await loadScript("assets/vendor/pdfjs/pdf.min.js");
      // Web workers cannot start from file:// — load the worker in the page instead (pdf.js "fake worker").
      if (location.protocol === "file:") { if (!window.pdfjsWorker) await loadScript("assets/vendor/pdfjs/pdf.worker.min.js"); }
      else window.pdfjsLib.GlobalWorkerOptions.workerSrc = "assets/vendor/pdfjs/pdf.worker.min.js";
      return { PDFLib: window.PDFLib, pdfjsLib: window.pdfjsLib };
    })();
    libs.catch(() => { libs = null; });
  }
  return libs;
}

/* ---------- status / busy ---------- */
function status(msg, kind) {
  const el = ROOT && ROOT.querySelector("#pdf-status");
  if (el) { el.textContent = msg || ""; el.className = "pdf-status" + (kind ? " " + kind : ""); }
}
function setBusy(b) { busy = b; if (ROOT) ROOT.querySelectorAll("[data-act], .pdf-add input").forEach(x => { x.disabled = b; }); }

/* ---------- add files ---------- */
async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const pdfs = files.filter(f => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  const errors = files.filter(f => !pdfs.includes(f)).map(f => `${f.name}: not a PDF file.`);
  if (!pdfs.length) { status(errors.join(" ") || "Please choose PDF files.", "error"); return; }
  setBusy(true);
  let added = 0;
  try {
    const { PDFLib, pdfjsLib } = await ensureLibs();
    for (const f of pdfs) {
      if (f.size > MAX_FILE_MB * 1024 * 1024) { errors.push(`${f.name}: larger than ${MAX_FILE_MB} MB.`); continue; }
      status(`Reading ${f.name}…`);
      const bytes = new Uint8Array(await f.arrayBuffer());
      let doc;
      try { doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false }); }
      catch (e) { errors.push(`${f.name}: ${/encrypt/i.test(e && e.message) ? "password-protected PDFs are not supported" : "could not be read (corrupt or password-protected)"}.`); continue; }
      const n = doc.getPageCount();
      if (n === 0) { errors.push(`${f.name}: contains no pages.`); continue; }
      if (n > MAX_PAGES_PER_FILE) { errors.push(`${f.name}: exceeds the ${MAX_PAGES_PER_FILE} page limit.`); continue; }
      const src = { id: srcId++, name: f.name, bytes, pageCount: n };
      let pdf;
      try { pdf = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise; }
      catch (e) { errors.push(`${f.name}: pages could not be rendered.`); continue; }
      sources.push(src);
      for (let i = 0; i < n; i++) {
        status(`Rendering ${f.name} — page ${i + 1} of ${n}…`);
        const pg = await pdf.getPage(i + 1);
        const v1 = pg.getViewport({ scale: 1, rotation: 0 });
        const vp = pg.getViewport({ scale: THUMB_WIDTH / v1.width, rotation: 0 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        await pg.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
        pages.push({ uid: "p" + (uid++), src: src.id, page: i, rotation: 0, base: pg.rotate || 0, thumb: URL.createObjectURL(blob), w: canvas.width, h: canvas.height, selected: false });
        pg.cleanup();
      }
      await pdf.destroy();
      added++;
    }
    status(errors.length ? errors.join(" ") : `Added ${added} file${added === 1 ? "" : "s"}.`, errors.length ? "error" : "ok");
  } catch (e) {
    status("The PDF libraries could not be loaded: " + (e.message || e), "error");
  } finally {
    setBusy(false);
    render();
  }
}

/* ---------- build output (pdf-lib) ---------- */
async function buildPdf(list) {
  const { PDFLib } = await ensureLibs();
  const out = await PDFLib.PDFDocument.create();
  const loaded = {};
  for (const p of list) {
    const src = sources.find(s => s.id === p.src);
    if (!loaded[src.id]) loaded[src.id] = await PDFLib.PDFDocument.load(src.bytes, { updateMetadata: false });
    const [cp] = await out.copyPages(loaded[src.id], [p.page]);
    const page = out.addPage(cp);
    page.setRotation(PDFLib.degrees(((page.getRotation().angle || 0) + p.rotation) % 360));
  }
  return out.save({ useObjectStreams: true });
}

/* ---------- minimal ZIP writer (stored entries; PDFs are already compressed) ---------- */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
/** entries: [{ name, data: Uint8Array }] → Uint8Array of a .zip file */
function zip(entries) {
  const enc = new TextEncoder(), chunks = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  entries.forEach(e => {
    const name = enc.encode(e.name), crc = crc32(e.data), size = e.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, e.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  });
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = chunks.concat(central, [new Uint8Array(end.buffer)]);
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0; all.forEach(c => { out.set(c, p); p += c.length; });
  return out;
}

function saveBlob(name, data, mime) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const safeName = (s, def) => ((s || "").trim().replace(/[\\/:*?"<>|]+/g, "_") || def);
function outName(def) { let n = safeName(ROOT.querySelector("#pdf-name").value, def); if (!/\.pdf$/i.test(n)) n += ".pdf"; return n; }

async function run(kind) {
  if (busy) return;
  const sel = pages.filter(p => p.selected);
  let list = pages;
  if (kind === "extract") { if (!sel.length) { status("Select the pages you want to extract.", "error"); return; } list = sel; }
  if (kind === "split" && sel.length) list = sel;
  if (!list.length) { status("Add some pages first.", "error"); return; }
  setBusy(true); status("Building your file…");
  try {
    if (kind === "split") {
      const base = outName("page").replace(/\.pdf$/i, "");
      const entries = [];
      for (let i = 0; i < list.length; i++) { status(`Building page ${i + 1} of ${list.length}…`); entries.push({ name: `${base}_${String(i + 1).padStart(3, "0")}.pdf`, data: await buildPdf([list[i]]) }); }
      saveBlob(`${base}_pages.zip`, zip(entries), "application/zip");
    } else {
      saveBlob(outName(kind === "extract" ? "extracted.pdf" : "merged.pdf"), await buildPdf(list), "application/pdf");
    }
    status("Done.", "ok");
  } catch (e) {
    status("Something went wrong: " + (e.message || e), "error");
  } finally { setBusy(false); }
}

/* ---------- page grid ---------- */
function render() {
  if (!ROOT) return;
  const has = pages.length > 0;
  ROOT.querySelector("#pdf-drop").hidden = has;
  ROOT.querySelector("#pdf-work").hidden = !has;
  ACTIONS.querySelector('[data-act="clear"]').hidden = !has;
  const nSel = pages.filter(p => p.selected).length;
  META.textContent = has ? `${pages.length} page${pages.length === 1 ? "" : "s"} from ${new Set(pages.map(p => p.src)).size} file${sources.length === 1 ? "" : "s"}${nSel ? ` · ${nSel} selected` : ""} · processed in your browser — nothing is uploaded`
    : "Merge, reorder, rotate, extract and split PDFs — processed in your browser, nothing is uploaded";
  const src = id => sources.find(s => s.id === id) || { name: "?" };
  ROOT.querySelector("#pdf-grid").innerHTML = pages.map((p, i) => `
    <div class="pdf-card${p.selected ? " selected" : ""}" draggable="true" data-uid="${p.uid}">
      <div class="pdf-thumb"><img src="${p.thumb}" alt="${esc(src(p.src).name)} page ${p.page + 1}" draggable="false" style="transform:rotate(${p.rotation}deg)${p.rotation % 180 ? `;max-width:${Math.min(100, 100 * p.h / p.w).toFixed(0)}%` : ""}">
        <span class="pdf-index">${i + 1}</span>
        <input type="checkbox" class="pdf-select" data-sel="${p.uid}"${p.selected ? " checked" : ""} aria-label="Select page ${i + 1}">
        <div class="pdf-controls"><button class="icon-btn" data-pact="left" data-uid="${p.uid}" title="Rotate left">⟲</button><button class="icon-btn" data-pact="right" data-uid="${p.uid}" title="Rotate right">⟳</button><button class="icon-btn del" data-pact="del" data-uid="${p.uid}" title="Delete page">×</button></div></div>
      <div class="pdf-meta" title="${esc(src(p.src).name)}">${esc(src(p.src).name)} · p.${p.page + 1}${p.rotation ? ` · ${p.rotation}°` : ""}</div>
    </div>`).join("");
}

function clearAll() {
  pages.forEach(p => URL.revokeObjectURL(p.thumb));
  pages = []; sources = [];
  status(""); render();
}

/* ---------- events ---------- */
function onClick(e) {
  const b = e.target.closest("[data-act], [data-pact]");
  if (!b || busy) return;
  if (b.dataset.pact) {
    const p = pages.find(x => x.uid === b.dataset.uid);
    if (b.dataset.pact === "left") p.rotation = (p.rotation + 270) % 360;
    if (b.dataset.pact === "right") p.rotation = (p.rotation + 90) % 360;
    if (b.dataset.pact === "del") pages = pages.filter(x => x !== p);
    render(); return;
  }
  const a = b.dataset.act, sel = pages.filter(p => p.selected);
  if (a === "all" || a === "none") pages.forEach(p => { p.selected = a === "all"; });
  if (a === "rotl" || a === "rotr") { if (!sel.length) { status("Select one or more pages first.", "error"); return; } sel.forEach(p => { p.rotation = (p.rotation + (a === "rotl" ? 270 : 90)) % 360; }); }
  if (a === "delsel") { if (!sel.length) { status("Select one or more pages first.", "error"); return; } pages = pages.filter(p => !p.selected); }
  if (a === "merge") { run("merge"); return; }
  if (a === "extract") { run("extract"); return; }
  if (a === "split") { run("split"); return; }
  if (a === "clear") { RO.ui.confirm("Clear all", "Remove all files and pages and start over?", "Clear all", true).then(ok => { if (ok) clearAll(); }); return; }
  render();
}
function onChange(e) {
  const el = e.target;
  if (el.dataset.sel) { const p = pages.find(x => x.uid === el.dataset.sel); p.selected = el.checked; render(); return; }
  if (el.type === "file") { addFiles(el.files); el.value = ""; }
}
function onDragStart(e) { const c = e.target.closest(".pdf-card"); if (!c) return; dragUid = c.dataset.uid; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragUid); }
function onDragOver(e) {
  if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files")) { e.preventDefault(); ROOT.querySelector(".pdf-droparea").classList.add("over"); return; }
  const c = e.target.closest(".pdf-card");
  if (!dragUid || !c || c.dataset.uid === dragUid) return;
  e.preventDefault();
  const r = c.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2;
  const from = pages.findIndex(p => p.uid === dragUid);
  const [moved] = pages.splice(from, 1);
  let to = pages.findIndex(p => p.uid === c.dataset.uid) + (after ? 1 : 0);
  pages.splice(to, 0, moved);
  render();
  const d = ROOT.querySelector(`.pdf-card[data-uid="${dragUid}"]`); if (d) d.classList.add("dragging");
}
function onDrop(e) {
  ROOT.querySelector(".pdf-droparea").classList.remove("over");
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); }
}
function onDragEnd() { dragUid = null; render(); }

/** Move a page (keyboard / tests): from index → to index. */
function move(from, to) { const [m] = pages.splice(from, 1); pages.splice(to, 0, m); render(); }

RO.registerModule({
  id: "pdftools",
  title: "PDF toolkit",
  pageTitle: () => "PDF toolkit",
  mount(ctx) {
    ROOT = ctx.root; META = ctx.meta; ACTIONS = ctx.actions;
    ROOT.classList.remove("mod-layout"); ROOT.classList.add("mod-scroll");
    ROOT.innerHTML = `<div class="in-page pdf-page">
      <section class="blueprint in-sec pdf-droparea" id="pdf-drop"><i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <div class="pdf-drop-inner"><h2>Merge, organize &amp; split PDFs</h2>
          <p class="dim">Drop PDF files here or choose them. Pages are read and built in your browser — nothing is uploaded to the server.</p>
          <label class="btn btn-primary pdf-add">Choose PDF files<input type="file" accept="application/pdf,.pdf" multiple hidden></label></div></section>
      <div id="pdf-work" hidden>
        <div class="pdf-toolbar">
          <label class="btn btn-secondary btn-sm pdf-add">+ Add files<input type="file" accept="application/pdf,.pdf" multiple hidden></label>
          <button class="btn btn-secondary btn-sm" data-act="all">Select all</button><button class="btn btn-secondary btn-sm" data-act="none">Deselect</button>
          <span class="spacer"></span>
          <button class="btn btn-secondary btn-sm" data-act="rotl" title="Rotate selected left">⟲ Rotate</button><button class="btn btn-secondary btn-sm" data-act="rotr" title="Rotate selected right">⟳ Rotate</button>
          <button class="btn btn-secondary btn-sm" data-act="delsel">Delete selected</button></div>
        <div class="pdf-grid pdf-droparea" id="pdf-grid"></div>
        <div class="pdf-output"><input class="input" id="pdf-name" value="merged.pdf" spellcheck="false" aria-label="Output file name">
          <button class="btn btn-secondary" data-act="extract">Extract selected</button>
          <button class="btn btn-secondary" data-act="split">Split to pages (.zip)</button>
          <button class="btn btn-primary" data-act="merge">Download PDF</button></div>
      </div>
      <p class="pdf-status" id="pdf-status" role="status"></p></div>`;
    ACTIONS.innerHTML = `<button class="btn btn-secondary" data-act="clear" hidden>Clear all</button>`;
    ROOT.addEventListener("click", onClick); ACTIONS.addEventListener("click", onClick);
    ROOT.addEventListener("change", onChange);
    ROOT.addEventListener("dragstart", onDragStart); ROOT.addEventListener("dragover", onDragOver);
    ROOT.addEventListener("drop", onDrop); ROOT.addEventListener("dragend", onDragEnd);
    ROOT.addEventListener("dragleave", e => { if (e.target.classList && e.target.classList.contains("pdf-droparea")) e.target.classList.remove("over"); });
    render();
  },
  onShow() { ensureLibs().catch(e => status("The PDF libraries could not be loaded: " + e.message, "error")); render(); },
  reset() { clearAll(); },
  // for tests / other modules
  api: { addFiles, buildPdf, zip, crc32, move, run, pages: () => pages, sources: () => sources, ensureLibs }
});
})(window.RO = window.RO || {});
