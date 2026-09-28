# RO Workbench

A modular web app for RO plant work — design calculations today; inspection, commissioning, operations, maintenance and automation on the roadmap.

- **Specification:** [Pipeline Hydraulics Module — PRD.md](Pipeline%20Hydraulics%20Module%20—%20PRD.md)
- **Equations and sources:** [equations.md](equations.md)
- **UI design source:** [design/](design/) (Claude Design "RO Shell", round 1)

## Shell (from the Claude Design prototype)

- **Navigation:**
  - Icon rail (collapsed, default) or grouped sidebar (expanded); a drawer below 1100 px.
  - "Show roadmap" reveals planned pages as **Soon**.
- **Top bar:**
  - Project / plant / train switcher (standalone until project profiles exist).
  - **Ctrl K** command palette.
  - **SI / Imperial** units.
  - Online / offline status, guest tag.
  - Alerts: approvals waiting / your drafts.
  - Account menu.
- **Page header:** breadcrumb, title, actions (Save on this device · Submit for approval · Import · Export · Reset · Print), and page tabs.

| Area › page | Route |
| --- | --- |
| Home › Dashboard | `#/home` |
| Design › Intake — Pump sizing · Gravity line · Pump selection · Surge & class · Calculation steps | `#/intake/sizing` … `#/intake/steps` |
| Design › Pretreatment — Overview (train) · Chemical dosing · DAF · Sedimentation · Media filters · Bag filters · Cartridge filters · Calculation steps | `#/pretreat/overview` … |
| Design › Supports & buoyancy — Sections · Calculation steps | `#/buoyancy/sections`, `#/buoyancy/steps` |
| Design › Bill of materials | `#/bom` |
| Libraries › Fittings · Pumps · Equipment · Recommended values | `#/libraries/fittings` … |
| Tools › Line velocity · Fluid properties | `#/tools/velocity`, `#/tools/fluid` |
| Tools › PDF toolkit | `#/pdftools` |
| Tools › Pipeline design — Profile · Segments & fittings · Hydraulics · Pressures & valves · Surge & class · Diameter comparison · Calculation steps | `#/pipeline/profile` … `#/pipeline/steps` |
| Admin › Users & roles (admin) | `#/libraries/users` |
| Roadmap pages | `#/soon/<id>` |

**Pipeline design** (PRD §8A, equations.md §5A): any single line along a surveyed profile. Paste the profile from Excel or import a CSV (template on the page); pipe level = ground − cover − OD/2 unless typed. Pumped mode gives the required inlet pressure / pump TDH, gravity mode the capacity and margin. Air valves and drains are flagged at high / low points unless the line is marked *Submerged*. **Send to Intake** copies the line into the Intake gravity line or discharge main (pump-local piping kept) with its profile.

**PDF toolkit** (browser port of `legacy/pdf_modifier`): merge PDFs, reorder pages by drag and drop, rotate, delete, extract the selected pages, and split to single pages (.zip).
- Files are read and built **in the browser** with pdf-lib 1.17.1 and pdf.js 3.11.174, bundled in `assets/vendor/` (MIT / Apache-2.0) and loaded on first use. Nothing is uploaded and no Python is needed; it works for guests and offline.
- pdf.js runs with `isEvalSupported: false` (mitigation for CVE-2024-4367).

**Pretreatment** ([Pretreatment Module — PRD.md](Pretreatment%20Module%20—%20PRD.md), equations.md §11): a train builder (include / remove / order steps) with one page per unit, flows typed per unit.
- **Chemical dosing:** storage days per site requirement / SDS.
- **DAF:** on the net flow, with recovery and recycle.
- **Sedimentation:** conventional or lamella.
- **Media filters:** N−1 rule, L/dₑ bed depth, backwash.
- **Bag and cartridge filters:** sized from **Libraries › Equipment**, the vendor / consultant list with draft → approved entries, CSV import and generic placeholders.

**Supports & buoyancy** (equations.md §9, §9.5): concrete blocks per pipe section against the air-filled uplift (PPI Handbook Ch. 10). The criterion is method A, submerged ballast ÷ net uplift ≥ 1.5 (recommended); method B is shown alongside. Each section shows the block mass needed for the target and the largest spacing. Sections can be imported from the Intake gravity line or the Pipeline design line.

**Bill of materials** (equations.md §9B): pipes (net, + allowance, 12 m lengths), fittings, joints, stub ends / gaskets / bolt sets (DN / PN), concrete blocks and pumps, from the Intake route, Supports & buoyancy and (opt-in) the Pipeline design line. It downloads as CSV.

