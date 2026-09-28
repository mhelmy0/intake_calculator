# RO Plant Design Calculator — PRD v2.9 (Intake & Pipeline Hydraulics)

Sep 26, 2026 · @Mohammed · supersedes "Pipeline Hydraulics Module — PRD" v1

| Version | Change |
| --- | --- |
| v2.9 | **Phase 2 implemented:** Design → Supports & buoyancy (PPI Ch. 10 per section, safety factor method A = ballast ÷ net uplift as the criterion with method B shown, required block mass / largest spacing, import from Intake / Pipeline design) and Design → Bill of materials (pipes with allowance and 12 m lengths, fittings, joints, flange sets with DN / PN, ballast, pumps; Pipeline design line opt-in). equations.md §9.5, §9B. Fix: intermittent HTTP 500 on unknown-user login |
| v2.8 | **Phase 1.5 implemented:** Tools → Pipeline design (§8A) — profile with ground + cover, pumped and gravity modes, segments by chainage, located / spread fittings, HGL / EGL / static line, pressures, air valves and drains (Submerged switch), surge & class, flow range, diameter comparison, quantities, suggested bends, paste / CSV import, Send to Intake with profile view. New recommended values: pipeline cover, residual pressure, minimum pressure, bend threshold |
| v2.7 | Phase 1.5 / 2 open questions resolved (§11): ground + cover profiles, pumped and gravity modes, per-line Submerged switch for air valves, Send to Intake, BOM covers Intake + Pipeline Design |
| v2.6 | **Claude Design shell implemented** ("RO Shell", round 1): RO Workbench shell (rail / sidebar / drawer, project switcher, Ctrl K palette, alerts, SI / Imperial units, offline and guest banners, roadmap pages), Industry design system, Intake rebuilt as Pump sizing · Gravity line · Pump selection · Surge & class · Calculation steps with REC fields, pump / motor sizing (equations.md §6.1) and device drafts. Approval workflow shown but disabled until project profiles |
| v2.5 | **Tools → Pipeline Design** tool with an elevation profile, lengths, diameters and fittings (§8A). The full elevation profile is moved out of "deferred" |
| v2.4 | Recommended fittings list + CSV import / versioning (§5.4–5.5) |
| v2.3 | Buoyancy inputs and criterion, ψ = 0.80 default, HI 9.8 submergence, legacy baseline (§11) |
| v2.2 | Default fittings catalogue (§5.4), guest / user access model (§9), approver role, branched networks out of scope, legacy buoyancy review. All equations collected and verified in [equations.md](equations.md) |
| v2.1 | First round of open questions folded in (fittings sources, pump data entry, team use, segmented gravity intake, recommended-but-editable values, legacy apps) |

> **Phase 1 status (2026-09-27): implemented.**
>
> - **Delivered:**
>   - Backend: PostgreSQL + PHP API with users/roles, CSRF, login throttling and audit; versioned fittings lists; pump library; recommended values.
>   - Libraries module: fittings, pumps with curve editor, values, users.
>   - Intake restructured into Route · Gravity Line · Pump System · Pump Selection · Surge & Class · Steps on one shared input set.
>   - Tools module: velocity calculator, fluid properties.
>   - Guest / offline mode; JSON / CSV / print export and JSON import.
>   - The standalone pipeline module moved to `legacy/pipeline_v1/`.
> - **Tests:**
>   - `tests/engine_test.html`: 46 checks, including a regression against the original intake page.
>   - `tests/ui_test.html`: 23.
>   - `tests/api_test.py`: 57.
> - **Not in Phase 1** (as planned): BOM, buoyancy / supports (Phase 2), VFD, project profiles UI.

## 1. Overview & Purpose

The RO calculator becomes one app, the **RO Plant Design Calculator**. It is organised by design job: **Intake → Pretreatment → RO Design**. Every job module uses the same shared calculation engines. The goal is to replace spreadsheets and hand calculations with one validated, traceable tool.

This PRD covers:

1. The overall module map, so each new calculator has a defined place (§3).
2. **Phase 1 in detail:** merging the existing Intake calculator and Pipeline Hydraulics module into a single **Intake** module. It adds a pipeline route with segments and fittings, required pump head and pressure, and pump selection from a user-defined vendor library (§5–§9).

Status of v1 of this PRD: friction loss, water hammer, SDR/pipe-class and fluid properties are **built** as a standalone module. In v2 their equations become a shared engine and their screens move into Intake.

## 2. Goals

- One app, one navigation, one set of inputs per job. No re-entering flow, pipe or fluid data between calculators.
- Calculate the **required pump duty** from the real pipeline: length, segments, diameter changes, fittings, static head and required delivery pressure.
- Select pumps from **user-defined vendor pump curves** and decide the number of duty and standby pumps.
- Keep the existing validated equations (Darcy-Weisbach + Swamee-Jain, Korteweg + Joukowsky, ISO 4427 SDR/PN), with no re-derivation.
- Traceability: every result shows its formula, substituted values and intermediate results.
- Store libraries (pumps, fittings, later membranes) and projects in **PostgreSQL**, shared by a **team** with user accounts.
- Reachable **from the internet**. **Guests** can use every calculator and export results without an account. **Users** (created by the admin only) get profiles and saved data.
- **Recommended, but user-defined:** every engineering constant (K values, E-modulus, viscosity, derating, margins) ships with a recommended default and its source. The user can override it per project, and the override is visibly flagged.

