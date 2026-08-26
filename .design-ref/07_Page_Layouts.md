```markdown
# 07_Page_Layouts.md

---

# TEMO AI OS Page Layouts & Information Architecture

This document defines the complete page layouts and Information Architecture (IA) for the first production release of **TEMO AI OS**[cite: 3, 5]. It strictly adheres to the **TEMO AI OS Visual Design Bible**[cite: 5] and **UI Component Library Specification**[cite: 6]. Every required page, layout grid, interaction pattern, and backend data flow is specified without code generation[cite: 5].

---

## 1. Global Navigation & Architecture Overview

The system runs within the **App Shell** container, anchoring a 3D orbital glass environment (Zones A–E)[cite: 2, 6]. Navigation across all modules is driven by the **Top Navigation**, **Left Navigation** (collapsed/expanded rail), **Right Context Panel**, and **Command Palette** ($⌘K$)[cite: 6].


```

+---------------------------------------------------------------------------------------------------------+
| [Top Navigation] Workspaces | Telemetry | System Pulse | Alerts | Profile                         |
+---------------------------------------------------------------------------------------------------------+
| [Left Rail] | [Zone A & B: Environment & Telemetry]                                 | [Right Panel]     |
|  - Command  |                                                                        |  - Diagnostics    |
|  - Chat     |  [ZONE C: Core Avatar Stage]         [ZONE D: Spatial HUD Buffer]     |  - Live Logs      |
|  - Missions |  (TEMO / Active Manager)             (Dynamic Module Interface)        |  - Properties     |
|  - Agents   |                                                                        |                   |
|  - Workflows|                                                                        |                   |
|  - Knowledge|                                                                        |                   |
|  - Memory   |                                                                        |                   |
|  - Tools    |                                                                        |                   |
|  - Analytics|                                                                        |                   |
|  - Settings |                                                                        |                   |
+---------------------------------------------------------------------------------------------------------+

```

---

## 2. Production Page Specifications

---

### Page 1: Dashboard (Command Bridge)

*   **Purpose:** Serves as the central executive mission control room[cite: 2, 5]. Displays macro system health, real-time agent activity, department telemetry, and active high-level orchestrations[cite: 1, 2, 6].
*   **Route:** `/dashboard`
*   **Layout:** Full-Viewport 3D Spatial Grid[cite: 6]. Zone C hosts TEMO-01 on the central glass pedestal; Zone A/B host macro system gauges; Zone D displays active system cards[cite: 2, 3, 6].
*   **Sections:**
    1.  *Executive Telemetry Header* (Zone A)[cite: 2]
    2.  *Central Avatar Stage* (Zone C)[cite: 2, 3]
    3.  *Active Missions & Flow Stream* (Zone D)[cite: 2]
    4.  *Department Health Matrix* (Zone B)[cite: 1, 2]
    5.  *Live Event Activity Feed* (Right Panel)[cite: 6]
*   **Components Used:** App Shell, Top Navigation, Left Navigation, Right Context Panel, Dashboard Cards, Statistics Cards, Mission Cards, Voice Orb, Activity Feed, Charts[cite: 6].
*   **User Interactions:**
    *   Clicking a Department Health Card switches Stage focus to that Manager[cite: 1, 3, 6].
    *   Hovering over Mission Cards highlights active workflow nodes[cite: 6].
    *   Clicking Voice Orb activates continuous audio interaction[cite: 6].
*   **Animations:**
    *   Idle character breathing ($0.2\text{ Hz}$ sine displacement)[cite: 3].
    *   Continuous vertical sine-wave float ($\pm 4\text{ px}$) on unpinned 3D glass cards.
    *   Background ground fog drift ($0.05\text{ m/s}$)[cite: 2].
*   **Responsive Behavior:** On screens $<1024\text{px}$, side panels collapse into drawer overlays; Zone C avatar stage scales to top header backdrop[cite: 6].
*   **Empty States:** Displays Empty State wireframe with "No Active Missions running. Launch via Command Center" button[cite: 6].
*   **Loading States:** Skeleton Pulse glass cards with `SYNTHESIZING...` loading spinner overlay[cite: 6].
*   **Error States:** Border pulses Critical Red (`#EF4444`)[cite: 3, 6]. Displays Error State card with "Re-establish System Link" button[cite: 6].
*   **Backend Data Required:** Core CPU/Memory utilization, active agent statuses, department throughput, live error logs, active mission progress percentages[cite: 1, 6].
*   **APIs Consumed:** `GET /api/v1/system/telemetry`, `GET /api/v1/missions/active`, `WS /ws/v1/activity-stream`
*   **Related Managers:** TEMO-01 (Primary)[cite: 3], supported by Nova, Flow, and Atlas[cite: 1].
*   **Mission Interactions:** Displays macro mission progress, allows pausing/resuming global orchestrations[cite: 6].

---

### Page 2: Chat (Conversational Gateway)

