# 08_User_Flows.md

---

# TEMO AI OS Complete User Journey Specifications

This document defines the complete end-to-end User Flows for **TEMO AI OS**[cite: 3, 5]. It strictly enforces the visual, physical, and technical standards established in the **TEMO AI OS Visual Design Bible**[cite: 5], **UI Component Library Specification**[cite: 6], and **Page Layouts & Information Architecture Specification**[cite: 9]. 

Every core interaction journey—from cold launch to mission completion and error recovery—is fully specified without code generation[cite: 5].

---

## 1. Global Journey Framework & Standards

Across all 21 user journeys, interactions strictly comply with TEMO OS spatial principles[cite: 2, 6]:
* **Spatial Anchoring:** TEMO-01 (or the active Manager) remains anchored on the central stage pedestal (Zone C), while dynamic interaction cards inhabit Zone D[cite: 2, 3, 6].
* **Audio Feedback:** Synthesized voice output uses warm, low-pitch executive audio ($40\text{ Hz}$ sub-bass core hum, $8\text{ kHz}$ glassy chimes for HUD activation)[cite: 3].
* **Visual States:** Active states illuminate Primary Cyan (`#00F3FF`), department themes use signature tokens (e.g., Deep Violet `#8B5CF6` for Nova), and critical alerts utilize Red (`#EF4444`)[cite: 1, 3, 6].

---

## 2. Comprehensive User Flows

---

### Journey 1: First Launch

* **Goal:** Initialize TEMO AI OS for the first time, establish core 3D orbital glass environment, calibrate volumetric lights, and boot character reactors[cite: 2, 3, 6].
* **Entry point:** Application execution / First domain access (`/`).
* **User actions:**
  1. Launches TEMO AI OS executable or navigates to web interface[cite: 6].
  2. Observes automated environment boot and character awakening[cite: 2, 3].
* **System actions:**
  1. Initializes App Shell and renders Zone A–E 3D orbital glass bridge[cite: 2, 6].
  2. Executes boot sequence: overhead LED rings illuminate ($0 \to 100\%$), obsidian floor grid lights up, volumetric fog starts rolling[cite: 2, 3].
  3. TEMO-01 avatar materializes on Zone C pedestal; chest reactor core shifts from dimmed gray to pulsing Active Cyan (`#00F3FF`)[cite: 2, 3, 6].
  4. Top Navigation and Left Navigation rails slide in from edges[cite: 6].
* **Backend APIs involved:** `POST /api/v1/system/init`, `GET /api/v1/system/config`
* **Manager participation:** TEMO-01 (Primary System Anchor)[cite: 3].
* **Animations:** Overhead LED sweep ($0.4\text{ s}$ ease-out), floor ring pulse wave expansion, TEMO posture elevation from standby to active executive posture[cite: 2, 3].
* **Transitions:** $0.6\text{ s}$ cubic-bezier environment fade-in from pure black void[cite: 6].
* **Voice behavior:** TEMO-01 speaks: *"TEMO AI OS initialized. Core systems operational. Welcome, Commander."*[cite: 3]
* **Success state:** App Shell rendered, TEMO-01 standing in idle breathing state ($0.2\text{ Hz}$ sine wave), landing automatically at Onboarding sequence[cite: 3, 6].
* **Failure state:** Critical Red screen overlay (`#EF4444`), error modal displaying *"Graphics Engine / API Connection Failed"*, with "Re-initialize Boot" primary button[cite: 6].

---

### Journey 2: Onboarding

* **Goal:** Configure user profile, select AI voice model preferences, connect primary workspace APIs, and introduce Department Managers[cite: 1, 3, 6].
* **Entry point:** Automatic transition from First Launch or `/onboarding`.
* **User actions:**
  1. Clicks "Begin Executive Calibration" CTA on centered glass onboarding modal[cite: 6].
  2. Inputs User Name and Executive Role[cite: 6].
  3. Selects primary organizational focus (Engineering, Trading, Marketing, Automation)[cite: 1].
  4. Tests and confirms Voice Orb synthesizer settings[cite: 6].
  5. Clicks "Complete Setup"[cite: 6].
* **System actions:**
  1. Displays multi-step Glass Modal overlay over dimmed 3D scene[cite: 6].
  2. Highlights corresponding Department Manager on Zone C pedestal as user selects focus areas (e.g., Nova highlights when "Engineering" is picked)[cite: 1, 3, 6].
  3. Saves user preferences into long-term system settings and vector memory[cite: 6].
* **Backend APIs involved:** `POST /api/v1/user/onboard`, `POST /api/v1/settings/save`, `POST /api/v1/memory/store`
* **Manager participation:** TEMO-01 leads, introducing Nova, Echo, Flow, Luna, Atlas, or Orion based on user selection[cite: 1, 3].
* **Animations:** Modal step transition ($X\text{-axis}$ slide $20\text{px}$, $0.25\text{ s}$ cubic-bezier), Manager avatars rotate $15^\circ$ toward camera with illuminated chest core when selected[cite: 1, 3, 6].
* **Transitions:** Glass modal fades out; background scene blurs clear ($8\text{px} \to 0\text{px}$)[cite: 6].
* **Voice behavior:** TEMO-01 guides each step: *"Please state your operational parameters... Core calibration complete. Transferring to Command Bridge."*[cite: 3]
* **Success state:** User profile created, default preferences saved, user routed to `/dashboard`[cite: 6].
* **Failure state:** Inline red validation errors on missing fields; "Retry Calibration" toast on network save failure[cite: 6].

---

### Journey 3: Dashboard Navigation