## 3. Module Map (full picture)

| Module | Sub-designs | Phase |
| --- | --- | --- |
| **Intake** | Gravity intake · Pumped intake · Pipeline route & hydraulics · Pump selection · Surge & pipe class · Bill of Materials (BOM) · Pipe supports / ballast against buoyancy · merge of legacy intake SPA (HTML/JS) | 1 (BOM, supports, legacy merge: 2) |
| **Pretreatment** | DAF · Sedimentation / settling tanks · Media filters · Microfiltration · Ultrafiltration · Cartridge filters · Chemical dosing (coagulant, flocculant, prechlorination) | 3 |
| **RO Design** | Membrane library (user-defined / re-rated elements) · Projection engine · Current-state projection of operating units with custom parameters | 4 |
| **Tools** | Velocity calculator · Fluid properties · **Pipeline Design** (any line: elevation profile, lengths, diameters, fittings; §8A) · **PDF toolkit** (merge / reorder / rotate / extract / split, in the browser — port of the legacy Flask app) · Unit converter | 1 (Pipeline Design: 1.5) |

**Shared engines** are not menu items; every module calls them:

| Engine | Content | Used by |
| --- | --- | --- |
| Hydraulics | Friction (DW + Swamee–Jain), fitting losses (K), system curve, NPSH, surge (Korteweg/Joukowsky) | Intake, Pretreatment transfer lines, RO feed/HP piping |
| Pipes | Catalogues (PE100/PE80 ISO 4427; later steel, GRP, SDSS), SDR/PN, wall/ID lookup | All |
| Fluids | Freshwater / seawater / brine / custom (T, S), shared per project | All |
| Pump library | Vendor pumps with curves (PostgreSQL) | Intake, Pretreatment, RO (HP / booster pumps) |
| Membrane library | Elements, user re-rated data (PostgreSQL) | RO Design |
| Projects | Saved inputs of every module per project (PostgreSQL) | All (design to be discussed separately) |

## 4. Scope — Phase 1

**In scope**

1. **Merge.** The Intake module gets tabs: Gravity Intake · Pumped Intake · Pipeline Route · Pump Selection · Surge & Pipe Class. All tabs share one input set (flow, levels, fluid, route). The standalone Pipeline Hydraulics module is removed; its equations stay in the shared engine.
2. **Pipeline route.** Suction and discharge sides, each made of segments in series. Each segment has its own pipe, length, elevation change and fittings list. The **gravity intake also uses the segmented route** (e.g. intake head + screen, sea line, sump inlet).
3. **Fittings.** K-value library with several **source lists**. The recommended list is "RO-Calc Recommended Fittings v1" (Crane-based), and more lists come in by CSV import. The list can be changed per project. Plus a per-segment fittings table (type × quantity).
4. **Required pressure / head.** Static head, friction and fitting losses per segment, TDH, required discharge pressure, NPSHa, and the system curve at minimum and maximum source level.
5. **Pump selection.** Vendor pump library (CRUD), fitted curves, n duty + m standby in parallel, operating points at LAT and HAT, and power and motor checks.
6. **Surge & pipe class.** Existing calculators, re-pointed at the discharge route: highest-pressure segment, total length, and segment velocities.
7. **Backend.** PostgreSQL + PHP API for the pump and fittings libraries, with the **guest / user access model** in §9. The projects schema is reserved but its UI is out of scope.
8. **Recommended values framework.** Shared mechanism for "recommended default + source + user override", used by fittings, material E-modulus, fluid properties, derating and check limits.
9. **Export.** Guests and users can export any calculation (inputs, results, step traces) as a printable A4 report / PDF and as a data file (CSV, JSON). For guests nothing is stored on the server.

**Phase 1.5 (done, v2.8):** Tools → Pipeline Design (§8A). Equations in equations.md §5A.

**Deferred**

- BOM (pipe lengths per size, fittings, joint method, flanges and gaskets): **done in v2.9** (Design › Bill of materials, equations.md §9B)
- Pipe supports / concrete ballast against buoyancy: **done in v2.9** (Design › Supports & buoyancy, equations.md §9.5).
  - Rebuild on the PPI Handbook Ch. 10 method (equations.md §9), keeping the per-section, block-weight and spacing workflow of the **Python desktop app** (`legacy/`).
  - The legacy code has calculation errors that the port must **not** carry over (equations.md §9.4).
- Legacy intake SPA (HTML/JS): **already merged** as the Intake module (verbatim port). The original is kept in `legacy/intake_calc_original.html` as the regression baseline.
- Branched networks (headers with branches, loops): **not needed** (decision v2.2). Phase 1 and 2 use series segments + parallel identical lines
- VFD / affinity-law operation, pump curve at reduced speed
- ~~Full elevation profile~~ → moved into Tools → Pipeline Design (§8A, Phase 1.5). Using a profile inside the Intake route stays deferred (open question in §11)
- Automated surge mitigation sizing (surge vessel, relief valve)
- Project profiles UI (separate discussion)

