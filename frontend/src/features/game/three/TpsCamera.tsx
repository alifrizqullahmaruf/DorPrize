"use client";

import { PerspectiveCamera } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { forwardOf, useView } from "@/features/game/state/view";

type Props = {
  /** World position of the followed character's feet. */
  target: [number, number, number];
  /** Live position source (free walking); overrides `target` when set. */
  follow?: () => [number, number, number];
  /** performance.now() timestamps of shots; the camera kicks on each. */
  kicks?: number[];
};

const DIST = 4.6;
const SHOULDER = 0.55;
const HEAD = 1.15;

/** Over-the-shoulder camera that orbits with the mouse (Roblox shift-lock feel). */
export function TpsCamera({ target, follow, kicks = [] }: Props) {
  const cam = useRef<THREE.PerspectiveCamera>(null);
  const focus = useRef(new THREE.Vector3(...target));
  const want = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const c = cam.current;
    if (!c) return;
    const { yaw, pitch } = useView.getState();
    want.current.set(...(follow ? follow() : target));
    focus.current.lerp(want.current, Math.min(1, delta * (follow ? 14 : 8)));

    const f = forwardOf(yaw);
    const r = forwardOf(yaw - Math.PI / 2);
    const fx = f.x;
    const fz = f.y;
    const horiz = Math.cos(pitch) * DIST;
    const px = focus.current.x + r.x * SHOULDER;
    const py = focus.current.y + HEAD;
    const pz = focus.current.z + r.y * SHOULDER;

    let shake = 0;
    const now = performance.now();
    for (const k of kicks) {
      const t = (now - k) / 1000;
      if (t >= 0 && t < 0.25) shake = Math.max(shake, (0.25 - t) * 0.25);
    }

    c.position.set(
      px - fx * horiz + (Math.random() - 0.5) * shake,
      py + Math.sin(pitch) * DIST + (Math.random() - 0.5) * shake,
      pz - fz * horiz,
    );
    look.current.set(px + fx * 4, py - Math.sin(pitch) * 1.5, pz + fz * 4);
    c.lookAt(look.current);
  });

  return <PerspectiveCamera ref={cam} makeDefault fov={68} near={0.05} far={120} />;
}