* **Goal:** Monitor system performance, inspect macro metrics, and navigate between operational zones[cite: 2, 6, 9].
* **Entry point:** Left Navigation "Command Bridge" item or `/dashboard`[cite: 6, 9].
* **User actions:**
  1. Views system metrics across Zone A, B, and D cards[cite: 2, 6, 9].
  2. Hovers over Department Health Cards to inspect active sub-agents[cite: 1, 6, 9].
  3. Clicks a specific Department Health Card (e.g., Orion Trading)[cite: 1, 6, 9].
* **System actions:**
  1. Renders macro telemetry, active missions, and activity feeds in glass cards[cite: 6, 9].
  2. Camera shifts $30^\circ$ smoothly to frame selected department telemetry[cite: 2, 6].
  3. TEMO-01 steps aside on central stage; target Department Manager (e.g., Orion) glides to center stage with Imperial Gold core glow (`#EAB308`)[cite: 1, 3, 9].
* **Backend APIs involved:** `GET /api/v1/system/telemetry`, `GET /api/v1/missions/active`, `WS /ws/v1/activity-stream`[cite: 9]
* **Manager participation:** TEMO-01 hands off stage focus to selected Department Manager[cite: 1, 3, 9].
* **Animations:** Floating card vertical sine-wave float ($\pm 4\text{ px}$), camera focus transition over $0.6\text{ s}$ ease-in-out, manager swap transition[cite: 1, 2, 3, 6].
* **Transitions:** Smooth layout camera pan and panel z-index re-ordering[cite: 2, 6].
* **Voice behavior:** Manager takes focus and states: *"Orion standing by. Financial telemetry live."*[cite: 1, 3]
* **Success state:** User transitioned to deep department view with active Manager on stage[cite: 1, 3, 9].
* **Failure state:** Disconnected telemetry card displaying Red warning border (`#EF4444`) and "Reconnect Stream" button[cite: 6, 9].

---

### Journey 4: Talking with Temo

* **Goal:** Conduct a continuous multi-modal conversational exchange with TEMO-01 for inquiry, analysis, or system execution[cite: 3, 6, 9].
* **Entry point:** Navigating to `/chat` or clicking the Chat icon on Left Navigation[cite: 6, 9].
* **User actions:**
  1. Types prompt into bottom Input Bar or clicks Voice Orb[cite: 6, 9].
  2. Sends message: *"Analyze last week's API errors and summarize root causes."*[cite: 6, 9]
  3. Observes response and interacts with inline dynamic widgets[cite: 6, 9].
* **System actions:**
  1. Focuses Chat Window ($60\%$ width left), retaining Zone C TEMO avatar ($40\%$ right)[cite: 3, 6, 9].
  2. Displays User message bubble (Electric Blue border `#0088FF`)[cite: 6].
  3. Renders TEMO Chat Bubble with real-time streaming text and cyan trailing cursor node[cite: 6, 9].
  4. TEMO-01 avatar eye micro-saccades activate, chest reactor pulses (+25% intensity) in sync with text/voice stream[cite: 3, 6, 9].
* **Backend APIs involved:** `POST /api/v1/chat/completions` (SSE Stream), `GET /api/v1/chat/history`[cite: 9]
* **Manager participation:** TEMO-01 (Primary)[cite: 3, 9].
* **Animations:** Real-time character lip sync, chest reactor brightness pulse, auto-scrolling chat thread ($0.2\text{ s}$ smooth ease)[cite: 3, 6, 9].
* **Transitions:** Input Bar expands vertically on long text; background subtle cyan particle stream active during inference[cite: 6, 9].
* **Voice behavior:** TEMO-01 synthesizes vocal output in real-time matching text generation cadence[cite: 3, 6, 9].
* **Success state:** Full response generated, actionable code/summary cards rendered in thread[cite: 6, 9].
* **Failure state:** Chat Bubble displays Critical Red border (`#EF4444`) with "Retry Stream" action button[cite: 6, 9].

---

### Journey 5: Creating a Mission

* **Goal:** Formulate and launch a multi-step autonomous goal executed by multi-agent teams[cite: 1, 6, 9].
* **Entry point:** "Create Mission" button on `/missions` page or command entry in Chat[cite: 6, 9].
* **User actions:**
  1. Clicks "Create Mission" CTA[cite: 6, 9].
  2. Fills Mission Creation Wizard modal: Mission Name, Objective, Target Department, Priority, and Max Token Budget[cite: 6, 9].
  3. Assigns Lead Manager (e.g., Flow for Automation)[cite: 1, 9].
  4. Clicks "Launch Autonomous Mission"[cite: 6, 9].
* **System actions:**
  1. Validates mission parameter fields[cite: 6].
  2. Compiles mission DAG graph and assigns sub-agents[cite: 1, 6, 9].
  3. Spawns new Mission Card on `/missions` grid with pulsing progress path[cite: 6, 9].
  4. Routes user to Mission Details (`/missions/:missionId`)[cite: 6, 9].
* **Backend APIs involved:** `POST /api/v1/missions/create`, `GET /api/v1/agents/available`[cite: 9]
* **Manager participation:** Flow (Orchestration Lead) accepts assignment alongside assigned Department Manager[cite: 1, 9].
* **Animations:** Mission Card materializes with elastic scale-up ($0.95 \to 1.0$), border glows with Lead Manager theme color[cite: 1, 6].
* **Transitions:** Modal closes; smooth screen push transition to Mission Details view[cite: 6, 9].
* **Voice behavior:** Flow speaks: *"Mission parameters received. Constructing multi-agent execution pipeline."*[cite: 1, 3]
* **Success state:** Mission initialized, visible on Mission Board, DAG nodes active[cite: 6, 9].
* **Failure state:** Form validation error highlighting missing fields in red; toast alert on API failure[cite: 6, 9].