## 5. Pipeline Route — Functional Requirements

### 5.1 Route structure

```
Source (sea / sump / tank)  →  [Suction side: segments S1..Sn]  →  Pump(s)  →  [Discharge side: segments D1..Dn]  →  Delivery point
```

- Gravity intakes use the segmented route with no pump; the route losses feed the gravity head budget (available head = source level − sump level). Typical gravity route: intake head / screen → sea line segments → sump inlet.
- Segments are in series. Parallel pipes are handled with a **"number of parallel lines"** value per side (flow split equally), as the intake does today.

### 5.2 Segment inputs

| Field | Notes |
| --- | --- |
| Name / tag | e.g. "Intake line", "Header", "Riser" |
| Pipe | Material + catalogue (DN, SDR) **or** custom OD / wall / ID |
| Roughness ε | Default from material, editable |
| Length (m) | Straight pipe length |
| Elevation change Δz (m) | End minus start, used for the static head check and highest point |
| Parallel lines | Default 1 |
| Fittings | Table of type × quantity (K from the library; row override allowed) |
| Joint method | Default for the segment: butt-fusion / electrofusion / welded / flanged. Individual fittings can override it (e.g. flanged valves on a welded line). Stored now, used by the Phase 2 BOM |

### 5.3 Source and delivery conditions

| Input | Notes |
| --- | --- |
| Source level min / max (m) | e.g. LAT / HAT, sump low / high level |
| Source surface pressure (bar g) | 0 for open sea/sump, >0 for pressurised tanks |
| Pump centreline elevation (m) | For NPSHa. Submersible pumps: submergence below min level |
| Delivery elevation (m) | Point where the line discharges |
| Required residual pressure at delivery (bar g) | e.g. inlet pressure needed by the pretreatment / DAF / filters |
| Flow: design Q_max, Q_min (m³/h) | Shared with the rest of Intake |

### 5.4 Fittings library — source lists (stored in DB)

- The library holds **fitting types** and **source lists**. A source list gives a K value, or an L/D value, for each fitting type.
- **Recommended list: "RO-Calc Recommended Fittings v1"**, based on Crane TP-410. It is selected by default in every new project.
  - Its source of truth is [assets/data/fittings/fittings_recommended_v1.csv](assets/data/fittings/fittings_recommended_v1.csv), seeded into the database at install.
  - The catalogue tables below mirror that file.
- **Other lists:** consultant, company or project lists are added later by **CSV import** (§5.5). An approver can promote any approved list to "recommended".
- **Per project:** the project chooses the list. The user can override K on any single row, and overridden rows are flagged in the results and the report.
- **Governance:** only users with the approver role (and admins) can edit approved lists. Engineers can add draft lists and project-level overrides.

#### Default fittings catalogue (seed data)

These tables list every item in "RO-Calc Recommended Fittings v1". Each one exists as a fitting type from day one, with a default loss value.

- **Loss basis:**
  - **"n":** Crane L/D, so K = n·f_T and K varies with size (equations.md §4.2).
  - **"K":** fixed value.
  - **"mfr":** use manufacturer data (Kv/Cv → K, equations.md §4.6). A placeholder K is given so the calculation runs, and the row is flagged until real data is entered.
- **K @ DN500** shows K = n × 0.012 (f_T at DN 500) for comparison.
- **BOM** says whether the item is counted in the Phase 2 bill of materials.

**Entrances, exits and intake items**

| Fitting | Basis | Default | K @ DN500 | BOM |
| --- | --- | --- | --- | --- |
| Bellmouth / well-rounded entrance | K | 0.04 | 0.04 | yes |
| Slightly rounded entrance | K | 0.23 | 0.23 | — |
| Sharp-edged (flush) entrance | K | 0.50 | 0.50 | — |
| Inward-projecting entrance | K | 0.78 | 0.78 | — |
| Pipe exit (into sump / tank / sea) | K | 1.00 | 1.00 | — |
| Intake screen — clean / 50 % fouled | mfr | 0.50 / 2.50 | — | yes |
| Intake head / velocity cap | mfr | 1.00 | — | yes |

**Elbows and bends**

| Fitting | Basis | Default | K @ DN500 | BOM |
| --- | --- | --- | --- | --- |
| 90° standard elbow (r/D ≈ 1) | n | 30 | 0.36 | yes |
| 90° long-radius elbow (r/D = 1.5) | n | 16 | 0.19 | yes |
| 90° bend r/D = 2 / 3 / 5 | n | 12 / 12 / 16 * | 0.14 / 0.14 / 0.19 | yes |
| 45° standard elbow | n | 16 | 0.19 | yes |
| 45° long-radius bend | n | 8 * | 0.10 | yes |
| 22.5° / 11.25° bend | n | 5 / 3 * | 0.06 / 0.04 | yes |
| Mitred (segmented) 90°, 2 / 3 / 4 cuts (fabricated PE) | n | 30 / 24 / 20 * | 0.36 / 0.29 / 0.24 | yes |
| 180° return bend | n | 50 | 0.60 | yes |

