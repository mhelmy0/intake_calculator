/* ============================================================
   Minimal RFC-4180 CSV reader / writer (quotes, embedded commas/newlines, BOM).
   ============================================================ */
(function (RO) {
"use strict";

/** Parse CSV text into an array of row arrays. */
function parseRows(text) {
  text = String(text).replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", i = 0, q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim() !== ""));
}

/** Parse CSV with a header row into objects keyed by header name. */
function parseObjects(text) {
  const rows = parseRows(text);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const o = {};
    head.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    return o;
  });
}

function esc(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Build CSV text (with BOM so Excel opens UTF-8 correctly). */
function stringify(header, rows) {
  return "﻿" + [header, ...rows].map(r => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

/** Trigger a browser download of text content. */
function download(filename, text, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

RO.csv = { parseRows, parseObjects, stringify, download };
})(window.RO = window.RO || {});
