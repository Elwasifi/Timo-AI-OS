import type { Agent } from '@/types';

/**
 * AgentResponses — per-agent response generators.
 * Each agent has its own tone, vocabulary, and personality.
 * No generic responses — every agent sounds distinctly different.
 */

type Category = 'code' | 'workflow' | 'business' | 'design' | 'content' | 'default';

function categorize(input: string): Category {
  const l = input.toLowerCase();
  if (/(code|function|program|debug|api|database|deploy|typescript|react|bug|server)/.test(l)) return 'code';
  if (/(workflow|automate|n8n|zapier|webhook|integration|pipeline|trigger|schedule)/.test(l)) return 'workflow';
  if (/(business|marketing|sales|pricing|growth|revenue|competitor|market|strategy|analytics)/.test(l)) return 'business';
  if (/(design|ui|ux|brand|logo|color|layout|prototype|figma|presentation)/.test(l)) return 'design';
  if (/(content|writing|seo|youtube|social|email|blog|post|article|viral|copy)/.test(l)) return 'content';
  return 'default';
}

interface ResponseSet {
  greeting: string;
  default: string[];
  code: string[];
  workflow: string[];
  business: string[];
  design: string[];
  content: string[];
}

const RESPONSES: Record<string, ResponseSet> = {
  temo: {
    greeting: `Hello Amro.\n\nI'm **Temo**.\n\nI'll coordinate our AI team.\n\nTell me what you would like to build today.`,
    default: [
      "I've assessed your request and the right specialist is ready to help. Let me coordinate this for you.",
      "I'll route this to the best team member. One moment while I sync up our crew.",
      "Got it. I'm coordinating our specialists now — I'll have a structured response for you shortly.",
      "Let me synthesize this across our crew. I'll pull in the right expertise and deliver a clear plan.",
    ],
    code: [
      "This is a great engineering task. I'll bring in **Nova** — she's our Senior Software Engineer and she'll have a clean implementation for you in moments.",
      "Nova can handle this. She's already reviewing the architecture. I'll relay her solution once she's ready.",
    ],
    workflow: [
      "Automation is **Flow**'s domain. I'll hand this to him — he'll design a precise multi-step pipeline and map every integration point.",
      "I'm routing this to **Flow**. He'll lay out the full automation blueprint with triggers, actions, and webhooks.",
    ],
    business: [
      "**Atlas** is our Business Strategist. I'll have him analyze this with his strategic lens and come back with actionable insights.",
      "Atlas will take this one. He'll cross-reference market data and give you a growth-focused recommendation.",
    ],
    design: [
      "This calls for **Luna** — our Creative Designer. She'll craft something elegant and on-brand for you.",
      "I'm bringing in **Luna** for this. She has a keen eye for design and will deliver something beautiful.",
    ],
    content: [
      "**Echo** is our Content Creator. He'll craft something engaging and optimized for your audience.",
      "Echo will handle this — he knows how to make content that connects and converts.",
    ],
  },

  nova: {
    greeting: `Hey Amro!\n\nNeed code?\nLet's build something amazing.`,
    default: [
      "Alright, let me look at this from an engineering perspective. I'll have a clean, production-ready approach for you fast.",
      "Got it! I love a good challenge. Let me architect this properly — clean code, solid types, no shortcuts.",
      "Let's build this right. I'll design the solution, write the code, and make sure it's deployable.",
    ],
    code: [
      "Here's a clean implementation:\n\n```typescript\nasync function enrichLead(email: string) {\n  const data = await fetchCompany(email);\n  const enriched = {\n    ...data,\n    email,\n    score: calculateScore(data),\n    enriched: true,\n  };\n  return enriched;\n}\n```\n\nThis is production-ready. Want me to add tests?",
      "Let me architect this properly:\n\n```typescript\ninterface Lead {\n  email: string;\n  company?: string;\n  score: number;\n}\n\nclass LeadEnricher {\n  async enrich(lead: Lead): Promise<Lead> {\n    const company = await this.lookupCompany(lead.email);\n    return { ...lead, company: company.name, score: this.score(company) };\n  }\n}\n```\n\nClean, typed, and testable.",
    ],
    workflow: [
      "I can write the automation script for this. But for visual workflows, **Flow** is your guy — he'll wire up n8n beautifully. Want me to code it or should I hand off to Flow?",
      "From a code perspective, I'd build this as a microservice. But if you want a no-code workflow, Flow can set up an n8n pipeline. Your call!",
    ],
    business: [
      "I'm an engineer, not a strategist — but I can build the tools Atlas needs to analyze this. Want me to code a data pipeline for it?",
      "This is more Atlas's territory. I can build the analytics dashboard, but the strategic calls should come from him.",
    ],
    design: [
      "I can build the component and wire up the interactions, but for the visual design itself, Luna is your best bet. Want me to scaffold the code while she designs?",
      "I'll handle the engineering side — Luna can make it look stunning. We make a great team on this kind of thing.",
    ],
    content: [
      "I can write technical docs and code comments all day, but for marketing copy, Echo is your guy. Want me to code the backend while he writes the content?",
    ],
  },

  flow: {
    greeting: `Hi Amro.\n\nLet's automate your work.`,
    default: [
      "Let me analyze the inputs and design an efficient automation pipeline for this.",
      "I'll map out every step, every trigger, and every integration point. Precise and organized.",
      "Give me the parameters and I'll build a workflow that runs itself. No manual steps required.",
    ],
    code: [
      "I can set up a webhook trigger that calls your API endpoint automatically. The workflow would be:\n\n1. Webhook receives the request\n2. Transform the payload\n3. Call your API\n4. Log the result\n5. Send a notification\n\nShall I design this in n8n?",
      "If you need custom code in the workflow, Nova can write the script node. I'll wire it into the pipeline. Shall I coordinate with her?",
    ],
    workflow: [
      "Here's the automation blueprint:\n\n1. **Trigger**: Webhook or schedule\n2. **Fetch**: Pull data from connected services\n3. **Process**: Transform and enrich\n4. **Execute**: Run via n8n or Make\n5. **Notify**: Alert you on completion\n\nEvery step is mapped. Shall I enable it?",
      "I'll design this as a 6-step workflow:\n\n- Step 1: Receive trigger\n- Step 2: Validate input\n- Step 3: Enrich with Atlas\n- Step 4: Execute action\n- Step 5: Log result\n- Step 6: Send notification\n\nClean, precise, and fully automated.",
    ],
    business: [
      "I can automate the data collection for Atlas. A scheduled workflow that pulls market data, enriches it, and delivers a digest. Want me to set that up?",
      "Atlas handles the strategy — I handle the automation. I can build a pipeline that feeds him the data he needs. Shall I?",
    ],
    design: [
      "I can automate design asset delivery — trigger a workflow when Luna exports, resize automatically, and push to the right folders. Want me to wire that up?",
    ],
    content: [
      "I can build a content scheduling pipeline. Echo writes, I automate the publishing across channels. Want me to set up the workflow?",
    ],
  },

  atlas: {
    greeting: `Good to see you again.\n\nLet's grow your business.`,
    default: [
      "Let me take a strategic view of this. I'll analyze the landscape and give you a measured, actionable recommendation.",
      "I've seen patterns like this before. Let me break down the strategic implications and outline a path forward.",
      "Wise question. Let me consider the market context, competitive positioning, and growth potential before advising.",
    ],
    code: [
      "From a business perspective, I'd evaluate whether building this in-house is worth the engineering cost. Nova can build it, but let me first assess the ROI. Shall I run the numbers?",
      "Before Nova writes code, let me assess: is this the right thing to build? I'll analyze market demand and competitive alternatives first.",
    ],
    workflow: [
      "Automation is powerful, but let's make sure we're automating the right process. I'll analyze the workflow's business impact first, then Flow can implement it.",
      "I'll evaluate the strategic value of this automation. If the ROI is there, Flow will build it. Let me run the analysis.",
    ],
    business: [
      "Here's my strategic assessment:\n\n- **Market position**: You're well-positioned in a growing segment\n- **Competitive edge**: Your pricing is competitive but under-leveraged\n- **Growth lever**: Focus on retention — your LTV justifies a higher CAC\n\nWant me to build a full growth plan?",
      "I've analyzed the landscape. The data suggests a clear opportunity:\n\n- Competitor A raised prices 8% — opening room for you\n- Market sentiment is positive\n- Your differentiator is under-communicated\n\nShall I draft a positioning strategy?",
    ],
    design: [
      "Design is a business investment. Luna can make it beautiful, but let me first assess what design changes will move the needle on conversion. I'll brief her with data-driven specs.",
      "I'll analyze which design improvements have the highest ROI. Luna executes — I make sure we're investing in the right visuals.",
    ],
    content: [
      "Content strategy is a growth lever. Let me define the target audience and messaging framework, then Echo can craft the content that converts. Shall I build the strategy first?",
    ],
  },

  luna: {
    greeting: `Hi Amro!\n\nLet's create something beautiful.`,
    default: [
      "I'm already envisioning something elegant. Let me sketch out the aesthetic direction and we'll refine from there.",
      "Beautiful. I have a clear picture in my mind — clean lines, intentional whitespace, and a palette that feels premium. Let me detail it.",
      "Let's make this stunning. I'll design an experience that's both beautiful and intuitive. Here's my creative direction.",
    ],
    code: [
      "I can design the UI and hand off precise specs to Nova. She'll code it, I'll make sure every pixel feels intentional. Want me to start with the visual direction?",
      "I'll design the interface — Nova builds it. I'll provide colors, spacing, motion specs, and component states. It'll be gorgeous and functional.",
    ],
    workflow: [
      "I can design the workflow's visual interface — clean cards, intuitive connections, and beautiful status indicators. Flow handles the logic, I handle the look. Shall I mock it up?",
    ],
    business: [
      "Branding is business strategy made visible. Let me design a visual identity that communicates your market position. Atlas defines the strategy — I make it beautiful.",
      "I'll create a brand system that reflects your competitive edge. Atlas handles the positioning, I translate it into design.",
    ],
    design: [
      "Here's my creative direction:\n\n- **Palette**: Deep navy base with a cyan accent — confident and premium\n- **Typography**: Clean sans-serif with generous line height\n- **Motion**: Smooth, spring-based transitions — nothing abrupt\n- **Layout**: Asymmetric grid with intentional whitespace\n\nWant me to build a full design system?",
      "I'm seeing something elegant:\n\n- Soft gradients with glass morphism\n- Subtle micro-interactions on every element\n- A color story that flows from page to page\n- Typography that breathes — 150% line height, never cramped\n\nShall I prototype this?",
    ],
    content: [
      "I can design the visual assets for Echo's content — thumbnails, social cards, presentation decks. He writes, I make it visually stunning. Want me to start?",
    ],
  },

  echo: {
    greeting: `Ready to create viral content?\n\nLet's go.`,
    default: [
      "Oh, I have ideas for this already. Let me craft something that grabs attention and actually connects with people.",
      "This is gonna be fun. I'll write something with personality — no boring corporate speak. Just real, engaging content.",
      "Alright, let's make some noise. I'll craft copy that's catchy, SEO-friendly, and impossible to scroll past.",
    ],
    code: [
      "I can write the docs and the README — make it sound human and exciting. Nova handles the code, I make people actually want to use it. Want me to write the developer story?",
      "Code is Nova's thing, but I can write a killer launch announcement for when it ships. Want me to draft it?",
    ],
    workflow: [
      "I can write the workflow documentation and the launch content. Flow builds it, I make sure people know about it. Shall I draft the announcement?",
    ],
    business: [
      "I'll write the marketing copy that turns Atlas's strategy into words that sell. He defines the message — I make it punchy. Want me to draft the copy?",
      "Atlas does the analysis, I do the storytelling. I'll turn his insights into content that drives action. Let me write it.",
    ],
    design: [
      "I can write the microcopy and brand voice guidelines. Luna designs the visuals, I give them a voice. Want me to draft the copy that goes with her designs?",
    ],
    content: [
      "Here's what I'm thinking:\n\n**Headline**: \"This AI crew just changed everything.\"\n\n**Hook**: What if you had six AI specialists working for you — right now?\n\n**Body**: Keep it punchy, conversational, and loaded with value. Every sentence should make them want the next one.\n\nWant me to write the full piece?",
      "Let's make this go viral:\n\n- **YouTube title**: \"I Built an AI Team in 10 Minutes\"\n- **Thumbnail text**: \"6 AI Agents. 1 Crew.\"\n- **Hook**: Start with the result, not the process\n- **CTA**: Soft, not pushy — let the value sell itself\n\nShall I write the full script?",
    ],
  },
};

export function getAgentGreeting(agentId: string): string {
  return RESPONSES[agentId]?.greeting ?? RESPONSES.temo.greeting;
}

export function getAgentResponse(agentId: string, input: string): string {
  const set = RESPONSES[agentId] ?? RESPONSES.temo;
  const cat = categorize(input);
  const pool = set[cat].length > 0 ? set[cat] : set.default;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function getAgentIntro(agentId: string): string {
  return getAgentGreeting(agentId);
}
