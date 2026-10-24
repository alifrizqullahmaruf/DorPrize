"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Dir } from "@dorprize/game-core";
import { PX, Pistol, ShieldModel, ShotgunModel } from "@/features/game/three/Props";
import { DIMS, characterMaterials } from "@/features/game/three/textures";
import { facingToRotation } from "@/features/game/three/world";

export type Pose = "idle" | "aim" | "dead" | "menu";

type Props = {
  skin: string;
  position: [number, number, number];
  facing: Dir | null;
  pose?: Pose;
  weapon?: "pistol" | "shotgun" | null;
  shield?: boolean;
  goldHelm?: boolean;
  label?: string;
  labelTone?: "me" | "enemy" | "dead";
  /** Smoothly walk to new positions instead of teleporting. */
  smooth?: boolean;
  /** Live position source (free walking); read every frame instead of `position`. */
  follow?: () => [number, number, number];
  /** performance.now() ms when death happens; drives the fall animation. */
  deadAt?: number;
};

const geo = {
  head: new THREE.BoxGeometry(...(DIMS.head.map((v) => v * PX) as [number, number, number])),
  body: new THREE.BoxGeometry(...(DIMS.body.map((v) => v * PX) as [number, number, number])),
  limb: new THREE.BoxGeometry(...(DIMS.limb.map((v) => v * PX) as [number, number, number])),
  helmet: new THREE.BoxGeometry(...(DIMS.helmet.map((v) => v * PX) as [number, number, number])),
};

export function Character({
  skin,
  position,
  facing,
  pose = "idle",
  weapon = "pistol",
  shield = false,
  goldHelm = false,
  label,
  labelTone = "enemy",
  smooth = true,
  follow,
  deadAt,
}: Props) {
  const mats = useMemo(() => characterMaterials(skin), [skin]);
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const target = useRef(new THREE.Vector3(...position));
  const hop = useRef(0);
  const [px0, py0, pz0] = position;
  useEffect(() => {
    target.current.set(px0, py0, pz0);
  }, [px0, py0, pz0]);

  useFrame(({ clock }, delta) => {
    const g = root.current;
    if (!g) return;
    const t = clock.elapsedTime;
    const deadSince = deadAt !== undefined ? (performance.now() - deadAt) / 1000 : undefined;
    if (deadSince !== undefined) g.visible = deadSince >= 0;
    // free walking: follow the live position, swing legs while moving
    let walkingNow = false;
    if (follow) {
      const [fx, fy, fz] = follow();
      const speed = Math.hypot(fx - g.position.x, fz - g.position.z) / Math.max(delta, 1e-3);
      walkingNow = speed > 0.3;
      g.position.set(fx, fy, fz);
      hop.current = 0;
    } else if (!smooth || g.position.distanceTo(target.current) > 4) {
      g.position.copy(target.current);
    } else if (g.position.distanceTo(target.current) > 0.001) {
      const dist = g.position.distanceTo(target.current);
      g.position.lerp(target.current, Math.min(1, delta * 6));
      hop.current = Math.min(1, dist);
    } else {
      hop.current = 0;
    }
    const baseY = follow ? g.position.y : target.current.y;
    g.position.y = baseY + Math.sin(Math.min(1, hop.current) * Math.PI) * 0.18;

    const yaw = pose === "menu" ? t * 0.6 : facingToRotation(facing);
    const cur = g.rotation.y;
    let d = yaw - cur;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    g.rotation.y = pose === "menu" ? yaw : cur + d * Math.min(1, delta * 10);

    if (body.current) {
      if (pose === "dead") {
        const k = Math.min(1, Math.max(0, deadSince ?? 1) * 2.5);
        body.current.rotation.x = -k * (Math.PI / 2);
        body.current.position.y = k * 2 * PX;
      } else {
        body.current.rotation.x = 0;
        body.current.position.y = Math.sin(t * 2) * 0.004;
      }
    }

    const swing = hop.current > 0.02 || walkingNow ? Math.sin(t * 14) * 0.6 : 0;
    if (legR.current) legR.current.rotation.x = swing;
    if (legL.current) legL.current.rotation.x = -swing;
    if (armR.current) {
      const aimed = pose === "aim" || pose === "menu";
      armR.current.rotation.x = aimed ? -Math.PI / 2 : -swing * 0.8 + Math.sin(t * 2) * 0.03;
    }
    if (armL.current) {
      const twoHand = (pose === "aim" || pose === "menu") && weapon === "shotgun";
      armL.current.rotation.x = twoHand ? -Math.PI / 2.3 : shield ? -0.5 : swing * 0.8;
      armL.current.rotation.z = twoHand ? -0.5 : 0;
    }
  });

  const tagColor =
    labelTone === "me"
      ? "bg-[#f5b82e] text-[#111]"
      : labelTone === "dead"
        ? "bg-[#d93a2b] text-white"
        : "bg-black/70 text-white";

  return (
    <group ref={root} position={position}>
      <group ref={body}>
        {/* legs: pivot at hip (y = 12px) */}
        <group ref={legR} position={[-2 * PX, 12 * PX, 0]}>
          <mesh geometry={geo.limb} material={mats.legR} position={[0, -6 * PX, 0]} castShadow />
        </group>
        <group ref={legL} position={[2 * PX, 12 * PX, 0]}>
          <mesh geometry={geo.limb} material={mats.legL} position={[0, -6 * PX, 0]} castShadow />
        </group>
        <mesh geometry={geo.body} material={mats.body} position={[0, 18 * PX, 0]} castShadow />
        {/* arms: pivot at shoulder (y = 23px) */}
        <group ref={armR} position={[-6 * PX, 23 * PX, 0]}>
          <mesh geometry={geo.limb} material={mats.armR} position={[0, -5 * PX, 0]} castShadow />
          {weapon && (
            <group position={[0, -10 * PX, 1 * PX]}>{weapon === "shotgun" ? <ShotgunModel /> : <Pistol />}</group>
          )}
        </group>
        <group ref={armL} position={[6 * PX, 23 * PX, 0]}>
          <mesh geometry={geo.limb} material={mats.armL} position={[0, -5 * PX, 0]} castShadow />
          {shield && (
            <group position={[0.6 * PX, 0, 0]} rotation={[0, 0, 0]}>
              <ShieldModel />
            </group>
          )}
        </group>
        <mesh geometry={geo.head} material={mats.head} position={[0, 28 * PX, 0]} castShadow />
        <mesh
          geometry={geo.helmet}
          material={goldHelm ? mats.goldHelmet : mats.helmet}
          position={[0, 32 * PX, 0]}
          castShadow
        />
      </group>
      {label && (
        <Html position={[0, 44 * PX, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className={`rounded px-1.5 py-0.5 font-pixel text-[11px] leading-none whitespace-nowrap ${tagColor}`}>
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}
