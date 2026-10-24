"use client";

import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { DIRS, ringOf, sameTile, shotDirs } from "@dorprize/game-core";
import type { Dir, RevealedPlayer, RoundResolve } from "@dorprize/game-core";
import type { Corpse } from "@/features/game/state/store";
import { draftTarget, useDeathShown, useGame } from "@/features/game/state/store";
import { buildTimeline, hitAt, shotIndexHitting, type Timeline } from "@/features/game/state/timeline";
import { useAfter } from "@/shared/hooks/useAfter";
import { useView } from "@/features/game/state/view";
import { Board } from "@/features/game/three/Board";
import { CameraRig } from "@/features/game/three/CameraRig";
import { TpsCamera } from "@/features/game/three/TpsCamera";
import { Character } from "@/features/game/three/Character";
import {
  AimLasers,
  BulletTrail,
  Burst,
  HelmDrop,
  ShieldFlash,
  ShieldGuide,
  TileMarker,
} from "@/features/game/three/Effects";
import { Lava, LavaRocks, Sky } from "@/features/game/three/Lava";
import { MineModel } from "@/features/game/three/Props";
import { tileToWorld } from "@/features/game/three/world";

// Particle palettes (module constants so Burst keeps its GPU buffers between renders).
const MINE_COLORS = ["#ff3b1a", "#ffb020", "#ffe066", "#3a3a3a"];
const HELM_HIT_COLORS = ["#ffffff", "#fff3b0", "#f5b82e"];
const DEATH_COLORS = ["#8a8a8a", "#d93a2b", "#5e5c58"];

export default function GameScene() {
  return (
    <Canvas shadows dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={["#1a0703"]} />
      <World />
    </Canvas>
  );
}

