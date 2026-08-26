'use client';

import { useEffect, useRef } from 'react';

export type ShaderType = 'default' | 'core' | 'flow';

const vsSource = `
  attribute vec2 a_position;
  varying vec2 v_texCoord;
  void main() {
    v_texCoord = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const buildFsSource = (type: ShaderType): string => `
  precision highp float;
  uniform float u_time;
  uniform vec2 u_resolution;
  varying vec2 v_texCoord;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
    float d = length(uv);
    vec3 cyan = vec3(0.0, 0.94, 1.0);
    vec3 purple = vec3(0.6, 0.2, 1.0);

    float t = u_time * 0.5;
    float pulse = 0.5 + 0.5 * sin(t);

    vec3 color = vec3(0.02, 0.03, 0.08);

    if ("${type}" == "core") {
      float core = smoothstep(0.4, 0.2, d);
      color += cyan * core * 0.3;
      color += cyan * noise(uv * 10.0 + t) * core * 0.5;
    } else if ("${type}" == "flow") {
      float angle = atan(uv.y, uv.x);
      float spiral = smoothstep(0.1, 0.0, abs(fract(angle * 3.0 / 6.28 - t) - 0.5));
      color += purple * spiral * smoothstep(0.8, 0.0, d);
    } else {
      color += cyan * noise(uv * 5.0 + t * 0.2) * 0.1;
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

export function useShaderBackground(type: ShaderType = 'default') {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return;

    const compileShader = (source: string, shaderType: number): WebGLShader => {
      const shader = gl.createShader(shaderType)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };

    const program = gl.createProgram()!;
    gl.attachShader(program, compileShader(vsSource, gl.VERTEX_SHADER));
    gl.attachShader(program, compileShader(buildFsSource(type), gl.FRAGMENT_SHADER));
    gl.linkProgram(program);
    gl.useProgram(program);

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const posAttrib = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posAttrib);
    gl.vertexAttribPointer(posAttrib, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, 'u_time');
    const uRes = gl.getUniformLocation(program, 'u_resolution');

    // Track last known dimensions to avoid clearing the canvas buffer every frame
    let lastW = 0;
    let lastH = 0;

    let rafId = 0;
    const render = (time: number) => {
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (cw !== lastW || ch !== lastH) {
        lastW = cw;
        lastH = ch;
        canvas.width = cw;
        canvas.height = ch;
        gl.viewport(0, 0, cw, ch);
        gl.uniform2f(uRes, cw, ch);
      }
      gl.uniform1f(uTime, time * 0.001);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      rafId = requestAnimationFrame(render);
    };

    const start = () => {
      if (rafId !== 0) return;
      rafId = requestAnimationFrame(render);
    };
    const stop = () => {
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop();
      } else {
        start();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [type]);

  return canvasRef;
}
