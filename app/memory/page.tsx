'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Brain, Search, Trash2, Clock } from 'lucide-react';
import { AppShell } from '@/components/temo/app-shell';
import { GlassPanel, SectionHeader, EmptyState, StatCard } from '@/components/temo/primitives';
import { cn } from '@/lib/utils';

type MemoryType = 'episodic' | 'semantic' | 'procedural';

type MemoryRecord = {
  id: string;
  type: MemoryType;
  summary: string;
  confidence: number;
  lastAccessed: string;
  topics: string[];
};

const MEMORIES: MemoryRecord[] = [
  { id: 'm1', type: 'episodic', summary: 'User prefers concise answers with code examples', confidence: 0.98, lastAccessed: '2 min ago', topics: ['communication', 'preferences'] },
  { id: 'm2', type: 'semantic', summary: 'Project uses Next.js 14 with App Router and Tailwind CSS', confidence: 0.95, lastAccessed: '15 min ago', topics: ['tech-stack', 'nextjs'] },
  { id: 'm3', type: 'procedural', summary: 'Deployment workflow: build → test → deploy to Netlify', confidence: 0.92, lastAccessed: '1 hr ago', topics: ['deployment', 'netlify'] },
  { id: 'm4', type: 'episodic', summary: 'User asked about TEMO design system migration', confidence: 0.89, lastAccessed: '3 hrs ago', topics: ['design', 'migration'] },
  { id: 'm5', type: 'semantic', summary: 'Six managers: Nova, Flow, Atlas, Luna, Echo, Orion', confidence: 0.99, lastAccessed: '5 hrs ago', topics: ['agents', 'crew'] },
  { id: 'm6', type: 'procedural', summary: 'Voice synthesis uses Google TTS with rate 1.0 and pitch 1.0', confidence: 0.87, lastAccessed: '1 day ago', topics: ['voice', 'tts'] },
];

const TYPE_COLORS: Record<MemoryType, string> = {
  episodic: '#00F3FF',
  semantic: '#8B5CF6',
  procedural: '#10B981',
};

const TYPE_LABELS: Record<MemoryType, string> = {
  episodic: 'Episodic',
  semantic: 'Semantic',
  procedural: 'Procedural',
};

export default function MemoryPage() {
  const [filter, setFilter] = useState<MemoryType | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = MEMORIES.filter((m) => filter === 'all' || m.type === filter).filter((m) =>
    m.summary.toLowerCase().includes(query.toLowerCase()) || m.topics.some((t) => t.includes(query.toLowerCase()))
  );

  const selectedMemory = MEMORIES.find((m) => m.id === selected);

  return (
    <AppShell>
      <div className="space-y-6 pb-8">
        <div>
          <h1 className="font-sans text-2xl font-bold tracking-tight text-temo-led">Memory</h1>
          <p className="font-mono text-xs text-temo-titanium">Long-term cognitive bank and vector embeddings</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total Memories" value={MEMORIES.length} icon={<Brain className="h-4 w-4" />} index={0} />
          <StatCard label="Episodic" value={MEMORIES.filter((m) => m.type === 'episodic').length} icon={<Brain className="h-4 w-4" />} accentColor="#00F3FF" index={1} />
          <StatCard label="Semantic" value={MEMORIES.filter((m) => m.type === 'semantic').length} icon={<Brain className="h-4 w-4" />} accentColor="#8B5CF6" index={2} />
          <StatCard label="Procedural" value={MEMORIES.filter((m) => m.type === 'procedural').length} icon={<Brain className="h-4 w-4" />} accentColor="#10B981" index={3} />
        </div>

        {/* Filters + search */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {(['all', 'episodic', 'semantic', 'procedural'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={cn(
                  'rounded-full px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-all',
                  filter === t
                    ? 'bg-temo-cyan/15 text-temo-cyan border border-temo-cyan/30'
                    : 'border border-temo-titanium/20 text-temo-titanium hover:text-temo-led'
                )}
              >
                {t === 'all' ? 'All' : TYPE_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-temo-titanium/20 bg-white/[0.02] px-3 py-1.5">
            <Search className="h-4 w-4 text-temo-titanium" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search memories..."
              className="bg-transparent font-mono text-xs text-temo-led placeholder:text-temo-titanium/50 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Memory grid */}
          <div className="lg:col-span-2">
            {filtered.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {filtered.map((m, i) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    whileHover={{ y: -3 }}
                    onClick={() => setSelected(m.id)}
                    className={cn(
                      'temo-glass cursor-pointer rounded-xl p-4 transition-all',
                      selected === m.id && 'border-temo-cyan/50',
                    )}
                    style={{ borderColor: `${TYPE_COLORS[m.type]}25` }}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className="rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                        style={{ backgroundColor: `${TYPE_COLORS[m.type]}15`, color: TYPE_COLORS[m.type] }}
                      >
                        {TYPE_LABELS[m.type]}
                      </span>
                      <span className="font-mono text-[10px] text-temo-titanium">{Math.round(m.confidence * 100)}%</span>
                    </div>
                    <p className="mt-2 font-sans text-sm text-temo-led">{m.summary}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.topics.map((t) => (
                        <span key={t} className="rounded bg-white/[0.03] px-1.5 py-0.5 font-mono text-[9px] text-temo-titanium">{t}</span>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                      <Clock className="h-3 w-3 text-temo-titanium" />
                      <span className="font-mono text-[10px] text-temo-titanium">{m.lastAccessed}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <GlassPanel className="p-8">
                <EmptyState
                  icon={<Brain className="h-12 w-12" />}
                  title="No Memories Found"
                  description="No long-term memories match your query in this category."
                />
              </GlassPanel>
            )}
          </div>

          {/* Detail drawer */}
          <div>
            <SectionHeader title="Inspection" icon={<Brain className="h-4 w-4" />} />
            {selectedMemory ? (
              <GlassPanel className="p-4">
                <div className="space-y-3">
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-temo-titanium">Type</span>
                    <p className="font-sans text-sm text-temo-led">{TYPE_LABELS[selectedMemory.type]}</p>
                  </div>
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-temo-titanium">Summary</span>
                    <p className="font-sans text-sm text-temo-led">{selectedMemory.summary}</p>
                  </div>
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-temo-titanium">Confidence</span>
                    <p className="font-mono text-sm text-temo-cyan">{(selectedMemory.confidence * 100).toFixed(1)}%</p>
                  </div>
                  <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-temo-critical/30 px-3 py-2 font-mono text-xs text-temo-critical transition-colors hover:bg-temo-critical/10">
                    <Trash2 className="h-3 w-3" /> Forget Memory
                  </button>
                </div>
              </GlassPanel>
            ) : (
              <GlassPanel className="p-6">
                <p className="text-center font-mono text-xs text-temo-titanium">Select a memory tile to inspect its vector data.</p>
              </GlassPanel>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
