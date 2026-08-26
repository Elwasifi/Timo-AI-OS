'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Search, Upload, FileText, Link as LinkIcon, Database } from 'lucide-react';
import { AppShell } from '@/components/temo/app-shell';
import { GlassPanel, SectionHeader, EmptyState, StatCard } from '@/components/temo/primitives';
import { cn } from '@/lib/utils';

const SOURCES = [
  { id: 's1', name: 'Product Documentation.pdf', type: 'pdf', chunks: 1247, size: '4.2 MB', status: 'synced', icon: 'description' },
  { id: 's2', name: 'API Reference', type: 'url', chunks: 384, size: '1.1 MB', status: 'synced', icon: 'link' },
  { id: 's3', name: 'Customer Feedback Database', type: 'database', chunks: 892, size: '2.8 MB', status: 'syncing', icon: 'database' },
  { id: 's4', name: 'Research Notes.md', type: 'markdown', chunks: 156, size: '340 KB', status: 'synced', icon: 'article' },
];

const STATUS_COLORS: Record<string, string> = {
  synced: '#10B981',
  syncing: '#06B6D4',
  error: '#EF4444',
};

export default function KnowledgePage() {
  const [query, setQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState<string | null>(null);

  const filtered = SOURCES.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <AppShell>
      <div className="space-y-6 pb-8">
        <div>
          <h1 className="font-sans text-2xl font-bold tracking-tight text-temo-led">Knowledge</h1>
          <p className="font-mono text-xs text-temo-titanium">Vector store and document intelligence</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Sources" value={SOURCES.length} icon={<BookOpen className="h-4 w-4" />} accentColor="#06B6D4" index={0} />
          <StatCard label="Vector Chunks" value={SOURCES.reduce((a, s) => a + s.chunks, 0).toLocaleString()} icon={<Database className="h-4 w-4" />} accentColor="#06B6D4" index={1} />
          <StatCard label="Synced" value={SOURCES.filter((s) => s.status === 'synced').length} icon={<FileText className="h-4 w-4" />} accentColor="#10B981" index={2} />
          <StatCard label="Indexing" value={SOURCES.filter((s) => s.status === 'syncing').length} icon={<Upload className="h-4 w-4" />} accentColor="#06B6D4" index={3} />
        </div>

        {/* Search bar */}
        <div className="flex items-center gap-2 rounded-xl border border-temo-research/20 bg-white/[0.02] px-4 py-3">
          <Search className="h-5 w-5 text-temo-research" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Query the neural mesh..."
            className="flex-1 bg-transparent font-sans text-sm text-temo-led placeholder:text-temo-titanium/50 focus:outline-none"
          />
          <button className="rounded-lg bg-temo-research/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-temo-research">
            Atlas Search
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Source library */}
          <div className="lg:col-span-1">
            <SectionHeader title="Data Sources" icon={<BookOpen className="h-4 w-4" />} accent="#06B6D4" />
            <div className="space-y-2">
              {filtered.map((src, i) => (
                <motion.div
                  key={src.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => setSelectedSource(src.id)}
                  className={cn(
                    'temo-glass cursor-pointer rounded-xl p-3 transition-all',
                    selectedSource === src.id && 'border-temo-research/50',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-xl text-temo-research">{src.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-sans text-sm text-temo-led">{src.name}</p>
                      <p className="font-mono text-[10px] text-temo-titanium">{src.chunks} chunks · {src.size}</p>
                    </div>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[src.status], boxShadow: `0 0 4px ${STATUS_COLORS[src.status]}` }} />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Vector chunk explorer */}
          <div className="lg:col-span-2">
            <SectionHeader title="Vector Index Explorer" icon={<Database className="h-4 w-4" />} accent="#06B6D4" />
            {selectedSource ? (
              <GlassPanel className="p-4">
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="rounded-lg border border-temo-research/10 bg-temo-research/5 p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-temo-research">Chunk #{i + 1}</span>
                        <span className="font-mono text-[10px] text-temo-titanium">Confidence: {(0.92 - i * 0.05).toFixed(2)}</span>
                      </div>
                      <p className="mt-2 font-sans text-sm text-temo-titanium">
                        Vector embedding preview for chunk {i + 1} of the selected source document.
                      </p>
                    </div>
                  ))}
                </div>
              </GlassPanel>
            ) : (
              <GlassPanel className="p-8">
                <EmptyState
                  icon={<BookOpen className="h-12 w-12" />}
                  title="Select a Source"
                  description="Choose a data source from the left to inspect its vector chunks and embeddings."
                />
              </GlassPanel>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