---

### Journey 6: Mission Execution

* **Goal:** Real-time monitoring and interactive supervision of an ongoing autonomous mission[cite: 1, 6, 9].
* **Entry point:** Selecting an active mission card on `/missions` or arriving via Mission Creation[cite: 6, 9].
* **User actions:**
  1. Observes execution flow across node-edge canvas[cite: 1, 6, 9].
  2. Clicks "Pause Execution" or "Inject Directive" on active control bar[cite: 6, 9].
* **System actions:**
  1. Renders active DAG node graph on canvas[cite: 1, 6, 9].
  2. Connects nodes with animated light-particle streams representing active data payloads[cite: 1, 6, 9].
  3. Updates progress bar percentage and time elapsed metrics in real-time[cite: 6, 9].
  4. Highlights individual Manager Nodes as they assume control of specific sub-tasks[cite: 1, 6, 9].
* **Backend APIs involved:** `WS /ws/v1/missions/:id/trace`, `PATCH /api/v1/missions/:id/status`[cite: 9]
* **Manager participation:** Flow supervises, calling upon Nova, Echo, Atlas, Luna, or Orion dynamically[cite: 1, 9].
* **Animations:** Continuous particle packet streaming along wires, border gradient march on active Worker Nodes[cite: 1, 6, 9].
* **Transitions:** Smooth pan/zoom canvas updates; node state color shifts (Gray $\to$ Glowing Accent $\to$ Mint Green `#10B981`)[cite: 6, 9].
* **Voice behavior:** Manager provides status updates on key step completions[cite: 1, 3].
* **Success state:** All nodes complete green checkmark verification; progress reaches $100\%$[cite: 6, 9].
* **Failure state:** Failed node stops stream, turns Critical Red (`#EF4444`), launches Error Recovery flow[cite: 6, 9].

---

### Journey 7: Live Timeline

* **Goal:** Audit system activity history, scrub past execution states, and review scheduled operations[cite: 6, 9].
* **Entry point:** Accessing `/notifications` or selecting "Timeline View" on Right Context Panel[cite: 6, 9].
* **User actions:**
  1. Scrolls through vertical bioluminescent axis line[cite: 6, 9].
  2. Drags timeline scrubber back to an earlier timestamp[cite: 6, 9].
  3. Clicks a timeline event node[cite: 6, 9].
* **System actions:**
  1. Renders central glowing axis line with chronological event cards[cite: 6, 9].
  2. Replays system state for the selected timestamp across background cards[cite: 6, 9].
  3. Opens event detail drawer showing raw input/output payloads and agent logs[cite: 6, 9].
* **Backend APIs involved:** `GET /api/v1/timeline/history`, `GET /api/v1/timeline/event/:id`
* **Manager participation:** Atlas (Knowledge & History) and TEMO-01[cite: 1, 3, 9].
* **Animations:** Downward light pulse along active execution line, event cards expand $1.05\times$ on hover[cite: 3, 6, 9].
* **Transitions:** Timeline scrubbing smoothly fades non-relevant event cards to $40\%$ opacity[cite: 6].
* **Voice behavior:** Atlas speaks: *"Accessing historical telemetry log for target timestamp."*[cite: 1, 3]
* **Success state:** Target event expanded, detailed execution logs displayed[cite: 6, 9].
* **Failure state:** "Log Stream Corrupted" notice with "Re-index Vector Log" action[cite: 6, 9].

---

### Journey 8: Viewing Managers

* **Goal:** Inspect Department Managers, examine their performance metrics, tools, and assigned sub-agents[cite: 1, 6, 9].
* **Entry point:** Navigating to `/agents` or selecting a Manager from the Command Palette ($⌘K$)[cite: 6, 9].
* **User actions:**
  1. Selects "Managers" tab on `/agents` page[cite: 6, 9].
  2. Clicks on a specific Manager card (e.g., Nova — Engineering Manager)[cite: 1, 6, 9].
  3. Navigates to `/agents/manager/nova`[cite: 6, 9].
* **System actions:**
  1. Loads $1:1$ 3D Manager Avatar on Stage Pedestal (Zone C)[cite: 1, 3, 9].
  2. Sets global UI accents and borders to Manager's signature color (e.g., Deep Violet `#8B5CF6` for Nova)[cite: 1, 6, 9].
  3. Displays Department Performance Telemetry, Connected Tools, and Active Workflows on right glass panels[cite: 1, 6, 9].
* **Backend APIs involved:** `GET /api/v1/managers/nova`, `GET /api/v1/managers/nova/telemetry`[cite: 9]
* **Manager participation:** Selected Manager (Nova) takes stage center[cite: 1, 3, 9].
* **Animations:** Smooth camera pan focusing on Manager's chest reactor, department color core emission pulse[cite: 1, 3, 9].
* **Transitions:** App Shell border accent shifts smoothly to department color token over $0.4\text{ s}$[cite: 1, 6].
* **Voice behavior:** Nova speaks: *"Engineering operations online. All codebase pipelines nominal."*[cite: 1, 3]
* **Success state:** Manager profile rendered, live tools and telemetry interactive[cite: 6, 9].
* **Failure state:** Manager offline warning banner; "Re-calibrate Character Core" button[cite: 6, 9].

---

### Journey 9: Viewing Workers

