# Temo OS Environment: Production-Ready Design Specification

---

## 1. Architecture & Room Layout

* **Architectural Philosophy:** Minimalist futuristic executive bridge / orbital command platform. Blends curved glass structural elements with high-end titanium paneling and open-space vistas.
* **Spatial Configuration:** Multi-tiered circular chamber featuring a central interactive pedestal, flanked by upper-deck mezzanine balconies and curved control workstations on the left and right flanks.
* **Walls:**
* *Back Wall:* $180^\circ$ continuous panoramic structural glass viewport facing deep space (nebula clusters, gas giants, planetary ring systems).
* *Side Structural Walls:* Smooth matte titanium bulkheads (`#1E293B`) with recessed indirect LED channels and embedded ultra-wide glass display matrices.


* **Floor:**
* *Base Material:* High-gloss polished obsidian glass floor (`#080C14`) with sub-surface grid illumination.
* *Reflection Index:* $0.85$ specularity, $0.05$ roughness for sharp real-time reflections of floating UI elements and background space scenes.
* *Centerpiece:* Concentric raised circular platform with embedded cyan light-rings (`#00F3FF`).


* **Ceiling:**
* Circular recessed dome ceiling with concentric LED ring light fixtures (`#E2F8FF`).
* Matte brushed-titanium outer rim (`#334155`) with hidden accent light troughs.



---

## 2. Lighting & Materials

* **Lighting Scheme:**
* *Key Light:* Cold ambient light ($6500\text{ K}$) emitted from the central dome ring and floor-embedded light bands.
* *Accent Lighting:* Deep cyan (`#00F3FF`) and electric blue (`#0088FF`) highlights along display perimeters and floor channels.
* *Volumetric Lighting:* Soft blue volumetric fog density layered across the lower ground plane ($0.12$ opacity).


* **Glass Materials:**
* *Viewport Glass:* High-transparency structural smart-glass with minimal chromatic aberration and index of refraction (IOR) of $1.52$.
* *Holographic Panels:* Smoked glassmorphism panels ($35\%$ opacity dark fill, `backdrop-filter: blur(16px)`, $1\text{px}$ crisp border stroke).


* **Metal Materials:**
* *Brushed Titanium:* Dark grey metallic surfaces (`#1E293B`) with directional anisotropy.
* *Chrome Accents:* Polished silver trim (`#94A3B8`) on furniture edges and floor trim lines.



---

## 3. Color Palette (HEX Specification)

```
[ Deep Space Black ] ----- #04070D  (Base Floor, Deep Background Voids)
[ Obsidian Glass ] ------- #080C14  (Reflective Floor Panels, Dark Displays)
[ Titanium Bulkhead ] ---- #1E293B  (Structural Beams, Workstation Bases)
[ Primary Glow Cyan ] ---- #00F3FF  (Active Data Nodes, Floor Light Rings)
[ Electric Blue ] -------- #0088FF  (Volumetric Mist, Outer Display Accents)
[ Deep Purple Accent ] --- #7C3AED  (Nebula Background Highlights, Secondary UI)
[ Clean White LED ] ------ #E2F8FF  (Ceiling Dome Ring, High-Intensity Indicators)

```

---

## 4. UI Layout, Dashboard Zones & Spatial Reserves

```
+-----------------------------------------------------------------------------------+
|  [ZONE A: Upper Deck Displays]                       [ZONE D: Deep Space Viewport] |
|   System Metrics & Global Analytics                   Data Constellations & Orbit |
|                                                                                   |
|  [ZONE B: Left Wall Console]     +-----------------+     [ZONE E: Right Wall HUD] |
|   Live Feeds & Telemetry Grid    |  ZONE C: CORE   |      Workflow Nodes          |
|                                  |  AVATAR STAGE   |                              |
|  [Workstation Left]              +-----------------+     [Workstation Right]      |
|                                   [Floor Pedestal]                                |
+-----------------------------------------------------------------------------------+

```

* **Zone A (Upper-Left Mezzanine Displays):** High-density macro system status, orbital planetary tracking, and multi-chart telemetry panels.
* **Zone B (Lower-Left Curved Wall):** Interactive high-resolution glass display array for live system logs, network topology, and 3D point-cloud models.
* **Zone C (Central Stage / Pedestal):** Reserved for primary AI character placement (Temo / AI Managers) with a clear, unobscured sightline.
* **Zone D (Center-Right Glass Viewport Area):** Large empty spatial buffer reserved for floating dynamic HUD overlays, active conversational windows, and widget cards.
* **Zone E (Right Wall Glass Matrices):** Secondary workstation terminals and financial/trading flow dashboards.

---

## 5. Atmosphere, Motion & Animation Specification

* **Atmospheric Effects:**
* *Ground Fog:* Slow-drifting volumetric cyan fog rolling across the glass floor plane ($0.05\text{ m/s}$ velocity).
* *Dust/Energy Particles:* Subtle floating ambient light motes ($0.2\text{ px}$ size) drifting vertically toward the ceiling dome.


* **Ambient Motion:**
* *Background Space Scene:* Ultra-slow rotational movement of background planetary rings ($1^\circ$ per minute) and drifting starfield/nebula gas clouds.
* *Floating Displays:* Independent micro-bobbing ($3\text{ px}$ vertical travel, $6\text{ s}$ sinusoidal period) across all suspended holographic glass panels.


* **System Animation Ideas:**
* *Startup Sequence:* Ceiling and floor rings pulse sequentially outward from center; glass wall panels fade up from $0\%$ to $35\%$ opacity with a sweeping light band.
* *Alert Mode:* Ambient lighting transitions smooth-gradient from `#00F3FF` (Cyan) to `#EF4444` (Red) along floor channels and bulkhead LED strips.



---

## 6. Camera Setup & Composition Rules

* **Primary Camera Angle (Default View):**
* *Position:* Eye-level ($1.65\text{ m}$ elevation), centered directly on the stage pedestal.
* *Focal Length:* $24\text{ mm}$ ultra-wide lens to capture panoramic space background and framing side consoles.
* *Perspective:* 1-point perspective convergence toward the center horizon.


* **Secondary Camera Angles (Focus Views):**
* *Stage Close-Up:* $50\text{ mm}$ lens zoomed on the central pedestal for 1-on-1 AI interaction.
* *Analytics View:* $35\text{ mm}$ lens angled $30^\circ$ left to frame Zone A & B displays prominently.



---

## 7. Environment Keywords & Design Rules

### Keywords

`Orbital Command` • `Architectural Glass` • `Volumetric Cyan` • `High-Key Precision` • `Executive Polish` • `Spatial Glassmorphism`

### Stable Design Rules

1. **Uncluttered Sightlines:** The center of the frame must remain open to accommodate character avatars and interactive foreground UI widgets without visual collisions.
2. **Glass Surface Uniformity:** All UI glass panels must share the same refraction index and edge-glow styling to maintain world consistency.
3. **No Industrial Noise:** Strictly prohibit industrial cables, exposed pipes, metallic rust, or distressed textures.
4. **Lighting Hierarchy:** Primary ambient light must always originate from functional architectural fixtures (ceiling ring, floor bands) rather than arbitrary invisible light sources.