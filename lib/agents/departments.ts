// Agent Registry Foundation — Department Definitions
// Phase 1: Manager Architecture
//
// Static department definitions that mirror the seed data in the database.
// These provide a fallback when the database is unavailable and serve as
// the single source of truth for department metadata in code.

import type { DepartmentRecord } from './types';

export const DEPARTMENTS: readonly DepartmentRecord[] = [
  {
    id: 'engineering',
    name: 'Engineering Department',
    description: 'Software architecture, code review, and technical implementation.',
    icon: 'Code2',
    themeColor: '#7B61FF',
    sortOrder: 1,
    businessUnitId: null,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'automation',
    name: 'Automation Department',
    description: 'Workflow design, API integration, and process automation.',
    icon: 'Workflow',
    themeColor: '#22C55E',
    sortOrder: 2,
    businessUnitId: null,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'research',
    name: 'Research Department',
    description: 'Market research, competitive intelligence, and business analysis.',
    icon: 'TrendingUp',
    themeColor: '#3B82F6',
    sortOrder: 3,
    businessUnitId: null,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'design',
    name: 'Design Department',
    description: 'Interface design, brand identity, and visual direction.',
    icon: 'Palette',
    themeColor: '#EC4899',
    sortOrder: 4,
    businessUnitId: null,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'marketing',
    name: 'Marketing Department',
    description: 'Content strategy, SEO, copywriting, and social media.',
    icon: 'PenTool',
    themeColor: '#F59E0B',
    sortOrder: 5,
    businessUnitId: null,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'trading',
    name: 'Trading Department',
    description: 'Market analysis, trading strategy, and risk management.',
    icon: 'LineChart',
    themeColor: '#F97316',
    sortOrder: 6,
    businessUnitId: null,
    createdAt: '',
    updatedAt: '',
  },
] as const;

export const DEPARTMENT_IDS = DEPARTMENTS.map((d) => d.id);

export function getDepartmentById(id: string): DepartmentRecord | undefined {
  return DEPARTMENTS.find((d) => d.id === id);
}
