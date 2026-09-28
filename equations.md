# Equations — RO Plant Design Calculator

Reference for every equation used (or planned) in the app. For each group it gives the equation, symbols and units, validity range, source, **verification status**, and where it lives in the code.

Compiled 2026-09-26. Status keys:

| Key | Meaning |
| --- | --- |
| ✅ **Verified** | checked against the primary source (or a reliable secondary source) online |
| ⚠️ **Partly verified** | form verified, a coefficient or table value not accessible online (paywalled standard) |
| ❌ **Issue** | differs from the source; correction proposed |
| 🗓 **Planned** | equation for Phase 2+ features, not implemented yet |
| ✔ **Implemented** | in the app since Phase 1 (2026-09-27), covered by `tests/engine_test.html` |

Units: SI internally (m, s, kg, Pa). Display in m³/h, mm, bar, kW. g = 9.81 m/s², P_atm = 101 325 Pa.

---

## 1. Fluid properties

### 1.1 Seawater / brine density — Sharqawy et al. (2010), eq. 8 ✅

$$\rho_{sw} = (a_1 + a_2 t + a_3 t^2 + a_4 t^3 + a_5 t^4) + (b_1 S + b_2 S t + b_3 S t^2 + b_4 S t^3 + b_5 S^2 t^2)$$

| Coefficient | Value | Coefficient | Value |
| --- | --- | --- | --- |
| a₁ | 9.999 × 10² | b₁ | 8.020 × 10² |
| a₂ | 2.034 × 10⁻² | b₂ | −2.001 |
| a₃ | −6.162 × 10⁻³ | b₃ | 1.677 × 10⁻² |
| a₄ | 2.261 × 10⁻⁵ | b₄ | −3.060 × 10⁻⁵ |
| a₅ | −4.657 × 10⁻⁸ | b₅ | −1.613 × 10⁻⁵ |

- t in °C, **S in kg/kg** (app input in g/kg ÷ 1000).
- Validity 0–180 °C, 0–0.16 kg/kg; accuracy ±0.1 %. The first bracket alone is the pure-water density (eq. 50).
- Code: `RO.fluids.densitySW` — [fluids.js](assets/js/core/fluids.js).
- Check: freshwater 20 °C → 998.02 kg/m³ (IAPWS 998.21); seawater 35 g/kg, 25 °C → 1023.56 kg/m³ (ref 1023.3).

### 1.2 Dynamic viscosity — Sharqawy et al. (2010), eqs. 22–23 ✅

$$\mu_w = 4.2844\times10^{-5} + \left[0.157\,(t + 64.993)^2 - 91.296\right]^{-1}$$

$$\mu_{sw} = \mu_w\,(1 + A S + B S^2)$$

$$A = 1.541 + 1.998\times10^{-2} t - 9.52\times10^{-5} t^2 \qquad B = 7.974 - 7.561\times10^{-2} t + 4.724\times10^{-4} t^2$$

- μ in Pa·s, S in kg/kg.
- Validity 0–180 °C, 0–0.15 kg/kg; accuracy ±1.5 % (μ_w ±0.05 %).
- Kinematic viscosity: ν = μ / ρ.
- Code: `RO.fluids.viscositySW`.
- Check: freshwater 20 °C → 1.0018 mPa·s; seawater 35 g/kg, 25 °C → 0.959 mPa·s.

### 1.3 Speed of sound and bulk modulus ✅ (salinity term extrapolated for brine)

Pure water — Marczak (1997), 0–95 °C:

$$c_w = 1402.385 + 5.038813\,t - 5.799136\times10^{-2} t^2 + 3.287156\times10^{-4} t^3 - 1.398845\times10^{-6} t^4 + 2.787860\times10^{-9} t^5$$

Salinity term — from Mackenzie (1981), surface (depth Z = 0), S in g/kg (≈ ‰):

$$c = c_w + (1.340 - 1.025\times10^{-2}\,t)\,S$$

- Mackenzie's full equation (validity −2…30 °C, S 30…40 ‰, 0–8000 m) is
  c = 1448.96 + 4.591T − 5.304×10⁻²T² + 2.374×10⁻⁴T³ + (S−35)(1.340 − 1.025×10⁻²T) + 1.630×10⁻²Z + 1.675×10⁻⁷Z² − 7.139×10⁻¹³TZ³.
- The app keeps only its salinity term, added to Marczak's pure-water value, so freshwater stays exact.
- Checks:
  - Seawater 35 g/kg, 25 °C → 1534.7 m/s (Mackenzie: 1534.5 m/s).
  - Freshwater 20 °C → 1482.38 m/s (NPL: 1482.3 m/s).
- **Brine (S > 40 g/kg):** the salinity term is extrapolated. The app flags this, and K is approximate.

Isentropic bulk modulus (the one surge analysis needs):

$$K = \rho\,c^2$$

Code: `RO.fluids.soundSpeed`, `compute()`. Check: freshwater 20 °C → 2.193 GPa (textbook ≈ 2.2 GPa).

### 1.4 Vapour pressure ✅

Pure water (Antoine, 1–100 °C), P in mmHg:

$$\log_{10} P_{v,w} = 8.07131 - \frac{1730.63}{233.426 + t} \qquad P_{v,w}[\text{Pa}] = 133.322\,P_{v,w}[\text{mmHg}]$$