**Intake page pattern:**
- Numbered blueprint sections on the left and a sticky results column on the right (KPI strip, chart, result rows, OK / CHECK / NOTE checks).
- Fields with a recommended value show **REC** when blank; typing overrides it, clearing returns to it.

## Running

- **Web:** `http://localhost/intake_calculator/` (WAMP). Also works offline from `file://` as a guest with the bundled defaults.
- **Database:** PostgreSQL 18 (scoop, per-user). Start it with `db\pg_start.cmd` after a reboot.
- **PHP:** WAMP PHP 8.3 with `extension=pdo_pgsql` enabled (in `php.ini` and `phpForApache.ini`). Restart WAMP after enabling it.
- **Setup / updates:** `db\migrate.cmd` applies migrations and seeds recommended values plus the fittings list. It runs WAMP's PHP (`C:\wamp64\bin\php\php8.3.28\php.exe`), which is not on PATH.
- **Admin:**
  - `db\migrate.cmd --create-admin=NAME` creates an admin.
  - `db\migrate.cmd --reset-password=NAME` issues a new one-time password.
- **Config:** `config/config.local.php` (git-ignored; copy `config/config.sample.php`). `ROCALC_CONFIG=<file>` points the API and CLI at another config, e.g. a test database.

### Access (PRD §9.1)

| Role | Can do |
| --- | --- |
| Guest | Every calculator; export; drafts on this device; session-only pumps / fittings lists |
| Viewer | As guest, signed in |
| Engineer | Save draft pumps and fittings lists |
| Approver | Approve library data; choose the recommended fittings list; edit recommended values |
| Admin | Create users and assign roles (no self-registration) |

## Layout

```
index.html                  shell markup (rail, sidebar, top bar, banners, page header, popovers)
design/                     Claude Design source (RO Shell.dc.html)
api/  config/  db/          PHP JSON API, config, migrations + seed + helpers
assets/css/industry.css     design-system tokens + components (vendored from the design project)
assets/css/app.css          shell + shared components mapped onto the design system
assets/data/fittings/       recommended fittings CSV (source of truth), import template, bundled JS copy
assets/js/core/
  util · units · hydraulics · pipes · fluids                equations, catalogues, SI/Imperial
  csv · api · values · fittings · pumplib · alerts          data access (server with offline fallback)
  pipeclass · route · pumpcurve                             class check, route engine, pump curves
  svgchart · ui · authui · fluidui · nav · app              charts, widgets, sign-in, nav map, shell
modules/home, intake, pipeline, buoyancy, bom, pretreat (*_calc.js = calculations, *.js = pages), libraries, tools
legacy/                     original intake page (regression baseline), buoyancy Python apps, v1 pipeline module, pdf_modifier (Flask original of the PDF toolkit)
assets/vendor/              pdf-lib, pdf.js (pinned, with licences)
tests/                      engine_test.html, ui_test.html, api_test.py
```

## Tests

| Test | How to run | Checks |
| --- | --- | --- |
| `tests/engine_test.html` | open in a browser (file:// is fine) | 137: equations, K rules, pump fit, sizing, units, pipeline profile / HGL / capacity / parsing, buoyancy (incl. the legacy re-run case), BOM counting, pretreatment (DAF, settling, media / L/dₑ, bag, cartridge, dosing), **regression vs `legacy/intake_calc_original.html`** |
| `tests/ui_test.html` | serve over HTTP (`php -S 127.0.0.1:8099 -t .`) and open `/tests/ui_test.html` | 94: shell, Intake, Pipeline design, Supports & buoyancy, BOM, Pretreatment, Equipment and PDF toolkit flows (REC, units, paste, send to Intake, block sizing, sources, palette, drawer, drafts, …) |
| `tests/api_test.py` | against a **test database** (see its header) | 69: auth, roles, CSRF, throttling, imports, approvals, pumps, equipment list |

## Adding a page

1. Add the page to `assets/js/core/nav.js` (area, label, `live`/`soon`, target `{ module, tab }`).
2. Create `modules/<id>/<id>.js` (+ css) calling `RO.registerModule({ id, title, pageTitle, mount(ctx), onShow, onRoute, reset, getState, setState, exportMenu, importJson })`. `ctx` gives `root`, `meta`, `tabs`, `actions`.
3. Add it to `index.html`.

Rules:
- Reuse the shared engines, and `RO.units` for every displayed or typed quantity (store SI).
- Add each new equation to `equations.md` before implementing it.
- Prefix element ids with the module id.
