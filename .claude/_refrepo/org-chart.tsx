'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { LayoutDashboard, X } from 'lucide-react'
import { agents, TEMO, TONE_COLORS, type Agent, type Tone } from '@/lib/api'

const SPACE =
  'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/Stars_floating_in_space_void_202608161156-9XpFD91iiUbgGWePMBqBu8AAvk8Eha.jpeg'

type Point = { x: number; y: number }
type Edge = { id: string; from: Point; to: Point; tone: Tone; delay: number }

/* ---------- Animated deep-space starfield (canvas) ---------- */
function Starfield() {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const DPR = Math.min(window.devicePixelRatio || 1, 2)
    let w = 0
    let h = 0
    let raf = 0
    type Star = { x: number; y: number; r: number; vx: number; vy: number; tw: number; ts: number }
    let stars: Star[] = []

    const resize = () => {
      w = canvas.width = window.innerWidth * DPR
      h = canvas.height = window.innerHeight * DPR
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
    }
    const seed = () => {
      const count = Math.min(240, Math.round((window.innerWidth * window.innerHeight) / 9000))
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: (Math.random() * 1.4 + 0.3) * DPR,
        vx: (Math.random() - 0.5) * 0.06 * DPR,
        vy: (Math.random() * 0.12 + 0.02) * DPR,
        tw: Math.random() * Math.PI * 2,
        ts: Math.random() * 0.02 + 0.004,
      }))
    }
    const tick = () => {
      ctx.clearRect(0, 0, w, h)
      for (const s of stars) {
        s.x += s.vx
        s.y += s.vy
        s.tw += s.ts
        if (s.y > h) s.y = 0
        if (s.x < 0) s.x = w
        if (s.x > w) s.x = 0
        const a = 0.35 + Math.sin(s.tw) * 0.35
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(165,243,252,${a})`
        ctx.shadowBlur = 6 * DPR
        ctx.shadowColor = 'rgba(34,211,238,.85)'
        ctx.fill()
      }
      raf = requestAnimationFrame(tick)
    }

    resize()
    seed()
    tick()
    const onResize = () => {
      resize()
      seed()
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return <canvas ref={ref} className="org-starfield" aria-hidden />
}

/* ---------- Holographic avatar (frameless) ---------- */
function Holo({
  image,
  fallback,
  tone,
  size,
}: {
  image?: string
  fallback: string
  tone: Tone
  size: 'xl' | 'md' | 'sm'
}) {
  const color = TONE_COLORS[tone]
  return (
    <span className={`holo holo-${size}`} style={{ ['--tone' as string]: color }}>
      <span className="holo-scan" aria-hidden />
      <span
        className="holo-face"
        style={image ? { backgroundImage: `linear-gradient(180deg, transparent 12%, rgba(2,8,20,.28)), url(${image})` } : undefined}
      >
        {!image && fallback}
      </span>
      <span className="holo-ring" aria-hidden />
    </span>
  )
}

/* ---------- Frameless node: floating avatar + voice aura + label ---------- */
function Node({
  image,
  fallback,
  tone,
  size,
  name,
  title,
  status,
  kicker,
  active,
  level,
  avatarRef,
}: {
  image?: string
  fallback: string
  tone: Tone
  size: 'xl' | 'md' | 'sm'
  name: string
  title: string
  status?: 'online' | 'busy' | 'idle'
  kicker?: string
  active?: boolean
  level: 'ceo' | 'manager' | 'sub'
  avatarRef?: (el: HTMLSpanElement | null) => void
}) {
  return (
    <span className={`node node-${level} ${active ? 'node-active' : ''}`} style={{ ['--tone' as string]: TONE_COLORS[tone] }}>
      <span className="node-avatar" ref={avatarRef}>
        {active && (
          <>
            <span className="node-aura" aria-hidden />
            <span className="node-sonar" aria-hidden />
            <span className="node-sonar s2" aria-hidden />
            <span className="node-sonar s3" aria-hidden />
          </>
        )}
        <Holo image={image} fallback={fallback} tone={tone} size={size} />
      </span>
      <span className="node-label">
        <strong>{name}</strong>
        <span>{title}</span>
        {status && (
          <i className={`dot dot-${status}`}>
            ● {status}
          </i>
        )}
        {kicker && <em className="node-kicker">{kicker}</em>}
      </span>
    </span>
  )
}

/* ---------- Detail modal ---------- */
function DepartmentModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  return (
    <div className="org-modal-backdrop" onClick={onClose}>
      <section
        className={`org-modal tone-${agent.tone}`}
        onClick={(e) => e.stopPropagation()}
        style={{ ['--tone' as string]: TONE_COLORS[agent.tone] }}
      >
        <button className="org-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <Holo image={agent.image} fallback={agent.name[0]} tone={agent.tone} size="md" />
        <p className="org-kicker">DEPARTMENT NODE</p>
        <h2>{agent.name}</h2>
        <h3>{agent.role}</h3>
        <p className="org-modal-activity">{agent.activity}</p>
        <div className="org-modal-stats">
          <span>
            Sub-agents <b>{agent.children.length}</b>
          </span>
          <span>
            Status <b>{agent.status.toUpperCase()}</b>
          </span>
        </div>
        <ul>
          {agent.children.map((child) => (
            <li key={child.title}>
              {child.title}
              <small className={`dot dot-${child.status}`}>{child.status}</small>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export function OrgChart() {
  const [selected, setSelected] = useState<Agent | null>(null)
  const [activeManager, setActiveManager] = useState<string>(agents[0].id)
  const [edges, setEdges] = useState<Edge[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })

  const stageRef = useRef<HTMLDivElement | null>(null)
  const ceoRef = useRef<HTMLSpanElement | null>(null)
  const managerRefs = useRef<Map<string, HTMLElement>>(new Map())
  const subRefs = useRef<Map<string, HTMLElement>>(new Map())

  const registerManager = useCallback((id: string, el: HTMLElement | null) => {
    if (el) managerRefs.current.set(id, el)
    else managerRefs.current.delete(id)
  }, [])
  const registerSub = useCallback((id: string, el: HTMLElement | null) => {
    if (el) subRefs.current.set(id, el)
    else subRefs.current.delete(id)
  }, [])

  /* rotate the active "speaking" manager to showcase the voice state */
  useEffect(() => {
    const t = setInterval(() => {
      setActiveManager((prev) => {
        const idx = agents.findIndex((a) => a.id === prev)
        return agents[(idx + 1) % agents.length].id
      })
    }, 3200)
    return () => clearInterval(t)
  }, [])

  const measure = useCallback(() => {
    const stage = stageRef.current
    const ceo = ceoRef.current
    if (!stage || !ceo) return
    const base = stage.getBoundingClientRect()
    setSize({ w: stage.scrollWidth, h: stage.scrollHeight })

    const point = (el: Element, edge: 'top' | 'bottom'): Point => {
      const r = el.getBoundingClientRect()
      return {
        x: r.left - base.left + stage.scrollLeft + r.width / 2,
        y: (edge === 'bottom' ? r.bottom : r.top) - base.top + stage.scrollTop,
      }
    }

    const ceoBottom = point(ceo, 'bottom')
    const next: Edge[] = []
    let d = 0

    agents.forEach((agent) => {
      const mEl = managerRefs.current.get(agent.id)
      if (!mEl) return
      next.push({ id: `temo-${agent.id}`, from: ceoBottom, to: point(mEl, 'top'), tone: agent.tone, delay: d })
      const mBottom = point(mEl, 'bottom')
      agent.children.forEach((child, i) => {
        const sEl = subRefs.current.get(`${agent.id}:${child.title}`)
        if (!sEl) return
        next.push({ id: `${agent.id}-${i}`, from: mBottom, to: point(sEl, 'top'), tone: agent.tone, delay: d + (i + 1) * 0.12 })
      })
      d += 0.18
    })
    setEdges(next)
  }, [])

  useLayoutEffect(() => {
    measure()
    const t = setTimeout(measure, 300)
    return () => clearTimeout(t)
  }, [measure])

  useEffect(() => {
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(() => measure())
    if (stageRef.current) ro.observe(stageRef.current)
    return () => {
      window.removeEventListener('resize', onResize)
      ro.disconnect()
    }
  }, [measure])

  const path = (e: Edge) => {
    const midY = e.from.y + (e.to.y - e.from.y) / 2
    return `M ${e.from.x} ${e.from.y} C ${e.from.x} ${midY}, ${e.to.x} ${midY}, ${e.to.x} ${e.to.y}`
  }

  return (
    <main
      className="org-shell"
      style={{ backgroundImage: `linear-gradient(rgba(2,7,18,.55),rgba(2,7,18,.9)), url(${SPACE})` }}
    >
      <Starfield />

      <header className="org-topbar">
        <div>
          <p className="org-kicker">TEMO AI OS / INTELLIGENCE COMMAND</p>
          <h1>
            G-BRAIN <span>/ ORGANIZATION CHART</span>
          </h1>
          <p>Chief AI Executive Network · 247 active agents · Live neural topology</p>
        </div>
        <div className="org-topbar-actions">
          <Link href="/dashboard" className="org-dash-link">
            <LayoutDashboard size={14} />
            Command Deck
          </Link>
          <div className="org-live">
            <i />
            SYSTEM SYNCHRONIZED <b>99.98%</b>
          </div>
        </div>
      </header>

      <section className="org-stage" ref={stageRef}>
        <svg
          className="org-lines"
          width={size.w}
          height={size.h}
          viewBox={`0 0 ${size.w || 1} ${size.h || 1}`}
          aria-hidden
        >
          <defs>
            <filter id="neon-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="2.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {edges.map((e) => {
            const color = TONE_COLORS[e.tone]
            const d = path(e)
            return (
              <g key={e.id}>
                <path d={d} stroke={color} strokeOpacity={0.2} strokeWidth={1.4} fill="none" />
                <path
                  d={d}
                  stroke={color}
                  strokeWidth={1.6}
                  fill="none"
                  filter="url(#neon-glow)"
                  strokeLinecap="round"
                  strokeDasharray="7 240"
                  className="org-pulse"
                  style={{ animationDelay: `${e.delay}s` }}
                />
                <circle r={2.6} fill={color} filter="url(#neon-glow)">
                  <animateMotion dur="3s" begin={`${e.delay}s`} repeatCount="indefinite" path={d} />
                </circle>
              </g>
            )
          })}
        </svg>

        <div className="org-tree">
          <div className="ceo-wrap">
            <Node
              level="ceo"
              image={TEMO.image}
              fallback="T"
              tone={TEMO.tone}
              size="xl"
              name={TEMO.name}
              title={TEMO.role}
              kicker="● READY · ACTIVE LISTENING"
              active
              avatarRef={(el) => (ceoRef.current = el)}
            />
          </div>

          <div className="manager-row">
            {agents.map((agent) => (
              <div className="branch-column" key={agent.id}>
                <button
                  type="button"
                  className="node-btn"
                  onClick={() => setSelected(agent)}
                  aria-label={`Inspect ${agent.name}`}
                >
                  <Node
                    level="manager"
                    image={agent.image}
                    fallback={agent.name[0]}
                    tone={agent.tone}
                    size="md"
                    name={agent.name}
                    title={agent.role}
                    status={agent.status}
                    active={activeManager === agent.id}
                    avatarRef={(el) => registerManager(agent.id, el)}
                  />
                </button>

                <div className="subagent-stack">
                  {agent.children.map((child) => (
                    <Node
                      key={child.title}
                      level="sub"
                      image={child.image}
                      fallback={child.title[0]}
                      tone={agent.tone}
                      size="sm"
                      name={child.title}
                      title=""
                      status={child.status}
                      avatarRef={(el) => registerSub(`${agent.id}:${child.title}`, el)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="org-footer">
        <div>
          <b>G-BRAIN NETWORK</b>
          <span>1 executive core</span>
          <span>7 department managers</span>
          <span>{agents.reduce((n, a) => n + a.children.length, 0)} specialist nodes</span>
        </div>
        <p>Click any manager to inspect department telemetry and capabilities.</p>
      </section>

      {selected && <DepartmentModal agent={selected} onClose={() => setSelected(null)} />}
    </main>
  )
}
