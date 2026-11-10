"use client";

import React, { useEffect, useRef } from "react";

// ============================================================================
// Sahārā 3D Volumetric Fluid Bloop Orb (Authentic SpaceUI / 21st.dev WGSL → WebGL)
// Matches exact shader & fluid morphology from sahara-app mobile/web
// ============================================================================

export type OrbState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "emergency";

export interface NebulaVoiceOrbProps {
  size?: number;
  active?: boolean;
  speaking?: boolean;
  state?: OrbState;
  audioLevel?: number;
  theme?: "blue" | "emerald" | "cyan" | "emergency";
  onClick?: () => void;
  lang?: "hi" | "en" | "ta" | "bn";
}

const VERTEX_SHADER_SRC = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SRC = `
precision highp float;
uniform float u_time;
uniform float u_micLevel;
uniform float u_stateListen;
uniform float u_listenTimestamp;
uniform float u_stateThink;
uniform float u_thinkTimestamp;
uniform float u_stateSpeak;
uniform float u_speakTimestamp;
uniform vec4 u_avgMag;
uniform vec4 u_cumulativeAudio;
uniform vec2 u_viewport;
uniform float u_watercolorStrength;
uniform vec4 u_bloopColorMain;
uniform vec4 u_bloopColorLow;
uniform vec4 u_bloopColorMid;
uniform vec4 u_bloopColorHigh;

const float E = 2.71828182846;
const float PI = 3.141592653589793;
const float MAIN_R = 0.49;

float scaled(float edge0, float edge1, float x) {
  return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
}

float spring(float t, float d) {
  return 1.0 - exp(-E * 2.0 * t) * cos((1.0 - d) * 115.0 * t);
}

float fixedSpring(float t, float d) {
  float s = mix(spring(t, d), 1.0, scaled(0.0, 1.0, t));
  return s * (1.0 - t) + t;
}

float silkySmooth(float t, float k) {
  return atan(k * sin((t - 0.5) * PI)) / atan(k) * 0.5 + 0.5;
}

float opSmoothUnion(float d1, float d2, float k_in) {
  float k = max(k_in, 0.000001);
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

float sdRoundedBox(vec2 p, vec2 b, float rad) {
  vec2 q = abs(p) - b + rad;
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - rad;
}

vec4 permute(vec4 x) {
  return mod((x * 34.0 + 1.0) * x, 289.0);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

vec3 fade3(vec3 t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float cnoise(vec3 P) {
  vec3 Pi0 = floor(P);
  vec3 Pi1 = Pi0 + vec3(1.0);
  Pi0 = mod(Pi0, 289.0);
  Pi1 = mod(Pi1, 289.0);
  vec3 Pf0 = fract(P);
  vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = vec4(Pi0.z);
  vec4 iz1 = vec4(Pi1.z);
  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);
  vec4 gx0 = ixy0 / 7.0;
  vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(vec4(0.0), gx0) - 0.5);
  gy0 -= sz0 * (step(vec4(0.0), gy0) - 0.5);
  vec4 gx1 = ixy1 / 7.0;
  vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(vec4(0.0), gx1) - 0.5);
  gy1 -= sz1 * (step(vec4(0.0), gy1) - 0.5);
  vec3 g000 = vec3(gx0.x, gy0.x, gz0.x);
  vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
  vec3 g010 = vec3(gx0.z, gy0.z, gz0.z);
  vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
  vec3 g001 = vec3(gx1.x, gy1.x, gz1.x);
  vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
  vec3 g011 = vec3(gx1.z, gy1.z, gz1.z);
  vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);
  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x;
  g010 *= norm0.y;
  g100 *= norm0.z;
  g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x;
  g011 *= norm1.y;
  g101 *= norm1.z;
  g111 *= norm1.w;
  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
  float n111 = dot(g111, Pf1);
  vec3 fade_xyz = fade3(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  return 2.2 * mix(n_yz.x, n_yz.y, fade_xyz.x);
}

float watercolorTex(vec2 uv, float z) {
  float a = cnoise(vec3(uv * 4.0, z));
  float b = cnoise(vec3(uv * 8.0 + vec2(5.2, 1.7), z + 1.1));
  return a * 0.65 + b * 0.35;
}

float texDisp(vec2 uv, float z, float mixT) {
  float r = watercolorTex(uv, z) * 0.5 + 0.5;
  float g = watercolorTex(vec2(uv.x, 1.0 - uv.y), z + 2.3) * 0.5 + 0.5;
  return mix(r - 0.5, g - 0.5, mixT);
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 4.1414))) * 43758.5453);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float res = mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  return res * res;
}

float fbm(vec2 x_in) {
  vec2 x = x_in;
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 4; i++) {
    v += a * noise2(x);
    x = rot * x * 2.0 + vec2(100.0);
    a *= 0.5;
  }
  return v;
}

vec3 blendLinearBurn(vec3 base, vec3 blend, float opacity) {
  vec3 burned = max(base + blend - vec3(1.0), vec3(0.0));
  return burned * opacity + base * (1.0 - opacity);
}

float idleDist(vec2 st, float time) {
  float midRadius = 0.14;
  float maxRadius = 0.38;
  float t1 = 1.0;
  float gamma = 3.0;
  float omega = PI / 2.0;
  float k = exp(-gamma) * omega;
  float radius;
  if (time <= t1) {
    float tp = time / t1;
    radius = midRadius * (1.0 - exp(-gamma * tp) * cos(omega * tp));
  } else {
    radius = midRadius + (maxRadius - midRadius) * (1.0 - exp(-k * (time - t1)));
  }
  return length(st) - radius;
}

float listenDist(vec2 st, float duration, float time, float mic) {
  float breathingSequence = sin(time) * 0.5 + 0.5;
  float entryAnimation = fixedSpring(scaled(0.0, 3.0, duration), 0.9);
  float radius = 0.38 + mic * 0.06 + breathingSequence * 0.03;
  radius *= 1.0 - (1.0 - entryAnimation) * 0.25;
  return length(st) - radius;
}

float thinkDist(vec2 st, float duration, float time) {
  float breathingSequence = sin(time) * 0.5 + 0.5;
  float entryAnimation = fixedSpring(scaled(0.0, 1.4, duration), 0.9);
  float radius = 0.38 + breathingSequence * 0.03;
  radius *= 1.0 - (1.0 - entryAnimation) * 0.25;
  float baseCircle = length(st) - radius;
  float deploy = smoothstep(0.35, 1.1, duration);
  float d = 1000.0;
  float ringRadi = MAIN_R * 0.45 * deploy;
  ringRadi -= (sin(PI * 4.0 + time * 3.0 - silkySmooth(time / 4.0, 2.0) * PI) * 0.5 + 0.5) * MAIN_R * 0.1 * deploy;
  float nodeRadius = mix(radius, MAIN_R * 0.5, deploy);
  for (int i = 0; i < 5; i++) {
    float f = (float(i) + 0.5) / 5.0;
    float a = -f * PI * 2.0 + time / 3.0;
    vec2 pos = vec2(cos(a), sin(a)) * ringRadi;
    d = opSmoothUnion(d, length(st - pos) - nodeRadius, 0.035);
  }
  return mix(baseCircle, d, deploy);
}

float speakDist(vec2 st, float duration, float time, vec4 avg) {
  float breathing = sin(time) * 0.5 + 0.5;
  float zoom = fixedSpring(scaled(0.0, 1.15, duration), 0.9);
  float radius = 0.38 + breathing * 0.03;
  radius *= 1.0 - (1.0 - zoom) * 0.25;
  float baseCircle = length(st) - radius;
  float deploy = smoothstep(0.55, 1.25, duration);
  float d = 1000.0;
  for (int i = 0; i < 4; i++) {
    float f = (float(i) + 0.5) / 4.0;
    float w = 0.11;
    float h = w;
    float wave = sin(f * PI * 0.8 + time) * 0.5 + 0.5;
    float barIn = spring(scaled(0.05 + wave * 0.25, 0.85 + wave * 0.2, max(duration - 0.5, 0.0)), 0.98);
    vec2 pos = vec2(f - 0.5, 0.0) * MAIN_R * 1.9;
    pos *= mix(0.15, 1.0, barIn);
    float m = (i == 0 ? avg.x : (i == 1 ? avg.y : (i == 2 ? avg.z : avg.w)));
    h += m * (0.1 + (1.0 - abs(f - 0.5) * 2.0) * 0.1);
    h *= barIn;
    d = opSmoothUnion(d, sdRoundedBox(st - pos, vec2(w, max(h, 0.001)), w), 0.2 * (1.0 - clamp(duration, 0.0, 1.0)));
  }
  return mix(baseCircle, d, deploy);
}

vec3 watercolor(vec2 st) {
  float time = u_time * 0.85;
  vec4 cum = u_cumulativeAudio;
  vec4 audio = u_avgMag;
  float amp = clamp(u_watercolorStrength, 0.0, 1.0) * 2.0;
  vec2 uv = st * (1.0 / (2.0 * 0.4)) + 0.5;
  uv.y = 1.0 - uv.y;
  float noiseX = cnoise(vec3(uv + vec2(0.0, 74.8572), (time + cum.x * 0.05) * 0.3));
  float noiseY = cnoise(vec3(uv + vec2(203.91282, 10.0), (time + cum.z * 0.05) * 0.3));
  uv += vec2(noiseX * 2.0, noiseY) * 0.19 * amp;
  float noiseA = cnoise(vec3(uv * 18.0 + vec2(344.91282, 0.0), time * 0.3))
    + cnoise(vec3(uv * 39.6 + vec2(723.937, 0.0), time * 0.4)) * 0.5;
  uv += noiseA * 0.01 * amp;
  uv.y -= 0.09;
  float mixT = (sin(time + cum.w * 2.0) + 1.0) * 0.5;
  float tex0 = texDisp(uv, 0.0, mixT) * 0.08 * amp;
  vec2 textureUv1 = uv + vec2(63.861 + cum.x * 0.05, 368.937);
  float tex1 = texDisp(textureUv1, 0.0, mixT) * 0.08 * amp;
  vec2 textureUv3 = uv + vec2(453.163 - cum.z * 0.1, 1649.808 + cum.y * 0.1);
  float tex3 = texDisp(textureUv3, 0.0, mixT) * 0.08 * amp;
  uv += vec2(tex0);
  vec2 stn = uv * 1.25;
  vec2 q = vec2(
    fbm(stn * 0.5 + 0.075 * (time + cum.w * 0.175)),
    fbm(stn * 0.5 + 0.075 * (time + cum.x * 0.136))
  );
  vec2 r = vec2(
    fbm(stn + q + vec2(0.3, 9.2) + 0.15 * (time + cum.y * 0.234)),
    fbm(stn + q + vec2(8.3, 0.8) + 0.126 * (time + cum.z * 0.165))
  );
  float f = fbm(stn + r - q);
  float fullFbm = (f + 0.6 * f * f + 0.7 * f + 0.5) * 0.5;
  fullFbm = pow(fullFbm, 0.55);
  vec3 sinOffsets = vec3(cum.x * 0.15, -cum.y * 0.5, cum.z * 1.5);
  vec2 snUv = uv + vec2((fullFbm - 0.5) * 1.2 + tex0, 0.025 + tex0);
  float sn = noise2(snUv * 2.0 + vec2(sin(sinOffsets.x * 0.25), time * 0.5 + sinOffsets.x)) * 2.0;
  float sn2 = smoothstep(sn - 1.8, sn + 1.8, (snUv.y - 0.5) * (5.0 - audio.x * 0.05) + 0.5);
  vec2 snUvBis = uv + vec2((fullFbm - 0.5) * 0.85 + tex1, 0.025 + tex1);
  float snBis = noise2(snUvBis * 4.0 + vec2(sin(sinOffsets.y * 0.15) * 2.4 + 293.0, time + sinOffsets.y * 0.5)) * 2.0;
  float sn2Bis = smoothstep(snBis - (0.9 + audio.y * 0.4), snBis + (0.9 + audio.y * 0.8), (snUvBis.y - 0.6) * (5.0 - audio.y * 0.75) + 0.5);
  vec2 snUvThird = uv + vec2((fullFbm - 0.5) * 1.1 + tex3, tex3);
  float snThird = noise2(snUvThird * 6.0 + vec2(sin(sinOffsets.z * 0.1) * 2.4 + 153.0, time * 1.2 + sinOffsets.z * 0.8)) * 2.0;
  float sn2Third = smoothstep(snThird - 0.7, snThird + 0.7, (snUvThird.y - 0.9) * 6.0 + 0.5);
  sn2 = pow(sn2, 0.8);
  sn2Bis = pow(sn2Bis, 0.9);
  vec3 col = blendLinearBurn(u_bloopColorMain.xyz, u_bloopColorLow.xyz, 1.0 - sn2);
  col = blendLinearBurn(col, mix(u_bloopColorMain.xyz, u_bloopColorMid.xyz, 1.0 - sn2Bis), sn2);
  col = mix(col, mix(u_bloopColorMain.xyz, u_bloopColorHigh.xyz, 1.0 - sn2Third), sn2 * sn2Bis);
  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_viewport;
  vec2 st = uv - 0.5;
  st.y *= u_viewport.y / max(u_viewport.x, 1.0);
  float t = u_time;
  float listenA = u_stateListen;
  float thinkA = u_stateThink;
  float speakA = u_stateSpeak;
  float listenDur = max(0.0, t - u_listenTimestamp);
  float thinkDur = max(0.0, t - u_thinkTimestamp);
  float speakDur = max(0.0, t - u_speakTimestamp);

  float dist = idleDist(st, t);
  float aMul = sin(PI / 0.7 * t) * 0.3 + 0.7;

  if (listenA > 0.001) {
    dist = mix(dist, listenDist(st, listenDur, t, u_micLevel), listenA);
    aMul = mix(aMul, 1.0, listenA);
  }
  if (thinkA > 0.001) {
    dist = mix(dist, thinkDist(st, thinkDur, t), thinkA);
    aMul = mix(aMul, 1.0, thinkA);
  }
  if (speakA > 0.001) {
    dist = mix(dist, speakDist(st, speakDur, t, u_avgMag), speakA);
    aMul = mix(aMul, 1.0, speakA);
  }

  float alpha = smoothstep(0.008, 0.0, dist) * aMul;
  vec3 col = watercolor(st);

  // Soft atmospheric outer rim glow
  float outerGlow = smoothstep(0.08, 0.0, dist) * (1.0 - smoothstep(0.008, 0.0, dist)) * 0.35;
  vec3 glowCol = u_bloopColorHigh.xyz * outerGlow;

  gl_FragColor = vec4(col * alpha + glowCol, max(alpha, outerGlow));
}
`;