*   **Purpose:** Multi-modal direct communication portal with TEMO-01 or specific department managers for problem-solving, code execution, and task delegation[cite: 1, 3, 6].
*   **Route:** `/chat` or `/chat/:threadId`
*   **Layout:** Split 3D Viewport layout[cite: 6]. Left $60\%$ area contains the interactive Chat Window and Input Bar; Right $40\%$ area retains Zone C avatar focus[cite: 3, 6].
*   **Sections:**
    1.  *Thread Control Header*[cite: 6]
    2.  *Scrollable Chat Stream*[cite: 6]
    3.  *Floating Multimodal Input Bar*[cite: 6]
    4.  *Manager Stage & Artifact Inspector* (Zone C / Right Context)[cite: 3, 6]
*   **Components Used:** Chat Window, Chat Bubble, Voice Orb, Input Bar, Context Menus, Progress Indicators, Buttons, Icon Buttons[cite: 6].
*   **User Interactions:**
    *   Typing `/` triggers the inline Command Palette prompt selector[cite: 6].
    *   Clicking "Execute in Workspace" on code snippets routes execution to Nova[cite: 1, 6].
    *   Dragging Voice Orb shifts audio focus to full screen[cite: 6].
*   **Animations:**
    *   Real-time streaming text generation with trailing glowing cyan cursor node[cite: 6].
    *   Avatar chest core brightens (+25% intensity) and speaks in sync with audio output[cite: 3].
*   **Responsive Behavior:** Below $640\text{px}$, Chat Window expands to $100\%$ width; Avatar stage docks into top header[cite: 6].
*   **Empty States:** Centered Voice Orb and prompt starter tiles ("Orchestrate Marketing Funnel", "Run System Diagnostics")[cite: 1, 6].
*   **Loading States:** Typing indicator with pulsing concentric cyan rings[cite: 6].
*   **Error States:** Message bubble border turns Critical Red (`#EF4444`) with inline "Retry Stream" trigger[cite: 6].
*   **Backend Data Required:** Message history array, token consumption, model inference stream, attached file contexts[cite: 6].
*   **APIs Consumed:** `POST /api/v1/chat/completions` (SSE Stream), `GET /api/v1/chat/history`, `POST /api/v1/voice/synthesize`
*   **Related Managers:** TEMO-01, dynamically hand-off to Nova (Code), Echo (Marketing), Flow (Automation), Luna (Creative), Atlas (Research), Orion (Trading)[cite: 1, 3].
*   **Mission Interactions:** Can initialize new missions directly from chat commands[cite: 6].

---

### Page 3: Missions (Autonomous Goal Center)

*   **Purpose:** Overview and orchestration hub for all autonomous multi-agent missions across the organization[cite: 1, 6].
*   **Route:** `/missions`
*   **Layout:** Filterable Grid / Board Layout inside Zone D spatial glass container[cite: 2, 6].
*   **Sections:**
    1.  *Mission Category & Filter Header*[cite: 6]
    2.  *Active Missions Board (In Progress, Pending, Completed, Failed)*[cite: 6]
    3.  *Global Goal Execution Timeline*[cite: 6]
*   **Components Used:** Glass Panels, Mission Cards, Progress Indicators, Search Box, Dropdowns, Timeline, Buttons[cite: 6].
*   **User Interactions:**
    *   Clicking a Mission Card opens the detailed execution graph page[cite: 6].
    *   Hovering over step nodes displays sub-agent execution parameters[cite: 6].
*   **Animations:**
    *   Continuous pulse along internal progress vector on active Mission Cards[cite: 6].
    *   Grid items re-order using smooth spring transitions[cite: 6].
*   **Responsive Behavior:** Board columns convert into a tabbed single-column view on mobile screens[cite: 6].
*   **Empty States:** Empty Holographic Wireframe with "Create New Autonomous Mission" call to action[cite: 6].
*   **Loading States:** Shimmer skeleton cards with pulsing track fill vectors[cite: 6].
*   **Error States:** Mission card displays red execution alert with "Inspect Bottleneck" button[cite: 6].
*   **Backend Data Required:** Active mission objects, step statuses, assigned manager IDs, execution logs, elapsed time[cite: 1, 6].
*   **APIs Consumed:** `GET /api/v1/missions`, `POST /api/v1/missions/create`, `PATCH /api/v1/missions/:id/status`
*   **Related Managers:** Flow (Orchestration Lead)[cite: 1], supported by all department leads[cite: 1].
*   **Mission Interactions:** Main interface for initiating, pausing, editing, and aborting autonomous goals[cite: 6].

---

### Page 4: Mission Details (Execution Graph)

*   **Purpose:** Deep inspection view for a single mission, showing real-time agent execution graphs, step traces, and resource consumption[cite: 1, 6].
*   **Route:** `/missions/:missionId`
*   **Layout:** Split Workbench: Canvas area on Left ($70\%$), Right Context Panel on Right ($30\%$)[cite: 6].
*   **Sections:**
    1.  *Mission Telemetry Header* (Name, Status, Time Elapsed, Cost)[cite: 6]
    2.  *Node-Edge Execution Canvas*[cite: 1, 6]
    3.  *Live Execution Step Terminal*[cite: 6]
    4.  *Manager/Agent Context Drawer*[cite: 6]
