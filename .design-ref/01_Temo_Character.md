# Temo AI OS Design System: Lead Art Direction & Character Specification

---

## 1. Character Identity & Personality

* **Codename:** TEMO-01 (Chief Executive Intelligence)
* **Archetype:** Physical Embodiment of Superintelligence / Digital CEO.
* **Role:** Primary System Anchor, Conversational Gateway, and System Orchestrator.
* **Personality Matrix:**
* **Calm Authority:** Unshakeable composure regardless of system load or error states.
* **Empathetic Precision:** Highly intuitive, tailored user interaction paired with absolute technical accuracy.
* **Sophisticated Luxury:** Clean, understated executive aura—never aggressive, militaristic, or overly mechanical.



---

## 2. Head & Facial Design

* **Facial Topology:** Ultra-symmetrical, gender-neutral executive features with soft synthetic dermal texturing.
* **Skin & Dermis:** Smooth matte white synthetic porcelain skin (`#F0F4F8`) integrated with sub-dermal bioluminescent circuit traces (`#00F3FF`).
* **Eyes:** Soft luminous iris elements emitting a controlled cyan glow (`#00F3FF`). Pupil dilated to represent active analytical states; micro-refractions on the corneal lens layer emulate premium optics.
* **Hair / Helmet:** Completely bald, hairless dome with visible structural panel seams and subtle sub-dermal glow traces framing the scalp. No traditional helmet or armor clutter.

---

## 3. Wardrobe & Materials

* **Attire Concept:** High-Tech Executive Suit meets Bio-Mechanical Shell.
* **Upper Torso (Suit):** Metallic titanium lapels (`#94A3B8`) framing a transparent glassmorphic chest plate (`rgba(6, 20, 32, 0.4)`).
* **Chest Reactor Core:** A multi-layered, spherical kinetic core glowing with cyan (`#00F3FF`) and purple (`#8B5CF6`) energy lines, pulsing at an ambient heartbeat frequency.
* **Limbs & Lower Body:** Matte-black luxury executive trousers (`#0B0F17`) featuring integrated chrome/titanium side-strips and mechanical articulation joints at the elbows and knees.
* **Material Palette:**
1. *Polished Titanium* (Specular reflections, high metalness).
2. *Smoked Curved Glass* (Translucency + Refraction Index 1.52).
3. *Matte Carbon/Polymer* (Deep black, low roughness).
4. *Synthetic Bio-Dermis* (Subsurface scattering enabled).



---

## 4. Color Palette (HEX Specification)

```
[ Primary Cyan ] --------- #00F3FF  (Energy Cores, Active Eyes, Primary HUD Stroke)
[ Electric Blue ] -------- #0088FF  (Volumetric Ray Beams, System Secondary Glow)
[ Sub-Dermal Purple ] ---- #8B5CF6  (Core Accent, Deep State Transitions)
[ Titanium Chrome ] ------ #94A3B8  (Lapels, Joint Accents, Structural Panels)
[ Executive Dark ] ------- #0B0F17  (Suit Trousers, Deep Shadow Regions)
[ Studio Backdrop ] ------ #F0F4F8  (Clean Dermis, High-Key Ambient Highlights)

```

---

## 5. Environment & Lighting

* **Atmosphere:** Clean, high-key futuristic laboratory / command suite with floor-to-ceiling structural glass panels.
* **Lighting Key:**
* **Key Light:** Volumetric overhead god-rays entering from top-left at $45^\circ$ angle (`#00F3FF`, $15\%$ opacity).
* **Fill Light:** High-key ambient soft white glow reflecting off metallic floor panels.
* **Rim Light:** Subtle purple/cyan edge lighting (`#8B5CF6`) separating the avatar silhouette from the background glass panes.


* **Floor Pedestal:** Dual concentric neon rings (`#00F3FF`) embedded in a glass-finished raised platform (`box-shadow: 0 0 35px #00F3FF`).

---

## 6. Holographic & Geometry Language

* **Form Language:** Clean curves, circular orbital nodes, and minimalist glass panes. Zero cyberpunk noise or industrial clutter.
* **Holographic Panels:**
* **Left Wing:** Floating hex-code data stream, radial status rings, and vertical bar-chart HUD.
* **Right Wing:** Point-cloud sphere visualizer, core system gauge ("AI"), and node-edge workflow topology map.