function World() {
  const room = useGame((s) => s.room);
  const round = useGame((s) => s.round);
  const phase = useGame((s) => s.phase);
  const me = useGame((s) => s.me);
  const draftTo = useGame((s) => s.draftTo);
  const draftShoot = useGame((s) => s.draftShoot);
  const draftSkill = useGame((s) => s.draftSkill);
  const draftMineAt = useGame((s) => s.draftMineAt);
  const locked = useGame((s) => s.locked);
  const sunkRings = useGame((s) => s.sunkRings);
  const shrunkRing = useGame((s) => s.shrunkRing);
  const roundAt = useGame((s) => s.roundAt);
  const myMines = useGame((s) => s.myMines);
  const resolve = useGame((s) => s.resolve);
  const resolveAt = useGame((s) => s.resolveAt);
  const corpses = useGame((s) => s.corpses);
  const facing = useGame((s) => s.facing);

  const n = round?.boardSize ?? room?.boardSize ?? 6;
  const meNum = room?.meNum ?? null;
  const meSkin = room?.players.find((p) => p.num === meNum)?.skin ?? "soldier";
  const inGame = phase === "input" || phase === "animation" || phase === "result" || phase === "finished";
  const canInput = phase === "input" && !locked && me.alive;

  const target = draftTarget({ me, draftTo, round, sunkRings });
  const timeline = useMemo(() => (resolve ? buildTimeline(resolve) : null), [resolve]);

  // While choosing, the character walks freely (float position from the view store).
  const followWalk = () => tileToWorld(useView.getState().walk, n);

  const shotgun = draftSkill === "shotgun";
  const laserDirs: Dir[] = draftShoot ? shotDirs(draftShoot, shotgun) : [];

  // The arena shrinks at the start of a round: the removed ring sinks into the lava.
  const sinking = useMemo(
    () => (phase === "input" && shrunkRing !== null ? { ring: shrunkRing, startAt: roundAt } : null),
    [phase, shrunkRing, roundAt],
  );

  // Visible span for the camera (tiles still standing).
  const span = Math.max(2, n - 2 * sunkRings);

  // Kick the camera on every shot.
  const kicks = timeline ? timeline.shotAt.map((t) => resolveAt + t) : [];

  // My own helm/death timing during the resolve animation.
  const myDeath = resolve?.deaths.find((d) => d.num === meNum);
  const myDeathAt = myDeath && timeline ? resolveAt + timeline.deathAt : null;
  const myHelmBreak = resolve?.blocks.find((b) => b.num === meNum && b.by === "helm");
  const myHelmBreakAt =
    myHelmBreak && resolve && timeline
      ? resolveAt + (timeline.shotAt[Math.max(0, shotIndexHitting(resolve, meNum!))] ?? timeline.deathAt) + 150
      : null;
  const helmBroken = useAfter(myHelmBreakAt);
  const iAmGone = useAfter(myDeathAt ?? (me.alive ? Number.POSITIVE_INFINITY : 0));
  const myShot = resolve?.shots.find((s) => s.shooterNum === meNum);
  const showGold = me.helm || (phase === "input" && draftSkill === "goldHelm") || (!!myHelmBreak && !helmBroken);
  const myWeapon = phase === "animation" ? (myShot?.weapon ?? "pistol") : shotgun ? "shotgun" : "pistol";
  // Alive: always shown. Died this round: shown until the death beat. Died earlier: hidden (body is a corpse).
  const showMe = inGame && meNum !== null && (me.alive || (!!myDeath && !iAmGone));
  // Third-person while I'm playing; isometric overview in the lobby and when spectating.
  const deathShown = useDeathShown();
  const tps = inGame && phase !== "finished" && !deathShown;
  const myWorld = tileToWorld(phase === "input" ? target : me, n);

  return (
    <>
      <ambientLight intensity={0.75} />
      <hemisphereLight args={["#ffd9b0", "#ff5a1a", 0.7]} />
      <directionalLight
        position={[-6, 12, 4]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      <pointLight position={[0, -0.2, 0]} color="#ff6a1a" intensity={4} distance={14} />
      {tps ? (
        <TpsCamera target={myWorld} follow={canInput ? followWalk : undefined} kicks={kicks} />
      ) : (
        <CameraRig span={span} kicks={kicks} />
      )}
      <Sky />
      <Lava />
      <LavaRocks radius={n / 2 + 3} />

      <Board
        n={n}
        sunkRings={sunkRings}
        sinking={sinking}
        // Only the tile I'll end up on (where the shot is fired from).
        selected={phase === "input" && me.alive ? target : null}
      />

      {/* my mines (only I can see them) */}
      {inGame &&
        myMines.map((m) => (
          <group key={`${m.x},${m.y}`} position={tileToWorld(m, n, 0.001)}>
            <MineModel />
          </group>
        ))}
      {canInput && draftSkill === "mine" && draftMineAt && (
        <group position={tileToWorld(draftMineAt, n, 0.001)}>
          <MineModel />
        </group>
      )}

      {/* origin marker when moving */}
      {canInput && !sameTile(me, target) && <TileMarker at={me} n={n} color="#e8e8e8" />}

      {showMe && (
        <Character
          skin={meSkin}
          position={myWorld}
          follow={canInput ? followWalk : undefined}
          facing={draftShoot ?? facing}
          pose="aim"
          weapon={myWeapon}
          shield={draftSkill === "shield"}
          goldHelm={showGold}
          label={tps ? undefined : `#${meNum} KAMU`}
          labelTone="me"
        />
      )}

      {/* aim laser: only my own, only while choosing */}
      {phase === "input" && me.alive && draftSkill !== "shield" && laserDirs.length > 0 && (
        <AimLasers origin={target} dirs={laserDirs} n={n} />
      )}
      {/* shield: no shot this round, a shield wall faces the camera instead */}
      {phase === "input" && me.alive && draftSkill === "shield" && (
        <ShieldGuide at={target} dir={draftShoot ?? facing} n={n} />
      )}

      {/* resolve playback */}
      {resolve && timeline && (
        <group>
          {resolve.mineBlasts.map((b, i) => (
            <Burst
              key={`mine-${i}`}
              at={b.at}
              n={n}
              startAt={resolveAt + timeline.mineAt[i]}
              colors={MINE_COLORS}
              count={34}
              power={3.2}
            />
          ))}
          {resolve.shots.flatMap((s, i) =>
            s.paths.map((p, j) => (
              <BulletTrail
                key={`shot-${i}-${j}`}
                from={p.from}
                to={p.to}
                n={n}
                startAt={resolveAt + timeline.shotAt[i]}
                holdMs={timeline.slot * 0.8}
              />
            )),
          )}
          {resolve.blocks.map((b, i) => {
            const idx = shotIndexHitting(resolve, b.num);
            const at = resolveAt + hitAt(timeline, resolve, b.num);
            return b.by === "shield" ? (
              <ShieldFlash key={`blk-${i}`} at={b.at} dir={b.dir} n={n} startAt={at} />
            ) : (
              <group key={`blk-${i}`}>
                {/* the bullet connects (white hit flash), then the helmet is knocked off */}
                <Burst at={b.at} n={n} startAt={at} colors={HELM_HIT_COLORS} y={0.95} count={14} power={1.4} />
                <HelmDrop
                  at={b.at}
                  n={n}
                  startAt={at}
                  dir={idx >= 0 ? (resolve.shots[idx].paths.find((p) => p.hitNums.includes(b.num))?.dir ?? null) : null}
                />
              </group>
            );
          })}
          {resolve.deaths.map((d, i) => (
            <Burst
              key={`death-${i}`}
              at={d.at}
              n={n}
              startAt={resolveAt + timeline.deathAt}
              colors={DEATH_COLORS}
              count={16}
              power={1.6}
            />
          ))}
        </group>
      )}

      {/* the shootout reveals everyone (hidden again at the next round:start) */}
      {resolve &&
        timeline &&
        resolve.revealed.map((r) => (
          <RevealedView
            key={`rev-${resolve.round}-${r.num}`}
            player={r}
            isMe={r.num === meNum}
            skin={room?.players.find((p) => p.num === r.num)?.skin ?? "soldier"}
            n={n}
            resolve={resolve}
            resolveAt={resolveAt}
            timeline={timeline}
          />
        ))}

      {/* bodies */}
      {corpses.map((c) => (
        <CorpseView
          key={`${c.num}-${c.round}`}
          corpse={c}
          n={n}
          sunkRings={sunkRings}
          deadAt={resolve && timeline && c.round === resolve.round ? resolveAt + timeline.deathAt : 0}
        />
      ))}
    </>
  );
}

function CorpseView({
  corpse,
  n,
  sunkRings,
  deadAt,
}: {
  corpse: Corpse;
  n: number;
  sunkRings: number;
  deadAt: number;
}) {
  const shown = useAfter(deadAt);
  if (!shown) return null;
  // Bodies on tiles that sank into the lava are gone.
  if (ringOf(corpse.at, n) < sunkRings) return null;
  const facingSeed = DIRS[(corpse.num * 3) % 8];
  return (
    <Character
      skin={corpse.skin}
      position={tileToWorld(corpse.at, n)}
      facing={facingSeed}
      pose="dead"
      weapon={null}
      label={`#${corpse.num}`}
      labelTone="dead"
      smooth={false}
      deadAt={deadAt}
    />
  );
}

type RevealProps = {
  player: RevealedPlayer;
  isMe: boolean;
  skin: string;
  n: number;
  resolve: RoundResolve;
  resolveAt: number;
  timeline: Timeline;
};

/** An opponent revealed for the shootout: stands, aims, fires on their turn. */
function RevealedView({ player, isMe, skin, n, resolve, resolveAt, timeline }: RevealProps) {
  const death = resolve.deaths.find((d) => d.num === player.num);
  const goneAt = death ? resolveAt + timeline.deathAt : Number.POSITIVE_INFINITY;
  const shotIdx = resolve.shots.findIndex((sh) => sh.shooterNum === player.num);
  const laserEnd = shotIdx >= 0 ? resolveAt + timeline.shotAt[shotIdx] : resolveAt;
  const helmBreak = resolve.blocks.find((b) => b.num === player.num && b.by === "helm");
  const helmBreakAt = helmBreak ? resolveAt + hitAt(timeline, resolve, player.num) : null;
  const gone = useAfter(goneAt);
  const fired = useAfter(laserEnd);
  const helmBroken = useAfter(helmBreakAt);
  const dirs: Dir[] = player.facing ? shotDirs(player.facing, player.weapon === "shotgun") : [];
  return (
    <>
      {!fired && !player.shield && dirs.length > 0 && <AimLasers origin={player.at} dirs={dirs} n={n} />}
      {player.shield && player.facing && !gone && <ShieldGuide at={player.at} dir={player.facing} n={n} />}
      {!isMe && !gone && (
        <Character
          skin={skin}
          position={tileToWorld(player.at, n)}
          facing={player.facing ?? "S"}
          pose="aim"
          weapon={player.weapon}
          shield={player.shield}
          goldHelm={player.helm && (!helmBreak || !helmBroken)}
          label={`#${player.num}`}
          labelTone="enemy"
          smooth={false}
        />
      )}
    </>
  );
}