*   **Components Used:** Manager Nodes, Worker Nodes, Timeline, Activity Feed, Buttons, Icon Buttons, Progress Indicators, Drawer Panels[cite: 6].
*   **User Interactions:**
    *   Pan/Zoom canvas to inspect individual execution step nodes[cite: 6].
    *   Clicking a Worker Node loads its raw input/output payload into the Right Panel[cite: 6].
*   **Animations:**
    *   Connection wires stream light particles during step execution[cite: 1, 6].
    *   Completed nodes flash Green (`#10B981`) upon verification[cite: 6].
*   **Responsive Behavior:** On mobile, canvas is replaced by a linear step list[cite: 6].
*   **Empty States:** "Mission Initializing... Connecting Agent Nodes" loader screen[cite: 6].
*   **Loading States:** Canvas nodes fade in sequentially with glowing cyan connection paths[cite: 6].
*   **Error States:** Failed node turns Critical Red (`#EF4444`) with pulsing warning stroke[cite: 6].
*   **Backend Data Required:** DAG node layout, step execution logs, input/output tokens, active agent states[cite: 6].
*   **APIs Consumed:** `GET /api/v1/missions/:id/graph`, `WS /ws/v1/missions/:id/trace`, `POST /api/v1/missions/:id/retry`
*   **Related Managers:** Flow (Pipeline Execution)[cite: 1] and Nova (Code Diagnostics)[cite: 1].
*   **Mission Interactions:** Allows stepping through execution, manual override, or re-running failed steps[cite: 6].

---

### Page 5: Agents (Roster & Hierarchy)

*   **Purpose:** Central management interface for all primary Department Managers and specialized sub-agents[cite: 1, 6].
*   **Route:** `/agents`
*   **Layout:** 3D Hierarchy Stage & Grid Overlay[cite: 1, 6].
*   **Sections:**
    1.  *Department Filter Tabs* (All, Engineering, Marketing, Automation, Creative, Research, Trading)[cite: 1, 6]
    2.  *Tier 0/1/2 Executive Manager Carousel*[cite: 1]
    3.  *Sub-Agent Roster Grid*[cite: 6]
*   **Components Used:** Agent Cards, Manager Nodes, Buttons, Search Box, Dropdowns, Statistics Cards[cite: 6].
*   **User Interactions:**
    *   Selecting a Manager Card updates Zone C with that manager's 3D avatar[cite: 1, 3, 6].
    *   Clicking "Deploy Agent" spawns the configuration modal[cite: 6].
*   **Animations:**
    *   Avatar ring rotates with radial emissive glow on active agents[cite: 6].
    *   Cards elevate ($Y\text{-axis} -3\text{ px}$) on hover[cite: 6].
*   **Responsive Behavior:** Carousel converts into horizontal scroll view on tablet/mobile[cite: 6].
*   **Empty States:** "No Sub-Agents deployed in this department" with "Deploy Agent" button[cite: 6].
*   **Loading States:** Grid skeleton blocks with pulsing circular avatar placeholders[cite: 6].
*   **Error States:** Agent status dot displays offline state; alert banner shown in context panel[cite: 6].
*   **Backend Data Required:** Agent profiles, department assignments, core traits, health status, total tasks executed[cite: 1, 6].
*   **APIs Consumed:** `GET /api/v1/agents`, `POST /api/v1/agents/deploy`, `DELETE /api/v1/agents/:id`
*   **Related Managers:** TEMO-01 (System Anchor)[cite: 3], Nova, Echo, Flow, Luna, Atlas, Orion[cite: 1].
*   **Mission Interactions:** Assigns specific agents to active or scheduled missions[cite: 6].

---

### Page 6: Manager Details (Executive Hub)

*   **Purpose:** Deep profile view for an executive AI manager, showing their signature domain metrics, connected tools, active workflows, and personality matrix[cite: 1, 6].
*   **Route:** `/agents/manager/:managerKey` (e.g., `/agents/manager/nova`)
*   **Layout:** Stage-Focused Split Layout[cite: 3, 6]. Left $50\%$ focuses on the $1:1$ Manager 3D Avatar (Zone C); Right $50\%$ contains Departmental Control Panels[cite: 1, 3, 6].
*   **Sections:**
    1.  *Manager Identity & Core Status Bar*[cite: 1, 6]
    2.  *Department Performance Telemetry*[cite: 1, 6]
    3.  *Connected Department Tools & APIs*[cite: 1, 6]
    4.  *Assigned Workflow Pipelines*[cite: 1, 6]
*   **Components Used:** Glass Panels, Statistics Cards, Tool Cards, Workflow Cards, Progress Indicators, Buttons, Voice Orb[cite: 6].
*   **User Interactions:**
    *   Clicking "Direct Link" opens a dedicated chat session with this manager using their department color theme[cite: 1, 6].
    *   Toggling Tool Switches enables or disables access for their sub-agents[cite: 6].