* **Goal:** Inspect individual sub-agents, worker nodes, and specialized API execution scripts[cite: 1, 6, 9].
* **Entry point:** "Worker Roster" section on `/agents` or clicking a Worker Node inside a Mission canvas[cite: 6, 9].
* **User actions:**
  1. Filters Worker grid by department or capability[cite: 6, 9].
  2. Clicks on a specific Worker Card (e.g., "Python Interpreter #04")[cite: 6, 9].
* **System actions:**
  1. Opens Right Context Panel displaying Worker properties, health, battery/execution load, and history[cite: 6, 9].
  2. Highlights the parent Manager Node connected to this worker[cite: 1, 6, 9].
* **Backend APIs involved:** `GET /api/v1/agents/workers`, `GET /api/v1/agents/workers/:id`
* **Manager participation:** Parent Manager (e.g., Nova for code runners) provides status commentary[cite: 1, 9].
* **Animations:** Worker Card elevates ($Y\text{-axis} -3\text{ px}$), avatar status ring rotates rapidly ($1.5\text{ Hz}$) if active[cite: 6].
* **Transitions:** Right Context Panel glides in from right ($+380\text{px} \to 0\text{px}$)[cite: 6].
* **Voice behavior:** Parent Manager: *"Sub-agent Python Interpreter #04 operating at nominal load."*[cite: 1, 3]
* **Success state:** Worker properties, active parameters, and trace logs fully displayed[cite: 6, 9].
* **Failure state:** Worker status dot displays Red; "Restart Sub-Agent" action button rendered[cite: 6, 9].

---

### Journey 10: Workflow Execution

* **Goal:** Build, test, and dry-run an automated pipeline workflow inside the visual builder[cite: 1, 6, 9].
* **Entry point:** Navigating to `/workflows` and opening a workflow canvas[cite: 6, 9].
* **User actions:**
  1. Drags trigger and worker nodes onto canvas grid[cite: 6, 9].
  2. Connects node ports with wire handles[cite: 6, 9].
  3. Clicks "Run Test Execution" on header toolbar[cite: 6, 9].
* **System actions:**
  1. Validates workflow DAG logic[cite: 6, 9].
  2. Executes dry-run, highlighting nodes sequentially as data passes through[cite: 6, 9].
  3. Displays live execution payload output inside bottom drawer terminal[cite: 6, 9].
* **Backend APIs involved:** `POST /api/v1/workflows/save`, `POST /api/v1/workflows/:id/execute`[cite: 9]
* **Manager participation:** Flow (Automation Manager) orchestrates execution[cite: 1, 9].
* **Animations:** Moving gradient march along borders of executing nodes, pulsing particle packets moving across wire connections[cite: 1, 6, 9].
* **Transitions:** Terminal drawer slides up from bottom ($0.3\text{ s}$ ease-out)[cite: 6, 9].
* **Voice behavior:** Flow speaks: *"Workflow logic compiled. Executing test sequence... Sequence successful."*[cite: 1, 3]
* **Success state:** All nodes highlight Green (`#10B981`); payload summary displayed in terminal[cite: 6, 9].
* **Failure state:** Invalid node connection highlights in Critical Red (`#EF4444`) with error badge describing parameter mismatch[cite: 6, 9].

---

### Journey 11: Knowledge Search

* **Goal:** Perform deep vector queries across indexed organizational documents and knowledge bases[cite: 1, 6, 9].
* **Entry point:** Navigating to `/knowledge` or issuing a query via Global Search[cite: 6, 9].
* **User actions:**
  1. Inputs query string into Knowledge Search Bar[cite: 6, 9].
  2. Selects filters (e.g., "PDF Documents", "Notion Databases")[cite: 6, 9].
  3. Presses Enter or clicks Search Lens[cite: 6, 9].
* **System actions:**
  1. Triggers Atlas vector embedding search engine[cite: 1, 6, 9].
  2. Displays matching document cards in Left Column and exact vector text chunks in Right Column[cite: 6, 9].
  3. Highlights semantic relevance scores on Knowledge Cards[cite: 6, 9].
* **Backend APIs involved:** `POST /api/v1/knowledge/query`, `GET /api/v1/knowledge/sources`[cite: 9]
* **Manager participation:** Atlas (Deep Research Lead) controls interface[cite: 1, 9].
* **Animations:** Atlas Ocean Cobalt theme (`#06B6D4`) glows, progress beam sweeps across search bar[cite: 1, 6, 9].
* **Transitions:** Results list populates with stagger fade-in ($0.05\text{ s}$ delay per item)[cite: 6].
* **Voice behavior:** Atlas speaks: *"Vector space queried. Matching 14 high-confidence knowledge chunks."*[cite: 1, 3]
* **Success state:** Knowledge chunks rendered with confidence scores and source file tags[cite: 6, 9].
* **Failure state:** Holographic Search Void emblem displayed with "No vector matches found. Expand query terms"[cite: 6, 9].

---

### Journey 12: Memory Search

* **Goal:** Query, inspect, and edit long-term episodic, semantic, and procedural vector memory blocks[cite: 6, 9].
* **Entry point:** Navigating to `/memory`[cite: 6, 9].
* **User actions:**
  1. Enters search keyword into Memory Search field[cite: 6, 9].
  2. Selects Memory Category tab (e.g., "Episodic")[cite: 6, 9].
  3. Clicks on a specific Memory Tile[cite: 6, 9].
* **System actions:**
  1. Filters 3D Crystalline Memory Grid based on vector similarity[cite: 6, 9].
  2. Moves selected Memory Tile to workspace center[cite: 6, 9].
  3. Opens raw vector data, memory decay metrics, and recall history in Right Context Panel[cite: 6, 9].