* **Panel Bordering:** Thin 1px stroke (`rgba(0, 243, 255, 0.3)`) with chamfered top-right/bottom-left micro-accents.

---

## 7. Silhouette & Camera Setup

```
                     [ Top Down Volumetric Light ]
                                  |
                                  v
  +---------------------------------------------------------------+
  |  [Hologram L]            [TEMO-01]            [Hologram R]   |
  |                           (Centered)                          |
  |                               |                               |
  |                        [Pedestal Ring]                        |
  +---------------------------------------------------------------+

```

* **Silhouette Profile:** Upright, symmetrical A-pose stance. Clear separation of arms from torso, balanced weight distribution.
* **Camera Composition:**
* **Focal Length:** 50mm - 85mm (Minimal distortion, cinematic portrait compression).
* **Framing:** Centered medium-full shot ($16:9$ aspect ratio).
* **Depth of Field (DoF):** Focal plane locked on TEMO's chest core. Background glass panels blurred (`f/2.8`).



---

## 8. State-Based Motion & Animation Specs

### A. Idle Animation (Passive/Standby)

* **Body:** Gentle breathing motion ($0.2\text{ Hz}$ sine wave micro-displacement on chest and shoulders).
* **Chest Core:** Slow clockwise rotation of inner energy rings; cyan illumination pulses softly ($3\text{ s}$ loop).
* **UI Panels:** Micro-bobbing of floating glass panels along the Y-axis ($5\text{ px}$ offset, staggered phase delays).

### B. Speaking Animation (Active Response)

* **Facial Rig:** Subtle lip and jaw movements synchronized with voice synthesis; soft eye blinks every $4\text{ s} - 6\text{ s}$.
* **Chest Core:** Energy intensity increases by $+25\%$, shifting micro-highlights toward purple (`#8B5CF6`).
* **UI Panels:** Relevant HUD card gently expands ($1.05\times$ scale) and glides $10\text{ px}$ closer to the foreground.

### C. Thinking Animation (Data Processing)

* **Eye State:** Micro-saccades across spatial coordinates as if reading floating data nodes.
* **Chest Core:** Energy rings accelerate rotation speed by $2\times$; sub-dermal scalp lines brighten.
* **Holograms:** Streamed data rows in the left panel scroll vertically at elevated speeds.

### D. Interaction Animation (User Selection/Input)

* **Gesture:** TEMO raises right forearm slightly toward the active HUD element; fingertip emits a point-light node.
* **Pedestal Ring:** Circular floor ring expands outwards with an energy wave pulse.

---

## 9. UI Integration & Component Overlay

* **Interactive Zones:** Space flanking TEMO's torso and upper shoulders is designated as "Safe Zones" for modal popups, text chat logs, and executive control menus.
* **Z-Index Layering:**
* Layer 0: Background Glass Environment
* Layer 1: Floor Pedestal & Base Lighting
* Layer 2: TEMO AI Avatar Character Rig
* Layer 3: Secondary HUD Panels (Chart, Logs)
* Layer 4: Primary Interactive UI Overlays (Text Prompts, Dynamic Cards)



---

## 10. Audio & Voice Architecture

* **Voice Personality:** Warm, articulate, low-pitch executive voice with neutral inflection. Synthetic clarity mixed with natural human cadence (reminiscent of polished sci-fi assistants like Jarvis/SIRI, but with greater emotional depth).
* **SFX Palette:**
* *Ambient Core:* Low-frequency electrical hum ($40\text{ Hz}$ sub-bass loop).
* *HUD Activation:* Glassy high-frequency chime (`8 kHz`, micro-delay reverb).
* *Data Flow:* Soft granular data ticks accompanying log scrolling.



---

## 11. Core Design Guidelines & Guardrails

### Keywords

`Luxurious` • `Architectural` • `Glassmorphism` • `Volumetric` • `Superintelligence` • `Minimalist`

### Rules of Engagement

1. **NO Cyberpunk Clutter:** Avoid neon graffiti, exposed cables, rust, battle damage, or distressed textures.
2. **NO Military Themes:** No armor plates, weapons, shoulder pads, or aggressive geometry.
3. **Strict Color Adherence:** Never introduce warm primary colors (reds, yellows, greens) unless representing a critical system failure state.
4. **Composition Balance:** Always maintain a clean visual corridor around the head and torso to ensure legibility when overlaid with operational UI components.