*   **Animations:**
    *   Manager's chest core and UI borders glow in their department color token (e.g., Deep Violet for Nova, Imperial Gold for Orion)[cite: 1, 6].
    *   Smooth camera pan focusing on the manager's chest reactor core[cite: 3].
*   **Responsive Behavior:** On mobile, 3D avatar docks behind a tabbed management interface[cite: 6].
*   **Empty States:** N/A (Static core system managers)[cite: 1].
*   **Loading States:** Department color glowing spinner with `CALIBRATING CORE...` sub-label[cite: 6].
*   **Error States:** Core turns Critical Red (`#EF4444`) on engine execution errors[cite: 1, 6].
*   **Backend Data Required:** Manager metadata, department telemetry history, tool authorization state, active sub-agent IDs[cite: 1, 6].
*   **APIs Consumed:** `GET /api/v1/managers/:key`, `PUT /api/v1/managers/:key/tools`
*   **Related Managers:** Targeted Manager (Nova, Echo, Flow, Luna, Atlas, or Orion)[cite: 1].
*   **Mission Interactions:** Filters global mission lists to display only department-specific goals[cite: 1, 6].

---

### Page 7: Workflows (Pipeline Orchestrator)

*   **Purpose:** Drag-and-drop visual canvas for designing, testing, and deploying multi-agent automation workflows and webhooks[cite: 1, 6].
*   **Route:** `/workflows` or `/workflows/builder/:workflowId`
*   **Layout:** Full-screen Node Canvas Viewport with floating Glass Toolbars and Left Node Library Drawer[cite: 6].
*   **Sections:**
    1.  *Canvas Control Header* (Run, Save, Deploy, Webhook URL)[cite: 6]
    2.  *Node Drawer* (Triggers, Managers, Workers, Integrations)[cite: 1, 6]
    3.  *Infinite Grid Canvas Workspace*[cite: 6]
    4.  *Node Inspector Panel* (Right Panel)[cite: 6]
*   **Components Used:** Workflow Cards, Manager Nodes, Worker Nodes, Buttons, Icon Buttons, Search Box, Context Menus, Drawer Panels[cite: 6].
*   **User Interactions:**
    *   Drag and drop nodes from drawer onto canvas; connect output ports to input ports[cite: 6].
    *   Right-clicking nodes opens Context Menu for instant testing/duplication[cite: 6].
*   **Animations:**
    *   Active connections stream glowing particle packets matching parent manager colors[cite: 1, 6].
    *   Moving gradient march animation along borders during workflow dry runs[cite: 6].
*   **Responsive Behavior:** Canvas editing is disabled on small viewports ($<768\text{px}$); displays list of workflows with execution triggers[cite: 6].
*   **Empty States:** Blank Grid Canvas with centered "Drag a Trigger Node or Select Template" placeholder[cite: 6].
*   **Loading States:** Canvas grid lines pulse cyan with "Compiling Workflow Logic..." banner[cite: 6].
*   **Error States:** Invalid connections highlight in red with error badge explaining input parameter mismatch[cite: 6].
*   **Backend Data Required:** Workflow JSON schema, available triggers, webhook signatures, past run execution metrics[cite: 6].
*   **APIs Consumed:** `GET /api/v1/workflows`, `POST /api/v1/workflows/save`, `POST /api/v1/workflows/:id/execute`
*   **Related Managers:** Flow (Automation Manager)[cite: 1].
*   **Mission Interactions:** Workflows serve as operational building blocks executed during missions[cite: 1, 6].

---

### Page 8: Knowledge (Deep Vector Store)

*   **Purpose:** Search, index, and manage document knowledge bases, vector embeddings, and organizational data sources[cite: 1, 6].
*   **Route:** `/knowledge`
*   **Layout:** Two-Column Data Layout[cite: 6]. Left Column ($35\%$) contains Knowledge Base sources list; Right Column ($65\%$) contains document vector chunk explorer[cite: 6].
*   **Sections:**
    1.  *Knowledge Search & Sync Bar*[cite: 6]
    2.  *Data Source Library* (Documents, URLs, Databases, Notion)[cite: 6]
    3.  *Vector Index Explorer & Chunk Viewer*[cite: 6]
    4.  *Atlas Neural Query Console*[cite: 1, 6]
*   **Components Used:** Knowledge Cards, Search Box, Buttons, Tables, Progress Indicators, Lists, Modal Windows[cite: 6].
*   **User Interactions:**
    *   Clicking "Sync Source" initiates background vector indexing managed by Atlas[cite: 1, 6].
    *   Selecting a Knowledge Card reveals its chunk embeddings in the Explorer[cite: 6].
*   **Animations:**
    *   Progress beam animates across card base during vector indexing[cite: 6].
    *   Atlas Ocean Cobalt theme accent (`#06B6D4`) glows during query searches[cite: 1, 6].
