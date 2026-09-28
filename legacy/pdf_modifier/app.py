import io
import json
import os
import shutil
import time
import uuid
import zipfile
from pathlib import Path
from threading import Lock

import pymupdf
from flask import (
    Flask,
    abort,
    jsonify,
    request,
    send_file,
    session,
    render_template,
)
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
WORKSPACE_DIR = BASE_DIR / "workspace"
WORKSPACE_DIR.mkdir(exist_ok=True)

SECRET_KEY_FILE = BASE_DIR / ".secret_key"
if SECRET_KEY_FILE.exists():
    SECRET_KEY = SECRET_KEY_FILE.read_bytes()
else:
    SECRET_KEY = os.urandom(32)
    SECRET_KEY_FILE.write_bytes(SECRET_KEY)

app = Flask(__name__)
app.secret_key = SECRET_KEY
app.config["MAX_CONTENT_LENGTH"] = 300 * 1024 * 1024  # 300 MB per request

THUMB_WIDTH = 260
MAX_PAGES_PER_UPLOAD = 800
SESSION_TTL_SECONDS = 24 * 3600

# In-memory registry of sources per session. Rebuildable from disk if the
# process restarts, but for a local single-user tool this is sufficient.
# session_id -> { "sources": { source_id: {"filename": str, "path": str, "page_count": int} },
#                  "next_id": int, "touched": float }
SESSIONS = {}
SESSIONS_LOCK = Lock()


def get_session_id():
    sid = session.get("sid")
    if not sid:
        sid = uuid.uuid4().hex
        session["sid"] = sid
    return sid


def get_session_dir(sid):
    d = WORKSPACE_DIR / sid
    (d / "sources").mkdir(parents=True, exist_ok=True)
    (d / "thumbs").mkdir(parents=True, exist_ok=True)
    return d


def get_session_state(sid):
    with SESSIONS_LOCK:
        state = SESSIONS.get(sid)
        if state is None:
            state = {"sources": {}, "next_id": 0, "touched": time.time()}
            SESSIONS[sid] = state
        state["touched"] = time.time()
        return state


def cleanup_old_sessions():
    now = time.time()
    with SESSIONS_LOCK:
        stale = [sid for sid, st in SESSIONS.items() if now - st["touched"] > SESSION_TTL_SECONDS]
        for sid in stale:
            SESSIONS.pop(sid, None)
    if not WORKSPACE_DIR.exists():
        return
    for child in WORKSPACE_DIR.iterdir():
        try:
            if child.is_dir() and now - child.stat().st_mtime > SESSION_TTL_SECONDS:
                shutil.rmtree(child, ignore_errors=True)
        except OSError:
            pass


@app.route("/")
def index():
    cleanup_old_sessions()
    get_session_id()
    return render_template("index.html")


@app.route("/api/upload", methods=["POST"])
def api_upload():
    sid = get_session_id()
    session_dir = get_session_dir(sid)
    state = get_session_state(sid)

    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files received."}), 400

    results = []
    errors = []

    for f in files:
        original_name = secure_filename(f.filename or "document.pdf") or "document.pdf"
        if not original_name.lower().endswith(".pdf"):
            errors.append(f"{original_name}: not a PDF file.")
            continue

        raw = f.read()
        try:
            doc = pymupdf.open(stream=raw, filetype="pdf")
        except Exception:
            errors.append(f"{original_name}: could not be read (corrupt or password-protected).")
            continue

        if doc.needs_pass:
            doc.close()
            errors.append(f"{original_name}: password-protected PDFs are not supported.")
            continue

        page_count = doc.page_count
        if page_count == 0:
            doc.close()
            errors.append(f"{original_name}: contains no pages.")
            continue
        if page_count > MAX_PAGES_PER_UPLOAD:
            doc.close()
            errors.append(f"{original_name}: exceeds the {MAX_PAGES_PER_UPLOAD} page limit.")
            continue

        source_id = state["next_id"]
        state["next_id"] += 1

        source_path = session_dir / "sources" / f"{source_id}.pdf"
        source_path.write_bytes(raw)

        pages = []
        for page_index in range(page_count):
            page = doc.load_page(page_index)
            rect = page.rect
            scale = THUMB_WIDTH / rect.width if rect.width else 1
            matrix = pymupdf.Matrix(scale, scale)
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            thumb_name = f"{source_id}_{page_index}.png"
            pix.save(str(session_dir / "thumbs" / thumb_name))
            pages.append(
                {
                    "page": page_index,
                    "thumbUrl": f"/workspace/{sid}/thumbs/{thumb_name}",
                    "width": pix.width,
                    "height": pix.height,
                    "rotation": page.rotation,
                }
            )

        doc.close()
        state["sources"][source_id] = {
            "filename": original_name,
            "path": str(source_path),
            "page_count": page_count,
        }
        results.append({"sourceId": source_id, "filename": original_name, "pages": pages})

    if not results and errors:
        return jsonify({"error": " ".join(errors)}), 400

    return jsonify({"sources": results, "errors": errors})