* **Backend APIs involved:** `GET /api/v1/memory`, `POST /api/v1/memory/query`[cite: 9]
* **Manager participation:** TEMO-01 and Atlas[cite: 1, 3, 9].
* **Animations:** Memory tile glides to screen center with scale expand ($1.0 \to 1.08$), sub-surface memory core brightens[cite: 6, 9].
* **Transitions:** Unselected memory tiles dim opacity to $20\%$[cite: 6].
* **Voice behavior:** TEMO-01 speaks: *"Recalling memory block #892. Confidence score 98%."*[cite: 3]
* **Success state:** Memory record displayed with edit and delete ("Forget Memory") controls[cite: 6, 9].
* **Failure state:** Empty state wireframe with "No long-term memories matching query" message[cite: 6, 9].

---

### Journey 13: Tool Execution

* **Goal:** Direct manual or automated execution of an integrated external API, code interpreter, or custom tool[cite: 1, 6, 9].
* **Entry point:** `/tools` page or inline tool trigger inside Chat/Workflows[cite: 6, 9].
* **User actions:**
  1. Selects a Tool Card (e.g., "Web Scraper / Browser")[cite: 6, 9].
  2. Clicks "Run Manual Execution"[cite: 6, 9].
  3. Enters input parameters into Tool Execution Modal and clicks "Execute"[cite: 6, 9].
* **System actions:**
  1. Validates API key and authorization permissions[cite: 6, 9].
  2. Runs tool payload via Nova / Flow execution engine[cite: 1, 9].
  3. Displays live execution terminal and returned JSON/HTML output payload[cite: 6, 9].
* **Backend APIs involved:** `POST /api/v1/tools/execute`, `GET /api/v1/tools/status`
* **Manager participation:** Nova (Engineering) or Flow (Automation)[cite: 1, 9].
* **Animations:** Tool Card border pulses cyan; loading spinner rotates in modal[cite: 6, 9].
* **Transitions:** Modal transitions from parameter form to execution log view[cite: 6].
* **Voice behavior:** Nova speaks: *"Tool payload dispatched. Execution completed in 142ms."*[cite: 1, 3]
* **Success state:** Tool return status $200\text{ OK}$; output payload viewable and copyable[cite: 6, 9].
* **Failure state:** Tool Card displays Red warning border; execution terminal outputs error stack trace with "Re-configure API Keys" CTA[cite: 6, 9].

---

### Journey 14: Voice Interaction

* **Goal:** Engage in hands-free, real-time continuous voice conversation with TEMO-01[cite: 3, 6, 9].
* **Entry point:** Clicking the floating Voice Orb on Top Navigation or Chat Input Bar[cite: 6, 9].
* **User actions:**
  1. Clicks Voice Orb[cite: 6, 9].
  2. Speaks query: *"TEMO, give me a status update on Orion's active gold trade."*[cite: 1, 3, 6]
  3. Listens to vocal response and views spatial HUD updates[cite: 3, 6].
  4. Clicks Voice Orb again to mute/end session[cite: 6, 9].
* **System actions:**
  1. Expands Voice Orb to focus mode ($240\text{px} \times 240\text{px}$) with particle ring explosion[cite: 6].
  2. Analyzes audio frequencies in real-time, modulating Voice Orb rings during user speech[cite: 6].
  3. Switches Orb to "Thinking" mode (inner rings spin $2\times$ speed) during inference[cite: 6].
  4. Modulates shape with smooth liquid sine wave matching vocal output during speech synthesis[cite: 6].
* **Backend APIs involved:** `WS /ws/v1/voice/stream`, `POST /api/v1/voice/synthesize`[cite: 9]
* **Manager participation:** TEMO-01 (Primary Vocal Anchor)[cite: 3, 9].
* **Animations:** Continuous multi-axis particle physics at $60\text{ fps}$, kinetic ring contractions[cite: 6].
* **Transitions:** Background view dims backdrop-filter blur ($12\text{px} \to 24\text{px}$) during voice focus mode[cite: 6].
* **Voice behavior:** TEMO-01 delivers fluid speech synthesis: *"Orion's gold trade is up +2.4%. Stop-loss order configured."*[cite: 1, 3]
* **Success state:** Voice query processed, verbal answer delivered, relevant HUD card spawned in Zone D[cite: 2, 3, 6].
* **Failure state:** Voice Orb turns static dark titanium gray; error toast reads *"Audio Input / Microphone Stream Lost"*[cite: 6].

---

### Journey 15: Notifications

* **Goal:** Receive, review, filter, and clear real-time system alerts and execution events[cite: 1, 6, 9].
* **Entry point:** Notification Bell icon on Top Navigation or `/notifications`[cite: 6, 9].
* **User actions:**
  1. Clicks Notification Bell to open floating dropdown stream[cite: 6, 9].
  2. Filters alerts by type ("Critical", "Missions", "Trading")[cite: 6, 9].
  3. Clicks a notification card[cite: 6, 9].
* **System actions:**
  1. Displays toast notifications in top-right space with $5\text{ s}$ auto-dismiss progress bar[cite: 6].
  2. Highlights unread notifications with glowing cyan indicator dot[cite: 6].
  3. Navigates user directly to target module upon card click (e.g., clicking trade alert opens `/analytics`)[cite: 1, 6, 9].
* **Backend APIs involved:** `GET /api/v1/notifications`, `POST /api/v1/notifications/read`[cite: 9]
* **Manager participation:** Flow (Alert Routing Lead)[cite: 1, 9].
* **Animations:** Toast notification elastic slide-in from right ($X +100\% \to 0$, $0.35\text{ s}$)[cite: 6].
* **Transitions:** Dismissed notifications slide out right with smooth fade[cite: 6].
* **Voice behavior:** Subdued $8\text{ kHz}$ glassy chime played on critical notification arrival[cite: 3].
* **Success state:** Notification marked as read, user routed to deep destination view[cite: 6, 9].
* **Failure state:** Red notification card for critical errors, persistent until manually acknowledged[cite: 6, 9].

