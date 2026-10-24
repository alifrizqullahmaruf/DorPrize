"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { DIR_VEC, edgeFrom } from "@dorprize/game-core";
import type { Dir, Tile } from "@dorprize/game-core";
import { GUN_Y, facingToRotation, tileToWorld } from "@/features/game/three/world";

/** Thin glowing beam between two world points. */
function Beam({
  a,
  b,
  color,
  core,
  width,
  matRef,
  coreRef,
}: {
  a: THREE.Vector3;
  b: THREE.Vector3;
  color: string;
  core: string;
  width: number;
  matRef?: React.Ref<THREE.MeshBasicMaterial>;
  coreRef?: React.Ref<THREE.MeshBasicMaterial>;
}) {
  const len = a.distanceTo(b);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  return (
    <group position={mid} rotation={[0, yaw, 0]}>
      <mesh>
        <boxGeometry args={[width, width, len]} />
        <meshBasicMaterial
          ref={matRef}
          color={color}
          transparent
          opacity={0.55}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh>
        <boxGeometry args={[width * 0.35, width * 0.35, len]} />
        <meshBasicMaterial ref={coreRef} color={core} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Aim laser(s) visible only to the local player. */
export function AimLasers({ origin, dirs, n }: { origin: Tile; dirs: Dir[]; n: number }) {
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  useFrame(({ clock }) => {
    const f = 0.45 + Math.sin(clock.elapsedTime * 18) * 0.12 + Math.random() * 0.05;
    mats.current.forEach((m) => m && (m.opacity = f));
  });
  return (
    <group>
      {dirs.map((d, i) => {
        const end = edgeFrom(origin, d, n);
        const v = DIR_VEC[d];
        const a = new THREE.Vector3(...tileToWorld(origin, n, GUN_Y));
        const b = new THREE.Vector3(...tileToWorld({ x: end.x + v.x * 0.5, y: end.y + v.y * 0.5 }, n, GUN_Y));
        a.add(new THREE.Vector3(v.x, 0, v.y).normalize().multiplyScalar(0.25));
        return (
          <Beam
            key={`${d}-${i}`}
            a={a}
            b={b}
            color="#ff2a1a"
            core="#ffffff"
            width={0.06}
            matRef={(m) => {
              mats.current[i] = m;
            }}
          />
        );
      })}
    </group>
  );
}

/**
 * Bullet trail that sweeps from `from` to `to` starting at `startAt`
 * (performance.now() ms) and then fades.
 */
export function BulletTrail({
  from,
  to,
  n,
  startAt,
  holdMs = 250,
}: {
  from: Tile;
  to: Tile;
  n: number;
  startAt: number;
  /** How long the trail stays fully bright before fading. */
  holdMs?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const core = useRef<THREE.MeshBasicMaterial>(null);
  const a = useMemo(() => new THREE.Vector3(...tileToWorld(from, n, GUN_Y)), [from, n]);
  const b = useMemo(() => new THREE.Vector3(...tileToWorld(to, n, GUN_Y)), [to, n]);
  const { len, dir, start, yaw } = useMemo(() => {
    const dir = b.clone().sub(a).normalize();
    return {
      len: Math.max(0.3, a.distanceTo(b) + 0.6),
      dir,
      start: a.clone().addScaledVector(dir, -0.3),
      yaw: Math.atan2(dir.x, dir.z),
    };
  }, [a, b]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = (performance.now() - startAt) / 1000;
    if (t < 0) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const grow = Math.min(1, t / 0.18);
    const hold = Math.max(0.25, holdMs / 1000);
    const fade = t < hold ? 1 : Math.max(0, 1 - (t - hold) / 0.6);
    g.scale.set(1, 1, Math.max(0.001, grow));
    g.position.copy(start).addScaledVector(dir, (len * grow) / 2);
    if (mat.current) mat.current.opacity = 0.7 * fade;
    if (core.current) core.current.opacity = fade;
    if (fade <= 0) g.visible = false;
  });

  return (
    <group ref={group} rotation={[0, yaw, 0]} visible={false}>
      <mesh>
        <boxGeometry args={[0.09, 0.09, len]} />
        <meshBasicMaterial
          ref={mat}
          color="#ffb020"
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh>
        <boxGeometry args={[0.03, 0.03, len]} />
        <meshBasicMaterial ref={core} color="#fffbe0" transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

type BurstProps = {
  at: Tile;
  n: number;
  startAt: number;
  colors: string[];
  count?: number;
  power?: number;
  y?: number;
};

/** Base edge length of one particle cube. */
const PARTICLE = 0.08;

/** Voxel particle burst (explosions, helmet shards, dust). */
export function Burst({ at, n, startAt, colors, count = 22, power = 2.4, y = 0.3 }: BurstProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => {
    const rand = (i: number, k: number) => {
      const x = Math.sin(i * 12.9898 + k * 78.233 + at.x * 3.1 + at.y * 7.7 + startAt * 0.001) * 43758.5453;
      return x - Math.floor(x);
    };
    return Array.from({ length: count }, (_, i) => ({
      v: new THREE.Vector3((rand(i, 1) - 0.5) * 2, 0.6 + rand(i, 2) * 1.4, (rand(i, 3) - 0.5) * 2)
        .normalize()
        .multiplyScalar(power * (0.4 + rand(i, 4) * 0.8)),
      s: PARTICLE * (0.5 + rand(i, 5)),
      r: rand(i, 6) * Math.PI,
    }));
  }, [count, power, at.x, at.y, startAt]);
  const origin = useMemo(() => new THREE.Vector3(...tileToWorld(at, n, y)), [at, n, y]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorArr = useMemo(() => {
    const arr = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      c.set(colors[i % colors.length]);
      arr.set([c.r, c.g, c.b], i * 3);
    }
    return arr;
  }, [colors, count]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const t = (performance.now() - startAt) / 1000;
    if (t < 0 || t > 1.4) {
      m.visible = false;
      return;
    }
    m.visible = true;
    seeds.forEach((s, i) => {
      dummy.position.set(origin.x + s.v.x * t, origin.y + s.v.y * t - 4.5 * t * t, origin.z + s.v.z * t);
      dummy.rotation.set(s.r + t * 6, s.r, 0);
      const k = Math.max(0, 1 - t / 1.4);
      dummy.scale.setScalar(s.s * k * 12);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} visible={false}>
      <boxGeometry args={[PARTICLE, PARTICLE, PARTICLE]}>
        <instancedBufferAttribute attach="attributes-color" args={[colorArr, 3]} />
      </boxGeometry>
      <meshBasicMaterial vertexColors toneMapped={false} />
    </instancedMesh>
  );
}

/** Blue energy flash where a shield blocked a bullet. */
export function ShieldFlash({ at, dir, n, startAt }: { at: Tile; dir: Dir | null; n: number; startAt: number }) {
  const g = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const yaw = facingToRotation(dir);
  const pos = tileToWorld(at, n, 0.45);
  useFrame(() => {
    const t = (performance.now() - startAt) / 1000;
    if (!g.current || !mat.current) return;
    g.current.visible = t >= 0 && t < 0.9;
    mat.current.opacity = Math.max(0, 0.8 - t);
    g.current.scale.setScalar(1 + t * 0.6);
  });
  return (
    <group ref={g} position={pos} rotation={[0, yaw, 0]} visible={false}>
      <mesh position={[0, 0, 0.32]}>
        <boxGeometry args={[0.7, 0.8, 0.04]} />
        <meshBasicMaterial
          ref={mat}
          color="#5cc8ff"
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/** Ring marker under the local player and the planned destination. */
export function TileMarker({ at, n, color }: { at: Tile; n: number; color: string }) {
  return (
    <mesh position={tileToWorld(at, n, 0.012)} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.32, 0.42, 4, 1, Math.PI / 4]} />
      <meshBasicMaterial color={color} transparent opacity={0.8} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** Blue shield wall in front of a defending player (replaces the aim laser). */
export function ShieldGuide({ at, dir, n }: { at: Tile; dir: Dir; n: number }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const yaw = facingToRotation(dir);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = 0.35 + Math.sin(clock.elapsedTime * 4) * 0.1;
  });
  return (
    <group position={tileToWorld(at, n, 0.45)} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0, 0.42]}>
        <boxGeometry args={[0.8, 0.9, 0.04]} />
        <meshBasicMaterial
          ref={mat}
          color="#5cc8ff"
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/** Gold helmet knocked off a head: pops up, tumbles sideways and rests on the floor. */
export function HelmDrop({ at, n, startAt, dir }: { at: Tile; n: number; startAt: number; dir: Dir | null }) {
  const g = useRef<THREE.Group>(null);
  const base = useMemo(() => new THREE.Vector3(...tileToWorld(at, n, 0)), [at, n]);
  const push = dir ? DIR_VEC[dir] : { x: 1, y: 0 };
  useFrame(() => {
    const grp = g.current;
    if (!grp) return;
    const t = (performance.now() - startAt) / 1000;
    if (t < 0 || t > 3) {
      grp.visible = false;
      return;
    }
    grp.visible = true;
    const fly = Math.min(t, 0.7);
    const y = Math.max(0.06, 0.92 + 2.2 * fly - 6 * fly * fly);
    grp.position.set(base.x + push.x * 0.5 * fly, base.y + y, base.z + push.y * 0.5 * fly);
    grp.rotation.set(Math.min(t, 0.7) * 9, 0, Math.min(t, 0.7) * 5);
    const s = t > 2.4 ? Math.max(0, 1 - (t - 2.4) / 0.6) : 1;
    grp.scale.setScalar(s);
  });
  return (
    <group ref={g} visible={false}>
      <mesh castShadow>
        <boxGeometry args={[0.28, 0.11, 0.28]} />
        <meshLambertMaterial color="#f5b82e" emissive="#5a3a00" />
      </mesh>
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[0.32, 0.03, 0.32]} />
        <meshLambertMaterial color="#c9851a" />
      </mesh>
    </group>
  );
}