@app.route("/workspace/<sid>/thumbs/<name>")
def serve_thumb(sid, name):
    if sid != session.get("sid"):
        abort(403)
    safe_name = secure_filename(name)
    path = WORKSPACE_DIR / sid / "thumbs" / safe_name
    if not path.exists():
        abort(404)
    return send_file(path, mimetype="image/png")


def _resolve_items(sid, items):
    """Validate client-supplied page references against the session's sources."""
    state = get_session_state(sid)
    resolved = []
    for item in items:
        try:
            source_id = int(item["sourceId"])
            page = int(item["page"])
            rotation = int(item.get("rotation", 0)) % 360
        except (KeyError, TypeError, ValueError):
            continue
        source = state["sources"].get(source_id)
        if not source:
            continue
        if page < 0 or page >= source["page_count"]:
            continue
        resolved.append({"source": source, "page": page, "rotation": rotation})
    return resolved


@app.route("/api/build", methods=["POST"])
def api_build():
    sid = get_session_id()
    payload = request.get_json(silent=True) or {}
    items = payload.get("items") or []
    filename = secure_filename(payload.get("filename") or "document.pdf") or "document.pdf"
    if not filename.lower().endswith(".pdf"):
        filename += ".pdf"

    resolved = _resolve_items(sid, items)
    if not resolved:
        return jsonify({"error": "No valid pages selected."}), 400

    open_docs = {}
    out_doc = pymupdf.open()
    try:
        for entry in resolved:
            path = entry["source"]["path"]
            if path not in open_docs:
                open_docs[path] = pymupdf.open(path)
            src_doc = open_docs[path]
            out_doc.insert_pdf(src_doc, from_page=entry["page"], to_page=entry["page"])
            new_page = out_doc[-1]
            base_rotation = new_page.rotation
            new_page.set_rotation((base_rotation + entry["rotation"]) % 360)

        buffer = io.BytesIO(out_doc.tobytes(garbage=4, deflate=True))
    finally:
        out_doc.close()
        for d in open_docs.values():
            d.close()

    buffer.seek(0)
    return send_file(
        buffer,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )


@app.route("/api/split-zip", methods=["POST"])
def api_split_zip():
    sid = get_session_id()
    payload = request.get_json(silent=True) or {}
    items = payload.get("items") or []
    base_name = secure_filename(payload.get("baseName") or "page") or "page"

    resolved = _resolve_items(sid, items)
    if not resolved:
        return jsonify({"error": "No valid pages selected."}), 400

    open_docs = {}
    zip_buffer = io.BytesIO()
    try:
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for idx, entry in enumerate(resolved, start=1):
                path = entry["source"]["path"]
                if path not in open_docs:
                    open_docs[path] = pymupdf.open(path)
                src_doc = open_docs[path]

                single = pymupdf.open()
                single.insert_pdf(src_doc, from_page=entry["page"], to_page=entry["page"])
                page = single[-1]
                page.set_rotation((page.rotation + entry["rotation"]) % 360)
                data = single.tobytes(garbage=4, deflate=True)
                single.close()

                zf.writestr(f"{base_name}_{idx:03d}.pdf", data)
    finally:
        for d in open_docs.values():
            d.close()

    zip_buffer.seek(0)
    return send_file(
        zip_buffer,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"{base_name}_pages.zip",
    )


@app.route("/api/reset", methods=["POST"])
def api_reset():
    sid = get_session_id()
    with SESSIONS_LOCK:
        SESSIONS.pop(sid, None)
    session_dir = WORKSPACE_DIR / sid
    if session_dir.exists():
        shutil.rmtree(session_dir, ignore_errors=True)
    session.pop("sid", None)
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(debug=True, port=5050)