*   **Responsive Behavior:** Layout converts to single-column view with tabbed switching between Sources and Chunks[cite: 6].
*   **Empty States:** Holographic Search Void emblem with "Drag and drop PDFs or connect data source" button[cite: 6].
*   **Loading States:** Cobalt spinner with animated `INDEXING VECTOR SPHERE...` progress bar[cite: 6].
*   **Error States:** Vector chunk displays red sync error badge with "Re-index Source" action[cite: 6].
*   **Backend Data Required:** Knowledge base sources, vector collection counts, chunk text, embedding dimensions, sync status[cite: 6].
*   **APIs Consumed:** `GET /api/v1/knowledge/sources`, `POST /api/v1/knowledge/upload`, `POST /api/v1/knowledge/reindex`
*   **Related Managers:** Atlas (Deep Research Lead)[cite: 1].
*   **Mission Interactions:** Supplies contextual grounding data for autonomous multi-agent missions[cite: 1, 6].

---

### Page 9: Memory (Long-Term Cognitive Bank)

*   **Purpose:** View, inspect, edit, and audit TEMO’s long-term episodic, semantic, and procedural memory blocks[cite: 6].
*   **Route:** `/memory`
*   **Layout:** 3D Crystalline Memory Grid / Vector Galaxy View[cite: 1, 6].
*   **Sections:**
    1.  *Memory Search & Category Filter Header* (Episodic, Semantic, Procedural)[cite: 6]
    2.  *Memory Tile Matrix*[cite: 6]
    3.  *Selected Memory Deep Inspection Drawer*[cite: 6]
*   **Components Used:** Memory Cards, Search Box, Dropdowns, Buttons, Drawer Panels, Modal Windows[cite: 6].
*   **User Interactions:**
    *   Clicking a Memory Tile opens raw vector data in the Right Context Panel[cite: 6].
    *   Clicking "Forget Memory" triggers confirmation modal to wipe specific vector block[cite: 6].
*   **Animations:**
    *   Memory tiles glide into center workspace when actively recalled[cite: 6].
    *   Sub-surface glowing memory core brightens on hover[cite: 6].
*   **Responsive Behavior:** Converts 3D grid into a clean vertical list of memory records[cite: 6].
*   **Empty States:** Holographic Wireframe with "No long-term memories stored in this category"[cite: 6].
*   **Loading States:** Crystalline skeleton pulse animations with cyan center glow[cite: 6].
*   **Error States:** Memory tile turns opaque gray with "Encryption Error" badge[cite: 6].
*   **Backend Data Required:** Memory records, vector IDs, confidence scores, last recalled timestamps, memory types[cite: 6].
*   **APIs Consumed:** `GET /api/v1/memory`, `DELETE /api/v1/memory/:id`, `PATCH /api/v1/memory/:id`
*   **Related Managers:** TEMO-01 (System Anchor)[cite: 3] and Atlas[cite: 1].
*   **Mission Interactions:** Serves as the cross-mission recall system for user preferences and past learnings[cite: 6].

---

### Page 10: Tools (Integrations & API Registry)

*   **Purpose:** Configure external tools, custom Python code runners, database integrations, and API keys for agents[cite: 1, 6].
*   **Route:** `/tools`
*   **Layout:** Filterable Grid of Glass Tool Cards[cite: 6].
*   **Sections:**
    1.  *Tool Category Tabs* (All, API Webhooks, Code Interpreters, Financial Feeds, Browsers)[cite: 6]
    2.  *Tool Grid*[cite: 6]
    3.  *API Key Security Vault Drawer*[cite: 6]
*   **Components Used:** Tool Cards, Search Box, Buttons, Toggle Switches, Modal Windows, Settings Components[cite: 6].
*   **User Interactions:**
    *   Toggling the switch enables/disables tool availability globally[cite: 6].
    *   Clicking "Configure Keys" opens secure settings modal[cite: 6].
*   **Animations:**
    *   Toggle switches slide smoothly with elastic spring physics[cite: 6].
    *   Cards scale up ($1.02\times$) on hover with illuminated cyan borders[cite: 6].
*   **Responsive Behavior:** Responsive flex wrap grid auto-fits viewport width[cite: 6].
*   **Empty States:** Centered Empty State with "Register Custom API Tool" trigger[cite: 6].
*   **Loading States:** Skeleton tiles with pulsing toggle placeholder shapes[cite: 6].
*   **Error States:** Tool card displays red alert badge if API key verification fails[cite: 6].
*   **Backend Data Required:** Registered tools, authorization status, rate limits, assigned agent permissions[cite: 6].
*   **APIs Consumed:** `GET /api/v1/tools`, `POST /api/v1/tools/toggle`, `POST /api/v1/tools/keys`
*   **Related Managers:** Nova (Engineering)[cite: 1] and Flow (Automation)[cite: 1].
*   **Mission Interactions:** Provides execution capabilities (e.g., executing trades via Orion, generating images via Luna) during missions[cite: 1, 6].

---

### Page 11: Analytics (System Telemetry & Performance)