**Tees and crosses** (velocity of the combined flow)

| Fitting | Basis | Default | K @ DN500 | BOM |
| --- | --- | --- | --- | --- |
| Equal tee — flow through run | n | 20 | 0.24 | yes |
| Equal tee — flow through branch | n | 60 | 0.72 | yes |
| Reducing tee — run / branch | n | 20 / 60 | 0.24 / 0.72 | yes |
| Cross — run / branch | n | 20 / 60 ** | 0.24 / 0.72 | yes |
| Lateral (Y) 45° — branch | n | 30 * | 0.36 | yes |

**Reducers and expanders**

| Fitting | Basis | Default | BOM |
| --- | --- | --- | --- |
| Concentric reducer, gradual (≤ 30°) | K on small-end V | 0.05 | yes |
| Eccentric reducer, gradual (pump suction) | K on small-end V | 0.05 | yes |
| Concentric expander, gradual (≤ 30°) | K on small-end V | 0.20 | yes |
| Sudden contraction / sudden expansion | formula (equations.md §4.4) | auto | — |

**Flanges and joints** (hydraulically negligible; counted for the BOM)

| Fitting | Basis | Default | BOM |
| --- | --- | --- | --- |
| Flange adaptor / stub end + backing ring (pair) | K | 0.00 | yes (+ bolts, gasket) |
| Weld-neck / slip-on flange (steel) | K | 0.00 | yes |
| Blind flange | — | — | yes |
| Butt-fusion joint | K | 0.00 | yes (joint count) |
| Electrofusion coupler | K | 0.00 | yes |
| Mechanical / flexible coupling | K | 0.00 | yes |
| Dismantling joint | K | 0.00 | yes |

**Valves** (fully open)

| Fitting | Basis | Default | K @ DN500 | BOM |
| --- | --- | --- | --- | --- |
| Gate valve / knife gate valve | n | 8 | 0.10 | yes |
| Butterfly valve 2–8″ / 10–14″ / 16–24″ | n | 45 / 35 / 25 | 0.30 (20″) | yes |
| Ball valve, full bore | n | 3 | 0.04 | yes |
| Plug valve, straightway | n | 18 | 0.22 | yes |
| Globe valve | n | 340 | 4.08 | yes |
| Angle valve | n | 150 | 1.80 | yes |
| Swing check valve | n | 100 | 1.20 | yes |
| Lift check valve | n | 600 | 7.20 | yes |
| Dual-plate (wafer) check valve | mfr | 1.50 | — | yes |
| Nozzle / non-slam check valve | mfr | 1.50 | — | yes |
| Foot valve with strainer | mfr | 1.50 | — | yes |
| Control / pressure-reducing valve | mfr (Kv) | — | — | yes |
| Air release / vacuum valve (on branch) | K | 0.00 on main line | — | yes |

**Strainers, meters and specials**

| Fitting | Basis | Default | BOM |
| --- | --- | --- | --- |
| Basket strainer, clean | mfr | 1.00 | yes |
| Y-strainer, clean | mfr | 2.00 | yes |
| Electromagnetic / ultrasonic flow meter (full bore) | K | 0.00 | yes |
| Outfall flap / duckbill valve | mfr | 1.00 | yes |
| Custom item | user | user | optional |

\* Crane bend, mitre and lateral multipliers must be confirmed against a TP-410 copy before approval. Only the main fittings table was verified online.
\*\* No Crane value exists for crosses; the tee values are used as the approximation (flagged).

### 5.5 Fittings list import / update (CSV)

**Files** (downloadable from the Fittings Library screen and in the repo):

| File | Purpose |
| --- | --- |
| [fittings_import_template.csv](assets/data/fittings/fittings_import_template.csv) | Header + 4 example rows, one per loss basis |
| [fittings_recommended_v1.csv](assets/data/fittings/fittings_recommended_v1.csv) | The full recommended list, also a worked example |
| Export of any existing list | Same format; edit and re-import it as a new version |

**Format:**
- UTF-8, comma-separated, `.` decimal separator, header row required. The files carry a BOM so Excel opens them correctly.
- Save from Excel as "CSV UTF-8".

| Column | Required | Values / units |
| --- | --- | --- |
| `code` | yes | Unique ID within the list, e.g. `ELB90-LR`. Used to match rows when updating a list |
| `name` | yes | Display name |
| `category` | yes | entrance, exit, elbow, bend, tee, cross, reducer, expander, flange, joint, valve, check_valve, strainer, meter, special |
| `basis` | yes | `n` (Crane L/D, K = n·f_T) · `K` (fixed K) · `kv` (manufacturer Kv, m³/h) · `3k` (Darby) · `formula` (sudden contraction / expansion; built-in only) |
| `n_LD` | if basis = n | L/D multiplier, > 0 |
| `K` | if basis = K | ≥ 0 |
| `Kv` | optional for kv | m³/h, > 0; if blank, entered per valve in the project |
| `K1`, `Ki`, `Kd` | if basis = 3k | Darby coefficients (Kd ≈ 4) |
| `velocity_ref` | no (default `segment`) | segment, upstream, downstream, small_end, combined |
| `dn_min_mm`, `dn_max_mm` | no | Size range the row applies to (e.g. butterfly valve by size); blank = all sizes |
| `bom` | no (default yes) | yes / no: counted in the bill of materials |
| `connection` | no | none, flanged, butt_fusion, electrofusion, welded, threaded, mechanical |
| `status` | no (default to_confirm) | verified, to_confirm, placeholder. Placeholder rows are flagged in results |
| `source` | recommended | Reference (standard, consultant document, datasheet) |
| `notes` | no | Free text |