---

### Journey 16: Settings

* **Goal:** Configure system-wide model routing, API credentials, audio synthesis, and visual parameters[cite: 6, 9].
* **Entry point:** Left Navigation "Settings" gear icon or `/settings`[cite: 6, 9].
* **User actions:**
  1. Selects category from left settings menu (e.g., "Model Routing")[cite: 6, 9].
  2. Modifies controls (toggles switches, adjusts temperature range sliders)[cite: 6, 9].
  3. Observes "Unsaved Changes" floating action bar at screen bottom[cite: 6, 9].
  4. Clicks "Save Settings"[cite: 6, 9].
* **System actions:**
  1. Updates system configuration matrix[cite: 6, 9].
  2. Displays glowing amber indicator dot next to modified rows before saving[cite: 6].
  3. Glides bottom action bar into view[cite: 6, 9].
  4. Applies changes system-wide upon confirmation[cite: 6, 9].
* **Backend APIs involved:** `GET /api/v1/settings`, `POST /api/v1/settings/save`[cite: 9]
* **Manager participation:** TEMO-01 (OS Architect)[cite: 3, 9].
* **Animations:** Setting controls illuminate emissive cyan light when active; bottom bar glides up ($Y +100\% \to 0$, $0.2\text{ s}$)[cite: 6, 9].
* **Transitions:** Category switching uses horizontal slide fade ($0.18\text{ s}$)[cite: 6].
* **Voice behavior:** TEMO-01 confirms: *"System configuration updated and locked."*[cite: 3]
* **Success state:** Settings saved, "Unsaved Changes" bar disappears, success toast displayed[cite: 6, 9].
* **Failure state:** Red helper text under invalid input fields; "Save Failed" alert modal[cite: 6, 9].

---

### Journey 17: Personalizing Manager Names & Avatars

* **Goal:** Customizing display callsigns, voice model mappings, and visual theme tokens for Department Managers[cite: 1, 6, 9].
* **Entry point:** Manager Details page (`/agents/manager/:key`) or `/settings/agents`[cite: 6, 9].
* **User actions:**
  1. Clicks "Customize Manager Profile" icon button on Manager Hub[cite: 6, 9].
  2. Edits Callsign field (e.g., renames "Nova" to "Nova Prime")[cite: 1, 6].
  3. Selects alternative avatar lighting profile and core color accent token[cite: 1, 3, 6].
  4. Clicks "Apply Personalization"[cite: 6].
* **System actions:**
  1. Updates manager schema records[cite: 1, 6, 9].
  2. Re-textures avatar stage light rings to match new accent token[cite: 1, 2, 3].
  3. Updates UI badges, navigation labels, and chat header titles across all modules[cite: 6, 9].
* **Backend APIs involved:** `PATCH /api/v1/managers/:key/customize`, `POST /api/v1/settings/save`[cite: 9]
* **Manager participation:** Target Manager reacts directly to customization[cite: 1, 3].
* **Animations:** $360^\circ$ slow rotation of Manager 3D avatar on Stage Pedestal while re-texturing[cite: 1, 2, 3].
* **Transitions:** Theme accent transition across UI elements over $0.5\text{ s}$ smooth fade[cite: 1, 6].
* **Voice behavior:** Manager speaks using updated parameters: *"Callsign updated. Nova Prime online."*[cite: 1, 3]
* **Success state:** Custom callsign and visual theme saved and visible system-wide[cite: 6, 9].
* **Failure state:** Reverts to default system parameters with warning toast if asset loading fails[cite: 6].

---

### Journey 18: Error Recovery

* **Goal:** Detect execution exceptions, isolate bottlenecks, inspect diagnostic traces, and recover operation smoothly[cite: 1, 6, 9].
* **Entry point:** System-wide exception trigger, mission failure, or API disconnect[cite: 6, 9].
* **User actions:**
  1. Receives Critical Red Error Card or banner[cite: 6, 9].
  2. Clicks "View Diagnostic Trace" CTA[cite: 6, 9].
  3. Reviews stack trace in Nova's Code Drawer[cite: 1, 6, 9].
  4. Clicks "Execute Auto-Recovery / Retry Step"[cite: 6, 9].
* **System actions:**
  1. Shifts screen border and affected card stroke to pulsing Critical Red (`#EF4444`) at $1\text{ Hz}$[cite: 3, 6, 9].
  2. Executes horizontal shake animation ($4\text{px}$ offset, $0.2\text{ s}$) on failure card[cite: 6].
  3. Slides out Nova Diagnostic Drawer containing detailed error logs[cite: 1, 6, 9].
  4. Re-compiles step logic and re-executes task upon recovery confirmation[cite: 6, 9].
* **Backend APIs involved:** `GET /api/v1/system/diagnostics/:id`, `POST /api/v1/missions/:id/retry`[cite: 9]
* **Manager participation:** Nova (Engineering Diagnostics Lead) takes control[cite: 1, 9].
* **Animations:** Pulsing red alert border, shaking error modal, smooth retry cyan spinner wave[cite: 6, 9].
* **Transitions:** Red alert state smoothly shifts back to Active Cyan (`#00F3FF`) upon successful recovery[cite: 3, 6].
* **Voice behavior:** Nova speaks: *"Exception isolated in Node #12. Applying auto-recovery patch... Recovery complete."*[cite: 1, 3]
* **Success state:** Error cleared, pipeline state restored to green active execution[cite: 6, 9].
* **Failure state:** Persistent failure escalates to manual override prompt with option to safe-abort mission[cite: 6, 9].