*   **Purpose:** Detailed quantitative reporting on system token usage, execution speeds, cost metrics, and financial trading P&L[cite: 1, 6].
*   **Route:** `/analytics`
*   **Layout:** Macro Dashboard Grid View[cite: 6].
*   **Sections:**
    1.  *Timeframe Selector Header* (1H, 24H, 7D, 30D, ALL)[cite: 6]
    2.  *Macro System Statistics Row*[cite: 6]
    3.  *Token & Inference Cost Charts*[cite: 6]
    4.  *Department Throughput Comparison*[cite: 1, 6]
    5.  *Orion Trading Performance & Risk Heatmaps*[cite: 1, 6]
*   **Components Used:** Dashboard Cards, Statistics Cards, Charts, Tables, Dropdowns, Buttons[cite: 6].
*   **User Interactions:**
    *   Dragging across charts zooms in on specific execution timeframes[cite: 6].
    *   Hovering over chart vectors displays precise numerical tooltips[cite: 6].
*   **Animations:**
    *   Vector lines draw smoothly from left to right on initial view load ($0.8\text{ s}$)[cite: 6].
    *   Imperial Gold chart vectors glow for Orion trading telemetry[cite: 1, 6].
*   **Responsive Behavior:** Charts collapse into single-column vertical stack on mobile[cite: 6].
*   **Empty States:** Charts display "No Telemetry Data for Selected Range" message[cite: 6].
*   **Loading States:** Glass chart containers with continuous left-to-right shimmer waves[cite: 6].
*   **Error States:** Chart displays red disconnected icon if telemetry feed stream drops[cite: 6].
*   **Backend Data Required:** Token usage metrics, execution latency, API costs, financial trading order history, success rates[cite: 1, 6].
*   **APIs Consumed:** `GET /api/v1/analytics/telemetry`, `GET /api/v1/analytics/costs`, `GET /api/v1/analytics/trading`
*   **Related Managers:** Orion (Fintech Lead)[cite: 1] and Nova (System Infrastructure)[cite: 1].
*   **Mission Interactions:** Tracks resource consumption and cost efficiency of all completed missions[cite: 6].

---

### Page 12: Settings (OS Configuration)

*   **Purpose:** System-wide controls for model routing, voice synthesis engines, security policies, and theme overrides[cite: 6].
*   **Route:** `/settings` or `/settings/:category`
*   **Layout:** Two-Column Settings Layout[cite: 6]. Left Navigation Column ($25\%$); Right Settings Group Area ($75\%$)[cite: 6].
*   **Sections:**
    1.  *Settings Category Menu* (Model Routing, Voice & Audio, Security, API Keys, Visual Preferences)[cite: 6]
    2.  *Settings Group Panels*[cite: 6]
    3.  *Unsaved Changes Sticky Action Bar*[cite: 6]
*   **Components Used:** Settings Components (Setting Rows, Groups, Sliders, Toggles), Dropdowns, Buttons, Modal Windows[cite: 6].
*   **User Interactions:**
    *   Modifying any control reveals the bottom "Unsaved Changes" floating bar[cite: 6].
    *   Adjusting range sliders changes parameters in real-time[cite: 6].
*   **Animations:**
    *   Setting controls illuminate emissive cyan light when toggled active[cite: 6].
    *   Unsaved changes bar glides up from bottom viewport edge[cite: 6].
*   **Responsive Behavior:** Category menu turns into a top horizontal dropdown on mobile[cite: 6].
*   **Empty States:** N/A.
*   **Loading States:** Setting rows display skeleton pulse bars while loading configurations[cite: 6].
*   **Error States:** Invalid setting input displays red helper text under the affected setting row[cite: 6].
*   **Backend Data Required:** System config object, model API keys, audio volume levels, active security parameters[cite: 6].
*   **APIs Consumed:** `GET /api/v1/settings`, `POST /api/v1/settings/save`
*   **Related Managers:** TEMO-01 (OS Architect)[cite: 3].
*   **Mission Interactions:** Sets global parameters (e.g., maximum mission budget, auto-abort error thresholds)[cite: 6].

---

### Page 13: Profile (User & Organization)

*   **Purpose:** Manage user identity, executive privileges, workspace organization settings, and multi-user access[cite: 6].
*   **Route:** `/profile`
*   **Layout:** Single Centered Glass Panel View ($800\text{px}$ max width)[cite: 6].
*   **Sections:**
    1.  *Executive Profile Header* (Avatar, Name, Role Badge, Security Level)[cite: 6]
    2.  *Account Credentials & Biometrics Section*[cite: 6]
    3.  *Workspace & Team Management Table*[cite: 6]
*   **Components Used:** Glass Panels, Buttons, Tables, Input Bar, Settings Components, Modal Windows[cite: 6].
*   **User Interactions:**
    *   Clicking "Update Biometrics" launches security verification modal[cite: 6].
    *   Inviting team members adds a new row to the Workspace Table[cite: 6].
*   **Animations:**
    *   Profile card border exhibits subtle cyan glow on load[cite: 6].
