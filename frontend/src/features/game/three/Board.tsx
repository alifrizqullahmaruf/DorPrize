"use client";

import { useFrame } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { allTiles, ringOf } from "@dorprize/game-core";
import type { Tile as TileT } from "@dorprize/game-core";
import { stoneSideTexture, stoneTexture } from "@/features/game/three/textures";
import { tileToWorld } from "@/features/game/three/world";

type BoardProps = {
  n: number;
  sunkRings: number;
  /** Ring currently sinking (at the start of the round) and when it started. */
  sinking?: { ring: number; startAt: number } | null;
  /** Tile marked as the player's walk target. */
  selected?: TileT | null;
};

const TILE_H = 0.5;

// Shared by every tile (up to 144) instead of one GPU geometry each.
const TILE_GEO = new THREE.BoxGeometry(0.97, TILE_H, 0.97);
const GLOW_GEO = new THREE.PlaneGeometry(0.97, 0.97);
const SELECTED_GEO = new THREE.PlaneGeometry(0.9, 0.9);

export function Board({ n, sunkRings, sinking, selected }: BoardProps) {
  const tiles = useMemo(() => allTiles(n), [n]);

  const materials = useMemo(() => {
    const side = new THREE.MeshLambertMaterial({ map: stoneSideTexture() });
    const top = new THREE.MeshLambertMaterial({ map: stoneTexture() });
    return [side, side, top, side, side, side];
  }, []);

  return (
    <group>
      {tiles.map((t) => {
        const ring = ringOf(t, n);
        // Sunk rings are gone, except the one still playing its sinking animation.
        if (ring < sunkRings && sinking?.ring !== ring) return null;
        return (
          <BoardTile
            key={`${t.x},${t.y}`}
            tile={t}
            n={n}
            materials={materials}
            sinkStart={sinking && sinking.ring === ring ? sinking.startAt : null}
            selected={!!selected && selected.x === t.x && selected.y === t.y}
          />
        );
      })}
    </group>
  );
}

type TileProps = {
  tile: TileT;
  n: number;
  materials: THREE.Material[];
  sinkStart: number | null;
  selected: boolean;
};

const BoardTile = memo(function BoardTile({ tile, n, materials, sinkStart, selected }: TileProps) {
  const group = useRef<THREE.Group>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);
  const pos = tileToWorld(tile, n);

  // Back to the resting pose once the tile stops sinking.
  useEffect(() => {
    if (sinkStart !== null || !group.current) return;
    group.current.position.y = 0;
    group.current.rotation.z = 0;
  }, [sinkStart]);

  useFrame(() => {
    // Only sinking tiles animate; the rest stay at their resting pose.
    if (sinkStart === null || !group.current) return;
    // Short rumble, then the tile drops into the lava.
    const k = Math.max(0, (performance.now() - sinkStart) / 1000);
    const fall = Math.max(0, k - 0.35);
    group.current.position.y =
      k < 0.35 ? Math.sin(k * 60 + tile.x * 3 + tile.y) * 0.02 : -Math.min(1.6, fall * fall * 2.2);
    group.current.rotation.z = Math.sin(k * 20 + tile.x) * 0.03 * Math.min(1, k * 3);
    if (glowMat.current) glowMat.current.opacity = Math.min(0.6, k * 1.5);
  });

  return (
    <group ref={group} position={pos}>
      <mesh position={[0, -TILE_H / 2, 0]} geometry={TILE_GEO} material={materials} receiveShadow castShadow />
      {sinkStart !== null && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} geometry={GLOW_GEO}>
          <meshBasicMaterial
            ref={glowMat}
            color="#ff4a10"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} geometry={SELECTED_GEO}>
          <meshBasicMaterial color="#ffffff" transparent opacity={0.55} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
});