---

### Journey 19: Empty States

* **Goal:** Provide clear visual guidance, system context, and immediate action triggers when views contain zero data[cite: 6, 9].
* **Entry point:** Navigating to an unpopulated view (e.g., empty `/missions`, empty `/knowledge`, or empty search)[cite: 6, 9].
* **User actions:**
  1. Lands on empty module view[cite: 6, 9].
  2. Observes 3D Holographic Wireframe Emblem and guidance text[cite: 6, 9].
  3. Clicks primary CTA button (e.g., "Create New Autonomous Mission")[cite: 6, 9].
* **System actions:**
  1. Renders centered vertical stack: 3D Holographic Wireframe Emblem, Clean White Heading, Muted Subtext, and Primary Button[cite: 6].
  2. Executes micro-bobbing sine-wave float on wireframe emblem[cite: 6].
  3. Launches corresponding creation modal or wizard upon button click[cite: 6, 9].
* **Backend APIs involved:** `GET /api/v1/[module]/list` (returns empty array `[]`)[cite: 9]
* **Manager participation:** Department Manager matching module provides helpful onboarding prompt[cite: 1, 9].
* **Animations:** Floating hologram emblem bobbing ($4\text{px}$ path, $6\text{ s}$ sine wave)[cite: 6].
* **Transitions:** Smooth fade-out of empty state card when creation modal launches[cite: 6].
* **Voice behavior:** Manager speaks softly: *"No active data streams detected in this module. Ready to initialize."*[cite: 3]
* **Success state:** User guided seamlessly into creation flow, populating the view[cite: 6, 9].
* **Failure state:** N/A (Static guidance state)[cite: 6].

---

### Journey 20: Loading Experience

* **Goal:** Deliver high-tech, responsive visual feedback during model inference, workspace generation, or asynchronous API calls[cite: 6, 9].
* **Entry point:** Any long-running system operation ($>500\text{ms}$)[cite: 6].
* **User actions:**
  1. Initiates complex task (e.g., compiling workflow, running deep research query)[cite: 1, 6, 9].
  2. Observes loading indicators[cite: 6, 9].
  3. Option to click "Cancel Operation" if duration exceeds $5\text{ s}$[cite: 6].
* **System actions:**
  1. Renders Skeleton Pulse glass shapes over loading card bounds[cite: 6, 9].
  2. Displays centered kinetic double-ring spinner with `SYNTHESIZING...` or `CALIBRATING CORE...` monospace sub-label[cite: 6, 9].
  3. TEMO-01 / Manager enters Thinking state: eye micro-saccades active, chest core rings rotate at $2\times$ speed[cite: 3, 6].
* **Backend APIs involved:** Async progress polling or SSE stream connection[cite: 9]
* **Manager participation:** Active Manager exhibits Thinking animation on Zone C stage[cite: 1, 3, 9].
* **Animations:** Skeleton opacity pulse ($30\% \to 70\% \to 30\%$), counter-rotating concentric rings ($1.5\text{ s}$ period)[cite: 6].
* **Transitions:** Smooth cross-fade ($0.2\text{ s}$) from loading skeleton to fully rendered glass data cards[cite: 6].
* **Voice behavior:** Low $40\text{ Hz}$ ambient core hum increases slightly in volume during heavy processing[cite: 3].
* **Success state:** Data loaded, loading overlay dissolves into clean active view[cite: 6, 9].
* **Failure state:** Loading spinner converts to Red warning octagon; "Operation Timed Out" banner rendered with "Retry" button[cite: 6, 9].

---

### Journey 21: Mission Completion

* **Goal:** Conclude an autonomous goal, present synthesized deliverables, record execution metrics, and transition team back to standby[cite: 1, 6, 9].
* **Entry point:** Final step verification of an active autonomous mission[cite: 1, 6, 9].
* **User actions:**
  1. Observes final step node completion on Mission Canvas[cite: 6, 9].
  2. Clicks "Inspect Mission Summary & Deliverables" banner[cite: 6, 9].
  3. Exports final generated report/code or dismisses mission overlay[cite: 6, 9].
* **System actions:**
  1. Shifts Mission Card and details border to Mint Green (`#10B981`) with glowing halo expansion[cite: 6, 9].
  2. Triggers celebratory radial light wave pulse across obsidian glass floor pedestal[cite: 2, 3, 6].
  3. Renders Executive Deliverables Summary Modal containing generated artifacts, token consumption totals, and execution duration[cite: 6, 9].
  4. Saves complete execution trace and output into Long-Term Memory and Activity Feed[cite: 6, 9].
* **Backend APIs involved:** `POST /api/v1/missions/:id/finalize`, `POST /api/v1/memory/store`[cite: 9]
* **Manager participation:** Lead Manager and TEMO-01 take stage center to present results[cite: 1, 3, 9].
* **Animations:** Mint Green pulse along progress vector, floor neon ring expansion wave, particle chime explosion[cite: 2, 3, 6].
* **Transitions:** Canvas view transitions smoothly to clean Executive Summary View[cite: 6, 9].
* **Voice behavior:** TEMO-01 speaks: *"Mission completed successfully. Deliverables indexed and ready for executive review."*[cite: 3]
* **Success state:** Mission state marked `Completed`, output artifacts accessible, metrics recorded in Analytics[cite: 6, 9].
* **Failure state:** If post-processing summary generation fails, raw node outputs remain fully accessible in context drawer[cite: 6, 9].

