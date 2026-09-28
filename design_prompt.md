# Prompt for Claude Design — RO Plant Platform: navigation & shell redesign

## Context

I'm building a web app for reverse-osmosis (RO) desalination plants. Today it is the **RO Plant Design Calculator**: an engineering tool for designing seawater intakes and pipelines. It will grow into **one unified app for the whole RO plant lifecycle**:

- design calculations
- site inspection
- commissioning and production
- daily operations and maintenance
- automation (scheduled reports, alerts, data import from plant systems)

Please redesign the app shell and navigation so it works well today and scales to that future without another redesign.

**Users:** process and design engineers, plant operators, maintenance technicians, supervisors / approvers, and admins. Guests (not logged in) can use the calculators and export results, but cannot save.

## What exists today (keep the look and feel)

- **Visual style:** dark, dense engineering UI (GitHub-dark feel). Keep these tokens and adapt them into a design system:

  | Token | Value |
  | --- | --- |
  | `--bg` | #0f1419 |
  | `--bg-elev` | #1a2129 |
  | `--bg-card` | #1e2630 |
  | `--bg-deep` | #0d1117 |
  | `--border` | #2a3441 |
  | `--text` | #e6edf3 |
  | `--text-dim` | #8b949e |
  | `--accent` | #58a6ff |
  | `--green` | #3fb950 |
  | `--red` | #f85149 |
  | `--amber` | #d29922 |
  | `--purple` | #a371f7 |

  Fonts: system sans for UI, monospace for numbers.
- **Shell today:**
  - A narrow **left icon rail** with three modules: Intake, Libraries, Tools.
  - A **top header** with the module title, a one-line meta summary (fluid, flow), the module's **sub-tabs** in the centre, and toolbar buttons on the right (Import, Export, Reset, Print A4, account: "Guest / Log in" or user name + role).
- **Module layout today:** a collapsible input panel on the left (~30 % width) and a results area on the right. Results are arranged in cards:
  - **Value cards:** label / big number / unit, with pass / warn / fail colour.
  - **Checks lists:** PASS / WARN / FAIL badges.
  - **Charts:** head budget, pump vs system curves, pressure along a pipeline.
  - **Data tables:** route segments, fittings.
  - **Step-by-step calculation traces:** formula → substitution → result.
- **Intake module tabs:** Route · Gravity Line · Pump System · Pump Selection · Surge & Class · Steps.
- **Libraries:** Fittings lists (versioned, CSV import, draft / approved / recommended) · Pumps (curve editor) · Recommended values · Users (admin).
- **Tools:** Velocity calculator · Fluid properties · Pipeline Design (planned: elevation profile, diameters, fittings).
- **Tech constraints** (the design must be buildable in them):
  - Vanilla HTML/CSS/JS, no framework, no build step; must also work offline from a local file.
  - Modules register themselves into the shell.
  - Desktop first: 1920×1080 and 1366×768. Tablet (1024) must be usable for operators in the field. Phone is read-only / light use.
  - Every screen must print cleanly to A4 (calculation reports).

## Target information architecture (proposed; refine it)

The navigation must handle ~30+ destinations, grouped by lifecycle area. Items not built yet appear as **"coming soon"** — visible but clearly inactive — so users see the roadmap.

1. **Home** — role-aware dashboard: recent calculations / projects, plant KPIs, alerts, tasks, shortcuts.
2. **Projects / Plants** — a context selector. The user picks a project (design work) or a plant and train (operations). Everything below uses that context.
3. **Design:**
   - Intake (built)
   - Pretreatment: DAF · Sedimentation · Media filters · MF / UF · Cartridge filters · Chemical dosing
   - RO Design: membrane library · projections
   - Post-treatment / remineralisation
   - Brine & outfall
   - Pipelines (Pipeline Design)
   - Bill of Materials & supports / buoyancy
4. **Inspection** — site surveys and inspection checklists (intake, pipelines, tanks, RO trains), photo / defect capture, inspection reports.
5. **Commissioning** — test sheets, punch lists, handover documents.
6. **Operations:**
   - Production dashboard (flows, recovery, pressures, specific energy)
   - Daily logs / shift reports
   - RO performance normalisation and current-state projection
   - Water quality / lab
   - Chemical consumption and inventory
