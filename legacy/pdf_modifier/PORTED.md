# pdf_modifier — ported

This Flask + PyMuPDF app has been merged into RO Workbench as **Tools › PDF toolkit** (`modules/pdftools/`).
The port runs entirely in the browser (pdf-lib + pdf.js, bundled in `assets/vendor/`), so no Python server is needed.

Kept here for reference only. Do not expose `app.py` on a network: it runs with `debug=True` (Werkzeug debugger).
`venv/`, `.secret_key`, `workspace/` and `server.log` are git-ignored (see `.gitignore`).

Feature map: upload → Add files / drop · thumbnails → pdf.js · reorder (Sortable) → native drag & drop ·
rotate / delete / select → same · Download PDF (/api/build) → pdf-lib · Extract selected → pdf-lib ·
Split to pages .zip (/api/split-zip) → pdf-lib + built-in ZIP writer · Clear all (/api/reset) → Clear all.
