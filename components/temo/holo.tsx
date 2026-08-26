'use client';

import { TONE_COLORS, type Tone } from '@/lib/agents/frontendBridge';

/**
 * Shared cinematic avatar primitives used by BOTH the G-Brain org chart and
 * the Command Deck so the two views stay visually identical.
 *
 * - Holo: frameless glowing holographic character avatar.
 * - VoiceAura: the active "speaking" aura + sonar rings.
 */

export function Holo({
  image,
  fallback,
  tone,
  size,
}: {
  image?: string;
  fallback: string;
  tone: Tone;
  size: 'hero' | 'xl' | 'md' | 'sm';
}) {
  const color = TONE_COLORS[tone];
  return (
    <span className={`holo holo-${size}`} style={{ ['--tone' as string]: color }}>
      <span className="holo-scan" aria-hidden />
      <span
        className="holo-face"
        style={
          image
            ? { backgroundImage: `linear-gradient(180deg, transparent 12%, rgba(2,8,20,.28)), url(${image})` }
            : undefined
        }
      >
        {!image && fallback}
      </span>
      <span className="holo-ring" aria-hidden />
    </span>
  );
}

/** Active speaking / voice aura — pulsing glow plus expanding sonar rings. */
export function VoiceAura() {
  return (
    <>
      <span className="node-aura" aria-hidden />
      <span className="node-sonar" aria-hidden />
      <span className="node-sonar s2" aria-hidden />
      <span className="node-sonar s3" aria-hidden />
    </>
  );
}

/**
 * Node — a full agent node (avatar + name + title + company tag + status +
 * description), frameless and card-free. Shared by G-Brain and the Command
 * Deck's Live Command Bridge so both surfaces render agents identically,
 * not two hand-maintained lookalikes.
 */
export function Node({
  image,
  fallback,
  tone,
  size,
  name,
  title,
  company,
  description,
  status,
  kicker,
  active,
  level,
  avatarRef,
}: {
  image?: string;
  fallback: string;
  tone: Tone;
  size: 'hero' | 'xl' | 'md' | 'sm';
  name: string;
  title: string;
  company?: string;
  description?: string;
  status?: 'online' | 'busy' | 'idle';
  kicker?: string;
  active?: boolean;
  level: 'ceo' | 'manager' | 'sub';
  avatarRef?: (el: HTMLSpanElement | null) => void;
}) {
  return (
    <span
      className={`node node-${level} ${active ? 'node-active' : ''}`}
      style={{ ['--tone' as string]: TONE_COLORS[tone] }}
    >
      <span className="node-avatar" ref={avatarRef}>
        {active && <VoiceAura />}
        <Holo image={image} fallback={fallback} tone={tone} size={size} />
      </span>
      <span className="node-label">
        <strong>{name}</strong>
        {title && <span>{title}</span>}
        {company && <em className="node-company">{company}</em>}
        {status && (
          <i className={`dot dot-${status}`}>
            &#9679; {status}
          </i>
        )}
        {description && <p className="node-description">{description}</p>}
        {kicker && <em className="node-kicker">{kicker}</em>}
      </span>
    </span>
  );
}
