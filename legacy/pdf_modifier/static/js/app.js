(() => {
  "use strict";

  /** @typedef {{uid:string, sourceId:number, filename:string, page:number, rotation:number, thumbUrl:string, selected:boolean}} PageItem */

  /** @type {PageItem[]} */
  let pages = [];
  let uidCounter = 0;
  let sortable = null;
  let busy = false;

  const dropzone = document.getElementById("dropzone");
  const workspace = document.getElementById("workspace");
  const grid = document.getElementById("grid");
  const fileInput = document.getElementById("fileInput");
  const addFileInput = document.getElementById("addFileInput");
  const resetBtn = document.getElementById("resetBtn");
  const statusMsg = document.getElementById("statusMsg");
  const outputFilename = document.getElementById("outputFilename");

  function setStatus(msg, isError) {
    statusMsg.textContent = msg || "";
    statusMsg.classList.toggle("error", !!isError);
  }

  function setBusy(state) {
    busy = state;
    document.querySelectorAll(".btn").forEach((b) => (b.disabled = state));
  }

  async function uploadFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (!files.length) {
      setStatus("Please choose PDF files.", true);
      return;
    }
    const form = new FormData();
    files.forEach((f) => form.append("files", f));

    setBusy(true);
    setStatus("Uploading and rendering pages…");
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "Upload failed.", true);
        return;
      }
      for (const source of data.sources || []) {
        for (const p of source.pages) {
          pages.push({
            uid: `p${uidCounter++}`,
            sourceId: source.sourceId,
            filename: source.filename,
            page: p.page,
            rotation: 0,
            thumbUrl: p.thumbUrl,
            selected: false,
          });
        }
      }
      if (data.errors && data.errors.length) {
        setStatus(data.errors.join(" "), true);
      } else {
        setStatus(`Added ${files.length} file(s).`);
      }
      showWorkspace();
      renderGrid();
    } catch (err) {
      setStatus("Network error while uploading.", true);
    } finally {
      setBusy(false);
    }
  }

  function showWorkspace() {
    if (pages.length === 0) return;
    dropzone.hidden = true;
    workspace.hidden = false;
    resetBtn.hidden = false;
  }

  function iconRotateLeft() { return "⟲"; }
  function iconRotateRight() { return "⟳"; }

  function renderGrid() {
    grid.innerHTML = "";
    pages.forEach((item, index) => {
      const card = document.createElement("div");
      card.className = "page-card" + (item.selected ? " selected" : "");
      card.dataset.uid = item.uid;

      const thumbWrap = document.createElement("div");
      thumbWrap.className = "page-thumb-wrap rot-" + item.rotation;

      const img = document.createElement("img");
      img.src = item.thumbUrl;
      img.alt = `${item.filename} page ${item.page + 1}`;
      img.draggable = false;
      thumbWrap.appendChild(img);

      const indexBadge = document.createElement("span");
      indexBadge.className = "page-index";
      indexBadge.textContent = String(index + 1);
      thumbWrap.appendChild(indexBadge);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "page-select no-drag";
      checkbox.checked = item.selected;
      checkbox.addEventListener("change", () => {
        item.selected = checkbox.checked;
        card.classList.toggle("selected", item.selected);
      });
      thumbWrap.appendChild(checkbox);

      const controls = document.createElement("div");
      controls.className = "page-controls no-drag";

      const rotLeftBtn = document.createElement("button");
      rotLeftBtn.className = "icon-btn no-drag";
      rotLeftBtn.title = "Rotate left";
      rotLeftBtn.textContent = iconRotateLeft();
      rotLeftBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        item.rotation = (item.rotation + 270) % 360;
        renderGrid();
      });

      const rotRightBtn = document.createElement("button");
      rotRightBtn.className = "icon-btn no-drag";
      rotRightBtn.title = "Rotate right";
      rotRightBtn.textContent = iconRotateRight();
      rotRightBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        item.rotation = (item.rotation + 90) % 360;
        renderGrid();
      });

      const delBtn = document.createElement("button");
      delBtn.className = "icon-btn danger no-drag";
      delBtn.title = "Delete page";
      delBtn.textContent = "🗑";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        pages = pages.filter((p) => p.uid !== item.uid);
        renderGrid();
        if (pages.length === 0) {
          workspace.hidden = true;
          dropzone.hidden = false;
        }
      });

      controls.append(rotLeftBtn, rotRightBtn, delBtn);
      thumbWrap.appendChild(controls);

      const meta = document.createElement("div");
      meta.className = "page-meta";
      meta.textContent = `${item.filename} · p.${item.page + 1}`;

      card.appendChild(thumbWrap);
      card.appendChild(meta);
      grid.appendChild(card);
    });

    if (sortable) {
      sortable.destroy();
      sortable = null;
    }
    sortable = new Sortable(grid, {
      animation: 150,
      filter: ".no-drag",
      preventOnFilter: false,
      onEnd: syncOrderFromDom,
    });
  }

  function syncOrderFromDom() {
    const order = Array.from(grid.children).map((el) => el.dataset.uid);
    const byUid = new Map(pages.map((p) => [p.uid, p]));
    pages = order.map((uid) => byUid.get(uid));
    renderGrid();
  }

  function selectAll(state) {
    pages.forEach((p) => (p.selected = state));
    renderGrid();
  }

  function rotateSelected(delta) {
    const targets = pages.filter((p) => p.selected);
    if (!targets.length) {
      setStatus("Select one or more pages first.", true);
      return;
    }
    targets.forEach((p) => (p.rotation = (p.rotation + delta + 360) % 360));
    renderGrid();
  }

  function deleteSelected() {
    const before = pages.length;
    pages = pages.filter((p) => !p.selected);
    if (pages.length === before) {
      setStatus("Select one or more pages first.", true);
      return;
    }
    renderGrid();
    if (pages.length === 0) {
      workspace.hidden = true;
      dropzone.hidden = false;
    }
  }

  function ensureFilename(defaultName) {
    let name = (outputFilename.value || "").trim() || defaultName;
    if (!name.toLowerCase().endsWith(".pdf")) name += ".pdf";
    return name;
  }

  async function downloadBlob(url, body, downloadNameFallback) {
    setBusy(true);
    setStatus("Building your file…");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatus(data.error || "Something went wrong.", true);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const name = match ? match[1] : downloadNameFallback;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      setStatus("Done.");
    } catch (err) {
      setStatus("Network error while building the file.", true);
    } finally {
      setBusy(false);
    }
  }

  function itemsPayload(list) {
    return list.map((p) => ({ sourceId: p.sourceId, page: p.page, rotation: p.rotation }));
  }

  document.getElementById("fileInput").addEventListener("change", (e) => uploadFiles(e.target.files));
  document.getElementById("addFileInput").addEventListener("change", (e) => {
    uploadFiles(e.target.files);
    e.target.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("drag-over");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag-over");
    })
  );
  dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  document.getElementById("selectAllBtn").addEventListener("click", () => selectAll(true));
  document.getElementById("selectNoneBtn").addEventListener("click", () => selectAll(false));
  document.getElementById("rotateLeftBtn").addEventListener("click", () => rotateSelected(270));
  document.getElementById("rotateRightBtn").addEventListener("click", () => rotateSelected(90));
  document.getElementById("deleteSelectedBtn").addEventListener("click", deleteSelected);

  document.getElementById("downloadBtn").addEventListener("click", () => {
    if (busy) return;
    if (!pages.length) return setStatus("Add some pages first.", true);
    downloadBlob("/api/build", { items: itemsPayload(pages), filename: ensureFilename("merged.pdf") }, "merged.pdf");
  });

  document.getElementById("extractBtn").addEventListener("click", () => {
    if (busy) return;
    const selected = pages.filter((p) => p.selected);
    if (!selected.length) return setStatus("Select the pages you want to extract.", true);
    downloadBlob("/api/build", { items: itemsPayload(selected), filename: ensureFilename("extracted.pdf") }, "extracted.pdf");
  });

  document.getElementById("splitZipBtn").addEventListener("click", () => {
    if (busy) return;
    const list = pages.some((p) => p.selected) ? pages.filter((p) => p.selected) : pages;
    if (!list.length) return setStatus("Add some pages first.", true);
    const base = ensureFilename("page").replace(/\.pdf$/i, "");
    downloadBlob("/api/split-zip", { items: itemsPayload(list), baseName: base }, `${base}_pages.zip`);
  });

  resetBtn.addEventListener("click", async () => {
    if (busy) return;
    if (!confirm("Clear all uploaded files and start over?")) return;
    setBusy(true);
    try {
      await fetch("/api/reset", { method: "POST" });
    } catch (err) {
      /* ignore */
    }
    pages = [];
    renderGrid();
    workspace.hidden = true;
    dropzone.hidden = false;
    resetBtn.hidden = true;
    setStatus("");
    setBusy(false);
  });
})();
