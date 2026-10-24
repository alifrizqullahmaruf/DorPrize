"use client";

import { OrthographicCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import type * as THREE from "three";

type Props = {
  /** Width of the playable area in tiles (shrinks with the lava). */
  span: number;
  /** performance.now() timestamps of shots; the camera kicks on each. */
  kicks?: number[];
  /** Extra zoom-out factor (menu scene uses a wider shot). */
  padding?: number;
  /** World point kept at the screen centre. */
  focus?: [number, number, number];
};

const DIST = 20;
/** Camera height relative to DIST (isometric tilt). */
const HEIGHT = 0.9;

/** Isometric orthographic camera that keeps the board framed. */
export function CameraRig({ span, kicks = [], padding = 1.1, focus = [0, 0, 0] }: Props) {
  const cam = useRef<THREE.OrthographicCamera>(null);
  const size = useThree((s) => s.size);
  const zoom = useRef(0);

  useFrame((_, delta) => {
    const c = cam.current;
    if (!c) return;
    // Fit diagonal of the board (isometric view shows ~1.42× span horizontally).
    const fitW = size.width / (span * 1.42 + padding);
    const fitH = size.height / (span * 1.05 + padding);
    const want = Math.max(20, Math.min(fitW, fitH));
    zoom.current = zoom.current === 0 ? want : zoom.current + (want - zoom.current) * Math.min(1, delta * 2.5);
    c.zoom = zoom.current;

    const now = performance.now();
    let shake = 0;
    for (const k of kicks) {
      const t = (now - k) / 1000;
      if (t >= 0 && t < 0.25) shake = Math.max(shake, (0.25 - t) * 0.5);
    }
    const [fx, fy, fz] = focus;
    c.position.set(
      fx + DIST + (Math.random() - 0.5) * shake,
      fy + DIST * HEIGHT + (Math.random() - 0.5) * shake,
      fz + DIST + (Math.random() - 0.5) * shake,
    );
    c.lookAt(fx, fy, fz);
    c.updateProjectionMatrix();
  });

  return <OrthographicCamera ref={cam} makeDefault near={0.1} far={200} position={[DIST, DIST * HEIGHT, DIST]} />;
}
