import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './features/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: '0.75rem',
        '2xl': '1rem',
        full: '9999px',
      },
      spacing: {
        gutter: '24px',
        unit: '4px',
        'safe-area': '40px',
        'node-gap': '64px',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
        grotesk: ['var(--font-grotesk)', 'Space Grotesk', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        'label-caps': ['JetBrains Mono', 'monospace'],
        'headline-md': ['Inter', 'SF Pro Display', 'sans-serif'],
        'display-lg': ['Inter', 'SF Pro Display', 'sans-serif'],
        'data-point': ['JetBrains Mono', 'monospace'],
        'body-base': ['Inter', 'sans-serif'],
      },
      fontSize: {
        'label-caps': ['11px', { lineHeight: '1.4', letterSpacing: '0.15em', fontWeight: '600' }],
        'headline-md': ['24px', { lineHeight: '1.2', letterSpacing: '0.02em', fontWeight: '300' }],
        'display-lg': ['48px', { lineHeight: '1.1', letterSpacing: '-0.04em', fontWeight: '200' }],
        'data-point': ['14px', { lineHeight: '1', letterSpacing: '0', fontWeight: '500' }],
        'body-base': ['16px', { lineHeight: '1.6', letterSpacing: '0.01em', fontWeight: '400' }],
      },
      colors: {
        // ── shadcn semantic tokens (preserved for existing ui/ components) ──
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },

        // ── TEMO Design System exact tokens (04_Design_System.md) ──
        'temo-cyan': '#00F3FF',        // Primary Core - Active Cyan
        'temo-blue': '#0088FF',        // Secondary Core - Electric Blue
        'temo-purple': '#8B5CF6',      // Sub-Dermal Accent - Deep Purple
        'temo-titanium': '#94A3B8',    // Structural Metallic - Titanium Chrome
        'temo-void': '#04070D',        // Background Void - Deep Void
        'temo-obsidian': '#080C14',    // Reflective Surface - Obsidian Glass
        'temo-bulkhead': '#1E293B',    // Bulkhead Structure - Titanium Bulkhead
        'temo-led': '#E2F8FF',         // High-Key Accent - Clean White LED

        // Department accent tokens
        'dept-engineering': '#A855F7', // Nova - Deep Violet
        'dept-engineering-glow': '#8B5CF6',
        'dept-marketing': '#F97316',   // Echo - Solar Orange
        'dept-marketing-glow': '#FDE047',
        'dept-automation': '#10B981',  // Flow - Cyber Emerald
        'dept-automation-glow': '#34D399',
        'dept-creative': '#EC4899',    // Luna - Neon Pink
        'dept-creative-glow': '#F472B6',
        'dept-research': '#06B6D4',    // Atlas - Ocean Cobalt
        'dept-research-glow': '#3B82F6',
        'dept-trading': '#EAB308',      // Orion - Imperial Gold
        'dept-trading-glow': '#FDE047',

        // System alert tokens
        'temo-critical': '#EF4444',     // Critical Red
        'temo-mint': '#10B981',        // Success - Mint Green

        // Semantic aliases for new components
        'surface': '#04070D',
        'surface-dim': '#04070D',
        'surface-bright': '#353944',
        'surface-variant': '#1E293B',
        'surface-container': '#080C14',
        'surface-container-low': '#060912',
        'surface-container-lowest': '#02040A',
        'surface-container-high': '#0C1119',
        'surface-container-highest': '#121826',
        'surface-tint': '#00F3FF',
        'on-background': '#E2F8FF',
        'on-surface': '#E2F8FF',
        'on-surface-variant': '#94A3B8',
        'outline': '#94A3B8',
        'outline-variant': '#1E293B',
        'primary-container': '#00F3FF',
        'on-primary-container': '#0B0F17',
        'primary-fixed': '#00F3FF',
        'primary-fixed-dim': '#0088FF',
        'on-primary': '#0B0F17',
        'secondary-container': '#8B5CF6',
        'on-secondary-container': '#E2F8FF',
        'error-container': '#EF4444',
        'on-error-container': '#E2F8FF',
        'on-error': '#0B0F17',
        'error': '#EF4444',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'gradient-shift': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 20px rgba(0,243,255,0.4)' },
          '50%': { opacity: '0.85', boxShadow: '0 0 40px rgba(0,243,255,0.6)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.8' },
          '50%': { transform: 'scale(1.04)', opacity: '1' },
        },
        'energy-wave': {
          '0%': { transform: 'scale(0.8)', opacity: '0' },
          '40%': { opacity: '0.5' },
          '100%': { transform: 'scale(2)', opacity: '0' },
        },
        'scanline-sweep': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        'flow-dash': {
          to: { strokeDashoffset: '-30' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
        'spin-reverse': {
          to: { transform: 'rotate(-360deg)' },
        },
        'radar-sweep': {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
        flicker: {
          '0%, 100%': { opacity: '1' },
          '45%': { opacity: '0.85' },
          '50%': { opacity: '0.6' },
          '55%': { opacity: '0.9' },
        },
        'data-stream': {
          '0%': { transform: 'translateX(-100%)', opacity: '0' },
          '20%': { opacity: '1' },
          '80%': { opacity: '1' },
          '100%': { transform: 'translateX(100%)', opacity: '0' },
        },
        'slide-up-fade': {
          from: { transform: 'translateY(12px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'spark-flow': {
          '0%': { strokeDashoffset: '100' },
          '100%': { strokeDashoffset: '-100' },
        },
        'gradient-march': {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
        'sine-float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        'count-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'particle-flow': {
          '0%': { strokeDashoffset: '100' },
          '100%': { strokeDashoffset: '0' },
        },
        'halo-expand': {
          '0%': { transform: 'scale(1)', opacity: '0.6' },
          '100%': { transform: 'scale(2.5)', opacity: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'gradient-shift': 'gradient-shift 10s ease infinite',
        shimmer: 'shimmer 2s infinite',
        'pulse-glow': 'pulse-glow 2.5s ease-in-out infinite',
        float: 'float 4s ease-in-out infinite',
        breathe: 'breathe 4.5s ease-in-out infinite',
        'energy-wave': 'energy-wave 3s ease-out infinite',
        'scanline-sweep': 'scanline-sweep 8s linear infinite',
        'flow-dash': 'flow-dash 1.2s linear infinite',
        'spin-slow': 'spin-slow 14s linear infinite',
        'spin-slow-rev': 'spin-reverse 10s linear infinite',
        'radar-sweep': 'radar-sweep 6s linear infinite',
        flicker: 'flicker 4s ease-in-out infinite',
        'data-stream': 'data-stream 2.5s ease-in-out infinite',
        'slide-up-fade': 'slide-up-fade 0.35s ease forwards',
        'spark-flow': 'spark-flow 3s linear infinite',
        'gradient-march': 'gradient-march 1.5s linear infinite',
        'sine-float': 'sine-float 6s ease-in-out infinite',
        'count-up': 'count-up 0.8s ease-out',
        'halo-expand': 'halo-expand 2s ease-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
export default config;