function hexToRgb(hex: string): [number, number, number] {
  const cleanHex = hex.replace("#", "");
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
  return [r, g, b];
}

// Official Bloop Palettes from 21st.dev / SpaceUI
const PALETTES = {
  // 1:1 Authentic 21st.dev SpaceUI Blue
  blue: {
    main: hexToRgb("#DCF7FF"),
    low: hexToRgb("#0181FE"),
    mid: hexToRgb("#A4EFFF"),
    high: hexToRgb("#FFFDEF"),
  },
  // Authentic Sahārā Emerald
  emerald: {
    main: hexToRgb("#def3e5"),
    low: hexToRgb("#53b559"),
    mid: hexToRgb("#9fddb1"),
    high: hexToRgb("#effaf3"),
  },
  // Cyan for Thinking state
  cyan: {
    main: hexToRgb("#DAF5FF"),
    low: hexToRgb("#0066CC"),
    mid: hexToRgb("#2EC6F5"),
    high: hexToRgb("#72EAF5"),
  },
  // Rose for Emergency SOS state
  emergency: {
    main: hexToRgb("#fbe8db"),
    low: hexToRgb("#ee3737"),
    mid: hexToRgb("#fa9898"),
    high: hexToRgb("#fefbee"),
  },
};

export function NebulaVoiceOrb({
  size = 220,
  active = false,
  speaking = false,
  state = "idle",
  audioLevel = 0,
  theme = "emerald",
  onClick,
  lang = "hi",
}: NebulaVoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startTime = useRef(Date.now());
  const stateTrackingRef = useRef({ current: state, enteredAt: 0 });
  const audioAvgRef = useRef([0, 0, 0, 0]);
  const cumAudioRef = useRef([0, 0, 0, 0]);
  const lastTimeRef = useRef(Date.now());
  const animFrameId = useRef<number | null>(null);

  const isSpeaking = state === "speaking" || speaking;
  const isThinking = state === "thinking";
  const isEmergency = state === "emergency";
  const isListening = state === "listening" || (active && !isSpeaking && !isThinking);

  // Pick color palette based on state priority
  const selectedPalette = isEmergency
    ? PALETTES.emergency
    : isThinking
    ? PALETTES.cyan
    : theme === "blue"
    ? PALETTES.blue
    : PALETTES.emerald;

  const paletteRef = useRef(selectedPalette);
  paletteRef.current = selectedPalette;

  const audioLevelRef = useRef(audioLevel);
  audioLevelRef.current = audioLevel;

  const stateRef = useRef({ isListening, isThinking, isSpeaking, state });
  stateRef.current = { isListening, isThinking, isSpeaking, state };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl =
      (canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true }) as WebGLRenderingContext | null) ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);

    if (!gl) {
      console.warn("[NebulaVoiceOrb] WebGL not supported, falling back");
      return;
    }

    let cancelled = false;

    // Helper: Compile shader
    function compileShader(type: number, src: string): WebGLShader | null {
      if (!gl) return null;
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("[NebulaVoiceOrb] Shader compile error:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    const vs = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("[NebulaVoiceOrb] Program link error:", gl.getProgramInfoLog(prog));
      return;
    }

    gl.useProgram(prog);

    // Full-screen quad
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const posLoc = gl.getAttribLocation(prog, "position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations
    const uTimeLoc = gl.getUniformLocation(prog, "u_time");
    const uMicLevelLoc = gl.getUniformLocation(prog, "u_micLevel");
    const uStateListenLoc = gl.getUniformLocation(prog, "u_stateListen");
    const uListenTsLoc = gl.getUniformLocation(prog, "u_listenTimestamp");
    const uStateThinkLoc = gl.getUniformLocation(prog, "u_stateThink");
    const uThinkTsLoc = gl.getUniformLocation(prog, "u_thinkTimestamp");
    const uStateSpeakLoc = gl.getUniformLocation(prog, "u_stateSpeak");
    const uSpeakTsLoc = gl.getUniformLocation(prog, "u_speakTimestamp");
    const uAvgMagLoc = gl.getUniformLocation(prog, "u_avgMag");
    const uCumAudioLoc = gl.getUniformLocation(prog, "u_cumulativeAudio");
    const uViewportLoc = gl.getUniformLocation(prog, "u_viewport");
    const uWaterColorStrLoc = gl.getUniformLocation(prog, "u_watercolorStrength");
    const uColorMainLoc = gl.getUniformLocation(prog, "u_bloopColorMain");
    const uColorLowLoc = gl.getUniformLocation(prog, "u_bloopColorLow");
    const uColorMidLoc = gl.getUniformLocation(prog, "u_bloopColorMid");
    const uColorHighLoc = gl.getUniformLocation(prog, "u_bloopColorHigh");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const render = () => {
      if (cancelled || !gl || !canvasRef.current) return;

      const now = Date.now();
      const time = (now - startTime.current) / 1000;
      const dt = Math.min(now - lastTimeRef.current, 100) / 1000;
      lastTimeRef.current = now;

      const st = stateRef.current;
      const activeState = st.isSpeaking
        ? "speaking"
        : st.isThinking
        ? "thinking"
        : st.isListening
        ? "listening"
        : "idle";

      if (stateTrackingRef.current.current !== activeState) {
        stateTrackingRef.current.current = activeState;
        stateTrackingRef.current.enteredAt = time;
      }
      const enteredAt = stateTrackingRef.current.enteredAt;

      // Audio calculation
      const mic = Math.min(Math.max(audioLevelRef.current || 0, 0), 1);
      const ambientMic = Math.sin(time * 2.0) * 0.08 + 0.08;
      const effectiveMic = mic > 0.01 ? mic : ambientMic;

      const avg = [
        effectiveMic,
        effectiveMic * 0.7,
        effectiveMic * 0.5,
        effectiveMic * 0.3,
      ];

      for (let i = 0; i < 4; i++) {
        audioAvgRef.current[i] += (avg[i] - audioAvgRef.current[i]) * 0.55;
        cumAudioRef.current[i] += audioAvgRef.current[i] * (60 * dt) * 0.25;
      }

      const p = paletteRef.current;
      const w = canvasRef.current.width;
      const h = canvasRef.current.height;

      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(prog);

      gl.uniform1f(uTimeLoc, time);
      gl.uniform1f(uMicLevelLoc, effectiveMic);
      gl.uniform1f(uStateListenLoc, st.isListening ? 1.0 : 0.0);
      gl.uniform1f(uListenTsLoc, st.isListening ? enteredAt : 0.0);
      gl.uniform1f(uStateThinkLoc, st.isThinking ? 1.0 : 0.0);
      gl.uniform1f(uThinkTsLoc, st.isThinking ? enteredAt : 0.0);
      gl.uniform1f(uStateSpeakLoc, st.isSpeaking ? 1.0 : 0.0);
      gl.uniform1f(uSpeakTsLoc, st.isSpeaking ? enteredAt : 0.0);

      gl.uniform4f(
        uAvgMagLoc,
        audioAvgRef.current[0],
        audioAvgRef.current[1],
        audioAvgRef.current[2],
        audioAvgRef.current[3]
      );
      gl.uniform4f(
        uCumAudioLoc,
        cumAudioRef.current[0],
        cumAudioRef.current[1],
        cumAudioRef.current[2],
        cumAudioRef.current[3]
      );
      gl.uniform2f(uViewportLoc, w, h);
      gl.uniform1f(uWaterColorStrLoc, 0.65);

      gl.uniform4f(uColorMainLoc, p.main[0], p.main[1], p.main[2], 1.0);
      gl.uniform4f(uColorLowLoc, p.low[0], p.low[1], p.low[2], 1.0);
      gl.uniform4f(uColorMidLoc, p.mid[0], p.mid[1], p.mid[2], 1.0);
      gl.uniform4f(uColorHighLoc, p.high[0], p.high[1], p.high[2], 1.0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      animFrameId.current = requestAnimationFrame(render);
    };

    animFrameId.current = requestAnimationFrame(render);

    return () => {
      cancelled = true;
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
      if (gl) {
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        gl.deleteBuffer(posBuf);
      }
    };
  }, []);

  // State label translation
  const getStateText = () => {
    switch (state) {
      case "connecting":
        if (lang === "ta") return "Connect aagudhu…";
        if (lang === "bn") return "Connect hochhe…";
        return lang === "hi" ? "जुड़ रहा है…" : "Connecting…";
      case "listening":
        if (lang === "ta") return "Ketkuren… (Pesunga)";
        if (lang === "bn") return "Shunchi… (Bolun)";
        return lang === "hi" ? "सुन रहा हूँ… (बोलिए)" : "Listening… (Speak now)";
      case "thinking":
        if (lang === "ta") return "Yosikkuren…";
        if (lang === "bn") return "Bhabchi…";
        return lang === "hi" ? "सोच रहा हूँ…" : "Thinking…";
      case "speaking":
        if (lang === "ta") return "Sahara pesudhu…";
        if (lang === "bn") return "Sahara bolche…";
        return lang === "hi" ? "सहारा बोल रहा है…" : "Sahara speaking…";
      case "emergency":
        if (lang === "ta") return "Emergency SOS Active";
        if (lang === "bn") return "Apatkalin SOS Active";
        return lang === "hi" ? "आपातकाल SOS सक्रिय" : "Emergency SOS Active";
      default:
        if (lang === "ta") return "Pesa tap pannunga";
        if (lang === "bn") return "Kotha bolte tap korun";
        return lang === "hi" ? "बात करने के लिए टैप करें" : "Tap to Speak";
    }
  };

  const stateColor =
    state === "connecting"
      ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
      : state === "listening"
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
      : state === "thinking"
      ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/30"
      : state === "speaking"
      ? "bg-teal-500/20 text-teal-300 border-teal-500/30"
      : state === "emergency"
      ? "bg-red-500/20 text-red-300 border-red-500/30"
      : "bg-muted text-muted-foreground border-border";

  const stateLabel = { text: getStateText(), color: stateColor };

  return (
    <div className="flex flex-col items-center justify-center select-none py-2">
      {/* 3D WebGL Volumetric Fluid Bloop Orb Container */}
      <button
        type="button"
        onClick={onClick}
        className="relative flex items-center justify-center cursor-pointer transition-transform active:scale-95 focus:outline-none group rounded-full"
        style={{ width: size, height: size }}
        aria-label={stateLabel.text}
      >
        <canvas
          ref={canvasRef}
          width={512}
          height={512}
          className="transition-all duration-300 pointer-events-none drop-shadow-[0_0_35px_rgba(45,212,191,0.25)]"
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
          }}
        />
      </button>

      {/* State Badge Chip */}
      <div className="mt-3 flex items-center justify-center">
        <span
          className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border shadow-sm backdrop-blur-sm transition-all ${stateLabel.color}`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isEmergency
                ? "bg-red-500 animate-ping"
                : isSpeaking
                ? "bg-teal-400 animate-pulse"
                : isListening
                ? "bg-emerald-400 animate-ping"
                : isThinking
                ? "bg-cyan-400 animate-spin"
                : "bg-teal-500"
            }`}
          />
          {stateLabel.text}
        </span>
      </div>
    </div>
  );
}
