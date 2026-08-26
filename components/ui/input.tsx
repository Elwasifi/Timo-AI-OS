import * as React from 'react';

import { cn } from '@/lib/utils';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // NOTE: text-foreground/text-muted-foreground below intentionally
          // use explicit hex arbitrary values, not the Tailwind
          // `text-foreground` utility. app/globals.css defines `--foreground`
          // twice — once as an HSL triplet (shadcn convention) and once,
          // later in the file, as a hex string (#e7f6ff, from the V0/Kinetic
          // Ether styling) — the later one wins by source order, so
          // `hsl(var(--foreground))` computes to the invalid `hsl(#e7f6ff)`
          // and silently falls back to black text. Using the real color
          // directly sidesteps that collision without touching the shared
          // CSS variable (which other, hex-based styling still depends on).
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-[#e7f6ff] ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[#e7f6ff] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