**Workflow:**
1. **Upload.** The user enters the list name, source and version, and chooses "new list" or "new version of list X".
2. **Validate.** Each row is checked (required columns per basis, numeric ranges, duplicate `code`, overlapping DN ranges for the same code family). A preview shows errors and warnings per row, and nothing is saved until every error is fixed.
3. **Diff (new version only).** Rows are matched by `code` and shown as added / changed / removed.
4. **Save as draft.** Only an approver can approve it or mark it recommended.
5. **Versioning.** Lists are never edited in place; every import creates a new version. Projects keep the list version they were calculated with, so old results reproduce exactly. The project shows a "newer version available" notice with the option to upgrade.

**Access:** engineers and above can import. Guests can load a CSV into their browser session only (not saved), and their exports record which list was used.

- A K value is applied at **the velocity of the segment it sits in**.
- Reducers between segments of different diameter are added automatically, using the downstream velocity (user can override).
- Rows carry a **category** (fitting / valve / special) and **connection type**, so the BOM can reuse them.

## 6. Required Head & Pressure — Calculations

Per segment *i* (flow per line Q_i = Q / n_parallel):

| Step | Equation |
| --- | --- |
| Velocity | V_i = Q_i / (π·D_i²/4) |
| Reynolds / friction | Re_i = V_i·D_i/ν ; f_i by Swamee–Jain (64/Re if laminar) |
| Friction loss | h_f,i = f_i · (L_i/D_i) · V_i²/2g |
| Fitting loss | h_m,i = (ΣK_i) · V_i²/2g |

Totals:

| Output | Equation |
| --- | --- |
| Suction losses | h_s = Σ (h_f + h_m) over suction segments |
| Discharge losses | h_d = Σ (h_f + h_m) over discharge segments |
| Static head (worst = min level) | H_st = z_delivery − z_source + (P_delivery − P_source)/(ρ·g) |
| Total dynamic head | TDH = H_st + h_s + h_d |
| Required pump discharge pressure | P_dis = P_delivery + ρ·g·(z_delivery − z_pump + h_d) |
| NPSH available | NPSHa = (P_atm + P_source)/(ρ·g) + (z_source,min − z_pump) − h_s − P_v/(ρ·g) |
| System curve | H_sys(Q) evaluated point-by-point from 0 to 1.3·Q_max (f recomputed at each Q; not a pure R·Q² fit), at min and max source level |
| Hydraulic power | P_hyd = ρ·g·Q·TDH |

**Outputs:** a per-segment table (V, Re, f, h_f, ΣK, h_m, head at segment end); totals; duty point (Q_max, TDH); a hydraulic grade line chart along the route; the system curve chart; and step-by-step traces.

**Checks:** velocity per segment (suction and discharge limits are separate, defaults 0.6–1.5 m/s suction and 0.6–3.0 m/s discharge); sub-atmospheric pressure at any segment end; and NPSHa above the chosen pump's NPSHr plus margin (§7).

## 7. Pump Library & Selection

### 7.1 Pump record (PostgreSQL)

| Field | Notes |
| --- | --- |
| Vendor, model, type | Type: submersible, vertical turbine, end-suction, split-case, dewatering, other |
| Speed (rpm), impeller Ø (mm), stages | |
| Curve points | Table of Q (m³/h), H (m), η (%), NPSHr (m), P (kW, optional). Minimum 3 points; 5–8 recommended |
| BEP flow; minimum continuous flow | Optional; derived from the η curve when blank |
| Motor rating (kW), voltage, frequency | |
| Materials / notes / datasheet reference | Free text or link |
| Created by / date | Audit |

- Curves are fitted by least squares: H(Q) quadratic (cubic if ≥ 6 points), η(Q) quadratic, NPSHr(Q) quadratic. The fit residual is shown so bad data is visible.
- **Entry methods:**
  - **Primary:** manual table from the vendor datasheet, with paste from Excel.
  - **Secondary:** CSV / Excel import, in case a vendor tool exports curve data. Grundfos Product Center, KSB and Xylem may offer this depending on version; to be checked.
  - **Later, nice-to-have:** a curve digitiser (upload the datasheet curve image, click points).
- **Governance:** pump records have status *draft / approved*. Selection shows approved pumps by default, with an option to include drafts.

### 7.2 Selection

