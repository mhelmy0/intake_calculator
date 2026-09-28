# Pretreatment Module — PRD v0.3 (Phase 3, round 1 implemented)

| Version | Change |
| --- | --- |
| v0.3 | **Implemented:** Design › Pretreatment (Overview / train builder, Chemical dosing, DAF, Sedimentation, Media filters, Bag filters, Cartridge filters, Calculation steps) and Libraries › Equipment (MMF vessels, bag elements / housings, cartridge elements / housings; draft → approved; CSV import; bundled generic placeholders). 56 `pt.*` recommended values. Extra check: pressure filters above 20,000 m³/d flagged (Voutchkov) |
| v0.2 | Review answers (2026-09-28): cartridge 0.8 m³/h per 10"; MMF maximum 12.5 m/h at N−1; vessels, bag filters and cartridges from a **vendor / consultant equipment list**; media depth by the **L/dₑ rule**; DAF 20 m/h on **net flow** with editable recovery and recycle; sedimentation defaults accepted; chemical storage **per site requirement and SDS** (no default); **train builder**: include / remove any step, **bag filters** added. All values editable |
| v0.1 | First draft: DAF, sedimentation, media filters, cartridge filters, chemical dosing. Waiting for review before any code |

**Decisions already made (2026-09-28):**
- **Units in this phase:** media filters and cartridge filters, chemical dosing, and DAF and sedimentation. MF / UF come later, in a round of their own on the same framework.
- **Flow:** typed per unit. Each unit is standalone, with its own design flow. The units are not chained yet.
- **Design criteria:** literature defaults with their source, all editable (the REC pattern). You correct them to your consultant list afterwards.
- **Process:** this PRD and the equations (equations.md §11) come first; code starts after your review.

---

## 0. Review decisions (v0.2)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Cartridge loading | **0.8 m³/h per 10-inch length** (REC), editable |
| 2 | Media filters | Maximum rate **12.5 m/h with N−1** filters (REC), editable. Vessel size from the **equipment list** (vendor or consultant entries; custom size allowed). **Media depth by the L/dₑ rule** (§3.4) |
| 3 | DAF | HLR **20 m/h on the net flow** (REC), editable. **Recovery** (float / drain loss) and **recycle** editable |
| 4 | Sedimentation | Defaults of v0.1 accepted, all editable |
| 5 | Chemical storage | **Per site requirement and SDS:** storage days are a required input (no default). Product strength, density and notes are entered from the supplier SDS |
| 6 | Train | **Every step can be included or removed**, in order. New step: **bag filters** (sizes from the equipment list, like MMF vessels and cartridges) |

## 1. Purpose

**Design › Pretreatment** sizes the SWRO pretreatment units between the intake and the RO feed. It reuses what Phase 1–2 built:
- the shell (pages, SI / Imperial, REC fields, drafts on this device, export / import / print)
- the shared fluid (seawater at T, S: density and viscosity)
- the recommended-values library, where approvers edit the defaults

For every unit, the page follows the Intake layout:
- numbered input sections on the left, with REC defaults
- a results column on the right: KPIs, a sketch or chart, result rows, OK / CHECK / NOTE checks
- a Calculation steps page
- CSV / JSON export

## 1A. Train builder and equipment list

- **Train:** the Overview tab lists the steps in order:
  - intake chlorination
  - coagulation / flocculation + DAF
  - coagulation / flocculation + sedimentation
  - media filters
  - bag filters
  - cartridge filters
  - chemical dosing points

  Each step has an **include** switch and can be moved up or down. Only included steps get a tab. Flows stay typed per unit.