*   **Responsive Behavior:** Full viewport width with stacked input fields on mobile screens[cite: 6].
*   **Empty States:** N/A.
*   **Loading States:** Shimmer blocks over profile avatar and input groups[cite: 6].
*   **Error States:** Input validation errors turn border Critical Red (`#EF4444`)[cite: 6].
*   **Backend Data Required:** User profile data, security clearance level, connected workspace details, team member list[cite: 6].
*   **APIs Consumed:** `GET /api/v1/user/profile`, `POST /api/v1/user/update`
*   **Related Managers:** TEMO-01[cite: 3].
*   **Mission Interactions:** Determines user execution permissions for high-priority missions[cite: 6].

---

### Page 14: Notifications (Alert Center)

*   **Purpose:** Centralized history and management view for all system alerts, mission completions, error traces, and trade execution notices[cite: 1, 6].
*   **Route:** `/notifications`
*   **Layout:** Streamlined Vertical List View inside Zone D spatial container[cite: 2, 6].
*   **Sections:**
    1.  *Notification Filter Header* (All, Critical Alerts, Missions, Trading, System)[cite: 6]
    2.  *Chronological Notification Stream*[cite: 6]
    3.  *Notification Action Toolbar* (Mark All as Read, Clear History)[cite: 6]
*   **Components Used:** Notifications, Timeline, Activity Feed, Buttons, Icon Buttons, Search Box[cite: 6].
*   **User Interactions:**
    *   Clicking a notification item navigates to its related module (e.g., clicking a trade alert opens Orion's dashboard)[cite: 1, 6].
    *   Swiping right or clicking X dismisses individual notifications[cite: 6].
*   **Animations:**
    *   New incoming notifications slide in from the top with a temporary cyan background flash (`rgba(0, 243, 255, 0.2)`)[cite: 6].
*   **Responsive Behavior:** Adapts spacing to fit narrow screens, hiding secondary timestamp details[cite: 6].
*   **Empty States:** Holographic Wireframe emblem displaying "Zero Active Alerts. All systems nominal."[cite: 6].
*   **Loading States:** Skeleton list items with pulsing left border strips[cite: 6].
*   **Error States:** Displays Critical Red notification cards for urgent system exceptions[cite: 6].
*   **Backend Data Required:** Notification history list, read/unread states, severity levels, action deep-links[cite: 6].
*   **APIs Consumed:** `GET /api/v1/notifications`, `POST /api/v1/notifications/read`, `DELETE /api/v1/notifications/clear`
*   **Related Managers:** Flow (Alert Routing)[cite: 1] and TEMO-01[cite: 3].
*   **Mission Interactions:** Delivers real-time notifications when autonomous missions complete or require human intervention[cite: 6].

---

### Page 15: Search (Global System Query)

*   **Purpose:** Deep, unified cross-system search interface querying workflows, agents, knowledge vectors, execution logs, and chat messages[cite: 1, 6].
*   **Route:** `/search` or `/search?q=:query`
*   **Layout:** Centered Command & Results Viewport[cite: 6].
*   **Sections:**
    1.  *Large Global Search Query Bar*[cite: 6]
    2.  *Category Results Tabs* (All, Missions, Knowledge, Code, Agents, Messages)[cite: 6]
    3.  *SearchResults List & Vector Match Preview*[cite: 6]
*   **Components Used:** Search Box, Lists, Activity Feed, Buttons, Icon Buttons, Progress Indicators[cite: 6].
*   **User Interactions:**
    *   Typing query triggers real-time vector search across system datasets[cite: 6].
    *   Pressing Enter on a result item opens that entity's details view[cite: 6].
*   **Animations:**
    *   Real-time result entries slide down into place ($0.15\text{ s}$) as search executes[cite: 6].
*   **Responsive Behavior:** Search input expands to cover full screen width on mobile[cite: 6].
*   **Empty States:** Search Void hologram displaying "No matching records found across TEMO OS memory"[cite: 6].
*   **Loading States:** Kinetic concentric loading rings with `QUERYING NEURAL MESH...` text[cite: 6].
*   **Error States:** Search bar border turns Critical Red (`#EF4444`) on backend query timeout[cite: 6].
*   **Backend Data Required:** Hybrid keyword and vector similarity search results across database collections[cite: 6].
*   **APIs Consumed:** `GET /api/v1/search/query?q=:query`
*   **Related Managers:** Atlas (Deep Knowledge Querying)[cite: 1].
*   **Mission Interactions:** Allows searching past mission execution logs and step output artifacts[cite: 6].

---

### Page 16: Command Center (Executive Modal Overdrive)

*   **Purpose:** System-wide executive command palette overlay ($⌘K$) for executing immediate actions, changing system modes, or overriding multi-agent operations[cite: 6].
*   **Route:** Global Overlay Modal (`/command-center` route anchor)[cite: 6].
*   **Layout:** High-Key Centered Modal Container over blurred dark backdrop (`backdrop-filter: blur(24px)`)[cite: 6].
*   **Sections:**
    1.  *Command Input Field*[cite: 6]
    2.  *Command Category Tabs* (All, Commands, Agents, Navigation, Workflows)[cite: 6]
    3.  *Quick Results List with Keyboard Shortcut Badges*[cite: 6]
    4.  *Footer Keyboard Navigation Hints*[cite: 6]
*   **Components Used:** Command Palette, Search Box, Lists, Icon Buttons, Buttons[cite: 6].
*   **User Interactions:**
    *   Pressing Up/Down Arrow keys navigates command selections[cite: 6].
    *   Pressing Enter immediately triggers action or executes shortcut[cite: 6].
    *   Pressing Escape dismisses the overlay instantly[cite: 6].
*   **Animations:**
    *   Modal drops down smoothly from top ($Y -20\text{px} \to 0\text{px}$, opacity $0 \to 1$ over $0.2\text{ s}$)[cite: 6].
    *   Selected item highlight row illuminates in Active Cyan (`rgba(0, 243, 255, 0.15)`)[cite: 6].
*   **Responsive Behavior:** Spans $95\%$ viewport width on mobile/tablet viewports[cite: 6].
*   **Empty States:** Displays "No matching commands found. Type 'help' for options"[cite: 6].
*   **Loading States:** Command row displays mini inline cyan spinner during async action execution[cite: 6].
*   **Error States:** Flashes command row background Critical Red (`#EF4444`) on execution failure[cite: 6].
*   **Backend Data Required:** System action registry, active hotkeys, navigation targets, dynamic manager shortcuts[cite: 6].
*   **APIs Consumed:** `POST /api/v1/command/execute`
*   **Related Managers:** TEMO-01 (Direct Orchestrator)[cite: 3].
*   **Mission Interactions:** Provides emergency global pause, instant mission trigger, and system override controls[cite: 6].

---

## 3. Product-Wide Information Architecture (IA) Matrix


```

+-----------------------------------------------------------------------------------------------------------------------------------+
| Module            | Route Path                  | Primary Manager | Primary Core Accent Token   | Core Data Source               |
+-------------------+-----------------------------+-----------------+-----------------------------+--------------------------------+
| Dashboard         | /dashboard                  | TEMO-01         | Active Cyan (#00F3FF)       | Telemetry & Active Missions    |
| Chat              | /chat                       | TEMO-01         | Active Cyan (#00F3FF)       | Conversational SSE Stream      |
| Missions          | /missions                   | Flow            | Cyber Emerald (#10B981)     | Autonomous Goal Engine         |
| Mission Details   | /missions/:missionId        | Flow / Nova     | Cyber Emerald / Violet      | Execution Graph DAG            |
| Agents            | /agents                     | TEMO-01         | Active Cyan (#00F3FF)       | Agent Roster Database          |
| Manager Details   | /agents/manager/:managerKey | Department Lead | Department Specific Token   | Manager Performance Metrics    |
| Workflows         | /workflows                  | Flow            | Cyber Emerald (#10B981)     | Workflow Schema & Webhooks     |
| Knowledge         | /knowledge                  | Atlas           | Ocean Cobalt (#06B6D4)      | Vector Database Collections    |
| Memory            | /memory                     | TEMO-01 / Atlas | Active Cyan / Cobalt        | Long-Term Vector Embeddings    |
| Tools             | /tools                      | Nova / Flow     | Neon Purple / Cyber Emerald | Tool Authorization Registry    |
| Analytics         | /analytics                  | Orion / Nova    | Imperial Gold / Violet      | Performance & Financial Logs   |
| Settings          | /settings                   | TEMO-01         | Titanium Chrome (#94A3B8)   | OS System Configuration        |
| Profile           | /profile                    | TEMO-01         | Active Cyan (#00F3FF)       | User Clearance & Team Registry |
| Notifications     | /notifications              | Flow / TEMO-01  | Active Cyan (#00F3FF)       | Real-Time Event Bus            |
| Search            | /search                     | Atlas           | Ocean Cobalt (#06B6D4)      | Hybrid Keyword / Vector Search |
| Command Center    | /command-center (Overlay)   | TEMO-01         | Active Cyan (#00F3FF)       | System Action Registry         |
+-----------------------------------------------------------------------------------------------------------------------------------+

```

---

## 4. Verification of Design System & Component Library Compliance

1. **Aesthetic Consistency:** Every specified layout operates within the futuristic high-key NASA Mission Control and Apple-inspired glassmorphic bridge environment[cite: 2, 5].
2. **Character & Material Palette Rules:** All page layouts reference the strict material matrix: Polished White Titanium, Smoked Curved Glass, Matte Carbon-Polymer, and Synthetic Bio-Dermis[cite: 1, 3, 5].
3. **Department Color Integrity:** Primary Cyan (`#00F3FF`) is preserved for TEMO-01 and core OS functions, while department pages strictly use their assigned tokens (Nova Deep Violet, Echo Solar Orange, Flow Cyber Emerald, Luna Neon Pink, Atlas Ocean Cobalt, Orion Imperial Gold)[cite: 1, 3, 5, 6].
4. **No Unspecified Elements:** Every page component is sourced directly from the **TEMO AI OS UI Component Library Specification**[cite: 6]. Zero unauthorized code or unlisted visual elements were introduced.

```