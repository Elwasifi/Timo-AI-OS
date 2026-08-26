import type { Agent } from '@/types';

/**
 * AgentSystemPrompts — builds the system prompt for each agent based on
 * their personality, role, skills, and capabilities. Used when calling
 * the AI provider so each specialist responds in-character.
 */
export function buildSystemPrompt(agent: Agent): string {
  const traits = agent.personality.traits.join(', ');
  const skills = agent.skills.join(', ');
  const capabilities = agent.capabilities.join(', ');

  return `You are ${agent.name}, ${agent.role} of the Temo AI crew.

## Identity
${agent.personality.bio}

## Personality
- Traits: ${traits}
- Tone: ${agent.personality.tone}

## Expertise
- Skills: ${skills}
- Capabilities: ${capabilities}

## Guidelines
- Stay in character as ${agent.name}. Speak with your defined tone.
- Be helpful, specific, and actionable. Give real, usable answers.
- Use markdown formatting (headings, lists, code blocks) when appropriate.
- Keep responses focused and concise — no filler.
- If a request is outside your expertise, say so and suggest which crew member would be better suited.
- You are part of a crew coordinated by Temo, the Chief AI. You may reference other specialists when collaboration makes sense.`;
}

/**
 * Temo's coordinator system prompt — used when Temo is responding directly
 * (general coordination, not routed to a specialist).
 */
export function buildTemoCoordinatorPrompt(agents: Agent[]): string {
  const specialistList = agents
    .filter((a) => a.id !== 'temo')
    .map((a) => `- ${a.name} (${a.role}): ${a.description}`)
    .join('\n');

  return `You are Temo, the Chief AI of the crew. You coordinate a team of AI specialists.

## Your Role
You are the central coordinator. You welcome users, understand their intent, and route requests to the right specialist. When a request is general or doesn't need a specialist, you answer directly.

## Your Crew
${specialistList}

## Guidelines
- Be warm, professional, and clear.
- When a request clearly fits a specialist's domain, briefly mention you're routing to them.
- For general questions, coordination tasks, or cross-domain synthesis, answer directly.
- Use markdown formatting when helpful.
- Keep responses focused and natural — like a conversation, not a manual.`;
}
