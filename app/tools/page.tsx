'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { AppShell } from '@/components/temo/app-shell';
import { ToolCard, type Tool } from '@/components/temo/tool-card';
import { cn } from '@/lib/utils';

const TOOLS: Tool[] = [
  { id: 't1', name: 'Web Search', description: 'Real-time web search powered by Atlas', icon: 'search', category: 'Research', enabled: true },
  { id: 't2', name: 'Code Interpreter', description: 'Execute and debug code snippets', icon: 'code', category: 'Development', enabled: true },
  { id: 't3', name: 'Document Analyzer', description: 'Parse and extract insights from documents', icon: 'description', category: 'Research', enabled: true },
  { id: 't4', name: 'Calendar Sync', description: 'Read and create calendar events', icon: 'calendar_month', category: 'Productivity', enabled: false },
  { id: 't5', name: 'Message Router', description: 'Route messages across Slack and email', icon: 'message', category: 'Communication', enabled: true },
  { id: 't6', name: 'Workflow Builder', description: 'Visually compose n8n workflows', icon: 'account_tree', category: 'Automation', enabled: true },
  { id: 't7', name: 'Knowledge Base', description: 'Semantic search over your notes', icon: 'menu_book', category: 'Knowledge', enabled: false },
  { id: 't8', name: 'API Gateway', description: 'Proxy external APIs through Temo', icon: 'api', category: 'Infrastructure', enabled: true },
  { id: 't9', name: 'Task Automator', description: 'Schedule recurring agent tasks', icon: 'bolt', category: 'Automation', enabled: true },
];

const CATEGORIES = ['All', 'Research', 'Development', 'Automation', 'Productivity', 'Communication', 'Knowledge', 'Infrastructure'];

export default function ToolsPage() {
  const [tools, setTools] = useState(TOOLS);
  const [category, setCategory] = useState('All');

  const filtered = category === 'All' ? tools : tools.filter((t) => t.category === category);

  const toggle = (id: string) => {
    setTools((t) => t.map((tool) => (tool.id === id ? { ...tool, enabled: !tool.enabled } : tool)));
  };

  return (
    <AppShell>
      <div className="space-y-6 pb-8">
        <div>
          <h1 className="font-sans text-2xl font-bold tracking-tight text-temo-led">Tools</h1>
          <p className="font-mono text-xs text-temo-titanium">Capabilities your agents can invoke</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                'rounded-full px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-all',
                category === c
                  ? 'bg-temo-cyan/15 text-temo-cyan border border-temo-cyan/30'
                  : 'border border-temo-titanium/20 text-temo-titanium hover:text-temo-led'
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tool, i) => (
            <ToolCard key={tool.id} tool={tool} index={i} onToggle={toggle} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
