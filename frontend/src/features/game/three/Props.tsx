"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

/** Size of one character pixel in world units. */
export const PX = 0.028;

type BoxProps = {
  size: [number, number, number];
  pos: [number, number, number];
  color: string;
  emissive?: string;
};

// Prop parts repeat on every character, so geometries and materials are shared.
const boxGeos = new Map<string, THREE.BoxGeometry>();
const boxMats = new Map<string, THREE.MeshLambertMaterial>();

function boxGeo([x, y, z]: [number, number, number]) {
  const key = `${x},${y},${z}`;
  let g = boxGeos.get(key);
  if (!g) boxGeos.set(key, (g = new THREE.BoxGeometry(x * PX, y * PX, z * PX)));
  return g;
}

function boxMat(color: string, emissive = "#000") {
  const key = `${color}|${emissive}`;
  let m = boxMats.get(key);
  if (!m) boxMats.set(key, (m = new THREE.MeshLambertMaterial({ color, emissive })));
  return m;
}

/** A box measured in character pixels. */
export function VBox({ size, pos, color, emissive }: BoxProps) {
  return (
    <mesh
      position={[pos[0] * PX, pos[1] * PX, pos[2] * PX]}
      geometry={boxGeo(size)}
      material={boxMat(color, emissive)}
      castShadow
    />
  );
}

/** Pistol held in a hand; barrel points along local -Y (the arm direction). */
export function Pistol() {
  return (
    <group>
      <VBox size={[2, 6, 2]} pos={[0, -2, 0.5]} color="#2d2f33" />
      <VBox size={[2, 2, 3]} pos={[0, 0.5, -1]} color="#5a3a24" />
      <VBox size={[1, 1, 1]} pos={[0, -4.6, 1.6]} color="#111" />
    </group>
  );
}

export function ShotgunModel() {
  return (
    <group>
      <VBox size={[2, 14, 2]} pos={[0, -5, 0.6]} color="#2b2b2b" />
      <VBox size={[2, 6, 2.4]} pos={[0, -2, 0.6]} color="#6b4428" />
      <VBox size={[2, 4, 3]} pos={[0, 3, -0.4]} color="#6b4428" />
      <VBox size={[1, 1, 1]} pos={[0, -12, 1.4]} color="#111" />
    </group>
  );
}

/** Wooden shield worn on the left forearm. */
export function ShieldModel() {
  return (
    <group position={[-2.6 * PX, -6 * PX, 0]}>
      <VBox size={[1, 12, 9]} pos={[0, 0, 0]} color="#7a4f2a" />
      <VBox size={[1.2, 12.6, 1]} pos={[0, 0, 4.5]} color="#8a8a8a" />
      <VBox size={[1.2, 12.6, 1]} pos={[0, 0, -4.5]} color="#8a8a8a" />
      <VBox size={[1.2, 1, 9]} pos={[0, 6, 0]} color="#8a8a8a" />
      <VBox size={[1.2, 1, 9]} pos={[0, -6, 0]} color="#8a8a8a" />
    </group>
  );
}

const BUTTON_ON = new THREE.Color("#ff2020");
const BUTTON_OFF = new THREE.Color("#300");

/** Green landmine with a blinking red button. */
export function MineModel() {
  const btn = useRef<THREE.MeshLambertMaterial>(null);
  useFrame(({ clock }) => {
    if (!btn.current) return;
    const on = Math.floor(clock.elapsedTime * 3) % 2 === 0;
    btn.current.emissive.copy(on ? BUTTON_ON : BUTTON_OFF);
  });
  return (
    <group>
      <mesh position={[0, 0.04, 0]} castShadow>
        <boxGeometry args={[0.34, 0.08, 0.34]} />
        <meshLambertMaterial color="#4f5d2a" />
      </mesh>
      <mesh position={[0, 0.1, 0]}>
        <boxGeometry args={[0.24, 0.05, 0.24]} />
        <meshLambertMaterial color="#5f6e33" />
      </mesh>
      <mesh position={[0, 0.14, 0]}>
        <boxGeometry args={[0.09, 0.05, 0.09]} />
        <meshLambertMaterial ref={btn} color="#c01818" />
      </mesh>
    </group>
  );
}
