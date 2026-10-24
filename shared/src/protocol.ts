/**
 * DOR PRIZE client <-> server contract (Socket.io).
 *
 * Both the in-browser mock (frontend/src/features/game/net) and the game server
 * (backend) emit these events through the shared RoomRunner, so
 * NEXT_PUBLIC_GAME_TRANSPORT=mock|socket behave the same.
 *
 * Rule of thumb: during the input phase nothing carries the position of
 * another player or an opponent's mine. Positions are revealed only in
 * `round:resolve` (the shootout), Blind Shot style, and hidden again at the
 * next `round:start`.
 */

export type Dir = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export type Skill = "mine" | "shotgun" | "shield" | "goldHelm";
export type Tile = { x: number; y: number };

export type RoomStatus = "LOBBY" | "COUNTDOWN" | "ROUND_INPUT" | "ANIMATION" | "RESULT" | "FINISHED" | "SETTLED";

export type PlayerPublic = {
  /** Seat number shown as "#N". Stable for the whole game. */
  num: number;
  name: string;
  skin: string;
  address?: string;
  ready: boolean;
  alive: boolean;
  isBot?: boolean;
};

export type RoomSummary = {
  roomId: string;
  name: string;
  bid: number;
  boardSize: number;
  maxPlayers: number;
  players: number;
  isPrivate: boolean;
  status: RoomStatus;
};

/** server -> client `room:state` */
export type RoomState = {
  roomId: string;
  name: string;
  status: RoomStatus;
  bid: number;
  pot: number;
  boardSize: number;
  maxPlayers: number;
  isPrivate: boolean;
  players: PlayerPublic[];
  /** The receiving player's seat, if seated. */
  meNum: number | null;
  /** Epoch ms when the start countdown ends (status COUNTDOWN). */
  countdownEndsAt: number | null;
  round: number;
  /** Server clock (epoch ms) when this was sent, to correct client clock skew. */
  serverNow: number;
};

/** server -> client `round:start` (personalised) */
export type RoundStart = {
  roomId: string;
  round: number;
  /** Server clock (epoch ms) when this was sent. */
  serverNow: number;
  /** Epoch ms deadline for `round:submit`. */
  deadline: number;
  boardSize: number;
  me: { x: number; y: number; alive: boolean; helm: boolean };
  /** Rounds left before a skill can be used again (0 = ready). */
  cooldowns: Record<Skill, number>;
  /** Ring (0 = outermost) that sank at the start of this round, or null. */
  shrunkRing: number | null;
  /** The receiving player stood on that ring and was pushed inwards. */
  pushed: boolean;
  /** Number of rings already sunk into lava. */
  sunkRings: number;
  /** Only the receiving player's own mines. */
  myMines: Tile[];
  /** The receiving player already submitted this round (resync after reconnect). */
  locked: boolean;
  /** Skill fees the receiving player has spent so far. */
  fees: number;
};

/** client -> server `round:submit`. Locked once sent. */
export type RoundSubmit = {
  /** Tile the player walked to (any solid tile on the board), or null to stay. */
  moveTo: Tile | null;
  /**
   * Aim direction. With the shield skill the player does not shoot: this is
   * only the facing direction the shield protects.
   */
  shootDir: Dir | null;
  skill: Skill | null;
  /** Tile the mine was dropped on (the tile under the player when buying it). */
  mineAt: Tile | null;
};

export type ShotPath = {
  dir: Dir;
  /** Visual segment: from the shooter's tile to where the bullet stopped. */
  from: Tile;
  to: Tile;
  hitNums: number[];
};

export type Shot = {
  shooterNum: number;
  weapon: "pistol" | "shotgun";
  paths: ShotPath[];
};

export type Death = {
  num: number;
  cause: "shot" | "mine";
  at: Tile;
  killerNums: number[];
};

export type Block = { num: number; by: "shield" | "helm"; at: Tile; dir: Dir | null };
export type MineBlast = { at: Tile; victimNums: number[] };

/** server -> client `round:resolve` (personalised `me`) */
/** Everyone alive at the shootout, after moving (revealed during the animation). */
export type RevealedPlayer = {
  num: number;
  at: Tile;
  /** Shot / facing direction, null when holding fire. */
  facing: Dir | null;
  weapon: "pistol" | "shotgun";
  shield: boolean;
  helm: boolean;
};

export type RoundResolve = {
  roomId: string;
  round: number;
  revealed: RevealedPlayer[];
  /** Mines that exploded this round (step 4). */
  mineBlasts: MineBlast[];
  /** Shots in display order ("Giliran #N"). */
  shots: Shot[];
  blocks: Block[];
  deaths: Death[];
  me: { x: number; y: number; alive: boolean; helm: boolean };
  myMines: Tile[];
};

export type GameEnd = {
  roomId: string;
  winners: number[];
  reason: "last" | "mutual" | "maxRounds";
  pot: number;
  payoutEach: number;
  /** Skill fees per seat, charged at settlement. */
  skillFees: Record<number, number>;
  kills: Record<number, number>;
  settlement?: { roomId: string; signature: string };
};

export type ServerEvents = {
  "room:state": RoomState;
  "round:start": RoundStart;
  "round:resolve": RoundResolve;
  "game:end": GameEnd;
  "room:error": { message: string };
};

export type ClientEvents = {
  "room:join": { roomId: string; name: string; skin: string };
  "room:skin": { skin: string };
  "room:ready": { ready: boolean };
  "room:leave": { roomId: string };
  "round:submit": RoundSubmit;
};

export type CreateRoomInput = {
  name: string;
  bid: number;
  maxPlayers: number;
  isPrivate: boolean;
};
