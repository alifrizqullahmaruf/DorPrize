"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { basaltTexture } from "@/features/game/three/textures";

const vertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vPos;
  void main() {
    vUv = uv;
    vPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vPos;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  void main() {
    // pixelate a little for the voxel look
    vec2 p = floor(vPos.xz * 8.0) / 8.0;
    float t = uTime * 0.12;
    float n = fbm(p * 0.45 + vec2(t, -t * 0.7));
    float n2 = fbm(p * 0.9 - vec2(t * 0.6, t));
    float v = smoothstep(0.25, 0.85, n * 0.7 + n2 * 0.5);
    vec3 deep = vec3(0.22, 0.02, 0.005);
    vec3 mid = vec3(0.85, 0.2, 0.02);
    vec3 hot = vec3(1.0, 0.82, 0.25);
    vec3 col = mix(deep, mid, v);
    col = mix(col, hot, smoothstep(0.72, 0.95, v));
    gl_FragColor = vec4(col * 0.78, 1.0);
    #include <colorspace_fragment>
  }
`;

export const LAVA_Y = -0.38;

const LAVA_SIZE = 190;

export function Lava() {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, LAVA_Y, 0]}>
      <planeGeometry args={[LAVA_SIZE, LAVA_SIZE, 1, 1]} />
      <shaderMaterial ref={mat} vertexShader={vertex} fragmentShader={fragment} uniforms={uniforms} />
    </mesh>
  );
}

/** Scattered basalt blocks poking out of the lava for depth. */
export function LavaRocks({ radius = 6, count = 26, seed = 3 }: { radius?: number; count?: number; seed?: number }) {
  const rocks = useMemo(() => {
    const r = (i: number, k: number) => {
      const x = Math.sin(i * 12.9898 + k * 78.233 + seed * 37.719) * 43758.5453;
      return x - Math.floor(x);
    };
    return Array.from({ length: count }, (_, i) => {
      const ang = r(i, 1) * Math.PI * 2;
      const dist = radius + r(i, 2) * 10;
      const size = 0.6 + r(i, 3) * 1.2;
      return {
        pos: [Math.cos(ang) * dist, LAVA_Y + size * (0.15 + r(i, 4) * 0.3), Math.sin(ang) * dist] as [
          number,
          number,
          number,
        ],
        size,
        rot: r(i, 5) * Math.PI,
      };
    });
  }, [radius, count, seed]);
  // One unit cube and one material for every rock; each rock only scales it.
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const mat = useMemo(() => new THREE.MeshLambertMaterial({ map: basaltTexture() }), []);
  return (
    <group>
      {rocks.map((rock, i) => (
        <mesh
          key={i}
          position={rock.pos}
          rotation={[0, rock.rot, 0]}
          scale={rock.size}
          geometry={geo}
          material={mat}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  varying vec3 vDir;
  void main() {
    float h = clamp(vDir.y, 0.0, 1.0);
    vec3 horizon = vec3(0.85, 0.32, 0.08);
    vec3 mid = vec3(0.32, 0.08, 0.04);
    vec3 top = vec3(0.07, 0.02, 0.03);
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
    col = mix(col, top, smoothstep(0.18, 0.7, h));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Smoky sunset dome: glowing horizon fading to a dark sky. */
export function Sky() {
  return (
    <mesh>
      <sphereGeometry args={[100, 32, 16]} />
      <shaderMaterial vertexShader={skyVertex} fragmentShader={skyFragment} side={THREE.BackSide} depthWrite={false} />
    </mesh>
  );
}