- The user chooses a pump plus **n duty** and **m standby**. The app also suggests an n for each library pump that meets the duty.
- Combined curve: H_n(Q) = H_1(Q/n) for identical pumps in parallel.
- Operating points: intersection with the system curve at **min and max source level**, with all n duty pumps and with n−1 pumps running.
- Outputs per operating point: Q, H, η, NPSHr, absorbed power per pump (ρ·g·Q·H/η), and total motor power.

**Checks (limits editable):**

| Check | Default criterion |
| --- | --- |
| Duty flow delivered | Q_op at min level ≥ Q_design |
| Operating region | 70–120 % of BEP flow (preferred operating region) |
| Runout | Q_op at max level ≤ end of curve / AOR |
| NPSH margin | NPSHa ≥ NPSHr + 0.5 m **and** NPSHa/NPSHr ≥ 1.1 |
| Motor sizing | Motor rating ≥ 1.15 × max absorbed power over the operating range |
| Standby | m ≥ 1 |

## 8. Surge & Pipe Class (existing, re-pointed)

- The v1 calculators stay unchanged: Korteweg wave speed, 2L/a, Joukowsky surge, steady/peak/min envelope, SDR, catalogue deviation, PN vs pressure, temperature derating, and surge allowance factor.
- Inputs now come from the route: L = total discharge length; the governing segment is the one with the highest velocity (surge) and the one with the highest steady pressure (class). Each segment is checked against its own SDR/PN.
- **E-modulus:** user-defined per material. The recommended value and its source are shown: PE100 short-term ≈ 1.0 GPa is recommended, and 0.3 GPa stays available as a conservative-low / long-term option.
- **Fluid properties:** the v1 model (presets + T, S, or custom) is the recommended source for the whole project, **including the intake**. It replaces the intake's `nuOf()` / `rhoOf()`. Users can override ρ, ν and K, and overrides are flagged.

## 8A. Tools — Pipeline Design (Phase 1.5)

A general-purpose design tool for **any single pipeline**, independent of the Intake job: transfer lines, brine outfalls, product-water mains, pretreatment interconnections.

- **Inputs:** the route along its real ground and pipe profile, with lengths, diameters and fittings.
- **Outputs:** the hydraulic grade line, pressures along the whole route, the required inlet pressure / pump head (or the gravity capacity), air-valve and drain locations, and a pressure-class check for every segment.
- **Engines:** it reuses the shared route, fittings, fluid, pipe-class and surge engines. No equations are re-derived.

### 8A.1 Inputs

**Design basis**

| Input | Notes |
| --- | --- |
| Fluid | Shared fluid card (preset + T, S, or custom) |
| Flow | Design Q, plus min / max for a range table (m³/h); parallel identical lines |
| Mode | **Pumped / pressurised:** known end conditions → required inlet pressure or pump head. **Gravity:** known upstream level → available head, capacity (max flow) and margin |
| Start condition | Upstream water level or known pressure at chainage 0 (m / bar g) |
| End condition | Delivery elevation + required residual pressure, or downstream water level (tank / sump / sea) |
| Submerged | On / off per line. On (e.g. intake sea lines, always full) → no air-valve checks; off (onshore) → an air valve is flagged at every high point |

**Elevation profile** (table; paste from Excel or import CSV)

| Column | Notes |
| --- | --- |
| Chainage (m) | Horizontal distance from the start, strictly increasing |
| Ground level (m) | Optional; used for cover and plotting |
| Cover depth (m) | Cover to pipe crown; per point, or one default for the line (recommended value, editable). Pipe centreline = ground − cover − OD/2 |
| Pipe level (m) | Optional override of the computed centreline (e.g. at crossings or on the seabed) |
| Label | Optional (road crossing, valve chamber, tie-in …) |

- The pipe length between profile points is measured **along the pipe**: L = √(Δx² + Δz²). The horizontal and along-pipe totals are both reported.
- A CSV profile template is downloadable, in the same style as the fittings template.

**Segments (diameter changes)**

| Input | Notes |
| --- | --- |
| From / to chainage | Contiguous, covering the whole profile; a diameter change creates a new segment |
| Pipe | Material + catalogue (OD, SDR) or custom OD / wall, roughness, E-modulus (recommended values) |
| Joint method | As in the Intake route (feeds the BOM later) |
| Transition at diameter changes | Gradual / sudden / none (as in the Intake route) |

**Fittings**

| Input | Notes |
| --- | --- |
| Fitting | From the active fittings list (Libraries); quantity, K override, Kv |
| Location | Either **at a chainage** (shown on the profile, counted in that segment), or **per segment** without a location (quantity only) |
| Auto-fittings (optional) | Suggested bends where the profile slope changes by more than a set angle; the user accepts or ignores them |

### 8A.2 Calculations