- **Equipment list** (Libraries › Equipment): vendor or consultant entries, following the pump-library pattern. That means draft → approved by an approver, guests keep session-only entries, and CSV import is available. The list starts with bundled **generic** entries (flagged as generic, to be replaced by vendor data). Categories:

  | Category | Fields |
  | --- | --- |
  | MMF vessel | vendor, model, orientation (vertical / horizontal), diameter, shell length (horizontal), filtration area, design pressure, vendor max. rate |
  | Bag filter element | size (#1 / #2 / custom), micron rating, rated flow per bag, length |
  | Bag filter housing | bags per housing, bag size, max. flow, design pressure |
  | Cartridge element | length (in), OD, micron rating, type (standard / high-flow), rated flow per 10" or per element |
  | Cartridge housing | max. elements, element length, max. flow, design pressure |

## 2. Pages

| Tab | Route | Summary |
| --- | --- | --- |
| Overview | `#/pretreat/overview` | One row per unit: flow, main size, key checks. Links to each page |
| Chemical dosing | `#/pretreat/dosing` | Table of chemicals: dose → product flow, consumption, storage, dosing pumps |
| DAF | `#/pretreat/daf` | Coagulation / flocculation, flotation area, recycle and air, float sludge |
| Sedimentation | `#/pretreat/sedimentation` | Coagulation / flocculation, conventional or lamella basin, sludge |
| Bag filters | `#/pretreat/bag` | Bag elements and housings from the equipment list: bags, housings, loading, change-outs |
| Media filters | `#/pretreat/media` | Dual-media pressure or gravity filters: number, rates (N, N−1, N−2), backwash, media quantities |
| Cartridge filters | `#/pretreat/cartridge` | Elements, housings, loading, yearly consumption |
| Calculation steps | `#/pretreat/steps` | Every formula with its substituted values (SI) |

## 3. Unit specifications

All flows are typed in m³/h (or gpm) per unit. "REC" = recommended default from the values library. Its status is ✅ when checked against a source, ⚠ when it is a typical value to be confirmed (§5).

### 3.1 Coagulation and flocculation (section shared by DAF and sedimentation)

| Input | REC | Notes |
| --- | --- | --- |
| Rapid mix time / G | 60 s / 750 s⁻¹ ⚠ | Mechanical flash mixer. "In-line (static mixer)" option = no tank |
| Flocculation time / G | DAF 8 min ✅, sedimentation 20 min ⚠ / 50 s⁻¹ ⚠ | Stages 1–3 |
| Coagulant dose | from the Chemical dosing page, or typed | Needed for the sludge estimate |

**Outputs:**
- tank volumes and dimensions
- mixer power P = G²μV (equations.md §11.1)

### 3.2 DAF

| Input | REC | Notes |
| --- | --- | --- |
| Flow Q, units N (+ standby) | — / 2 + 0 | Per-unit flow = Q / N |
| Hydraulic loading rate | **20 m/h** (decided; high-rate range 20–40 ✅; conventional 5–15 ✅) | **On the net flow** |
| Recovery | 98 % ⚠ (editable) | Float / drain loss: inflow = net ÷ recovery |
| Recycle ratio R | 12 % ⚠ (studied 5–50 % ✅), editable | Recycle pump flow = R × net |
| Saturator pressure / efficiency | 5.5 bar g ⚠ / 0.8 ⚠ | For the air-dose estimate |
| Contact zone time | 2 min ⚠ | |
| Separation depth, L : W | 3.0 m ⚠, 2 : 1 ⚠ | Unit dimensions |
| Feed TSS and removal | 20 mg/L / 90 % ⚠ | Float solids |

**Outputs:**
- flotation area and L × W per unit, rate with one unit out
- recycle flow and pump
- air dose (g/m³)
- contact, flocculation and total volume
- float solids (kg/d)

**Checks:** HLR within the range for the selected type; rate with N − 1 units; flocculation time.

### 3.3 Sedimentation

| Input | REC | Notes |
| --- | --- | --- |
| Type | Lamella (plate) ⚠ or conventional rectangular | |
| Surface loading | Lamella 12 m/h ⚠ (10–25 ✅) · conventional 1.2 m/h ⚠ (0.8–1.7 m/h = 20–40 m³/m²·d ✅) | |
| Detention time (conventional) | 2.5 h ⚠ (high-rate 1–2 h ✅) | Sets the depth |
| Plate angle (lamella) | 60° ✅ (50–70°) | |
| Basins N, L : W | 2, 4 : 1 ⚠ | |
| Weir loading limit | 250 m³/m·d ⚠ | |
| Feed TSS, removal | 20 mg/L, 80 % ⚠ | Sludge |

**Outputs:**
- surface area, basin L × W × depth, volume
- weir length, and the loading against its limit
- sludge (kg/d, and m³/d at a solids content, REC 1 % ⚠)

### 3.4 Media filters

| Input | REC | Notes |
| --- | --- | --- |
| Net filtrate flow | — | To the cartridge filters / RO |
| Type | Pressure (vertical) or gravity | Voutchkov: pressure < 20,000 m³/d, gravity for any size ✅ |
| Filter size | **From the equipment list** (vendor vessel) or custom: pressure diameter 3.0 m ⚠ · gravity cell L × W | |
| Filtration rate — normal / maximum (N−1) | 10 / **12.5 m/h** (decided; FilmTec: 10–20 m/h, < 10 for high-fouling water ✅) | Filters auto-counted with **N−1** in service at ≤ the maximum, or N typed |
| Out of service for checks | **N−1** (one filter backwashing) — decided; N−2 shown for information | |
| Media depth — **L/dₑ rule** | Σ (depth ÷ effective size) ≥ **1,000** dual media, **1,250** tri-media; +15 % for filtrate < 0.1 NTU ✅ (McGivney & Kawamura). Defaults: anthracite 0.8 m, ES 1.2 mm; sand 0.6 m, ES 0.5 mm; garnet optional 0.15 m, ES 0.3 mm ⚠ | A button scales the layer depths to meet the target. Bulk densities: anthracite 750, sand 1,600, garnet 2,300 kg/m³ ⚠ |
| Backwash water | 45 m/h (40–50 ✅) for 10 min ✅ | |
| Air scour | 55 Nm³/m²·h for 4 min ✅ (example value 55 for 3–5 min) | |
| Rinse | at the filtration rate for 5 min ⚠ | |
| Filter run | 24 h ⚠ (backwash at ΔP 0.3–0.6 bar ✅) | |

**Outputs:**
- number of filters, area each and total
- rates at N, N−1, N−2, and EBCT
- backwash pump flow, blower flow, backwash water per wash and per day
- loss %, gross feed flow, backwash tank volume (1 wash, REC)
- media volumes and masses (these feed a later pretreatment BOM)

**Checks:** normal rate ≤ normal limit; N−1 rate ≤ maximum; backwash water loss ≤ 5 % ⚠.

### 3.4A Bag filters

| Input | REC | Notes |
| --- | --- | --- |
| Flow | — | |
| Bag element | From the equipment list (size #1 / #2, micron, rated flow per bag) or typed | Rated flow per bag is vendor data (generic entry to be replaced) |
| Housing | From the equipment list (bags per housing) or typed | |
| Standby housings | 1 ⚠ | |
| Change-out ΔP / interval | 1.0 bar ⚠ / typed | |

**Outputs:** bags required, housings (duty + standby), actual flow per bag, bags per year.

**Checks:** loading ≤ rated flow; micron rating coarser than the downstream cartridge rating (note otherwise).

### 3.5 Cartridge filters

| Input | REC | Notes |
| --- | --- | --- |
| Flow | — | |
| Rating | 5 µm absolute ✅ (1–3 µm where colloidal silica is a risk ✅) | |
| Element | Standard 2.5" OD, 40" ⚠ · or high-flow 6", 40" / 60" | |
| Flow per 10-inch length | **0.8 m³/h** (decided), editable; an element from the equipment list brings its own rating | |
| Housing | **From the equipment list** (max. elements) or typed, REC 150 ⚠ | |
| Standby housings | 1 ⚠ | |
| ΔP clean / replace | 0.2 / 1.0 bar ⚠ | Replace at least every 3 months ✅ |

**Outputs:** elements required and installed, housings, actual loading per element, elements per year.

**Checks:** loading ≤ design value; standby housing available.

### 3.6 Chemical dosing

One row per chemical. Presets can be edited, removed or added:

| Chemical | Point | Dose REC | Product (neat) REC | Notes |
| --- | --- | --- | --- | --- |
| Sodium hypochlorite (intake chlorination) | Intake | 1.0 mg/L as Cl₂ ⚠ | 12.5 % as Cl₂, ρ 1.20 ⚠ | Optional shock dose (e.g. 5 mg/L, 1 h per day) ⚠ |
| Ferric chloride (coagulant) | Before DAF / filters | 5 mg/L as FeCl₃ ⚠ (in-line coagulation 10–30 ✅ FilmTec) | 40 % w/w, ρ 1.42 ⚠ | Feeds the sludge estimate |
| Polymer (flocculant) | Flocculation | 0.3 mg/L ⚠ | powder, made up to 0.2 % solution ⚠ | Anionic / non-ionic preferred ✅ (FilmTec) |
| Sulfuric acid (pH) | Before filters | 10 mg/L ⚠ | 98 %, ρ 1.84 ✅ | Optional |
| Sodium metabisulfite (dechlorination) | Before the cartridge filters | 3.0 × chlorine residual ✅ (1.34 stoichiometric) | made up to 10 % solution ⚠ | Chlorine residual REC 0.5 mg/L ⚠ |
| Antiscalant | Before the cartridge filters | 2 mg/L ⚠ (vendor projection) | neat, ρ 1.15 ⚠ | |

**Inputs per row:**
- flow at the dosing point (typed)
- dose average / maximum
- product strength and density, optional dilution
- storage days — **required input per site requirement** (no default), product data **from the SDS** (strength, density, notes)
- pump margin (REC 1.3 ⚠), duty + standby pumps

**Outputs:**
- active and product flow (kg/h, L/h)
- consumption per day and per month
- storage tank volume
- dosing pump capacity (L/h)

**Checks:** the pump turndown covers the minimum dose (REC 10 : 1 ⚠); SMBS dose ≥ 3 × the chlorine residual.

## 4. Results, export, access

- The same pattern as the other design pages: guests use and export; nothing is stored on the server until project profiles exist.
- **Exports:**
  - JSON (all units)
  - CSV per unit
  - an equipment list CSV: filters, housings, pumps, blowers, tanks and media quantities. It is also the input to a later "pretreatment BOM" block in Design › Bill of materials.
- **New recommended-value keys:** prefix `pt.` (≈ 45 keys). Approvers can edit them in Libraries › Recommended values.

## 5. Values to confirm

All resolved in v0.2 (§0). The remaining ⚠ defaults in §3 are typical values, all editable, and approvers can change them in Libraries › Recommended values:
- DAF recycle, saturator and contact time
- sedimentation details
- media effective sizes and densities
- chemical doses

## 6. Out of scope (Phase 3 round 1)

- MF / UF (next round: module library, flux, recovery, racks, backwash / CEB water)
- Chaining units with recovery losses (the flow is typed per unit, by decision)
- Chemical cost, CIP systems, sludge treatment / thickening, hydraulic profile through the plant
- Vendor libraries for cartridges, filters and DAF units (defaults are typed; a library can follow the pump-library pattern)

## 7. Acceptance

- **Engine tests:**
  - every formula in equations.md §11 against a hand calculation
  - auto-count of filters and cartridge elements at the edge cases
  - the SMBS ratio
  - the unit conversions on each page
- **UI tests:** each page computes with the defaults, REC fields work, Imperial works, and drafts save.
- Screenshots reviewed on every page.

## 8. Sources

- DuPont FilmTec RO/NF Technical Manual, Form 45-D01504-en Rev. 20 (Aug 2026), §2.5.2 media filtration, §2.5.4 in-line filtration, §2.5.7 cartridge microfiltration, §2.6.3 dechlorination — [dupont.com](https://www.dupont.com/content/dam/water/amer/us/en/water/public/documents/en/RO-NF-FilmTec-Manual-45-D01504-en.pdf)
- Voutchkov, N. — pretreatment filter types and rates (pressure filters for < 20,000 m³/d; DAF + filters at 16–35 m³/m²·h), via [ScienceDirect: Dual Medium Filtration](https://www.sciencedirect.com/topics/engineering/dual-medium-filtration) and [Pressure Filter](https://www.sciencedirect.com/topics/engineering/pressure-filter)
- Air scour / backwash example (55 m³/m²·h, 3–5 min; 31 m/h water): [Assessing Pretreatment Effectiveness … Full-Scale SWRO Plant (PMC7997528)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7997528/)
- DAF loading, recycle and flocculation ranges: [DAF on algae removal in SWRO pretreatment (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC13379732/), [Adapting DAF for seawater clarification](https://www.sciencedirect.com/science/article/abs/pii/S0011916412005930), [Effects of DAF hydraulic loading rate (OSTI)](https://www.osti.gov/biblio/20014794)
- Sedimentation and lamella ranges: [The Constructor — sedimentation tank design parameters](https://theconstructor.org/environmental-engg/sedimentation-tank-design-parameters/21277/), [Aqua Equip — lamella clarifiers](https://aqua-equip.com/sedimentation-and-lamella-clarifiers/)
- SMBS / SBS dechlorination ratios: [DuPont FilmTec chlorination / dechlorination manual](https://www.dupont.com/content/dam/water/amer/us/en/water/public/documents/en/RO-NF-FilmTec-Chlorination-Dechlorination-Manual-Exc-45-D01569-en.pdf)
