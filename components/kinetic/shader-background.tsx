'use client';

import { useShaderBackground } from '@/hooks/use-shader-background';
import type { ShaderType } from '@/hooks/use-shader-background';

export type { ShaderType };

type ShaderBackgroundProps = {
  type?: ShaderType;
};

export function ShaderBackground({ type = 'default' }: ShaderBackgroundProps) {
  const canvasRef = useShaderBackground(type);
  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none opacity-40" />;
}