| Output | Method |
| --- | --- |
| Segment hydraulics | V, Re, f (Swamee–Jain), h_f, ΣK, h_m per segment (shared route engine) |
| Hydraulic grade line | HGL(x) = HGL_start − cumulative (friction + fitting + transition) losses to x; energy line EGL = HGL + V²/2g |
| Pressure along the line | p(x)/ρg = HGL(x) − z_pipe(x) at every profile point and every fitting location |
| Required inlet (pumped) | H_in = z_end + P_end/ρg + Σh; P_in = ρg(H_in − z_start). Reported as pressure and as pump TDH for a given suction level |
| Gravity capacity | Flow at which Σh(Q) = available head (root finding), and the margin at design Q |
| Flow range table | Q_min → Q_max: velocity, losses, inlet pressure / margin |
| Diameter comparison | The same route with candidate ODs: velocity, losses, required pressure / capacity, max pressure, class. Supports picking the size |
| High points / low points | Local maxima / minima of the pipe profile → **air release / vacuum valve** and **drain / washout** suggestions, plus an optional maximum spacing on long uniform grades (recommended value, editable) |
| Pressure checks | Sub-atmospheric zones (HGL below the pipe), column-separation risk (p < vapour pressure), max static pressure at low points (no-flow case) |
| Surge & class | Per-segment wave speed and Joukowsky surge (§8, equations.md §5.2); steady / peak / min pressure at every profile point checked against that segment's PFA / PMA |
| Quantities | Pipe length per OD / SDR / material, and fittings count per type (input to the Phase 2 BOM) |

New equations (along-pipe length, EGL, pressure along the profile, high/low point rules) are added to equations.md before implementation.

### 8A.3 Outputs & UI

- **Tabs:** Profile · Segments & Fittings · Hydraulics · Pressures & Valves · Surge & Class · Diameter Comparison · Steps.
- **Main chart:** chainage vs elevation, showing ground level, pipe level, HGL (design Q; optionally min / max Q), EGL, the static line (no flow), fitting markers, air-valve / drain markers, and red shading for sub-atmospheric zones.
- **Tables:** profile points with pressure; segments; fittings; valves; quantities.
- **Checks:** velocity limits per segment, min pressure ≥ 0 (recommended margin editable), max pressure ≤ PFA, peak ≤ PMA, an air valve at every high point (onshore lines only; skipped when the line is marked **Submerged**), capacity ≥ design Q (gravity).
- **Export / import:** the same as Intake (JSON calculation file, CSV tables, A4 print). Profile and fittings are also exportable as CSV.
- **Access:** the same as every calculator. Guests can use and export everything; nothing is saved server-side until project profiles exist.
- **Send to Intake:** copies the designed line into the Intake gravity or discharge route as segments (pipe, length along the pipe, Δz, fittings, joint method), with a confirmation before it replaces the existing route. The Intake route keeps the profile and shows it in an optional profile view.

### 8A.4 Acceptance

Status v2.8: covered by `tests/engine_test.html` (flat-profile regression against the Intake route, hand-checked high-point example, parsing, validation, extrema, capacity root, located-fitting step, quantities, Send to Intake) and `tests/ui_test.html`.


- A single-segment profile with no elevation change reproduces the Intake route result for the same pipe, flow and fittings (regression test).
- A worked example with a high point is checked by hand: along-pipe length, HGL, pressure at the high point, and the air-valve flag.
- Unit tests cover profile parsing (CSV / paste), segment chainage validation, high/low point detection and gravity capacity root finding.

## 9. Architecture & Data

| Layer | Decision |
| --- | --- |
| Front end | Existing static shell (`index.html`, `assets/js/core`, `modules/<job>`); vanilla JS, no build step |
| API | PHP 8.x on WAMP, JSON REST endpoints under `/api` (pumps, fittings, later membranes and projects) |
| Database | **PostgreSQL** (to be installed; WAMP ships `pdo_pgsql` disabled; enable it in php.ini) |
| Accounts | App accounts in PostgreSQL (hashed passwords). **Only the admin creates users**, with no self-registration. Record ownership and audit trail (created/updated by, when) |
| Hosting | Internet-accessible server (PHP + PostgreSQL) behind **HTTPS** |
| Offline behaviour | Calculators work without the API; libraries are read-only / unavailable when the DB is down |

### 9.1 Access model

| Capability | Guest (no login) | Viewer | Engineer | Approver | Admin |
| --- | --- | --- | --- | --- | --- |
| Use all calculators | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read **approved** libraries (pumps, fittings, recommended values) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Export calculations (A4 / PDF, CSV, JSON) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Temporary custom data (own pump, K override) in the browser session only; lost on close unless exported | ✓ | ✓ | ✓ | ✓ | ✓ |
| Save to server: profile, projects, custom pumps / lists (draft) | — | — | ✓ | ✓ | ✓ |
| See other users' drafts | — | — | own only | ✓ | ✓ |
| Approve library data (pumps, fitting lists, recommended values) | — | — | — | ✓ | ✓ |
| Create / disable users, assign roles | — | — | — | — | ✓ |

- **Approval is role-based:** anyone holding the approver role can approve (decision v2.2).
- **Guests:**
  - The server never writes guest data.
  - A guest can re-import an exported JSON file to continue a calculation.
- **Internet exposure** requires:
  - HTTPS only; secure, HttpOnly, SameSite session cookies; CSRF tokens on write requests.
  - Password hashing (`password_hash`), login rate-limiting and lockout, and an admin-set password reset.
  - Parameterised SQL only.
  - Rate-limiting and a size cap on anonymous API reads.