---

## 3. Summary Matrix of Journey Technical Specifications

| Journey | Entry Point | Primary Manager | Primary Accent Token | Key API Endpoint | Success State Indicator |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **01. First Launch** | Application Boot (`/`) | TEMO-01[cite: 3] | Active Cyan (`#00F3FF`)[cite: 3] | `POST /api/v1/system/init` | App Shell & Floor Pedestal Active[cite: 2, 6] |
| **02. Onboarding** | Auto / `/onboarding` | TEMO-01 + Department Leads[cite: 1, 3] | Active Cyan (`#00F3FF`)[cite: 3] | `POST /api/v1/user/onboard` | Profile created, routed to `/dashboard`[cite: 6, 9] |
| **03. Dashboard Nav** | Left Rail / `/dashboard` | TEMO-01 / Department Leads[cite: 1, 3] | Department Specific[cite: 1] | `GET /api/v1/system/telemetry` | Dynamic Camera & Manager Stage Focus[cite: 2, 3, 9] |
| **04. Talking with Temo** | `/chat` | TEMO-01[cite: 3] | Electric Blue (`#0088FF`)[cite: 3] | `POST /api/v1/chat/completions` | Streaming text & voice response complete[cite: 6, 9] |
| **05. Creating Mission** | `/missions` | Flow[cite: 1] | Cyber Emerald (`#10B981`)[cite: 1] | `POST /api/v1/missions/create` | Mission Card spawned on board[cite: 6, 9] |
| **06. Mission Execution**| `/missions/:id` | Flow + Task Leads[cite: 1] | Department Specific[cite: 1] | `WS /ws/v1/missions/:id/trace` | Particle packets flowing on DAG graph[cite: 1, 6, 9] |
| **07. Live Timeline** | `/notifications` | Atlas[cite: 1] | Ocean Cobalt (`#06B6D4`)[cite: 1] | `GET /api/v1/timeline/history` | Historical event node expanded[cite: 6, 9] |
| **08. Viewing Managers** | `/agents/manager/:key` | Selected Manager[cite: 1] | Signature Manager Color[cite: 1] | `GET /api/v1/managers/:key` | $1:1$ 3D Avatar on stage with full HUD[cite: 1, 3, 9] |
| **09. Viewing Workers** | `/agents` | Parent Manager Lead[cite: 1] | Dark Titanium (`#1E293B`)[cite: 6] | `GET /api/v1/agents/workers/:id` | Worker properties drawer open[cite: 6, 9] |
| **10. Workflow Exec** | `/workflows` | Flow[cite: 1] | Cyber Emerald (`#10B981`)[cite: 1] | `POST /api/v1/workflows/:id/execute`| Moving gradient march & green completion[cite: 6, 9] |
| **11. Knowledge Search**| `/knowledge` | Atlas[cite: 1] | Ocean Cobalt (`#06B6D4`)[cite: 1] | `POST /api/v1/knowledge/query` | Vector chunks rendered with confidence[cite: 6, 9] |
| **12. Memory Search** | `/memory` | TEMO-01 + Atlas[cite: 1, 3] | Crystalline Cyan (`#00F3FF`)[cite: 6] | `POST /api/v1/memory/query` | Target Memory Tile centered & inspected[cite: 6, 9] |
| **13. Tool Execution** | `/tools` | Nova / Flow[cite: 1] | Neon Purple (`#8B5CF6`)[cite: 1] | `POST /api/v1/tools/execute` | Payload terminal output $200\text{ OK}$[cite: 6, 9] |
| **14. Voice Interaction**| Voice Orb Click | TEMO-01[cite: 3] | Kinetic Plasma Gradient[cite: 6] | `WS /ws/v1/voice/stream` | Continuous voice synthesis & spatial HUD[cite: 3, 6, 9] |
| **15. Notifications** | Top Nav / `/notifications`| Flow[cite: 1] | Alert / System Token[cite: 6] | `GET /api/v1/notifications` | Toast auto-dismissed / user routed[cite: 6, 9] |
| **16. Settings** | `/settings` | TEMO-01[cite: 3] | Active Cyan (`#00F3FF`)[cite: 3] | `POST /api/v1/settings/save` | Configuration saved, bottom bar dismissed[cite: 6, 9] |
| **17. Personalizing** | `/agents/manager/:key` | Target Manager[cite: 1] | New Custom Token[cite: 1] | `PATCH /api/v1/managers/:key` | Callsign & theme updated system-wide[cite: 6, 9] |
| **18. Error Recovery** | Exception Trigger | Nova[cite: 1] | Critical Red (`#EF4444`)[cite: 3] | `POST /api/v1/missions/:id/retry` | Red alert shifts back to Cyan active state[cite: 3, 6] |
| **19. Empty States** | Empty Module View | Module Lead[cite: 1] | Muted Titanium (`#94A3B8`)[cite: 6] | `GET /api/v1/[module]/list` | Wireframe emblem floating with actionable CTA[cite: 6, 9] |
| **20. Loading Exp** | Processing ($>500\text{ms}$)| Active Manager[cite: 1, 3] | Glowing Cyan Shimmer[cite: 6] | Async SSE Stream / Polling[cite: 9] | Skeleton loader dissolves into data cards[cite: 6, 9] |
| **21. Mission Complete**| Final Step Verification | Flow + TEMO-01[cite: 1, 3] | Mint Green (`#10B981`)[cite: 6] | `POST /api/v1/missions/:id/finalize`| Mint Green halo wave & summary modal[cite: 2, 6, 9] |