7. **Maintenance** — asset register, work orders, preventive maintenance plans, membrane CIP and replacement tracking, spare parts.
8. **Automation** — data connections (CSV / SCADA import), alert rules and thresholds, scheduled reports, workflows (e.g. inspection finding → work order).
9. **Reports** — calculation reports, operations reports, exports.
10. **Libraries** (built) — fittings, pumps, membranes, chemicals, recommended values.
11. **Tools** (built) — quick calculators.
12. **Admin** — users and roles, audit log, settings.

## What I want designed

### Navigation shell

- **Main navigation.** Replace or extend the icon rail with scalable navigation. My suggestion is a **collapsible left sidebar**: grouped sections with section headers, icon + label, expanded ~240 px or collapsed to an icon rail. If you think a hybrid works better, propose it; for example a slim top bar for areas (Design / Operations / Maintenance …) plus a context sidebar.
- **Top bar:**
  - Project / plant / train context switcher.
  - Global search / command palette (Ctrl+K: jump to any module, pump, fitting, plant, report).
  - Notifications / alerts bell (for automation).
  - Help.
  - Account menu: guest state vs logged-in user with role badge.
- **Module header:**
  - Breadcrumb (Area › Module › Tab).
  - Module sub-tabs (keep today's tab concept).
  - Module actions: Import, Export, Reset, Print, Save (disabled with an explanation for guests).
- **Role-based visibility:** operators see Operations / Maintenance first, and engineers see Design first. "Coming soon" items are shown but disabled, with a hint.
- **States:** offline mode badge (app works without the server), guest vs logged in, unsaved changes, and an approval / draft status chip on library items.

### Screens / artboards

1. **App shell, desktop 1920:** sidebar expanded, on the **Intake › Route** tab. Show the existing input panel + results layout inside the new shell: route segment table, value cards and a checks list.
2. **App shell, desktop 1366:** sidebar collapsed to icons, on **Intake › Pump Selection**: pump vs system curve chart, operating-point value cards, checks list.
3. **Home dashboard, role-aware:** two variants side by side — an engineer (recent calculations, projects, library approvals pending) and an operator (plant KPIs, alerts, today's tasks / inspections).
4. **Navigation details:**
   - Expanded sidebar with all sections and "coming soon" items.
   - Command palette open.
   - Project / plant switcher open.
   - Notifications panel.
5. **Operations placeholder page** (e.g. Operations › Production dashboard): what a future operations screen looks like in this system, with KPI tiles, a trend chart and an alarm list. This proves the design system works beyond calculators.
6. **Inspection on tablet (1024):** inspection checklist with pass / fail items, photo capture and a defect note. Touch-friendly.
7. **Libraries › Fittings:** versioned lists table with status chips (draft / approved / recommended) and an import flow step (upload → validation errors per row → save as draft).
8. **Login and guest banner:** login dialog, forced password change, and a guest banner ("You're using the calculators as a guest — exports only, nothing is saved").
9. **Print / A4 calculation report:** header with project, module, date and user; inputs summary; results; checks; step traces. Light background.
10. **Phone (390):** read-only Home / alerts view.

### Design system page

- Tokens: colours (dark theme first; include a light theme for print and optional use), type scale, spacing, radii.
- Components:
  - Sidebar item (default / hover / active / disabled "coming soon")
  - Tabs
  - Buttons (primary / secondary / danger / small)
  - Inputs and selects with the "recommended value" placeholder pattern: blank input shows the recommended value; user overrides are highlighted
  - Value card (neutral / pass / warn / fail)
  - Checks list row with badge
  - Status chips (draft / approved / recommended / placeholder / session-only / offline)
  - Data table (dense, sticky header, editable cells)
  - Chart card
  - Calculation-step card
  - Modal
  - Toast
  - Empty state
  - "Coming soon" module page

## Principles

- **Dense but calm:** engineers compare many numbers at once. Keep information density high, and use clear hierarchy and alignment rather than whitespace.
- **Status is always explicit:** pass / warn / fail and draft / approved use colour **plus** text or icon, never colour alone.
- **Numbers:** monospace, units always shown, consistent decimals.
- **Traceability is a feature:** every result can reveal the formula and inputs behind it.
- **One shell, many modules:** a new calculator or operations page should fit in without changing the navigation design.
- **Accessibility:** WCAG AA contrast, visible focus, keyboard navigation for sidebar, tabs and command palette.

## Deliverables

A multi-artboard canvas with the screens above, plus a short written rationale:

- the navigation model you chose and why
- how it scales to 30+ modules
- how role-based entry points work
- which components are new vs existing

Also include a handoff table listing each shell element, its states, and the CSS tokens it uses. The developer will implement it in the existing vanilla JS / CSS app.