Seawater — Sharqawy et al. (2010) eq. 29 (Raoult's law), S in g/kg:

$$P_{v,sw} = \frac{P_{v,w}}{1 + 0.57357\,\dfrac{S}{1000 - S}}$$

- Check: 20 °C → 2.330 kPa (steam tables: 2.339 kPa, −0.4 %).
- Upgrade option: the Hyland–Wexler / IAPWS fit (Sharqawy eq. 53, ±0.1 %):
  ln P = −5800.2206/T + 1.3914993 − 0.048640239·T + 4.1764768×10⁻⁵·T² − 1.4452093×10⁻⁸·T³ + 6.5459673·ln T (T in K, P in Pa).

### 1.6 Feed TDS → salinity ✔

The Intake design basis takes TDS (mg/L). The fluid model needs S (g/kg):

$$S = \frac{TDS}{\rho(T, S)} \quad (\text{mg/L} \div \text{kg/m}^3 = \text{g/kg}),\qquad \text{iterated from } S_0 = TDS/1025$$

Example: 41,000 mg/L at 25 °C → S ≈ 39.9 g/kg.

### 1.5 Legacy intake fluid functions ❌ → ✔ replaced in Phase 1 (Intake uses the shared fluid model §1.1–1.4; the legacy page is kept only as a regression baseline)

In [modules/intake/intake.js](modules/intake/intake.js), `rhoOf`, `nuOf`, `pVaporPa`:

| Function | Legacy form | Issue | Proposed |
| --- | --- | --- | --- |
| ρ(T) | 1025 − 0.2(T − 25) | Fixed salinity; approximate | §1.1 with user S |
| ν(T) | 1.79×10⁻⁶ / (1 + 0.033 t′ + 0.00022 t′²), t′ = T − 20 | This is Poiseuille's formula, but it references **0 °C**, and the code uses t′ = T − 20. At 28 °C it gives 1.40×10⁻⁶ m²/s; the correct value is 0.88×10⁻⁶ (+59 %) | §1.2 (decision: shared fluid model, user-overridable) |
| P_v(T) | exp(77.345 + 0.0057T − 7235/T − 8.2 ln T) | Matches steam tables within ~1 % at 20–30 °C | §1.4 |

---

## 2. Pipe geometry

| Quantity | Equation | Notes |
| --- | --- | --- |
| Inner diameter | D = OD − 2e | e = nominal wall. PPI buoyancy uses the average wall ≈ 1.06·e_min (§9) |
| Flow area | A = π D² / 4 | |
| Standard dimension ratio | SDR = OD / e | ISO 4427 series 41, 33, 26, 21, 17, 13.6, 11, 9, 7.4 |
| Velocity | V = Q / (n_lines · A) | Q total, split equally over identical parallel lines |
| Reynolds number | Re = V D / ν | Laminar < 2300 < transitional < 4000 < turbulent |

---

## 3. Friction loss (major losses)

### 3.1 Darcy–Weisbach ✅

$$h_f = f\,\frac{L}{D}\,\frac{V^2}{2g} \qquad \Delta P_f = \rho\, g\, h_f$$

### 3.2 Friction factor ✅

Swamee–Jain (1976), explicit approximation of Colebrook–White:

$$f = \frac{0.25}{\left[\log_{10}\!\left(\dfrac{\varepsilon}{3.7D} + \dfrac{5.74}{Re^{0.9}}\right)\right]^2}$$

- Validity 5×10³ ≤ Re ≤ 10⁸ and 10⁻⁶ ≤ ε/D ≤ 10⁻².
- The error vs Colebrook is typically < 1 %. The app test gives 0.1–0.7 % at the design points.

Laminar (Re < 2300): f = 64/Re.

Colebrook–White (reference only, implicit):

$$\frac{1}{\sqrt f} = -2\log_{10}\!\left(\frac{\varepsilon}{3.7D} + \frac{2.51}{Re\sqrt f}\right)$$

Code: `RO.hyd.swameeJain`, `darcyFriction`, `headLossDW` — [hydraulics.js](assets/js/core/hydraulics.js).

**Roughness (recommended, user-editable):**

| Material | ε (mm) |
| --- | --- |
| PE / PVC (new) | 0.0015–0.007 |
| GRP | 0.01–0.03 |
| Cement-lined ductile iron | 0.03–0.1 |
| Commercial steel | 0.045 |
| Stainless steel | 0.015 |

---

## 4. Minor (fitting) losses ✔

### 4.1 K-method ✅

$$h_m = \Big(\sum K_i\Big)\,\frac{V^2}{2g}$$

K is applied at the velocity of the segment the fitting sits in. For reducers and expanders, use the velocity stated for that K (below).

### 4.2 Crane TP-410 ✅ (K varies with size)

$$K = n \cdot f_T \qquad f_T = \frac{0.25}{\left[\log_{10}\!\left(\dfrac{\varepsilon_{steel}}{3.7D}\right)\right]^2}\ \ (\varepsilon_{steel} = 0.045\ \text{mm})$$

- **f_T is a property of the fitting geometry.** Crane defines it for clean commercial steel at full turbulence, and it is used for every pipe material.
- Crane f_T by size: 1″ 0.023 · 2″ 0.019 · 4″ 0.017 · 6″ 0.015 · 8–10″ 0.014 · 12–16″ 0.013. Around DN 500 the formula gives ≈ 0.012.

| Fitting | n (L/D) | Fitting | n (L/D) |
| --- | --- | --- | --- |
| 90° standard elbow | 30 | Gate valve, open | 8 |
| 90° long-radius elbow | 16 | Ball valve, full bore | 3 |
| 45° standard elbow | 16 | Plug valve, straightway | 18 |
| 180° close return | 50 | Globe valve | 340 |
| Tee, flow through run | 20 | Angle valve | 150 |
| Tee, flow through branch | 60 | Swing check valve | 100 |
| Butterfly 2–8″ / 10–14″ / 16–24″ | 45 / 35 / 25 | Lift check valve | 600 |

Fixed K values (Crane):

| Entrance / exit | K |
| --- | --- |
| Inward-projecting (Borda) entrance | 0.78 |
| Sharp-edged entrance | 0.5 |
| Slightly rounded entrance | 0.23 |
| Well-rounded / bellmouth entrance | 0.04 |
| Pipe exit | 1.0 |

### 4.3 Darby 3-K ✅ (optional, best at low Re)

$$K = \frac{K_1}{Re} + K_i\left(1 + \frac{K_d}{D_{in}^{0.3}}\right)$$

- D in inches; K_d ≈ 4 for most fittings.
- Example: threaded 90° elbow K₁ = 800, K_i = 0.14, K_d = 4.

### 4.4 Sudden area changes ✅ (textbook: Borda–Carnot)

| Change | K | Applied at |
| --- | --- | --- |
| Sudden expansion | K = (1 − (D₁/D₂)²)² | upstream velocity V₁ |
| Sudden contraction | K ≈ 0.5 (1 − (D₂/D₁)²) | downstream velocity V₂ |
| Gradual reducer / expander | from the fittings list | per list |

### 4.5 Default fittings list — see PRD §5.4

### 4.6 Manufacturer flow coefficient → K ✅ (derived)

Kv definition (water): $\Delta P[\text{bar}] = \dfrac{\rho}{1000}\left(\dfrac{Q[\text{m}^3/\text{h}]}{K_v}\right)^2$. Equating with $\Delta P = K\,\rho V^2/2$ and $V = Q/A$:

$$K = \frac{2.592\times10^{9}\,A^2}{K_v^2} = \frac{1.599\times10^{9}\,D^4}{K_v^2}\qquad (D\ \text{in m},\ K_v\ \text{in m}^3/\text{h})$$

- Cv (US gpm, psi): Kv = 0.865·Cv.
- Example: DN 100 valve with Kv = 400 → K = 1.0.

---

## 5. Route hydraulics, required head and NPSH ✔

For each segment *i* in series (suction side *s*, discharge side *d*):

$$h_i = f_i\frac{L_i}{D_i}\frac{V_i^2}{2g} + \Big(\sum K\Big)_i\frac{V_i^2}{2g}$$

| Output | Equation |
| --- | --- |
| Static head (worst case at minimum source level) | $H_{st} = z_{del} - z_{src} + \dfrac{P_{del} - P_{src}}{\rho g}$ |
| Total dynamic head | $TDH = H_{st} + \sum_s h_i + \sum_d h_i$ |
| Pump discharge pressure | $P_{dis} = P_{del} + \rho g\,(z_{del} - z_{pump} + \sum_d h_i)$ |
| NPSH available | $NPSH_a = \dfrac{P_{atm} + P_{src}}{\rho g} + (z_{src,min} - z_{pump}) - \sum_s h_i - \dfrac{P_v}{\rho g}$ |
| System curve | $H_{sys}(Q)$ evaluated point by point (f recomputed at each Q), at z_src,min and z_src,max |
| Hydraulic grade line | $HGL_{end,i} = HGL_{start,i} - h_i$ |

- NPSHa: the static term is positive when the source level is above the pump (flooded suction) and negative for suction lift. ✅
- Gravity intake: available head H_avail = z_src − z_sump ≥ Σ h_i + margin. The existing intake criterion is margin ≥ 0.20 m.

### 5.1 Route model conventions (Phase 1 implementation)

| Topic | Convention |
| --- | --- |
| Flow per line | Q_line = Q_total / n_lines on each side. The suction side is split over the **n_duty** pumps, one suction line per pump |
| Transitions between segments (D changes > 1 %) | Added automatically; the user chooses per side: **gradual** → list items RED-CONC / EXP-CONC at the small-end velocity; **sudden** → §4.4 formulas; **none** |
| Size-dependent list rows (e.g. BFV-S/M/L) | Share a code family (text before the last "-"). The row whose DN range covers the segment OD is used automatically |
| Fitting K at Reynolds number Re | `n` basis: K = n·f_T(D); `K`: fixed; `kv`: §4.6; `3k`: §4.3 with D in inches |
| Water levels vs pipe elevations | Static head uses water levels and the delivery elevation (inputs). Segment Δz is used only for the pressure profile along the line |
| Pump station source | Arrangement "gravity line + pumps": sump levels (min/max). Arrangement "pumps at sea": LAT/HAT |

### 5.2 Surge on a multi-segment line (screening)

$$a_i \text{ per segment (§7.1)},\qquad \Delta P_i = \rho\,a_i\,\Delta V_i,\qquad T_c = 2\sum_i \frac{L_i}{a_i}$$

- The governing surge is max ΔP_i, with ΔV_i the segment velocity at Q_max (instantaneous stop).
- Each segment's peak is its own steady pressure plus ΔP_gov, and it is checked against that segment's own PMA.
- This is a Joukowsky screening method; wave reflections at diameter changes are ignored.

---

## 5A. Pipeline profile (Tools › Pipeline design, PRD §8A) ✔

A single line along a surveyed profile. Every point i has a chainage x_i (horizontal distance from the start) and a ground level.

| Quantity | Equation / rule |
| --- | --- |
| Pipe centreline from cover | $z_i = z_{ground,i} - c_i - OD/2$. The cover c_i is measured to the pipe **crown**; it is given per point, otherwise the line default (recommended 1.0 m). A typed pipe level overrides it |
| Length along the pipe | $L = \sum \sqrt{\Delta x^2 + \Delta z^2}$. Both the horizontal total Σ Δx and the along-pipe total are reported |
| Segment boundaries | Contiguous chainage ranges. A boundary between two profile points is inserted by linear interpolation of z |
| Segment hydraulics | §5 route engine with L = along-pipe length and Δz = z_end − z_start |
| Loss at chainage x | $h(x) = \sum_{\text{upstream}} \big(h_{f} + h_{m,\text{unlocated}}\big)\,\dfrac{L_{\text{upstream}}}{L_{seg}} + \sum_{x_k \le x} K_k\,\dfrac{V^2}{2g} + \sum_{\text{boundaries} \le x} h_{trans}$. Friction and fittings without a chainage are spread uniformly along their segment; located fittings and diameter transitions are steps |
| Hydraulic grade line | $HGL(x) = HGL_0 - h(x)$ |
| Energy grade line | $EGL(x) = HGL(x) + V(x)^2/2g$ |
| Pressure along the line | $p(x) = \rho g\,\big(HGL(x) - z(x)\big)$ (gauge) |
| End condition (pumped) | Delivery: $HGL_{end} = z_{del} + P_{res}/\rho g$ (P_res recommended 2.0 bar). Downstream water level: $HGL_{end} = z_{water}$ |
| Required inlet (pumped) | $H_{in} = HGL_{end} + h_{total}$ · $P_{in} = \rho g\,(H_{in} - z_0)$ · $TDH = H_{in} - z_{suction\ water}$ (when a suction level is given) |
| Start condition (gravity) | Upstream water level: $HGL_0 = z_{water}$. Known pressure: $HGL_0 = z_0 + P_0/\rho g$ |
| Gravity capacity | $Q_{cap}$ solves $h_{total}(Q) = HGL_0 - HGL_{end}$ (bisection on Q; h increases monotonically with Q). Margin at design flow = available − h_total(Q_design) |
| Static line (no flow) | Pumped: $HGL_{static} = HGL_{end}$ (line held by the downstream level / check valve). Gravity: $HGL_{static} = HGL_0$ (downstream valve closed). Max static pressure = max ρg(HGL_static − z) |
| Sub-atmospheric zone | Where HGL(x) < z(x) (p < 0 bar g). Column separation where p < P_v − P_atm |
| High / low points | Interior local maxima / minima of z(x) (a flat run counts once). Air release / vacuum valve at each high point and a drain / washout at each low point — **onshore lines only**; lines marked *Submerged* (always full, e.g. intake sea lines) get no valve flags |
| Surge per point | §5.2: governing ΔP = max_i ρ a_i V_i; peak(x) = max(p_steady, p_static) + ΔP; min(x) = p_steady − ΔP; checked against that segment's PFA / PMA (§8) |
| Diameter comparison | The same profile with every catalogue segment set to a candidate OD (same SDR) |
| Quantities | Pipe length per material / OD / SDR = along-pipe length × parallel lines; fittings count per code = qty × parallel lines |

---

## 6. Pumps ✔ (except affinity laws / VFD 🗓)

| Item | Equation / rule | Status |
| --- | --- | --- |
| Curve fit (least squares) | H(Q) = a₀ + a₁Q + a₂Q² (cubic if ≥ 6 points); same form for η(Q) and NPSHr(Q) | ✔ |
| n identical pumps in parallel | H_n(Q) = H₁(Q/n) | ✅ standard |
| Operating point | H_n(Q) = H_sys(Q), solved numerically (bisection), at min and max source level | ✔ |
| Hydraulic power | P_hyd = ρ g Q H | ✅ |
| Shaft power per pump | P_shaft = ρ g Q₁ H / η_p | ✅ |
| Motor input | P_in = P_shaft / η_m | ✅ |
| Preferred operating region (ANSI/HI 9.6.3) | 0.70·Q_BEP ≤ Q ≤ 1.20·Q_BEP; high-energy pumps 0.80–1.15 | ✅ |
| NPSH margin (app default, user-editable) | NPSHa ≥ NPSHr + 0.5 m and NPSHa/NPSHr ≥ 1.1. HI 9.6.1 gives application-specific ratios | ⚠️ default is a design choice |
| Motor sizing (app default) | P_motor ≥ 1.15 × max P_shaft over the operating range | ⚠️ design choice |
| Affinity laws (future, VFD) | Q ∝ N, H ∝ N², P ∝ N³ | ✅ standard |

The legacy intake pump model (current code) uses a two-point parabola, H = H₀ − b(Q/n)² with b = (H₀ − H_r)/Q_r², and R = (fL/D + ΣK)/(2gA²n_p²). It will be replaced by fitted vendor curves (§7 of the PRD).

---

### 6.1 Pump sizing (Intake › Pump sizing) ✔

| Quantity | Equation |
| --- | --- |
| Design head with margin | $H = TDH \cdot (1 + m)$, m = head margin (recommended 10 %) |
| Hydraulic power | $P_h = \rho\,g\,Q\,H$ |
| Shaft power | $P_s = P_h / \eta_p$ (recommended 78 %; the selected library pump's η at the operating point replaces it) |
| Motor input | $P_{in} = P_s / \eta_m$ (recommended 95 %, IE3) |
| Motor per duty pump | smallest IEC standard rating ≥ $k_m \cdot P_s / n$ (k_m = motor margin, recommended 1.15) |
| Motor load | $P_s / n \,/\, P_{motor}$ ≤ $1/k_m$ |
| Recommended pipe OD | smallest catalogue OD at the segment SDR with $V \le V_{target}$ (recommended 1.5 m/s) |

TDH decomposition shown in the results: static elevation head + residual pressure head + friction + fittings/transitions = TDH (checked in tests).

### 6.2 Display units

- All calculations and stored values are SI (m³/h, m, mm, bar, kW, °C).
- Imperial display factors:

  | Quantity | SI → Imperial |
  | --- | --- |
  | Flow | 1 m³/h = 4.402868 US gpm |
  | Length / head | 1 m = 3.28084 ft |
  | Diameter / roughness | 1 mm = 1/25.4 in |
  | Pressure | 1 bar = 14.50377 psi |
  | Velocity | 1 m/s = 3.28084 ft/s |
  | Power | 1 kW = 1.341022 hp |
  | Temperature | T °F = 9/5·T °C + 32 |
  | Density | 1 kg/m³ = 0.062428 lb/ft³ |
  | Kv → Cv | Cv = 1.156·Kv |

- Friction gradient per 100 m is the same number per 100 ft (a ratio).
- Calculation steps are always shown in SI.

## 7. Water hammer / surge

### 7.1 Wave speed — Korteweg with restraint factor ✅

$$a = \frac{\sqrt{K/\rho}}{\sqrt{1 + \psi\,\dfrac{K}{E}\,\dfrac{D}{e}}}$$

Restraint factor ψ (μ = Poisson's ratio; PE ≈ 0.45, steel ≈ 0.30). Sources differ on the expansion-joint case:

| Support condition | ψ (Wylie & Streeter / common texts) | ψ (Bentley HAMMER / ASCE 1975) |
| --- | --- | --- |
| Anchored throughout (buried / butt-fused PE) | 1 − μ² | 1 − μ² |
| Anchored at upstream end only | 1 − μ/2 | 5/4 − μ |
| Expansion joints throughout | 1 | 1 − μ/2 |

- Thin-wall form, valid for D/e > ~40. PE SDR 11–17 is thick-walled, so treat a as an estimate.
- ✅ **Default ψ = 0.80** ≈ 1 − μ² (PE anchored throughout), user-editable. This is implemented. The earlier default ψ = 1 gave the lowest a and was the least conservative. Effect at the default case: a 253 → 282 m/s, ΔP 3.55 → 3.95 bar.
- **E-modulus (recommended, user-defined):**

  | Material | E |
  | --- | --- |
  | PE100 short-term | ≈ 1.0 GPa (published datasheets range 0.76–1.1 GPa) |
  | PE long-term / conservative-low | 0.3 GPa |
  | PVC-U | 3.0 GPa |
  | GRP | ~10 GPa |
  | Ductile iron | 170 GPa |
  | Steel | 207 GPa |

  E drops with temperature, so use the manufacturer's value at operating temperature.

### 7.2 Joukowsky and critical time ✅

$$\Delta P = \rho\,a\,\Delta V \qquad \Delta H = \frac{a\,\Delta V}{g} \qquad T_c = \frac{2L}{a}$$

- The full ΔP develops when the closure time t_c ≤ T_c. Slower closures reduce the surge; Joukowsky is then an upper bound.

### 7.3 Transient envelope (app convention)

$$P_{steady} = P_{del} + \Delta P_f(Q_{max}) \qquad P_{peak} = P_{steady} + \Delta P \qquad P_{min} = P_{steady} - \Delta P$$

- Check P_min against 0 bar g (sub-atmospheric) and against the vapour pressure (column separation).
- For PE intake/suction lines, also check buckling under vacuum using the **long-term** modulus (PPI Ch. 10, Step 2).

### 7.4 Legacy intake surge ❌ → ✔ replaced in Phase 1 by §7.1 / §5.2

- **Legacy form:** a = 1480 / √(1 + (2.2×10⁹ / 3×10⁸)(D/e)). This fixes K = 2.2 GPa, E = 0.3 GPa, ψ = 1, and uses a₀ = 1480 m/s (freshwater) instead of √(K/ρ) for seawater.
- **Proposed:** replace it with §7.1, using fluid properties from §1 and user-defined E and ψ.

---

## 8. PE pipe pressure class (ISO 4427)

| Quantity | Equation | Status |
| --- | --- | --- |
| Design stress | σ_s = MRS / C (rounded down, R20 series). PE100: MRS 10 MPa, PE80: 8 MPa, C = 1.25 for water → σ_s = 8.0 / 6.3 MPa | ✅ ISO 4427-1 §3.1.3.3 |
| Maximum operating pressure | MOP [bar] = 20·MRS / [C·(SDR − 1)] = 20·σ_s / (SDR − 1) | ✅ ISO 4427-1 §3.1.2.2 |
| PN (PE100) | SDR 41/33/26/21/17/13.6/11/9/7.4 → PN 4/5/6.3/8/10/12.5/16/20/25 | ✅ |
| Allowable operating pressure | PFA = f_T · f_A · PN (f_A = 1 for water) | ✅ ISO 4427-1 Annex A |
| Temperature derating f_T (PE80 and PE100) | 20 °C 1.00 · 30 °C 0.87 · 40 °C 0.74; linear interpolation permitted | ✅ ISO 4427-1:2007 Table A.1 |
| Maximum incl. surge (app) | PMA = k · PFA; k user-defined (default 1.0 = conservative) | design choice |
| Catalogue wall | e_min from the ISO 4427 table; otherwise OD/SDR rounded up to 0.1 mm (min 2.0 mm) | ✅ |
| Wall tolerance | e_max = e_min + (0.1·e_min + 0.1 mm), rounded up to 0.1 mm (ISO 11922-1 grade V) | ⚠️ grade V formula not accessible online (paywalled); confirm against the standard |

- Some secondary sources quote ISO 13761 derating values of 0.85 at 30 °C and 0.73 at 40 °C. Keep the ISO 4427-1 values as the recommended default, with the source shown.

---

## 9. Pipe buoyancy and concrete ballast ✔ (Phase 2; port of legacy Python app — Design › Supports & buoyancy)

Source: **PPI Handbook of PE Pipe, Ch. 10 Marine Installations** (rev. Jan 2026), Step 3 and Appendix A-1. All quantities per metre of pipe, in N/m.

### 9.1 Net vertical force of a fully submerged pipe ✅

$$F_{NET} = W_P + W_C - W_{DW}$$

$$W_P = \rho_P\,g\,\frac{\pi}{4}(D_O^2 - D_I^2) \qquad W_C = \rho_C\,g\,\frac{\pi}{4}D_I^2 \qquad W_{DW} = \rho_W\,g\,\frac{\pi}{4}D_O^2$$

| Symbol | Meaning |
| --- | --- |
| ρ_P | pipe material density (PE ≈ 950–960 kg/m³) |
| ρ_C | contents density (air ≈ 0; water-filled = ρ of the fluid) |
| ρ_W | surrounding water (seawater from §1.1) |

- PPI uses D_I = D_O − 2.12·D_O/DR, allowing 6 % extra wall typically added by manufacturers.
- Negative F_NET means the pipe floats (net buoyancy). **Design case: air-filled**, which gives the maximum buoyancy.
- With marine growth of thickness t_g: add its weight, and use D_O + 2t_g in W_DW.

### 9.2 Weighting and ballast ✅

| Quantity | Equation |
| --- | --- |
| Percent weighting | W% = W_S / F_NET,air × 100 (W_S = ballast **submerged** weight per metre) |
| Submerged weight of one ballast | W_bw,s = W_S · L_s (L_s = centre-to-centre spacing) |
| Ballast weight in air | $W_{bw,a} = W_{bw,s}\,\dfrac{\rho_B}{\rho_B - \rho_W}$ (reinforced concrete ρ_B ≈ 2400 kg/m³) |

PPI Table 1 (reference values; the site designer decides):

| Case | Weighting (% of air-filled net buoyancy) |
| --- | --- |
| Minimum | 5 % |
| Maximum | 85 % (float-and-sink installation keeps 15 % reserve buoyancy) |
| Trenched, gravel cover | 15–50 % |
| Trenched, fine-grained fill | 50–85 % |
| On-bottom, still water | 5–50 % |
| On-bottom, rough shallow water | 50–85 % |
| On-bottom, rough deep water | 5–50 % |

- Ballast spacing (PPI Table 2): 1 × D minimum to 12 × D maximum, centre to centre. Spacing is limited by deflection, so air pockets can't form.
- Installation bend ratio (PPI eq. 6–8): r = R/D_O; kink initiation r_b = (DR − 1)/1.12; minimum installation r_a = 1.5·(DR − 1)/1.12.

### 9.3 Anchoring safety factor (user method, corrected) — acceptance criterion

**Inputs per section** (all user-defined, because block size depends on pipe size and design constraints):

| Input | Default |
| --- | --- |
| Section length | — |
| Pipes in bundle | — |
| Block piece weight in air (kg) | — |
| Pieces per location | 2 = sandwich (top + bottom half) |
| Centre-to-centre spacing | — |
| Concrete density | 2400 kg/m³ |
| Contents | air = design case |
| Marine growth | 0 mm |

Ballast per location = piece weight × pieces per location.

**Criterion:**
- **Default set-point SF ≥ 1.5** (user-editable per project; recommended value shown with its source). Evaluated on the air-filled uplift.
- Reported alongside, for information: PPI percent weighting W% (§9.2) against Table 1, and the spacing check 1D ≤ L_s ≤ 12D.

$$SF = \frac{W_P + W_{C} + W_{ballast,sub}}{W_{DW}} \quad\text{with}\quad W_{ballast,sub} = W_{ballast,air}\left(1 - \frac{\rho_W}{\rho_B}\right)$$

Required ballast (in air) for a target SF: $W_{ballast,air} = \dfrac{SF\cdot W_{DW} - W_P - W_C}{1 - \rho_W/\rho_B}$. Number of blocks: $n = \lceil L / L_s \rceil$ (+1 if both ends are blocked).

### 9.4 Review of the legacy Python apps ❌

`legacy/PipeBuoyancyCalculator.py` (the app in the screenshot) and `legacy/BasicPipeBuoyancyCalculator.py`:

| # | Finding | Effect |
| --- | --- | --- |
| 1 | **Pipe weight counted twice.** `calculate_pipe_buoyancy` returns *net* buoyancy (displacement − pipe weight), then `calculate()` adds pipe weight to the resisting side again | Overstates SF |
| 2 | **Concrete block weight is used in air**, not submerged: missing factor (1 − ρ_W/ρ_B) = 0.573 for 2400 kg/m³ in seawater | Overstates ballast effect by 75 % |
| 3 | Displaced water uses **1000 kg/m³** (fresh), not seawater ≈ 1025 | Understates buoyancy by 2.5 % |
| 4 | "Total Blocks" display is ×2 ("sandwich"), but the force uses the single count × block weight | Resolved in the port: separate inputs for piece weight and pieces per location (§9.3) |
| 5 | Wall = nominal; PPI recommends 1.06 × e_min for weight | Minor |
| 6 | `BasicPipeBuoyancyCalculator.py` `main()` instantiates `PipeBuoyancyCalculator`, which isn't defined in that file | That file crashes when run |
| 7 | The "Basic" app applies SF to the net buoyancy of **all** pipes, then divides by one block weight. There is no spacing check against 1–12 D | Complement with PPI spacing |

Re-run of the screenshot case (OD 32 × 3.0 mm, air-filled, blocks of 12 kg):

| Section | Pipes | Spacing | Blocks | Legacy SF | Corrected SF (12 kg per location) | Corrected SF (2 × 12 kg sandwich) |
| --- | --- | --- | --- | --- | --- | --- |
| shallow | 3 | 1 m | 200 | 7.82 | 4.06 | 8.12 |
| deep | 3 | 3 m | 67 | 2.94 | **1.36 < 1.5** | 2.72 |
| gravity | 2 | 3 m | 67 | 4.17 | 2.04 | 4.08 |
| idwt | 1 | 3 m | 67 | 7.86 | 4.08 | 8.16 |

- Corrected method: SF = submerged ballast weight / air-filled net buoyancy, seawater 1025 kg/m³, concrete 2400 kg/m³.
- The legacy values reproduce the screenshot exactly, which confirms the reading of the code.
- **If each location has only 12 kg, the "deep" section is below the 1.5 threshold.**

---

### 9.5 Implementation (Phase 2) ✔

**Two safety-factor definitions.** §9.3 gave the formula as resisting ÷ uplift, while the reviewed re-run table (§9.4) used ballast ÷ net uplift. The app computes both and uses one as the criterion; you choose which, per project:

| Definition | Equation (per metre of bundle, n pipes) | Note |
| --- | --- | --- |
| **A — ballast ÷ net uplift** (default; matches the legacy workflow and the §9.4 table) | $SF_A = \dfrac{W_{ballast,sub}}{n\,(W_{DW} - W_P - W_C)}$ | Air-filled W_C = 0. The ballast alone must hold the pipe down |
| **B — total down ÷ buoyancy** | $SF_B = \dfrac{n\,(W_P + W_C) + W_{ballast,sub}}{n\,W_{DW}}$ | Standard factor of safety against flotation |

- **Ballast per metre:** $W_{ballast,sub} = \dfrac{m_{piece}\cdot k_{pieces}\cdot g\,(1 - \rho_W/\rho_B)}{L_s}$ (m_piece in kg, k = pieces per location, L_s = centre-to-centre spacing).
- **Required mass per location** for the target SF (definition A): $m_{loc} = \dfrac{SF\cdot n\,(W_{DW} - W_P - W_C)\,L_s}{g\,(1 - \rho_W/\rho_B)}$. For definition B: $m_{loc} = \dfrac{(SF\cdot n W_{DW} - n(W_P + W_C))\,L_s}{g\,(1 - \rho_W/\rho_B)}$.
- **Largest spacing** for the entered piece weight: solve the same equation for L_s.
- **Locations** on a section of length L: $N = \lceil L/L_s \rceil + 1$ (both ends blocked). **Pieces** = N × k. **Concrete volume** = N·m_loc/ρ_B.
- **Wall for weight:** $D_I = D_O - 2 \times 1.06\,e$ (PPI: manufacturers add ≈ 6 % wall); e = catalogue minimum wall (ISO 4427) or the custom wall.
- **Water:** surrounding water ρ_W = seawater at the design temperature (§1.1). The contents of a water-filled case use the shared fluid density.
- **PPI ranges vs the SF criterion:** PPI's weighting ranges (5–85 %) assume the pipe runs water-filled. An air-filled SF_A ≥ 1 already means W% ≥ 100 %, so the SF criterion is always above them. That is why the range is shown as a note, not a check.
- **Reported for information:** PPI percent weighting $W\% = W_{ballast,sub}/(n(W_{DW} - W_P)) \times 100$ against the installation case in Table 1, and the spacing range 1·D_O ≤ L_s ≤ 12·D_O (Table 2).
- **Regression:** the §9.4 case "deep" (3 × OD 32 × 3.0, 12 kg per location every 3 m, wall factor 1.0, ρ_P = 960 kg/m³) gives SF_A = 1.36.

## 9B. Bill of materials rules (Phase 2) ✔

The BOM is built from the Intake route (gravity, suction, discharge) and from the Tools › Pipeline design line. It counts each route item × the number of lines it runs in:
- gravity and discharge segments: × parallel lines
- pump-local segments (suction, "per pump" discharge): × installed pumps (duty + standby)

| Item | Rule |
| --- | --- |
| Pipe | Net length per material / OD / SDR (along the pipe). Order length = net × (1 + allowance), allowance recommended 3 %. Pipe lengths = ⌈order length / stick length⌉, stick recommended 12 m |
| Inline joints per segment | ⌈L / stick⌉ − 1 per line, of the segment's joint method: butt fusion joint · electrofusion coupler · weld · mechanical coupling · **flanged** = 2 stub ends + backing rings, 1 gasket, 1 bolt set |
| Fittings | Every list item flagged BOM, qty × lines, per OD |
| Fitting ends | Tee 3, cross 4, air valve 1 (branch), flap valve 1, others 2. The list's `connection` sets the joint for each end: **butt_fusion** / electrofusion / mechanical → one joint of that kind; **flanged** → 1 stub end + backing ring (PE) or weld-neck flange (steel), 1 gasket, 1 bolt set |
| Joint / flange list items | Counted as themselves. A flange adaptor pair adds 1 gasket + 1 bolt set; a dismantling joint adds 2 flanged ends |
| Flange size | DN = largest standard DN ≤ OD (e.g. OD 630 → DN 600); PN = the pipe's PN rating, at least PN 10 (EN 1092-1 drilling) |
| Ballast | From Supports & buoyancy: pieces per piece weight, and concrete volume |
| Pumps | Intake pump station: duty + standby, with the selected pump model when one is chosen |

---

## 10. Seawater intake — legacy equations (as in `legacy/intake_calc_original.html`; Phase 1 status per row)

| Item | Legacy form (intake.js) | Status |
| --- | --- | --- |
| Gravity head budget | H_avail = h_LAT − z_sump; H_req = h_f + Σh_m; margin ≥ 0.2 m | ✅ standard |
| Pipe auto-sizing | smallest DN with margin > 0 and 0.8 ≤ V ≤ 2.0 m/s (gravity), 1.5 ≤ V ≤ 2.5 m/s (pumped) | design criteria (user-editable later) |
| Minimum submergence | **S = D·(1 + 2.3·F_D), F_D = V/√(g·D)** (ANSI/HI 9.8) — implemented. Replaces the legacy S_min = 0.7·V·√D | ✅ form widely cited from ANSI/HI 9.8 (the standard itself is paywalled). Default case: 0.535 → 1.055 m, check still passes |
| Sump volume | V = Q·t_ret, t_ret = 180 s | design rule |
| Sediment critical velocity | V_sc = √(8·0.04/f · g(s − 1)·d), s = 2.65, d = 0.2 mm | Camp / Shields-type; design check |
| NPSHa (legacy) | submersible: h_sub + h_atm − h_vap; dewatering: h_atm − h_lift − h_vap (no suction friction) | ❌ omits suction losses → ✔ replaced by §5 in Phase 1 |

---

## 11. Pretreatment (Phase 3) ✔ — see "Pretreatment Module — PRD.md" v0.2

Every unit takes its own flow (m³/h). Status marks: ✅ = checked against a source listed below, ⚠ = typical value still to be confirmed against your consultant list.

### 11.1 Coagulation and flocculation (shared by DAF and sedimentation) ✅

| Quantity | Equation |
| --- | --- |
| Tank volume | $V = Q\,t$ (rapid mix t in s, flocculation t in min) |
| Velocity gradient → mixer power | $P = G^2\,\mu\,V$ (Camp–Stein; μ from the shared fluid) |
| Coagulant solids (sludge) | Fe(OH)₃ from FeCl₃: $m = 0.659\,m_{FeCl_3}$ (106.87 / 162.2, stoichiometric) |

### 11.2 Dissolved air flotation (DAF)

| Quantity | Equation |
| --- | --- |
| Inflow | $Q_{in} = Q_{net}/r$ (r = recovery; float / drain loss = Q_in − Q_net) |
| Recycle flow | $Q_r = R\,Q_{net}$ |
| Flotation (separation) area per unit | $A = \dfrac{Q_{net}/N}{HLR}$ — **HLR on the net flow** (PRD v0.2); rate with one unit out $= Q_{net}/((N-1)A)$ |
| Contact zone volume | $V_c = Q_{net}(1+R)\,t_c / N$ |
| Flocculation volume | $V_f = Q\,t_f / N$ (§11.1) |
| Air delivered | $A_{dose} = \dfrac{R\,s_a\,(f\,P_{abs}/P_{atm} - 1)}{1+R}$ (g/m³ of total flow; s_a = air solubility at 1 atm, f = saturator efficiency) ⚠ |
| Float (sludge) solids | $S = Q\,(TSS_{in}\,\eta + 0.659\,d_{FeCl_3})$ kg/d |

### 11.3 Sedimentation (conventional or lamella)

| Quantity | Equation |
| --- | --- |
| Surface area | $A = Q/SOR$ (lamella: basin plan area at the lamella loading rate) |
| Depth from detention | $h = SOR \cdot t_d$ (conventional) |
| Basin size | N basins, L : W ratio → $W = \sqrt{A/(N\,r)}$, $L = r\,W$ |
| Weir loading | $WLR = Q\,/\,L_{weir}$ (m³/m·d) |
| Sludge | as §11.2 with the settling removal efficiency |

### 11.4 Media filters (dual media, gravity or pressure) ✅

| Quantity | Equation |
| --- | --- |
| Area per filter | Pressure vertical: $A_f = \pi D^2/4$ · gravity: $A_f = L \times W$ |
| Filtration rate | $v_N = \dfrac{Q_{gross}}{N\,A_f}$, and with filters out of service $v_{N-1}$, $v_{N-2}$ |
| Number of filters (auto) | smallest N with $v_{N-1} \le v_{max}$ and $v_N \le v_{normal}$ |
| Empty-bed contact time | $EBCT = (h_{anthracite} + h_{sand})/v$ |
| Backwash pump / blower | $Q_{bw} = v_{bw}\,A_f$ · $Q_{air} = v_{air}\,A_f$ (Nm³/h) |
| Backwash water per wash | $V_{bw} = v_{bw}\,A_f\,t_{bw} + v_{rinse}\,A_f\,t_{rinse}$ |
| Daily loss and gross flow | $V_{day} = N\,V_{bw}\,(24/T_{cycle})$ · $Q_{gross} = Q_{net} + V_{day}/24$ (iterated) · loss % = $V_{day}/(24\,Q_{gross})$ |
| Media quantities | $V = N\,A_f\,h$ per layer; mass = V × bulk density ⚠ |
| **Bed depth — L/dₑ rule** ✅ | $\sum_i \dfrac{L_i}{d_{e,i}} \ge 1000$ (mono / dual media) or $\ge 1250$ (tri-media, coarse deep beds); **× 1.15** for filtrate < 0.1 NTU (McGivney & Kawamura). L in mm, dₑ = effective size in mm |
| Scaling depths to the target | $L_i' = L_i \cdot \dfrac{(L/d)_{target}}{\sum L_i/d_{e,i}}$ (keeps the layer proportions) |
| Filters (N−1 rule) | smallest N with $Q_{gross}/((N-1)A_f) \le v_{max}$ (12.5 m/h) and $Q_{gross}/(N A_f) \le v_{normal}$ |

### 11.4A Bag filters

| Quantity | Equation |
| --- | --- |
| Bags | $n = \lceil Q / q_{bag}ceil$ (q_bag = rated flow per bag, vendor) |
| Housings | $n_h = \lceil n / n_{bags/housing}ceil$ duty + standby |
| Actual loading | $q = Q/(n_h\,n_{bags/housing})$ |
| Bags per year | installed × 12 / change-out interval (months) |

### 11.5 Cartridge filters ✅ (flow per element ⚠ — vendor data)

| Quantity | Equation |
| --- | --- |
| Elements | $n = \left\lceil \dfrac{Q}{q_{10}\,(L/10'')} \right\rceil$ (q₁₀ = flow per 10-inch length) |
| Housings | $n_h = \lceil n / n_{max}\rceil$ duty + standby; elements installed = $(n_h + n_{sb})\,n_{max}$ |
| Actual loading | $q = Q\,/\,(n_h\,n_{max})$ per element |
| Yearly elements | installed × 12 / replacement interval (months) |

### 11.6 Chemical dosing ✅

| Quantity | Equation |
| --- | --- |
| Active chemical | $\dot m_a = Q \cdot d / 1000$ kg/h (Q m³/h, d mg/L as active, e.g. as Cl₂ or as FeCl₃) |
| Neat product | $\dot m_p = \dot m_a / w$ (w = mass fraction) · $\dot V_p = \dot m_p / \rho_p$ L/h |
| Diluted solution (optional) | $\dot V_s = \dot m_a / (c_s\,\rho_s)$ (c_s = solution strength) |
| Dechlorination | $d_{SMBS} = k \cdot Cl_{2,res}$; stoichiometric k = 1.34, **practice k = 3.0** (FilmTec) |
| Consumption and storage | per day = 24·ṁ; storage volume = $\dot V_p \cdot 24 \cdot$ days (at average dose). **Days per site requirement / SDS**, no default |
| Dosing pump | capacity ≥ margin × $\dot V$ at maximum dose and maximum flow; duty + standby |

**Sources (Phase 3):**
- DuPont FilmTec RO/NF Technical Manual, Form 45-D01504-en Rev. 20 (Aug 2026), §2.5.2–2.5.7 (media filters 10–20 m/h, < 10 m/h for high-fouling water, backwash 40–50 m/h for ≈ 10 min at ΔP 0.3–0.6 bar; cartridge 5 µm absolute, sized per manufacturer, replaced at least every 3 months; in-line ferric 10–30 mg/L) and §2.6.3 (SMBS 1.34 stoichiometric, 3.0 practice).
- DAF: high-rate 20–40 m/h, conventional 5–15 m/h; recycle 5–50 % studied; flocculation 5–8 min for DAF (MDPI / ScienceDirect DAF seawater studies, see PRD).
- Sedimentation: lamella 10–25 m/h; conventional overflow 20–40 m³/m²·d; high-rate basins 1–2 h detention (textbook ranges, see PRD).
- Voutchkov, *Pretreatment for Reverse Osmosis Desalination* (Elsevier 2017): pressure filters for plants < 20,000 m³/d, gravity for any size.
- L/dₑ bed-depth rule: McGivney & Kawamura, via *Granular filter media: evaluating filter bed depth to grain size ratio* (Filtration + Separation) and Encyclopedia MDPI "Filtration for Water Treatment".

---

## 12. References

1. Sharqawy, M.H., Lienhard, J.H., Zubair, S.M. (2010). *Thermophysical properties of seawater: a review of existing correlations and data.* Desalination and Water Treatment 16, 354–380. [MIT PDF](https://web.mit.edu/lienhard/www/Thermophysical_properties_of_seawater-DWT-16-354-2010.pdf)
2. Marczak, W. (1997). *Water as a standard in the measurements of speed of sound in liquids.* JASA 102(5). [NPL guide](http://resource.npl.co.uk/acoustics/techguides/soundpurewater/marczak.html)
3. Mackenzie, K.V. (1981). *Nine-term equation for sound speed in the oceans.* JASA 70(3), 807–812. [AIP](https://pubs.aip.org/asa/jasa/article/70/3/807/771547/Nine-term-equation-for-sound-speed-in-the-oceans)
4. Swamee, P.K., Jain, A.K. (1976). *Explicit equations for pipe-flow problems.* [EngineerExcel summary](https://engineerexcel.com/swamee-jain-equation/)
5. Crane Co. *Technical Paper 410 — Flow of Fluids.* [K-factor summary](https://simupipe.com/resources/k-factor-table)
6. Darby, R. (2001). *Chemical Engineering Fluid Mechanics* — 3-K method. [AFT docs](https://docs.aft.com/fathom/3KDarbyMethod.html), [Neutrium](https://neutrium.net/articles/fluid-flow/pressure-loss-from-fittings-3k-method/)
7. Wylie, E.B., Streeter, V.L. *Fluid Transients*; Bentley HAMMER docs — [Celerity and pipe elasticity](https://docs.bentley.com/LiveContent/web/Bentley%20HAMMER%20SS6-v1/en/GUID-860F7792-1873-46A7-A07D-06FB40F62D8B.html)
8. Joukowsky equation — [Leon, Water hammer lecture notes (FIU)](https://web.eng.fiu.edu/arleon/courses/Transient_flows/Lectures/Waterhammer.pdf)
9. ISO 4427-1:2007 *PE pipes and fittings for water supply — Part 1: General* (§3, Annex A). [PDF copy](https://www.pespipe.com/Portals/0/DNNGalleryPro/uploads/2019/4/2/ISO_4427-1-2007.pdf)
10. ISO 11922-1:2018 *Thermoplastics pipes — dimensions and tolerances* (paywalled). [ISO](https://www.iso.org/standard/65255.html)
11. ANSI/HI 9.6.3 *Rotodynamic pumps — Guideline for operating regions.* [AFT summary](https://www.aft.com/component/content/article/2-uncategorised/852-api-and-hi-pump-operating-range)
12. NPSH available — [Pumps & Systems step-by-step](https://www.pumpsandsystems.com/centrifugal-pumps/npsh-calculation-step-step-guide), [Wikipedia](https://en.wikipedia.org/wiki/Net_positive_suction_head)
13. Plastics Pipe Institute, *Handbook of PE Pipe*, Ch. 10 Marine Installations (rev. Jan 2026). [PDF](https://plasticpipe.org/common/Uploaded%20files/1-PPI/Manuals-Design%20Guides/Handbook%20of%20PE%20Pipe/SECOND_EDITION_HANDBOOK_OF_PE_PIPE_2008/Chapter_10_-_Marine_Installations/Chapter%2010%20-%20Marine%20Installations.pdf)
