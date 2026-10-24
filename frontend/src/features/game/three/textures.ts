import * as THREE from "three";
import { GOLD_HELMET, HELMET_COLORS, getSkin, type SkinDef } from "@dorprize/game-core";

/** Deterministic PRNG so textures look identical on every render. */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function canvasTexture(w: number, h: number, paint: Painter) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  paint(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return tex;
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function camo(ctx: CanvasRenderingContext2D, w: number, h: number, pal: [string, string, string], seed: number) {
  const r = mulberry(seed);
  px(ctx, 0, 0, pal[0], w, h);
  const blotches = Math.ceil((w * h) / 10);
  for (let i = 0; i < blotches; i++) {
    const c = r() < 0.5 ? pal[1] : pal[2];
    const x = Math.floor(r() * w);
    const y = Math.floor(r() * h);
    px(ctx, x, y, c, r() < 0.5 ? 2 : 1, r() < 0.5 ? 2 : 1);
  }
}

function shade(hex: string, f: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}

/* ---------- character parts ---------- */

type Face = "right" | "left" | "top" | "bottom" | "front" | "back";
const FACES: Face[] = ["right", "left", "top", "bottom", "front", "back"];

/** Face sizes in pixels for a box of w×h×d (BoxGeometry face order). */
function faceSize(face: Face, w: number, h: number, d: number): [number, number] {
  if (face === "right" || face === "left") return [d, h];
  if (face === "top" || face === "bottom") return [w, d];
  return [w, h];
}

function partMaterials(
  dims: [number, number, number],
  paint: (face: Face, ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  opts: THREE.MeshLambertMaterialParameters = {},
) {
  const [w, h, d] = dims;
  return FACES.map((face) => {
    const [fw, fh] = faceSize(face, w, h, d);
    return new THREE.MeshLambertMaterial({
      map: canvasTexture(fw, fh, (ctx) => paint(face, ctx, fw, fh)),
      ...opts,
    });
  });
}

function paintHead(s: SkinDef, face: Face, ctx: CanvasRenderingContext2D, w: number, h: number) {
  px(ctx, 0, 0, s.skin, w, h);
  const dark = shade(s.skin, 0.82);
  if (face === "top") {
    px(ctx, 0, 0, s.hair, w, h);
    return;
  }
  if (face === "bottom") {
    px(ctx, 0, 0, dark, w, h);
    return;
  }
  // hair line under the helmet
  px(ctx, 0, 0, s.hair, w, 2);
  if (face === "back") {
    px(ctx, 0, 0, s.hair, w, 5);
    return;
  }
  if (face === "left" || face === "right") {
    px(ctx, 0, 0, s.hair, w, 3);
    px(ctx, face === "right" ? 0 : w - 2, 3, s.hair, 2, 1);
    px(ctx, Math.floor(w / 2), 4, dark, 1, 2); // ear
    px(ctx, 0, 4, "#2a2a2a", 1, 4); // chin strap
    px(ctx, w - 1, 4, "#2a2a2a", 1, 4);
    return;
  }
  // front face: original soldier face
  px(ctx, 1, 3, s.hair, 2, 1); // brows
  px(ctx, 5, 3, s.hair, 2, 1);
  px(ctx, 1, 4, "#f4f1ea"); // eyes
  px(ctx, 2, 4, "#241a12");
  px(ctx, 5, 4, "#241a12");
  px(ctx, 6, 4, "#f4f1ea");
  px(ctx, 3, 5, dark, 2, 1); // nose
  px(ctx, 3, 6, "#6b3b2a", 2, 1); // mouth
  px(ctx, 0, 4, "#2a2a2a", 1, 4); // chin strap
  px(ctx, 7, 4, "#2a2a2a", 1, 4);
  switch (s.extra) {
    case "beard":
      px(ctx, 1, 6, s.hair, 2, 2);
      px(ctx, 5, 6, s.hair, 2, 2);
      px(ctx, 3, 7, s.hair, 2, 1);
      break;
    case "scarf":
      px(ctx, 0, 7, "#b8322a", 8, 1);
      break;
    case "mask":
      px(ctx, 1, 5, "#3a3d42", 6, 3);
      px(ctx, 2, 6, "#2a2c30", 4, 1);
      break;
    case "visor":
      px(ctx, 1, 3, "#111", 6, 2);
      px(ctx, 2, 3, "#3fd0ff", 1, 1);
      px(ctx, 5, 3, "#3fd0ff", 1, 1);
      break;
    case "goggles":
      px(ctx, 1, 3, "#3a2c20", 6, 2);
      px(ctx, 1, 3, "#8fd3e8", 2, 2);
      px(ctx, 5, 3, "#8fd3e8", 2, 2);
      break;
  }
}

function paintBody(s: SkinDef, face: Face, ctx: CanvasRenderingContext2D, w: number, h: number) {
  camo(ctx, w, h, s.jacket, 11 + FACES.indexOf(face));
  if (face === "top" || face === "bottom") return;
  // belt
  px(ctx, 0, h - 4, s.belt, w, 1);
  if (face === "front") {
    px(ctx, 3, h - 4, "#d6b04a", 2, 1); // buckle
    px(ctx, 1, 3, shade(s.jacket[0], 0.75), 2, 2); // pockets
    px(ctx, 5, 3, shade(s.jacket[0], 0.75), 2, 2);
    px(ctx, 3, 0, s.skin, 2, 1); // neck
    px(ctx, 0, 1, s.belt, 1, h - 5); // straps
    px(ctx, 7, 1, s.belt, 1, h - 5);
    if (s.extra === "scarf") px(ctx, 1, 0, "#b8322a", 6, 2);
  }
  if (face === "back") {
    px(ctx, 1, 2, shade(s.jacket[0], 0.7), 6, 5); // backpack
  }
}

function paintArm(s: SkinDef, face: Face, ctx: CanvasRenderingContext2D, w: number, h: number, left: boolean) {
  camo(ctx, w, h, s.jacket, left ? 31 : 41 + FACES.indexOf(face));
  if (face === "top") return;
  if (face === "bottom") {
    px(ctx, 0, 0, s.skin, w, h);
    return;
  }
  px(ctx, 0, h - 4, s.skin, w, 4); // hand
  px(ctx, 0, h - 5, shade(s.jacket[0], 0.7), w, 1); // cuff
  if (s.extra === "medic" && (face === "right" || face === "left") && !left) {
    px(ctx, 0, 2, "#f2f2f2", w, 4);
    px(ctx, 1, 3, "#c62828", 2, 2);
  }
}

function paintLeg(s: SkinDef, face: Face, ctx: CanvasRenderingContext2D, w: number, h: number, left: boolean) {
  camo(ctx, w, h, s.pants, left ? 51 : 61 + FACES.indexOf(face));
  if (face === "top") return;
  if (face === "bottom") {
    px(ctx, 0, 0, s.boots, w, h);
    return;
  }
  px(ctx, 0, h - 3, s.boots, w, 3);
  px(ctx, 0, h - 4, shade(s.boots, 1.4), w, 1);
}

function paintHelmet(
  pal: [string, string, string],
  face: Face,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
) {
  camo(ctx, w, h, pal, seed + FACES.indexOf(face));
  if (face === "front" || face === "left" || face === "right" || face === "back") {
    px(ctx, 0, h - 1, shade(pal[0], 0.65), w, 1); // rim
  }
}

export type CharacterMaterials = {
  head: THREE.Material[];
  body: THREE.Material[];
  armR: THREE.Material[];
  armL: THREE.Material[];
  legR: THREE.Material[];
  legL: THREE.Material[];
  helmet: THREE.Material[];
  goldHelmet: THREE.Material[];
};

const charCache = new Map<string, CharacterMaterials>();

export const DIMS = {
  head: [8, 8, 8] as [number, number, number],
  body: [8, 12, 4] as [number, number, number],
  limb: [4, 12, 4] as [number, number, number],
  helmet: [10, 4, 10] as [number, number, number],
};

export function characterMaterials(skinId: string): CharacterMaterials {
  const cached = charCache.get(skinId);
  if (cached) return cached;
  const s = getSkin(skinId);
  const helmPal = HELMET_COLORS[s.helmet];
  const mats: CharacterMaterials = {
    head: partMaterials(DIMS.head, (f, c, w, h) => paintHead(s, f, c, w, h)),
    body: partMaterials(DIMS.body, (f, c, w, h) => paintBody(s, f, c, w, h)),
    armR: partMaterials(DIMS.limb, (f, c, w, h) => paintArm(s, f, c, w, h, false)),
    armL: partMaterials(DIMS.limb, (f, c, w, h) => paintArm(s, f, c, w, h, true)),
    legR: partMaterials(DIMS.limb, (f, c, w, h) => paintLeg(s, f, c, w, h, false)),
    legL: partMaterials(DIMS.limb, (f, c, w, h) => paintLeg(s, f, c, w, h, true)),
    helmet: partMaterials(DIMS.helmet, (f, c, w, h) => {
      paintHelmet(helmPal, f, c, w, h, 71);
      if (s.extra === "goggles" && f === "front") {
        px(c, 2, 1, "#3a2c20", 6, 2);
        px(c, 2, 1, "#8fd3e8", 2, 2);
        px(c, 6, 1, "#8fd3e8", 2, 2);
      }
    }),
    goldHelmet: partMaterials(
      DIMS.helmet,
      (f, c, w, h) => {
        paintHelmet(GOLD_HELMET, f, c, w, h, 91);
        if (f === "top") px(c, 4, 4, "#fff3b0", 2, 2);
      },
      { emissive: new THREE.Color("#5a3a00"), emissiveIntensity: 0.6 },
    ),
  };
  charCache.set(skinId, mats);
  return mats;
}

/* ---------- world textures ---------- */

let stoneTex: THREE.Texture | null = null;
export function stoneTexture() {
  if (stoneTex) return stoneTex;
  stoneTex = canvasTexture(16, 16, (ctx, w, h) => {
    const r = mulberry(7);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = 128 + Math.floor((r() - 0.5) * 34);
        px(ctx, x, y, `rgb(${v},${v - 2},${v - 6})`);
      }
    // chiselled border + a few cracks
    for (let i = 0; i < w; i++) {
      px(ctx, i, 0, "#9c9a96");
      px(ctx, 0, i, "#9c9a96");
      px(ctx, i, h - 1, "#5e5c58");
      px(ctx, w - 1, i, "#5e5c58");
    }
    [
      [4, 5],
      [5, 6],
      [6, 6],
      [11, 10],
      [12, 11],
      [10, 3],
    ].forEach(([x, y]) => px(ctx, x, y, "#6a6864"));
  });
  return stoneTex;
}

let stoneSideTex: THREE.Texture | null = null;
export function stoneSideTexture() {
  if (stoneSideTex) return stoneSideTex;
  stoneSideTex = canvasTexture(16, 8, (ctx, w, h) => {
    const r = mulberry(13);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = 92 + Math.floor((r() - 0.5) * 30) - y * 3;
        px(ctx, x, y, `rgb(${v},${v - 4},${v - 8})`);
      }
    px(ctx, 0, 0, "#8f8c88", w, 1);
  });
  return stoneSideTex;
}

