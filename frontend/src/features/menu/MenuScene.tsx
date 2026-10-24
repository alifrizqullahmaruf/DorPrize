"use client";

import { Canvas } from "@react-three/fiber";
import { useProfile } from "@/features/wallet/profile";
import { Board } from "@/features/game/three/Board";
import { CameraRig } from "@/features/game/three/CameraRig";
import { Character } from "@/features/game/three/Character";
import { Lava, LavaRocks } from "@/features/game/three/Lava";

export default function MenuScene() {
  const skin = useProfile((s) => s.skin);
  return (
    <Canvas shadows dpr={[1, 2]}>
      <color attach="background" args={["#1a0703"]} />
      <ambientLight intensity={0.8} />
      <hemisphereLight args={["#ffd9b0", "#ff5a1a", 0.8]} />
      <directionalLight position={[-6, 12, 4]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[0, 0, 0]} color="#ff6a1a" intensity={5} distance={10} />
      <CameraRig span={2.1} padding={0.6} focus={[0, 1.15, 0]} />
      <Lava />
      <LavaRocks radius={3.2} count={40} seed={11} />
      <Board n={3} sunkRings={0} />
      <Character skin={skin} position={[0, 0, 0]} facing="S" pose="menu" weapon="pistol" />
    </Canvas>
  );
}