Initial tables: `users`, `roles`, `pumps`, `pump_curve_points`, `fitting_types`, `fitting_sources`, `fitting_values`, `recommended_values`, `audit_log`; reserved: `projects`, `project_module_states`, `membranes`.

## 10. Non-Functional Requirements

- **Equations:** every equation, coefficient, validity range and source is listed in [equations.md](equations.md). New equations are added there before they are implemented. Items marked ❌ there are corrections to make during Phase 1.
- **Units:** SI internally. Display in m³/h, mm, m, bar, kW.
- **Precision:** velocity 2 d.p., head 2 d.p. (m), pressure 2 d.p. (bar), power 1 d.p. (kW).
- **Traceability:** every calculation has a step panel (formula → substitution → result).
- **Validation:** Phase 1 is accepted when one real past intake design is reproduced within ±2 % on TDH, NPSHa and operating point, compared with the hand/spreadsheet calculation.

## 11. Decisions & Open Questions

**Resolved (v2.1)**

- [x] Legacy intake app is a single-page HTML/JS web app → merge its code in Phase 2
- [x] Fittings: multiple selectable source lists, one marked recommended (superseded in v2.4: the recommended list is the RO-Calc Crane-based list)
- [x] Pump curves are entered from datasheets (manual / paste); file import is secondary
- [x] Team usage → user accounts, roles, approval status on library data
- [x] Gravity intake uses the segmented route. Joints are mostly welded, with a per-fitting override for more complex designs
- [x] E-modulus, viscosity and similar constants are user-defined with recommended values; the intake moves to the shared fluid model
- [x] Supports against buoyancy come from an existing Python desktop app → port its logic in Phase 2

**Resolved (v2.2)**

- [x] Default fittings: full catalogue in §5.4 (elbows, bends, tees, crosses, reducers, flanges/joints, valves, strainers, meters)
- [x] Internet-accessible. Guests can use and export without saving; users are created by the admin only (§9.1)
- [x] Approval is role-based (approver role)
- [x] Branched networks not needed
- [x] Python buoyancy apps received in `legacy/` and reviewed (equations.md §9.4)
- [x] Equations collected and checked against sources in equations.md

**Resolved (v2.3)**

- [x] Ballast blocks: user-defined per section (piece weight × pieces per location, spacing, concrete density), because they depend on pipe size and design constraints
- [x] Buoyancy criterion: user-editable, with a recommended set-point **SF ≥ 1.5** (air-filled uplift). PPI % weighting and the 1D–12D spacing check are reported alongside
- [x] Surge restraint factor: default **ψ = 0.80**, user-editable. Implemented in the current pipeline module
- [x] Submergence: ANSI/HI 9.8 S = D(1 + 2.3·F_D). Implemented in the current intake module
- [x] Legacy intake SPA = the original `intake_calc.html`, kept as `legacy/intake_calc_original.html` as the **regression baseline**. All intake outputs are tested against it, and the only intended difference is the submergence check

**Resolved (v2.4)**

- [x] Fittings: "RO-Calc Recommended Fittings v1" (Crane TP-410 based) is the default. Other lists come in by CSV import with versioning; template and recommended CSV in `assets/data/fittings/` (§5.4–5.5)

**Resolved (v2.9)**

- [x] Buoyancy criterion: **method A** (submerged ballast ÷ net uplift, air-filled) decides OK / CHECK; method B ((pipe + contents + ballast) ÷ buoyancy) is shown alongside
- [x] PPI percent-weighting ranges are informational only (they assume water-filled service, so an air-filled SF ≥ 1 is always above them)
- [x] BOM sources: Intake route + concrete blocks + pumps by default; the Pipeline design line is opt-in to avoid double counting after Send to Intake

**Resolved (v2.7)**

- [x] **Pipeline Design — profile reference:** chainage + **ground level + cover depth to crown** (cover editable per section). The pipe centreline is computed as ground − cover − OD/2
- [x] **Pipeline Design — modes:** **both** in the first release: pumped (required inlet pressure / TDH at a given flow) and gravity (capacity for the available head)
- [x] **Pipeline Design — air valves:** a **per-line "Submerged" switch**. Submerged lines (e.g. intake sea lines, always full) get no air-valve checks; onshore lines get high points flagged
- [x] **Pipeline Design ↔ Intake:** **Send to Intake**. A designed pipeline can be copied into the Intake gravity or discharge route as segments, and the Intake route gains an optional profile view
- [x] **Phase 2 BOM scope:** the Intake route **and** lines designed in Tools → Pipeline Design

**Open**

- [ ] **"to_confirm" / "placeholder" rows** in the recommended list (17 / 10 of 62): confirm the Crane bend, mitre and lateral multipliers against a TP-410 copy, and replace placeholders with manufacturer data when available

## 12. Out of Scope (this PRD)

- Pretreatment and RO Design modules (Phases 3–4; separate PRDs — Phase 3 draft: [Pretreatment Module — PRD.md](Pretreatment%20Module%20—%20PRD.md))
- VFD operation, series pumps, non-identical parallel pumps
- Transient simulation (method of characteristics); only Joukowsky screening
- Automated surge protection sizing