let basaltTex: THREE.Texture | null = null;
export function basaltTexture() {
  if (basaltTex) return basaltTex;
  basaltTex = canvasTexture(16, 16, (ctx, w, h) => {
    const r = mulberry(29);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = 52 + Math.floor((r() - 0.5) * 26);
        px(ctx, x, y, `rgb(${v + 14},${v - 6},${v - 10})`);
      }
    for (let i = 0; i < 9; i++) px(ctx, Math.floor(r() * w), Math.floor(r() * h), "#ff7a1a");
  });
  return basaltTex;
}

/* ---------- 2D front preview (skin picker) ---------- */

function drawPart(
  target: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  paint(c.getContext("2d")!, w, h);
  target.drawImage(c, ox, oy);
}

/** Paint a 16×34 front view of a skin into `canvas`. */
export function drawSkinFront(canvas: HTMLCanvasElement, skinId: string) {
  const s = getSkin(skinId);
  canvas.width = 16;
  canvas.height = 34;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 16, 34);
  drawPart(ctx, 0, 10, 4, 12, (c, w, h) => paintArm(s, "front", c, w, h, false));
  drawPart(ctx, 12, 10, 4, 12, (c, w, h) => paintArm(s, "front", c, w, h, true));
  drawPart(ctx, 4, 10, 8, 12, (c, w, h) => paintBody(s, "front", c, w, h));
  drawPart(ctx, 4, 22, 4, 12, (c, w, h) => paintLeg(s, "front", c, w, h, false));
  drawPart(ctx, 8, 22, 4, 12, (c, w, h) => paintLeg(s, "front", c, w, h, true));
  drawPart(ctx, 4, 2, 8, 8, (c, w, h) => paintHead(s, "front", c, w, h));
  drawPart(ctx, 3, 0, 10, 4, (c, w, h) => {
    paintHelmet(HELMET_COLORS[s.helmet], "front", c, w, h, 71);
    if (s.extra === "goggles") {
      px(c, 2, 1, "#3a2c20", 6, 2);
      px(c, 2, 1, "#8fd3e8", 2, 2);
      px(c, 6, 1, "#8fd3e8", 2, 2);
    }
  });
}
