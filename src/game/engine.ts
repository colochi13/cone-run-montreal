import * as THREE from "three";
import { Sfx } from "./audio";
import {
  buildLandmarks,
  buildStreetLots,
  downtownAmount,
  envAt,
  SUBWAY_AT_M,
  subwayAmount,
  type Landmarks,
  type StreetLot,
} from "./landmarks";
import {
  asphaltTexture,
  ballastTexture,
  cloudTexture,
  facadeTexture,
  metroSignTexture,
  potholeTexture,
  shopTexture,
  sidewalkTexture,
  tunnelConcreteTexture,
  type FacadeStyle,
} from "./textures";

const LANE = 1.8;
const ROAD_HALF = 2.75;
const LEN = 30;
const CHUNKS = 7;

export type Phase = "attract" | "playing" | "paused" | "dead";
export type Cause = "cone" | "pit" | "barrier" | "scaffold" | "truck" | "pillar" | "sign";
export type Nudge = "left" | "right" | "jump" | "slide";

export type Hud = {
  phase: Phase;
  meters: number;
  coins: number;
  score: number;
  best: number;
  lane: number;
  hat: boolean;
  magnet: number;
  cause: Cause | null;
  callout: string;
  hint: string;
  muted: boolean;
  heat: number;
  newBest: boolean;
  nears: number;
};

type Kind = Cause | "coin" | "poutine" | "hat" | "magnet";

type Spawn = { z: number; lane: -1 | 0 | 1; kind: Kind; hint?: string };

type Pattern = { len: number; min: number; spawns: Spawn[] };

type Ent = {
  kind: Kind;
  alive: boolean;
  x: number;
  z: number;
  lane: number;
  mesh: THREE.Group;
  hint?: string;
  hintShown: boolean;
  scored: boolean;
};

type Part = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
};

type Save = { v: 1; best: number; muted: boolean };

const HAZE = "#cfdce6";
const SAVE_KEY = "cone-run-v1";

/** Irregular dish: raised broken rim, shallow dark centre. Normals point up. */
function potholeGeometry() {
  const A = 34;
  const rings = [
    { r: 0.1, y: 0.04 },
    { r: 0.26, y: 0.046 },
    { r: 0.42, y: 0.058 },
    { r: 0.58, y: 0.074 },
    { r: 0.72, y: 0.118 },
    { r: 0.92, y: 0.046 },
  ];
  const jag = new Float32Array(A);
  for (let i = 0; i < A; i += 1) {
    const a = (i / A) * Math.PI * 2;
    let j = 1 + 0.15 * Math.sin(a * 3 + 0.6) + 0.09 * Math.sin(a * 7 - 0.4) + 0.04 * Math.sin(a * 13 + 1.4);
    if (Math.sin(a * 5 + 0.8) > 0.7) j *= 0.8;
    jag[i] = j;
  }
  const positions: number[] = [];
  const uvs: number[] = [];
  positions.push(0, 0.036, 0);
  uvs.push(0.5, 0.5);
  for (let r = 0; r < rings.length; r += 1) {
    for (let i = 0; i < A; i += 1) {
      const a = (i / A) * Math.PI * 2;
      const influence = Math.min(1, rings[r].r / 0.42);
      const radius = rings[r].r * (1 + (jag[i] - 1) * influence);
      let y = rings[r].y;
      if (r >= 4 && Math.sin(a * 5 + 0.8) > 0.7) y -= 0.045;
      positions.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
      uvs.push(0.5 + Math.cos(a) * (radius / 2.05), 0.5 + Math.sin(a) * (radius / 2.05));
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < A; i += 1) {
    indices.push(0, 1 + ((i + 1) % A), 1 + i);
  }
  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let i = 0; i < A; i += 1) {
      const nxt = (i + 1) % A;
      const a = 1 + r * A + i;
      const b = 1 + r * A + nxt;
      const c = 1 + (r + 1) * A + i;
      const d = 1 + (r + 1) * A + nxt;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function smoothstep(x: number, edge0: number, edge1: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Mostly steady fluorescents, with a hard dip every so often. */
function fluorFlicker(time: number) {
  const wobble = 0.84 + Math.sin(time * 19) * 0.08 + Math.sin(time * 47) * 0.05;
  const drop = Math.sin(time * 13.7) > 0.93 ? 0.22 : 1;
  return wobble * drop;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadSave(): Save {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { v: 1, best: 0, muted: false };
    const parsed = JSON.parse(raw) as Partial<Save>;
    return {
      v: 1,
      best: typeof parsed.best === "number" ? parsed.best : 0,
      muted: Boolean(parsed.muted),
    };
  } catch {
    return { v: 1, best: 0, muted: false };
  }
}

const PATTERNS: Pattern[] = [
  { len: 22, min: 0, spawns: [{ z: 0, lane: 1, kind: "cone" }] },
  { len: 22, min: 0, spawns: [{ z: 0, lane: -1, kind: "cone" }] },
  { len: 22, min: 0, spawns: [{ z: 0, lane: 1, kind: "cone" }] },
  {
    len: 24,
    min: 0,
    spawns: [
      { z: 0, lane: -1, kind: "cone" },
      { z: 0, lane: 1, kind: "cone" },
    ],
  },
  { len: 24, min: 0, spawns: [{ z: 0, lane: 0, kind: "pit" }] },
  { len: 24, min: 0, spawns: [{ z: 0, lane: 0, kind: "scaffold" }] },
  { len: 24, min: 0, spawns: [{ z: 0, lane: -1, kind: "barrier" }] },
  {
    len: 26,
    min: 0,
    spawns: [
      { z: 0, lane: 0, kind: "cone" },
      { z: 2, lane: -1, kind: "coin" },
      { z: 5, lane: -1, kind: "coin" },
      { z: 8, lane: 0, kind: "coin" },
      { z: 11, lane: 1, kind: "coin" },
    ],
  },
  {
    len: 26,
    min: 70,
    spawns: [
      { z: 0, lane: -1, kind: "cone" },
      { z: 0, lane: 0, kind: "cone" },
    ],
  },
  { len: 26, min: 90, spawns: [{ z: 0, lane: 1, kind: "truck" }] },
  { len: 26, min: 90, spawns: [{ z: 0, lane: -1, kind: "truck" }] },
  {
    len: 28,
    min: 40,
    spawns: [
      { z: 0, lane: -1, kind: "pit" },
      { z: 0, lane: 0, kind: "pit" },
      { z: 0, lane: 1, kind: "pit" },
    ],
  },
  {
    len: 28,
    min: 50,
    spawns: [
      { z: 0, lane: -1, kind: "scaffold" },
      { z: 0, lane: 0, kind: "scaffold" },
      { z: 0, lane: 1, kind: "scaffold" },
    ],
  },
  {
    len: 30,
    min: 140,
    spawns: [
      { z: 0, lane: 0, kind: "truck" },
      { z: 14, lane: -1, kind: "cone" },
      { z: 14, lane: 1, kind: "pit" },
    ],
  },
  {
    len: 30,
    min: 160,
    spawns: [
      { z: 0, lane: -1, kind: "barrier" },
      { z: 0, lane: 1, kind: "cone" },
      { z: 13, lane: 0, kind: "scaffold" },
    ],
  },
  {
    len: 32,
    min: 280,
    spawns: [
      { z: 0, lane: 0, kind: "cone" },
      { z: 0, lane: 1, kind: "cone" },
      { z: 14, lane: -1, kind: "scaffold" },
      { z: 14, lane: 0, kind: "pit" },
    ],
  },
  {
    len: 34,
    min: 420,
    spawns: [
      { z: 0, lane: -1, kind: "truck" },
      { z: 0, lane: 1, kind: "cone" },
      { z: 15, lane: 0, kind: "scaffold" },
      { z: 15, lane: 1, kind: "barrier" },
    ],
  },
  {
    len: 24,
    min: 120,
    spawns: [
      { z: 0, lane: -1, kind: "cone" },
      { z: 0, lane: 1, kind: "hat" },
    ],
  },
  {
    len: 24,
    min: 220,
    spawns: [
      { z: 0, lane: 0, kind: "pit" },
      { z: 0, lane: 1, kind: "magnet" },
      { z: 4, lane: -1, kind: "coin" },
      { z: 7, lane: -1, kind: "coin" },
      { z: 10, lane: -1, kind: "poutine" },
    ],
  },
];

/** Obstacles that belong underground. Same lanes and the same dodge / jump / slide verbs. */
const SUBWAY_PATTERNS: Pattern[] = [
  { len: 24, min: 0, spawns: [{ z: 0, lane: 0, kind: "pillar", hint: "SWIPE — column fills the lane" }] },
  { len: 24, min: 0, spawns: [{ z: 0, lane: -1, kind: "pillar" }] },
  { len: 24, min: 0, spawns: [{ z: 0, lane: 1, kind: "pillar" }] },
  {
    len: 24,
    min: 0,
    spawns: [
      { z: 0, lane: -1, kind: "pillar" },
      { z: 0, lane: 1, kind: "pillar" },
    ],
  },
  { len: 24, min: 0, spawns: [{ z: 0, lane: 0, kind: "sign", hint: "SLIDE — under the sign" }] },
  {
    len: 26,
    min: 0,
    spawns: [
      { z: 0, lane: -1, kind: "sign" },
      { z: 0, lane: 0, kind: "sign" },
      { z: 0, lane: 1, kind: "sign" },
    ],
  },
  {
    len: 28,
    min: 0,
    spawns: [
      { z: 0, lane: 0, kind: "pillar" },
      { z: 12, lane: -1, kind: "sign" },
      { z: 12, lane: 1, kind: "sign" },
    ],
  },
  { len: 24, min: 0, spawns: [{ z: 0, lane: 0, kind: "pit" }] },
  {
    len: 28,
    min: 0,
    spawns: [
      { z: 0, lane: -1, kind: "pit" },
      { z: 0, lane: 0, kind: "pit" },
      { z: 0, lane: 1, kind: "pit" },
    ],
  },
  {
    len: 26,
    min: 0,
    spawns: [
      { z: 0, lane: 1, kind: "cone" },
      { z: 11, lane: -1, kind: "pillar" },
    ],
  },
  {
    len: 26,
    min: 0,
    spawns: [
      { z: 0, lane: 0, kind: "cone" },
      { z: 3, lane: -1, kind: "coin" },
      { z: 6, lane: -1, kind: "coin" },
      { z: 9, lane: 1, kind: "coin" },
    ],
  },
  {
    len: 24,
    min: 0,
    spawns: [
      { z: 0, lane: -1, kind: "sign" },
      { z: 0, lane: 1, kind: "hat" },
    ],
  },
  {
    len: 26,
    min: 0,
    spawns: [
      { z: 0, lane: 0, kind: "pillar" },
      { z: 0, lane: 1, kind: "magnet" },
      { z: 4, lane: -1, kind: "coin" },
      { z: 8, lane: -1, kind: "poutine" },
    ],
  },
];

const STATION_NAMES = ["SHERBROOKE", "MONT-ROYAL", "LAURIER", "BEAUBIEN", "JEAN-TALON"];

function introScript(): Pattern[] {
  return [
    {
      len: 16,
      min: 0,
      spawns: [
        { z: 0, lane: 0, kind: "coin" },
        { z: 3, lane: 0, kind: "coin" },
        { z: 6, lane: 0, kind: "coin" },
        { z: 9, lane: 0, kind: "coin" },
      ],
    },
    { len: 18, min: 0, spawns: [{ z: 0, lane: 1, kind: "cone", hint: "SWIPE — dodge the baril" }] },
    { len: 18, min: 0, spawns: [{ z: 0, lane: 0, kind: "pit", hint: "JUMP — nid-de-poule" }] },
    { len: 18, min: 0, spawns: [{ z: 0, lane: 0, kind: "scaffold", hint: "SLIDE — under the scaffold" }] },
    {
      len: 20,
      min: 0,
      spawns: [
        { z: 0, lane: -1, kind: "cone" },
        { z: 0, lane: 1, kind: "cone" },
      ],
    },
  ];
}

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      getX: () => number;
      getY: () => number;
      getLane: () => number;
      setKeys: (codes: string[]) => void;
      setSteer: (v: number) => void;
    };
  }
}

export class ConeGame {
  readonly sfx = new Sfx();
  phase: Phase = "attract";
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private dead = false;
  private host: HTMLElement;
  private time = 0;
  private meters = 0;
  /** Distance the scenery has actually scrolled. Stays glued to the chunks during a wipeout. */
  private scenic = 0;
  private coins = 0;
  private nears = 0;
  private best: number;
  private speed = 9;
  private horizon = -8;
  private script: Pattern[] = [];
  private rng = mulberry32(0xC0FE);
  private laneTarget = 0;
  private y = 0;
  private vy = 0;
  private grounded = true;
  private sliding = 0;
  private jumpBuffer = 0;
  private slideBuffer = 0;
  private invuln = 0;
  private hat = false;
  private magnetT = 0;
  private hitstop = 0;
  private shake = 0;
  private deathT = 0;
  private cause: Cause | null = null;
  private newBest = false;
  private hint = "";
  private hintT = 0;
  private callout = "";
  private calloutT = 0;
  private muted: boolean;
  private emitAcc = 0;
  private stepT = 0.2;
  private keyDown = new Set<string>();
  private qaKeys = new Set<string>();
  private prevLeft = false;
  private prevRight = false;
  private prevJump = false;
  private prevSlide = false;
  private swipeId: number | null = null;
  private swipeX = 0;
  private swipeY = 0;
  private swipeUsed = false;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private texs: THREE.Texture[] = [];
  private ents: Ent[] = [];
  private parts: Part[] = [];
  private partMesh: THREE.InstancedMesh;
  private partDummy = new THREE.Object3D();
  private player = new THREE.Group();
  private visual = new THREE.Group();
  private bob = new THREE.Group();
  private legL!: THREE.Group;
  private legR!: THREE.Group;
  private shinL!: THREE.Group;
  private shinR!: THREE.Group;
  private armL!: THREE.Group;
  private armR!: THREE.Group;
  private foreL!: THREE.Group;
  private foreR!: THREE.Group;
  private torsoPivot!: THREE.Group;
  private headPivot!: THREE.Group;
  private scarf!: THREE.Object3D;
  private eyeL!: THREE.Mesh;
  private eyeR!: THREE.Mesh;
  private browL!: THREE.Mesh;
  private browR!: THREE.Mesh;
  private mouth!: THREE.Mesh;
  private shadow: THREE.Mesh;
  private bubble: THREE.Mesh;
  private chunks: THREE.Group[] = [];
  private chunkRecs: {
    group: THREE.Group;
    street: THREE.Group;
    tunnel: THREE.Group;
    road: THREE.Object3D;
    lots: StreetLot[];
  }[] = [];
  private facades: { tex: THREE.Texture; style: FacadeStyle; base: string }[] = [];
  private shopTexs: THREE.Texture[] = [];
  private asphaltTex!: THREE.Texture;
  private walkTex!: THREE.Texture;
  private drumOrange: THREE.Material | null = null;
  private drumSilver: THREE.Material | null = null;
  private drumBlack: THREE.Material | null = null;
  private landmarks!: Landmarks;
  private clouds: THREE.Sprite[] = [];
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private rim!: THREE.DirectionalLight;
  private lamp!: THREE.PointLight;
  private fog!: THREE.Fog;
  private bg!: THREE.Color;
  private fluor!: THREE.MeshStandardMaterial;
  private portal!: THREE.Group;
  private train!: THREE.Group;
  private trainZ = 30;
  private trainOn = false;
  private trainSide: -1 | 1 = -1;
  private nextTrainM = SUBWAY_AT_M + 180;
  private metroCalled = false;
  private pitProto: THREE.Group | null = null;
  private signMats: THREE.Material[] = [];
  private tunnelBuilt = false;
  private tmpFog = new THREE.Color();
  private streetHemi = new THREE.Color(0xeaf1f8);
  private tunnelHemi = new THREE.Color(0x9aafc4);
  private streetGround = new THREE.Color(0x8a7a66);
  private tunnelGround = new THREE.Color(0x3a424c);
  private hazeColor = new THREE.Color(HAZE);
  private tunnelFog = new THREE.Color("#314054");
  private darkColor = new THREE.Color("#05060a");
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private steam: { mesh: THREE.Mesh; t: number }[] = [];
  private reduceMotion: boolean;
  private camBase = new THREE.Vector3();
  private look = new THREE.Vector3();

  constructor(
    canvas: HTMLCanvasElement,
    private onHud: (hud: Hud) => void,
  ) {
    const saved = loadSave();
    this.best = saved.best;
    this.muted = saved.muted;
    this.sfx.setMuted(this.muted);
    this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.host = canvas.parentElement ?? document.body;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(HAZE);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1400);
    this.fog = new THREE.Fog(HAZE, 55, 760);
    this.scene.fog = this.fog;
    this.bg = new THREE.Color(HAZE);
    this.scene.background = this.bg;

    this.hemi = new THREE.HemisphereLight(0xeaf1f8, 0x8a7a66, 0.5);
    const hemi = this.hemi;
    this.sun = new THREE.DirectionalLight(0xffe9c8, 3.3);
    const sun = this.sun;
    sun.position.set(-14, 24, -2);
    sun.target.position.set(0, 0, -16);
    sun.castShadow = true;
    const small = window.innerWidth < 700;
    sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -34;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.rim = new THREE.DirectionalLight(0xffa86a, 0.5);
    const rim = this.rim;
    rim.position.set(10, 8, -30);
    this.lamp = new THREE.PointLight(0xd5e6ff, 0, 18, 2);
    this.lamp.position.set(0, 3.05, -4.5);
    this.lamp.visible = false;
    this.scene.add(hemi, sun, sun.target, rim, this.lamp);
    this.scene.environmentIntensity = 0.32;

    this.asphaltTex = asphaltTexture(mulberry32(7));
    this.asphaltTex.repeat.set(1, LEN / 5.5);
    this.walkTex = sidewalkTexture(mulberry32(9));
    this.walkTex.repeat.set(1, LEN / 1.7);
    this.texs.push(this.asphaltTex, this.walkTex);
    this.buildFacadeSets();
    const ground = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(500, 330)), this.lambert("#7b756b", 0.95));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.04, -110);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.buildSky();
    this.buildVista();
    for (let i = 0; i < CHUNKS; i += 1) this.chunks.push(this.buildChunk(i));
    this.buildPortal();
    this.buildTrain();
    this.buildPlayer();
    this.shadow = this.makeShadow();
    this.bubble = this.makeBubble();
    this.player.add(this.bubble);
    this.scene.add(this.player, this.shadow);
    this.partMesh = this.makeParticles();
    this.scene.add(this.partMesh);
    this.poolEntities();
    const cast = (o: THREE.Object3D) =>
      o.traverse((m) => {
        if (m instanceof THREE.Mesh) m.castShadow = true;
      });
    cast(this.player);
    this.bubble.castShadow = false;
    for (const e of this.ents) cast(e.mesh);
    this.resize();

    this.onResize = this.onResize.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onVis = this.onVis.bind(this);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVis);
    this.host.addEventListener("pointerdown", this.onPointerDown);
    this.host.addEventListener("pointermove", this.onPointerMove);
    this.host.addEventListener("pointerup", this.onPointerUp);
    this.host.addEventListener("pointercancel", this.onPointerUp);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.host);

    window.__controlsTest = {
      getYaw: () => 0,
      getSpeed: () => this.speed,
      getX: () => this.player.position.x,
      getY: () => this.y,
      getLane: () => this.laneTarget,
      setKeys: (codes) => {
        this.qaKeys = new Set(codes);
      },
      setSteer: () => {},
    };

    this.resetRun("attract");
    this.sfx.startMusic();
    this.emit(true);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    if (this.dead) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!document.hidden) {
      this.pollInput();
      this.sfx.tick();
      if (this.phase !== "paused") {
        this.acc += dt;
        let steps = 0;
        while (this.acc >= 1 / 60 && steps < 5) {
          this.sim(1 / 60);
          this.acc -= 1 / 60;
          steps += 1;
        }
      }
      this.render();
      this.emitAcc += dt;
      if (this.emitAcc > 0.08) {
        this.emitAcc = 0;
        this.emit(false);
      }
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  unlock() {
    this.sfx.unlock();
  }

  play() {
    this.sfx.unlock();
    this.sfx.resumeCtx();
    if (this.phase === "playing") return;
    this.resetRun("playing");
    this.sfx.startMusic();
    this.emit(true);
  }

  pause() {
    if (this.phase !== "playing") return;
    this.phase = "paused";
    this.sfx.pauseMusic();
    this.emit(true);
  }

  resume() {
    if (this.phase !== "paused") return;
    this.phase = "playing";
    this.sfx.resumeCtx();
    this.sfx.resumeMusic();
    this.emit(true);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.sfx.unlock();
    this.sfx.setMuted(this.muted);
    this.persist();
    this.emit(true);
  }

  nudge(action: Nudge) {
    if (this.phase !== "playing") return;
    if (action === "left") this.laneTarget = Math.max(-1, this.laneTarget - 1);
    if (action === "right") this.laneTarget = Math.min(1, this.laneTarget + 1);
    if (action === "jump") this.jumpBuffer = 0.14;
    if (action === "slide") this.slideBuffer = 0.14;
  }

  dispose() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVis);
    this.host.removeEventListener("pointerdown", this.onPointerDown);
    this.host.removeEventListener("pointermove", this.onPointerMove);
    this.host.removeEventListener("pointerup", this.onPointerUp);
    this.host.removeEventListener("pointercancel", this.onPointerUp);
    this.ro?.disconnect();
    if (window.__controlsTest) delete window.__controlsTest;
    this.geos.forEach((g) => g.dispose());
    this.mats.forEach((m) => m.dispose());
    this.texs.forEach((t) => t.dispose());
    this.envRT?.dispose();
    this.pmrem?.dispose();
    this.renderer.dispose();
  }

  private ro: ResizeObserver | null = null;

  private snapshot(): Hud {
    const meters = Math.floor(this.meters);
    return {
      phase: this.phase,
      meters,
      coins: this.coins,
      score: meters + this.coins * 10 + this.nears * 25,
      best: this.best,
      lane: this.laneTarget,
      hat: this.hat,
      magnet: this.magnetT,
      cause: this.cause,
      callout: this.calloutT > 0 ? this.callout : "",
      hint: this.hintT > 0 ? this.hint : "",
      muted: this.muted,
      heat: Math.min(1, Math.max(0, (this.speed - 16) / 14)),
      newBest: this.newBest,
      nears: this.nears,
    };
  }

  private emit(force: boolean) {
    if (!force) {
      this.onHud(this.snapshot());
      return;
    }
    this.emitAcc = 0;
    this.onHud(this.snapshot());
  }

  private persist() {
    const data: Save = { v: 1, best: this.best, muted: this.muted };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* ignore quota */
    }
  }

  private resetRun(phase: Phase) {
    this.phase = phase;
    this.meters = 0;
    this.coins = 0;
    this.nears = 0;
    this.speed = phase === "attract" ? 10 : 15;
    this.laneTarget = 0;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.sliding = 0;
    this.jumpBuffer = 0;
    this.slideBuffer = 0;
    this.invuln = 0;
    this.hat = false;
    this.magnetT = 0;
    this.hitstop = 0;
    this.shake = 0;
    this.deathT = 0;
    this.cause = null;
    this.newBest = false;
    this.hint = "";
    this.hintT = 0;
    this.callout = "";
    this.calloutT = 0;
    this.player.position.set(0, 0, 0);
    this.visual.rotation.set(0, 0, 0);
    this.horizon = -6;
    this.scenic = 0;
    this.metroCalled = false;
    this.trainOn = false;
    this.trainZ = 30;
    this.nextTrainM = SUBWAY_AT_M + 180;
    if (this.train) this.train.visible = false;
    this.script = phase === "playing" ? introScript() : [];
    for (const e of this.ents) this.release(e);
    this.fillRoad();
    if (this.chunkRecs.length) this.updateScenery();
    if (this.fog) this.updateAtmosphere();
  }

  private sim(dt: number) {
    this.time += dt;
    if (this.hintT > 0) this.hintT -= dt;
    if (this.calloutT > 0) this.calloutT -= dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.magnetT > 0) this.magnetT -= dt;

    const live = this.phase === "playing" || this.phase === "attract" || this.phase === "dead";
    if (!live) return;

    let scale = 1;
    if (this.hitstop > 0) {
      scale = 0.06;
      this.hitstop -= dt;
    }
    const sdt = dt * scale;

    if (this.phase === "playing") {
      const target = Math.min(30, 15 + this.meters * 0.012);
      this.speed += (target - this.speed) * Math.min(1, sdt * 0.7);
      this.meters += this.speed * sdt;
      this.sfx.updatePitchBySpeed(this.speed, 30, sdt);
    } else if (this.phase === "attract") {
      this.speed = 10;
    } else {
      this.deathT += dt;
      this.speed *= Math.exp(-sdt * 3.2);
      this.visual.rotation.x += sdt * 5;
      this.visual.rotation.z += sdt * 3.2;
    }

    const shift = this.speed * sdt;
    if (this.phase === "playing" || this.phase === "dead") this.scenic += shift;
    for (const chunk of this.chunks) {
      chunk.position.z += shift;
      if (chunk.position.z > LEN) chunk.position.z -= CHUNKS * LEN;
    }
    this.horizon += shift;
    for (const e of this.ents) {
      if (!e.alive) continue;
      const prev = e.z;
      e.z += shift;
      e.mesh.position.z = e.z;
      e.mesh.position.x = e.x;
      if (e.z > 14) this.release(e);
      else this.noteCross(e, prev);
    }
    this.fillRoad();
    this.updateScenery();
    this.updateTrain(shift);
    if (this.phase === "playing" && !this.metroCalled && this.scenic >= SUBWAY_AT_M - 28) {
      this.metroCalled = true;
      this.callout = "MÉTRO";
      this.calloutT = 1.6;
      this.emit(true);
    }

    if (this.phase === "attract") this.autopilot();
    if (this.phase === "playing" || this.phase === "attract") this.updatePlayer(dt, sdt);
    else this.updatePlayer(dt, sdt);
    this.animateCharacter(dt);
    this.updateFloaters();
    this.updateSteam(dt);
    this.updateParticles(dt);
    if (this.phase === "playing") this.collide();
    this.shake *= Math.exp(-dt * 5);
  }

  private updatePlayer(dt: number, sdt: number) {
    if (this.phase === "dead") {
      this.vy -= 28 * sdt;
      this.y += this.vy * sdt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
      }
      this.player.position.y = this.y;
      const goal = this.laneTarget * LANE;
      this.player.position.x += (goal - this.player.position.x) * Math.min(1, sdt * 10);
      return;
    }

    if (this.jumpBuffer > 0) {
      this.jumpBuffer -= dt;
      if (this.grounded) {
        this.vy = 8.3;
        this.grounded = false;
        this.sliding = 0;
        this.slideBuffer = 0;
        this.jumpBuffer = 0;
        if (this.phase === "playing") this.sfx.jump();
      }
    }
    if (this.slideBuffer > 0) {
      this.slideBuffer -= dt;
      if (this.grounded && this.sliding <= 0 && this.y < 0.05) {
        this.sliding = 0.58;
        this.slideBuffer = 0;
        if (this.phase === "playing") this.sfx.slide();
      }
    }
    if (this.sliding > 0) this.sliding -= dt;

    this.vy -= 34 * sdt;
    this.y += this.vy * sdt;
    if (this.y <= 0) {
      if (!this.grounded && this.phase === "playing" && !this.reduceMotion) {
        this.burst(this.player.position.x, 0.08, 0.15, 0xc4b8aa, 5, 1.6);
      }
      this.y = 0;
      this.vy = 0;
      this.grounded = true;
    }
    this.player.position.y = this.y;
    const goal = this.laneTarget * LANE;
    this.player.position.x += (goal - this.player.position.x) * Math.min(1, sdt * 14);

    if (this.phase === "playing" && this.grounded && this.sliding <= 0) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = Math.max(0.16, 0.32 - this.speed * 0.004);
        if (!this.reduceMotion) this.burst(this.player.position.x, 0.06, 0.25, 0xb7aa9c, 2, 0.8);
      }
    }
  }

  private animateCharacter(dt: number) {
    const run = this.grounded && this.sliding <= 0 && this.phase !== "dead";
    const t = this.time * (7.2 + Math.min(this.speed, 28) * 0.18);
    const poseLeg = (hip: THREE.Group, shin: THREE.Group, phase: number, air = false) => {
      if (air) {
        hip.rotation.x = THREE.MathUtils.lerp(hip.rotation.x, 0.85, 0.18);
        shin.rotation.x = THREE.MathUtils.lerp(shin.rotation.x, -1.35, 0.18);
        return;
      }
      const swing = Math.sin(phase);
      hip.rotation.x = swing * 0.55;
      const recover = Math.max(0, Math.cos(phase));
      shin.rotation.x = -(0.2 + recover * 0.7);
    };
    const poseArm = (shoulder: THREE.Group, fore: THREE.Group, phase: number, air = false) => {
      if (air) {
        shoulder.rotation.x = THREE.MathUtils.lerp(shoulder.rotation.x, -0.55, 0.18);
        shoulder.rotation.z = THREE.MathUtils.lerp(shoulder.rotation.z, shoulder.position.x < 0 ? 0.35 : -0.35, 0.18);
        fore.rotation.x = THREE.MathUtils.lerp(fore.rotation.x, -0.7, 0.18);
        return;
      }
      shoulder.rotation.x = Math.sin(phase) * 0.45;
      shoulder.rotation.z = THREE.MathUtils.lerp(shoulder.rotation.z, shoulder.position.x < 0 ? 0.28 : -0.28, 0.25);
      fore.rotation.x = -0.65 + Math.sin(phase) * 0.15;
    };
    if (run) {
      poseLeg(this.legL, this.shinL, t);
      poseLeg(this.legR, this.shinR, t + Math.PI);
      poseArm(this.armL, this.foreL, t + Math.PI);
      poseArm(this.armR, this.foreR, t);
      this.bob.position.y = Math.abs(Math.sin(t)) * 0.04;
      this.torsoPivot.rotation.y = Math.sin(t) * 0.12;
      this.headPivot.rotation.y = -0.55 - Math.sin(t) * 0.05;
      this.headPivot.rotation.x = 0.06 + Math.sin(t * 2) * 0.03;
    } else if (!this.grounded && this.phase !== "dead") {
      poseLeg(this.legL, this.shinL, 0, true);
      poseLeg(this.legR, this.shinR, 0, true);
      poseArm(this.armL, this.foreL, 0, true);
      poseArm(this.armR, this.foreR, 0, true);
      this.bob.position.y = THREE.MathUtils.lerp(this.bob.position.y, 0, 0.2);
      this.torsoPivot.rotation.y = THREE.MathUtils.lerp(this.torsoPivot.rotation.y, 0, 0.15);
      this.headPivot.rotation.y = THREE.MathUtils.lerp(this.headPivot.rotation.y, -0.4, 0.15);
    } else if (this.sliding > 0) {
      this.legL.rotation.x = THREE.MathUtils.lerp(this.legL.rotation.x, 0.35, 0.25);
      this.legR.rotation.x = THREE.MathUtils.lerp(this.legR.rotation.x, 0.15, 0.25);
      this.shinL.rotation.x = THREE.MathUtils.lerp(this.shinL.rotation.x, -1.2, 0.25);
      this.shinR.rotation.x = THREE.MathUtils.lerp(this.shinR.rotation.x, -0.9, 0.25);
      this.armL.rotation.x = THREE.MathUtils.lerp(this.armL.rotation.x, 1.15, 0.25);
      this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, 1.25, 0.25);
      this.foreL.rotation.x = THREE.MathUtils.lerp(this.foreL.rotation.x, -0.35, 0.25);
      this.foreR.rotation.x = THREE.MathUtils.lerp(this.foreR.rotation.x, -0.35, 0.25);
      this.bob.position.y = 0;
      this.torsoPivot.rotation.y = 0;
      this.headPivot.rotation.x = THREE.MathUtils.lerp(this.headPivot.rotation.x, 0.35, 0.2);
    }
    if (this.phase !== "dead") {
      const slidePitch = this.sliding > 0 ? -1.05 : 0;
      this.visual.rotation.x = THREE.MathUtils.lerp(this.visual.rotation.x, slidePitch, 1 - Math.exp(-dt * 12));
      const lean = (this.laneTarget * LANE - this.player.position.x) * 0.42;
      this.visual.rotation.z = THREE.MathUtils.lerp(this.visual.rotation.z, lean, 1 - Math.exp(-dt * 8));
      this.headPivot.rotation.z = THREE.MathUtils.lerp(this.headPivot.rotation.z, -lean * 0.35, 0.2);
      this.poseFace(dt, false);
    } else {
      this.poseFace(dt, true);
    }
    this.scarf.rotation.z = Math.sin(this.time * 8) * 0.12;
    this.scarf.rotation.x = Math.sin(this.time * 6) * 0.08;
    this.bubble.visible = this.hat || this.invuln > 0.05;
    const pulse = 1 + Math.sin(this.time * 9) * 0.04;
    this.bubble.scale.setScalar(this.hat ? pulse : pulse * 1.08);
    this.shadow.position.x = this.player.position.x;
    this.shadow.position.z = 0.05;
    const lift = Math.min(1, this.y / 1.2);
    this.shadow.scale.setScalar(1 - lift * 0.35);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.35 - lift * 0.18;
  }

  private poseFace(dt: number, wiped: boolean) {
    const k = 1 - Math.exp(-dt * 10);
    const browY = wiped ? 0.135 : 0.108;
    const browZL = wiped ? -0.55 : 0.25;
    const browZR = wiped ? 0.55 : -0.15;
    const mouthY = wiped ? 3.4 : 1;
    const mouthX = wiped ? 0.65 : 1;
    const eye = wiped ? 1.35 : 1;
    this.browL.position.y = THREE.MathUtils.lerp(this.browL.position.y, browY, k);
    this.browR.position.y = THREE.MathUtils.lerp(this.browR.position.y, browY, k);
    this.browL.rotation.z = THREE.MathUtils.lerp(this.browL.rotation.z, browZL, k);
    this.browR.rotation.z = THREE.MathUtils.lerp(this.browR.rotation.z, browZR, k);
    this.mouth.scale.y = THREE.MathUtils.lerp(this.mouth.scale.y, mouthY, k);
    this.mouth.scale.x = THREE.MathUtils.lerp(this.mouth.scale.x, mouthX, k);
    this.mouth.rotation.z = THREE.MathUtils.lerp(this.mouth.rotation.z, wiped ? 0 : -0.4, k);
    this.eyeL.scale.setScalar(THREE.MathUtils.lerp(this.eyeL.scale.x, eye, k));
    this.eyeR.scale.setScalar(THREE.MathUtils.lerp(this.eyeR.scale.x, eye, k));
  }

  private updateFloaters() {
    for (const e of this.ents) {
      if (!e.alive) continue;
      if (e.kind === "coin" || e.kind === "poutine" || e.kind === "hat" || e.kind === "magnet") {
        e.mesh.rotation.y = this.time * 1.8 + e.z;
        e.mesh.position.y = 0.08 + Math.sin(this.time * 3.4 + e.x * 2) * 0.08;
      }
      if (this.magnetT > 0 && (e.kind === "coin" || e.kind === "poutine") && e.z > -9 && e.z < 2) {
        e.x += (this.player.position.x - e.x) * 0.18;
        e.z += Math.min(0.35, Math.max(0, -e.z) * 0.08);
      }
      if (e.kind === "coin" || e.kind === "poutine" || e.kind === "hat" || e.kind === "magnet") {
        e.mesh.position.x = e.x;
        e.mesh.position.z = e.z;
      }
    }
  }

  private updateSteam(dt: number) {
    for (const s of this.steam) {
      s.t += dt * 0.45;
      const w = s.t % 1;
      s.mesh.position.y = 0.25 + w * 1.5;
      const sc = 0.25 + w * 0.85;
      s.mesh.scale.setScalar(sc);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.28 * (1 - w);
    }
  }

  private noteCross(e: Ent, prev: number) {
    if (this.phase !== "playing" || e.scored) return;
    if (!(prev < 0 && e.z >= 0)) return;
    if (e.kind === "coin" || e.kind === "poutine" || e.kind === "hat" || e.kind === "magnet") return;
    const dx = Math.abs(e.x - this.player.position.x);
    if (dx > 0.82 && dx < 1.2) {
      e.scored = true;
      this.nears += 1;
      this.callout = "PROCHE";
      this.calloutT = 0.7;
      this.sfx.near();
      if (!this.reduceMotion) this.shake = Math.max(this.shake, 0.08);
    }
  }

  private collide() {
    if (this.invuln > 0) return;
    const px = this.player.position.x;
    for (const e of this.ents) {
      if (!e.alive) continue;
      const dx = Math.abs(e.x - px);
      const reach =
        e.kind === "truck" ? 1.65 : e.kind === "pit" ? 0.95 : e.kind === "barrier" ? 0.7 : e.kind === "pillar" ? 0.55 : 0.62;
      if (Math.abs(e.z) > reach) continue;
      const pickup = e.kind === "coin" || e.kind === "poutine" || e.kind === "hat" || e.kind === "magnet";
      if (pickup) {
        if (dx > 0.85) continue;
        this.collect(e);
        continue;
      }
      if (dx > 0.78) continue;
      if (e.kind === "pit" && this.y > 0.5) continue;
      if (e.kind === "barrier" && this.y > 0.55) continue;
      if ((e.kind === "scaffold" || e.kind === "sign") && this.sliding > 0.02) continue;
      if (e.kind === "cone" && this.y > 1.25) continue;
      if (this.hat) {
        this.hat = false;
        this.invuln = 1.2;
        this.hitstop = 0.08;
        this.shake = Math.max(this.shake, 0.32);
        this.callout = "CASQUE";
        this.calloutT = 0.9;
        this.sfx.smack();
        this.burst(e.x, 0.8, e.z, 0xffc83d, 10, 3);
        this.release(e);
        if (navigator.vibrate) navigator.vibrate(18);
        return;
      }
      this.crash(e.kind as Cause, e);
      return;
    }
  }

  private collect(e: Ent) {
    if (e.kind === "coin") {
      this.coins += 1;
      this.sfx.coin();
      this.burst(e.x, 0.8, e.z, 0xfff6ea, 4, 1.4);
    } else if (e.kind === "poutine") {
      this.coins += 5;
      this.sfx.rich();
      this.callout = "POUTINE +5";
      this.calloutT = 0.8;
      this.burst(e.x, 0.8, e.z, 0xf2d15a, 8, 2);
    } else if (e.kind === "hat") {
      this.hat = true;
      this.sfx.power();
      this.callout = "CASQUE";
      this.calloutT = 0.9;
    } else if (e.kind === "magnet") {
      this.magnetT = 8;
      this.sfx.power();
      this.callout = "AIMANT";
      this.calloutT = 0.9;
    }
    if (navigator.vibrate && (e.kind === "coin" || e.kind === "poutine")) navigator.vibrate(8);
    this.release(e);
  }

  private crash(kind: Cause, e: Ent) {
    this.phase = "dead";
    this.cause = kind;
    this.deathT = 0;
    this.hitstop = 0.1;
    this.shake = 0.6;
    this.vy = 6.5;
    this.grounded = false;
    this.sfx.fadeOut(0.35);
    this.sfx.fail();
    this.burst(e.x, 0.9, 0, 0xff5a1f, 18, 4.2);
    const score = Math.floor(this.meters) + this.coins * 10 + this.nears * 25;
    if (score > this.best) {
      this.best = score;
      this.newBest = true;
      this.persist();
    }
    if (navigator.vibrate) navigator.vibrate(46);
    this.release(e);
    this.emit(true);
  }

  private autopilot() {
    let nearest: Ent | null = null;
    let bestD = 1e9;
    for (const e of this.ents) {
      if (!e.alive) continue;
      if (e.kind === "coin" || e.kind === "poutine" || e.kind === "hat" || e.kind === "magnet") continue;
      if (e.z > -0.4 || e.z < -this.speed * 1.35) continue;
      if (Math.abs(e.x - this.player.position.x) > 0.9) continue;
      const d = -e.z;
      if (d < bestD) {
        bestD = d;
        nearest = e;
      }
    }
    if (!nearest) return;
    if (nearest.kind === "pit" || nearest.kind === "barrier") {
      this.jumpBuffer = 0.14;
      return;
    }
    if (nearest.kind === "scaffold" || nearest.kind === "sign") {
      this.slideBuffer = 0.14;
      return;
    }
    const options = ([-1, 0, 1] as const)
      .filter((lane) => lane !== this.laneTarget && !this.laneThreat(lane, nearest.z))
      .sort((a, b) => Math.abs(a - this.laneTarget) - Math.abs(b - this.laneTarget));
    if (options.length) this.laneTarget = options[0];
  }

  private laneThreat(lane: number, zRef: number) {
    const x = lane * LANE;
    for (const e of this.ents) {
      if (!e.alive) continue;
      if (e.kind === "coin" || e.kind === "poutine" || e.kind === "hat" || e.kind === "magnet") continue;
      if (Math.abs(e.z - zRef) > 2.4) continue;
      if (Math.abs(e.x - x) < 0.8) return true;
    }
    return false;
  }

  private fillRoad() {
    let guard = 0;
    while (this.horizon > -108 && guard < 8) {
      const pattern = this.nextPattern();
      const squeeze = this.phase === "playing" ? Math.max(0.74, 1 - this.meters / 4200) : 1;
      const len = pattern.len * squeeze;
      for (const s of pattern.spawns) {
        this.spawn(s.kind, s.lane, this.horizon - (5 + s.z) * squeeze, s.hint);
      }
      this.horizon -= len;
      guard += 1;
    }
  }

  private nextPattern(): Pattern {
    if (this.script.length) return this.script.shift()!;
    // Spawn a little before the mouth so the first columns are waiting inside it, not on the street.
    if (this.phase === "playing" && this.scenic >= SUBWAY_AT_M - 70) {
      return SUBWAY_PATTERNS[Math.floor(this.rng() * SUBWAY_PATTERNS.length)];
    }
    const pool = PATTERNS.filter((p) => this.meters >= p.min || this.phase === "attract");
    const usable = (this.phase === "attract" ? PATTERNS.filter((p) => p.min === 0) : pool);
    const pickFrom = usable.length ? usable : PATTERNS;
    return pickFrom[Math.floor(this.rng() * pickFrom.length)];
  }

  private spawn(kind: Kind, lane: number, z: number, hint?: string) {
    const ent = this.ents.find((e) => !e.alive);
    if (!ent) return;
    ent.kind = kind;
    ent.alive = true;
    ent.lane = lane;
    ent.x = lane * LANE;
    ent.z = z;
    ent.hint = hint;
    ent.hintShown = false;
    ent.scored = false;
    ent.mesh.visible = true;
    ent.mesh.position.set(ent.x, 0, z);
    ent.mesh.rotation.set(0, 0, 0);
    this.dress(ent);
  }

  private dress(ent: Ent) {
    const show = (name: string) => {
      ent.mesh.children.forEach((child) => {
        child.visible = child.name === name;
      });
    };
    show(ent.kind);
    if (ent.kind === "pit") {
      const pit = ent.mesh.getObjectByName("pit");
      if (pit) pit.rotation.y = Math.abs(Math.sin(ent.z * 12.989)) * Math.PI * 2;
    }
    if (ent.kind === "sign" && this.signMats.length) {
      const board = ent.mesh.getObjectByName("board");
      if (board instanceof THREE.Mesh) {
        const i = Math.abs(Math.floor(ent.z * 1.7)) % this.signMats.length;
        board.material = this.signMats[i];
      }
    }
  }

  private release(ent: Ent) {
    ent.alive = false;
    ent.mesh.visible = false;
    ent.mesh.position.set(0, -20, 0);
  }

  private poolEntities() {
    const blueprints: Kind[] = [
      "cone",
      "pit",
      "barrier",
      "scaffold",
      "truck",
      "pillar",
      "sign",
      "coin",
      "poutine",
      "hat",
      "magnet",
    ];
    for (let i = 0; i < 52; i += 1) {
      const mesh = new THREE.Group();
      for (const kind of blueprints) {
        const piece = this.makeKind(kind);
        piece.name = kind;
        piece.visible = false;
        mesh.add(piece);
      }
      mesh.visible = false;
      this.scene.add(mesh);
      this.ents.push({
        kind: "cone",
        alive: false,
        x: 0,
        z: -50,
        lane: 0,
        mesh,
        hintShown: false,
        scored: false,
      });
    }
  }

  private collideHints() {
    if (this.phase !== "playing" || this.best > 350) return;
    for (const e of this.ents) {
      if (!e.alive || !e.hint || e.hintShown) continue;
      if (e.z > -18 && e.z < -7) {
        e.hintShown = true;
        this.hint = e.hint;
        this.hintT = 1.45;
        this.emit(true);
      }
    }
  }

  private render() {
    this.collideHints();
    const aspect = this.camera.aspect;
    const portrait = aspect < 0.9;
    const attract = this.phase === "attract";
    const fov = portrait ? 64 : 52;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const px = this.player.position.x;
    if (attract && portrait) {
      this.camBase.set(0.85, 2.65, 5.15);
      this.look.set(0.05, 0.85, -8);
    } else if (portrait) {
      this.camBase.set(px * 0.3 + 0.7, 2.45, 4.65);
      this.look.set(px * 0.08, 0.85, -7.5);
    } else if (attract) {
      this.camBase.set(px * 0.15 + 1.15, 2.55, 5.05);
      this.look.set(px * 0.05, 0.95, -8);
    } else {
      this.camBase.set(px * 0.22 + 1.2, 2.4, 4.75);
      this.look.set(px * 0.06, 0.95, -8);
    }
    if (!this.reduceMotion && this.shake > 0.001) {
      this.camBase.x += (Math.random() - 0.5) * this.shake;
      this.camBase.y += (Math.random() - 0.5) * this.shake * 0.6;
    }
    this.camera.position.lerp(this.camBase, 0.22);
    this.camera.lookAt(this.look);
    const phase = 1.0 + Math.PI * 2 * (this.meters / 1400 + this.time / 120);
    this.landmarks.drift.position.x = -21 + 41 * Math.sin(phase);
    this.landmarks.update(this.time);
    for (const c of this.clouds) {
      c.position.x += 0.012;
      if (c.position.x > 420) c.position.x = -420;
    }
    this.updateAtmosphere();
    this.renderer.render(this.scene, this.camera);
  }

  private burst(x: number, y: number, z: number, color: number, n: number, spd: number) {
    let left = n;
    for (let i = 0; i < this.parts.length && left > 0; i += 1) {
      const p = this.parts[i];
      if (p.life > 0) continue;
      p.life = 0.28 + Math.random() * 0.28;
      p.max = p.life;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = (Math.random() - 0.5) * spd;
      p.vy = Math.random() * spd * 0.9 + 0.4;
      p.vz = (Math.random() - 0.5) * spd;
      this.partMesh.setColorAt(i, new THREE.Color(color));
      left -= 1;
    }
    if (this.partMesh.instanceColor) this.partMesh.instanceColor.needsUpdate = true;
  }

  private updateParticles(dt: number) {
    for (let i = 0; i < this.parts.length; i += 1) {
      const p = this.parts[i];
      if (p.life <= 0) {
        this.partDummy.position.set(0, -30, 0);
        this.partDummy.scale.setScalar(0.001);
      } else {
        p.life -= dt;
        p.vy -= 9 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        this.partDummy.position.set(p.x, p.y, p.z);
        this.partDummy.scale.setScalar(Math.max(0.01, p.life / p.max));
        this.partDummy.rotation.set(p.life * 4, p.life * 3, 0);
      }
      this.partDummy.updateMatrix();
      this.partMesh.setMatrixAt(i, this.partDummy.matrix);
    }
    this.partMesh.instanceMatrix.needsUpdate = true;
  }

  private pollInput() {
    const pad = navigator.getGamepads?.()[0] ?? null;
    let left = this.held("ArrowLeft") || this.held("KeyA");
    let right = this.held("ArrowRight") || this.held("KeyD");
    let jump = this.held("ArrowUp") || this.held("KeyW") || this.held("Space");
    let slide = this.held("ArrowDown") || this.held("KeyS");
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (ax < -0.45 || pad.buttons[14]?.pressed) left = true;
      if (ax > 0.45 || pad.buttons[15]?.pressed) right = true;
      if (pad.buttons[0]?.pressed || pad.buttons[12]?.pressed) jump = true;
      if (pad.buttons[1]?.pressed || pad.buttons[13]?.pressed) slide = true;
    }
    if (this.phase === "playing") {
      if (left && !this.prevLeft) this.laneTarget = Math.max(-1, this.laneTarget - 1);
      if (right && !this.prevRight) this.laneTarget = Math.min(1, this.laneTarget + 1);
      if (jump && !this.prevJump) this.jumpBuffer = 0.14;
      if (slide && !this.prevSlide) this.slideBuffer = 0.14;
    }
    this.prevLeft = left;
    this.prevRight = right;
    this.prevJump = jump;
    this.prevSlide = slide;
  }

  private held(code: string) {
    return this.keyDown.has(code) || this.qaKeys.has(code);
  }

  private onKeyDown(e: KeyboardEvent) {
    const block = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "KeyW", "KeyA", "KeyS", "KeyD"];
    if (block.includes(e.code)) e.preventDefault();
    this.keyDown.add(e.code);
    if (e.code === "KeyM") this.toggleMute();
    if (this.phase === "playing" && (e.code === "Escape" || e.code === "KeyP")) this.pause();
    else if (this.phase === "paused" && (e.code === "Escape" || e.code === "KeyP" || e.code === "Enter" || e.code === "Space"))
      this.resume();
    else if ((this.phase === "attract" || this.phase === "dead") && (e.code === "Enter" || e.code === "Space")) {
      this.sfx.unlock();
      this.play();
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    this.keyDown.delete(e.code);
  }

  private onBlur() {
    this.keyDown.clear();
  }

  private onVis() {
    if (document.hidden && this.phase === "playing") this.pause();
    if (!document.hidden) this.sfx.resumeCtx();
  }

  private onPointerDown(e: PointerEvent) {
    const target = e.target as HTMLElement | null;
    if (target?.closest("button")) return;
    this.swipeId = e.pointerId;
    this.swipeX = e.clientX;
    this.swipeY = e.clientY;
    this.swipeUsed = false;
  }

  private onPointerMove(e: PointerEvent) {
    if (e.pointerId !== this.swipeId || this.swipeUsed || this.phase !== "playing") return;
    const dx = e.clientX - this.swipeX;
    const dy = e.clientY - this.swipeY;
    if (Math.hypot(dx, dy) < 28) return;
    this.swipeUsed = true;
    if (Math.abs(dx) > Math.abs(dy) * 1.05) this.nudge(dx < 0 ? "left" : "right");
    else this.nudge(dy < 0 ? "jump" : "slide");
  }

  private onPointerUp(e: PointerEvent) {
    if (e.pointerId === this.swipeId) this.swipeId = null;
  }

  private onResize() {
    this.resize();
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    let pr = Math.min(window.devicePixelRatio || 1, 2);
    if (w * pr > 1100) pr = 1100 / w;
    if (h * pr > 1800) pr = Math.min(pr, 1800 / h);
    pr = Math.max(0.6, pr);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  private lambert(color: string, rough = 0.82) {
    return this.mat(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 }));
  }

  private buildSky() {
    const geo = this.geo(new THREE.SphereGeometry(1000, 32, 20));
    const mat = this.mat(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color("#2f78c4") },
          mid: { value: new THREE.Color("#7fb4e0") },
          hor: { value: new THREE.Color(HAZE) },
        },
        vertexShader:
          "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader:
          "varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 hor; void main(){ float h = max(normalize(vP).y, 0.0); vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, h)); c = mix(c, top, smoothstep(0.18, 0.75, h)); gl_FragColor = vec4(c, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}",
      }),
    );
    const dome = new THREE.Mesh(geo, mat);
    dome.renderOrder = -10;
    this.scene.add(dome);

    // Image-based lighting from the sky itself: gives glass, water and paint a real sky reflection.
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(geo, mat));
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = this.pmrem.fromScene(envScene, 0, 1, 2000);
    this.scene.environment = this.envRT.texture;

    const ct = cloudTexture();
    this.texs.push(ct);
    const cloudMat = this.mat(
      new THREE.SpriteMaterial({ map: ct, transparent: true, opacity: 0.92, depthWrite: false, fog: false }),
    );
    for (let i = 0; i < 9; i += 1) {
      const sp = new THREE.Sprite(cloudMat);
      const w = 150 + (i % 3) * 50;
      sp.scale.set(w, w * 0.42, 1);
      sp.position.set(-330 + i * 85, 95 + (i % 4) * 26, -520 - (i % 3) * 120);
      this.scene.add(sp);
      this.clouds.push(sp);
    }
  }

  private buildVista() {
    this.landmarks = buildLandmarks(mulberry32(0x4d54));
    this.geos.push(...this.landmarks.geos);
    this.mats.push(...this.landmarks.mats);
    this.texs.push(...this.landmarks.texs);
    this.landmarks.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.receiveShadow = false;
    });
    this.scene.add(this.landmarks.group);
  }

  private buildFacadeSets() {
    const sets: [FacadeStyle, string, boolean][] = [
      ["brick", "#9c4636", true],
      ["brick", "#b5694a", true],
      ["brick", "#7a4a3a", false],
      ["brick", "#a9553b", true],
      ["stone", "#cdbfa8", false],
      ["stone", "#9a9588", false],
      ["modern", "#59646f", false],
    ];
    const rng = mulberry32(31);
    for (const [style, base, bal] of sets) {
      const tex = facadeTexture(style, base, rng, bal);
      this.texs.push(tex);
      this.facades.push({ tex, style, base });
    }
    for (let i = 0; i < 3; i += 1) {
      const t = shopTexture(rng);
      this.texs.push(t);
      this.shopTexs.push(t);
    }
  }

  private buildChunk(index: number) {
    const rng = mulberry32(1000 + index * 97);
    const group = new THREE.Group();
    group.position.z = -index * LEN;
    const asphalt = this.mat(new THREE.MeshStandardMaterial({ map: this.asphaltTex, roughness: 0.9, metalness: 0 }));
    const road = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(ROAD_HALF * 2, LEN)), asphalt);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0;
    road.receiveShadow = true;
    group.add(road);
    const street = new THREE.Group();
    group.add(street);
    const sideMat = this.mat(new THREE.MeshStandardMaterial({ map: this.walkTex, roughness: 0.9, metalness: 0 }));
    for (const side of [-1, 1]) {
      const walk = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1.7, LEN)), sideMat);
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(side * (ROAD_HALF + 0.85), 0.02, 0);
      walk.receiveShadow = true;
      street.add(walk);
      const curb = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.16, 0.14, LEN)), this.lambert("#9b968d", 0.9));
      curb.position.set(side * (ROAD_HALF + 0.05), 0.06, 0);
      curb.receiveShadow = true;
      street.add(curb);
    }
    const white = this.lambert("#f4efe8", 0.55);
    const yellow = this.lambert("#f0c43a");
    for (const x of [-ROAD_HALF + 0.08, ROAD_HALF - 0.08]) {
      const edge = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.08, 0.025, LEN)), yellow);
      edge.position.set(x, 0.03, 0);
      street.add(edge);
    }
    const dashes = Math.floor(LEN / 4);
    for (let i = 0; i < dashes; i += 1) {
      const z = -LEN / 2 + i * 4 + 1.2;
      for (const x of [-LANE / 2, LANE / 2]) {
        const dash = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.1, 0.03, 1.5)), white);
        dash.position.set(x, 0.03, z);
        street.add(dash);
      }
    }
    if (index % 3 === 1) {
      for (let i = 0; i < 6; i += 1) {
        const bar = new THREE.Mesh(this.geo(new THREE.BoxGeometry(ROAD_HALF * 2 - 0.2, 0.02, 0.35)), white);
        bar.position.set(0, 0.035, -4 + i * 0.7);
        street.add(bar);
      }
    }
    for (const side of [-1, 1] as const) {
      for (let k = 0; k < 4; k += 1) {
        const drum = this.makeBarrel(0.55);
        drum.position.set(side * (ROAD_HALF + 0.35), 0, -LEN / 2 + 4 + k * 6.2);
        if (k === 2 && side === 1) {
          drum.rotation.z = 1.15;
          drum.position.y = 0.22;
        }
        drum.traverse((m) => {
          if (m instanceof THREE.Mesh) m.castShadow = true;
        });
        street.add(drum);
      }
      const tree = this.makeTree(rng);
      tree.traverse((m) => {
        if (m instanceof THREE.Mesh) m.castShadow = true;
      });
      tree.position.set(side * (ROAD_HALF + 1.15), 0, -6 + side * 4);
      street.add(tree);
      if (rng() > 0.4) {
        const tree2 = this.makeTree(rng);
        tree2.position.set(side * (ROAD_HALF + 1.25), 0, 8);
        street.add(tree2);
      }
    }
    const lots = buildStreetLots(this.meshKit(), rng, LEN, ROAD_HALF, this.facades, this.shopTexs);
    for (const lot of lots) group.add(lot.triplex, lot.downtown);
    const labels = ["TRAVAUX", "DÉTOUR", "RUE BARRÉE", "CONES"];
    const sign = this.makeSign(labels[index % labels.length]);
    const side = index % 2 === 0 ? -1 : 1;
    sign.position.set(side * (ROAD_HALF + 1.15), 0, 2);
    sign.rotation.y = side === -1 ? Math.PI / 2 : -Math.PI / 2;
    street.add(sign);

    if (index % 2 === 0) {
      const steamMat = this.mat(
        new THREE.MeshBasicMaterial({
          color: 0xe7eef4,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
        }),
      );
      const puff = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.28, 8, 6)), steamMat);
      const grate = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.35, 10)), this.lambert("#1a1917"));
      grate.rotation.x = -Math.PI / 2;
      grate.position.set(side * (ROAD_HALF + 0.7), 0.03, -8);
      puff.position.set(grate.position.x, 0.4, grate.position.z);
      street.add(grate, puff);
      this.steam.push({ mesh: puff, t: index * 0.37 });
    }

    const tunnel = this.addTunnel();
    tunnel.visible = false;
    group.add(tunnel);
    this.chunkRecs.push({ group, street, tunnel, road, lots });
    this.scene.add(group);
    return group;
  }

  private meshKit() {
    return {
      geo: <T extends THREE.BufferGeometry>(g: T) => this.geo(g),
      mat: <T extends THREE.Material>(m: T) => this.mat(m),
      tex: (t: THREE.Texture) => {
        this.texs.push(t);
      },
    };
  }

  /** Stage mix, distance shrink, and the tunnel mouth. Called after the chunks have scrolled. */
  private updateScenery() {
    for (const rec of this.chunkRecs) {
      const mark = this.scenic - rec.group.position.z;
      const env = envAt(mark);
      const inTunnel = subwayAmount(env) >= 0.5;
      const down = downtownAmount(env);
      rec.street.visible = !inTunnel;
      rec.tunnel.visible = inTunnel;
      rec.road.visible = !inTunnel;
      for (const lot of rec.lots) {
        const cut = (lot.z + LEN / 2) / LEN;
        const showDown = down >= 0.999 || cut < down;
        lot.downtown.visible = !inTunnel && showDown;
        lot.triplex.visible = !inTunnel && !showDown;
        const wz = rec.group.position.z + lot.z;
        const far = Math.min(1, Math.max(0, (-wz - 55) / 110));
        const f = 1 - 0.82 * far * far * (3 - 2 * far);
        if (Math.abs(lot.triplex.scale.y - f) > 0.002) lot.triplex.scale.y = f;
        if (Math.abs(lot.downtown.scale.y - f) > 0.002) lot.downtown.scale.y = f;
      }
    }
    if (this.portal) {
      const z = this.scenic - SUBWAY_AT_M;
      this.portal.position.z = z;
      this.portal.visible = this.phase !== "attract" && z < 12 && z > -80;
    }
  }

  private updateTrain(shift: number) {
    if (!this.train || this.phase === "attract") {
      if (this.train) this.train.visible = false;
      return;
    }
    if (!this.trainOn && this.phase === "playing" && this.scenic >= SUBWAY_AT_M + 50 && this.scenic >= this.nextTrainM) {
      this.trainOn = true;
      this.trainZ = -98;
      this.trainSide = Math.random() < 0.5 ? -1 : 1;
    }
    if (this.trainOn) {
      this.trainZ += shift * 1.72;
      if (this.trainZ > 20) {
        this.trainOn = false;
        this.nextTrainM = this.scenic + 260 + Math.random() * 220;
      }
    }
    const show = this.trainOn && this.scenic > SUBWAY_AT_M - 30;
    this.train.visible = show;
    if (show) this.train.position.set(this.trainSide * 4.15, 0, this.trainZ);
  }

  /** Daylight gives way to a dim, flickering tunnel, with a short blackout as you cross the mouth. */
  private updateAtmosphere() {
    const dist = this.scenic - SUBWAY_AT_M;
    const t = smoothstep(dist, -42, 14);
    const dark = this.phase === "attract" ? 0 : Math.exp(-(dist * dist) / 56);
    const flicker = this.reduceMotion ? 1 : fluorFlicker(this.time);
    const dim = 1 - dark * 0.88;
    this.hemi.color.copy(this.streetHemi).lerp(this.tunnelHemi, t);
    this.hemi.groundColor.copy(this.streetGround).lerp(this.tunnelGround, t);
    this.hemi.intensity = (0.5 + (0.62 - 0.5) * t) * dim;
    this.sun.intensity = (3.3 + (0.55 - 3.3) * t) * (1 - dark * 0.94);
    this.rim.intensity = (0.5 * (1 - t)) * (1 - dark);
    this.lamp.intensity = 34 * t * flicker * (1 - dark * 0.96);
    this.lamp.visible = t > 0.08;
    this.lamp.position.set(this.player.position.x * 0.25, 3.02, -5);
    if (this.fluor) this.fluor.emissiveIntensity = (0.4 + 2.1 * t) * flicker * (1 - dark * 0.92);
    this.tmpFog.copy(this.hazeColor).lerp(this.tunnelFog, t);
    if (dark > 0.01) this.tmpFog.lerp(this.darkColor, dark * 0.86);
    this.fog.color.copy(this.tmpFog);
    this.fog.near = 55 + (22 - 55) * t;
    this.fog.far = 760 + (128 - 760) * t;
    this.bg.copy(this.tmpFog);
    this.renderer.setClearColor(this.bg);
    this.renderer.toneMappingExposure = (1.05 + (0.96 - 1.05) * t) * (1 - dark * 0.72);
    this.scene.environmentIntensity = 0.32 * (1 - t * 0.85);
    const buried = t > 0.82;
    this.landmarks.group.visible = !buried;
    for (const c of this.clouds) c.visible = t < 0.4;
  }

  private ensureTunnelAssets() {
    if (this.tunnelBuilt) return;
    this.tunnelBuilt = true;
    const wallTex = tunnelConcreteTexture(mulberry32(21));
    wallTex.repeat.set(LEN / 4, 1.4);
    this.texs.push(wallTex);
    const ballast = ballastTexture(mulberry32(22));
    ballast.repeat.set(4, LEN / 4);
    this.texs.push(ballast);
    this.fluor = this.mat(
      new THREE.MeshStandardMaterial({
        color: "#d7e4f2",
        emissive: "#eaf3ff",
        emissiveIntensity: 0.9,
        roughness: 0.35,
      }),
    );
    const wallMat = this.mat(
      new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide }),
    );
    const floorMat = this.mat(new THREE.MeshStandardMaterial({ map: ballast, roughness: 0.96, metalness: 0 }));
    const ceilMat = this.lambert("#2a2e34", 0.9);
    const concrete = this.lambert("#4a5058", 0.88);
    const railMat = this.mat(
      new THREE.MeshStandardMaterial({ color: "#d5dde6", roughness: 0.28, metalness: 0.82, emissive: "#9aa8b8", emissiveIntensity: 0.18 }),
    );
    const sleeperMat = this.lambert("#3e342c", 0.96);
    const yellow = this.lambert("#d7a400", 0.55);
    this.tunnelWallMat = wallMat;
    this.tunnelFloorMat = floorMat;
    this.tunnelCeilMat = ceilMat;
    this.tunnelConcrete = concrete;
    this.railMat = railMat;
    this.sleeperMat = sleeperMat;
    this.safetyYellow = yellow;
    this.railGeo = this.geo(new THREE.BoxGeometry(0.045, 0.05, LEN));
    this.sleeperGeo = this.geo(new THREE.BoxGeometry(0.78, 0.035, 0.16));
    this.columnGeo = this.geo(new THREE.BoxGeometry(0.32, 3.45, 0.32));
    this.lampGeo = this.geo(new THREE.BoxGeometry(0.16, 0.05, 1.35));
    this.wallGeo = this.geo(new THREE.PlaneGeometry(LEN, 3.55));
    this.ceilGeo = this.geo(new THREE.PlaneGeometry(11.3, LEN));
  }

  private tunnelWallMat!: THREE.Material;
  private tunnelFloorMat!: THREE.Material;
  private tunnelCeilMat!: THREE.Material;
  private tunnelConcrete!: THREE.Material;
  private railMat!: THREE.Material;
  private sleeperMat!: THREE.Material;
  private safetyYellow!: THREE.Material;
  private railGeo!: THREE.BufferGeometry;
  private sleeperGeo!: THREE.BufferGeometry;
  private columnGeo!: THREE.BufferGeometry;
  private lampGeo!: THREE.BufferGeometry;
  private wallGeo!: THREE.BufferGeometry;
  private ceilGeo!: THREE.BufferGeometry;

  /** Walls, ceiling, a centre-bore colonnade, rails in the lane gaps, and a side track for the train. */
  private addTunnel() {
    this.ensureTunnelAssets();
    const g = new THREE.Group();
    const floor = new THREE.Mesh(this.ceilGeo, this.tunnelFloorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;
    floor.receiveShadow = true;
    g.add(floor);
    const ceil = new THREE.Mesh(this.ceilGeo, this.tunnelCeilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = 3.48;
    g.add(ceil);
    const duct = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.35, 0.12, LEN)), this.tunnelConcrete);
    duct.position.set(0, 3.38, 0);
    g.add(duct);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(this.wallGeo, this.tunnelWallMat);
      wall.position.set(side * 5.55, 1.78, 0);
      wall.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
      g.add(wall);
      const stripe = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.06, 0.1, LEN)), this.safetyYellow);
      stripe.position.set(side * 5.42, 0.18, 0);
      g.add(stripe);
    }
    const placeRail = (x: number) => {
      const rail = new THREE.Mesh(this.railGeo, this.railMat);
      rail.position.set(x, 0.072, 0);
      g.add(rail);
    };
    for (const center of [-LANE / 2, LANE / 2, -4.15, 4.15]) {
      placeRail(center - 0.26);
      placeRail(center + 0.26);
    }
    const tracks = [-LANE / 2, LANE / 2, -4.15, 4.15];
    const per = Math.floor(LEN / 1.15);
    const sleepers = new THREE.InstancedMesh(this.sleeperGeo, this.sleeperMat, per * tracks.length);
    sleepers.frustumCulled = false;
    const dummy = new THREE.Object3D();
    let n = 0;
    for (const cx of tracks) {
      const wide = Math.abs(cx) > 3;
      for (let s = 0; s < per; s += 1) {
        dummy.position.set(cx, 0.045, -LEN / 2 + 0.5 + s * 1.15);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(wide ? 1.45 : 1, 1, 1);
        dummy.updateMatrix();
        sleepers.setMatrixAt(n, dummy.matrix);
        n += 1;
      }
    }
    sleepers.instanceMatrix.needsUpdate = true;
    g.add(sleepers);
    const cols = 6;
    const columns = new THREE.InstancedMesh(this.columnGeo, this.tunnelConcrete, cols * 2);
    columns.frustumCulled = false;
    n = 0;
    for (const side of [-1, 1]) {
      for (let s = 0; s < cols; s += 1) {
        dummy.position.set(side * 2.95, 1.72, -LEN / 2 + 2.4 + s * (LEN / cols));
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        columns.setMatrixAt(n, dummy.matrix);
        n += 1;
      }
    }
    columns.instanceMatrix.needsUpdate = true;
    g.add(columns);
    const lamps = new THREE.InstancedMesh(this.lampGeo, this.fluor, 4);
    lamps.frustumCulled = false;
    for (let s = 0; s < 4; s += 1) {
      dummy.position.set(0, 3.28, -LEN / 2 + 4 + s * 7.2);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      lamps.setMatrixAt(s, dummy.matrix);
    }
    lamps.instanceMatrix.needsUpdate = true;
    g.add(lamps);
    return g;
  }

  private buildPortal() {
    const g = new THREE.Group();
    const concrete = this.lambert("#8d949e", 0.8);
    const dark = this.lambert("#14171c", 0.95);
    for (const x of [-3.62, 3.62]) {
      const jamb = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.48, 3.55, 0.62)), concrete);
      jamb.position.set(x, 1.78, 0);
      g.add(jamb);
    }
    const lintel = new THREE.Mesh(this.geo(new THREE.BoxGeometry(7.75, 0.48, 0.66)), concrete);
    lintel.position.set(0, 3.4, 0);
    g.add(lintel);
    const lip = new THREE.Mesh(this.geo(new THREE.BoxGeometry(6.7, 0.16, 0.28)), dark);
    lip.position.set(0, 3.08, 0.28);
    g.add(lip);
    const tex = metroSignTexture("MÉTRO");
    this.texs.push(tex);
    const board = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(2.4, 0.72)),
      this.mat(new THREE.MeshBasicMaterial({ map: tex })),
    );
    board.position.set(0, 2.95, 0.52);
    g.add(board);
    const glowMat = this.mat(
      new THREE.MeshStandardMaterial({ color: "#ffb080", emissive: "#ff7a3c", emissiveIntensity: 1.4 }),
    );
    for (const x of [-2.4, 2.4]) {
      const bulb = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.08, 8, 6)), glowMat);
      bulb.position.set(x, 3.22, 0.36);
      g.add(bulb);
    }
    g.visible = false;
    this.portal = g;
    this.scene.add(g);
  }

  private buildTrain() {
    const g = new THREE.Group();
    const bodyMat = this.mat(new THREE.MeshStandardMaterial({ color: "#e8eef3", roughness: 0.42, metalness: 0.22 }));
    const doorMat = this.lambert("#ff5a1f", 0.48);
    const winMat = this.mat(
      new THREE.MeshStandardMaterial({
        color: "#1b2836",
        roughness: 0.12,
        metalness: 0.45,
        emissive: "#d5e6f4",
        emissiveIntensity: 0.7,
      }),
    );
    const under = this.lambert("#1a1c20", 0.8);
    const stripe = this.lambert("#ff5a1f", 0.45);
    const carLen = 6.3;
    const gap = 0.38;
    for (let i = 0; i < 3; i += 1) {
      const z = (i - 1) * (carLen + gap);
      const body = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.58, 2.05, carLen)), bodyMat);
      body.position.set(0, 1.48, z);
      const skirt = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.68, 0.32, carLen)), under);
      skirt.position.set(0, 0.42, z);
      const roof = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.2, 0.06, carLen * 0.92)), stripe);
      roof.position.set(0, 2.54, z);
      g.add(body, skirt, roof);
      for (const dz of [-1.35, 1.35]) {
        for (const x of [-0.8, 0.8]) {
          const door = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.03, 1.45, 0.72)), doorMat);
          door.position.set(x, 1.32, z + dz);
          g.add(door);
        }
      }
      for (const x of [-0.81, 0.81]) {
        const win = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.03, 0.48, carLen * 0.72)), winMat);
        win.position.set(x, 1.9, z);
        g.add(win);
      }
    }
    const frontZ = carLen + gap + carLen / 2;
    const lampMat = this.mat(
      new THREE.MeshStandardMaterial({ color: "#fff4d2", emissive: "#ffe7a2", emissiveIntensity: 1.8 }),
    );
    for (const x of [-0.42, 0.42]) {
      const head = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.16, 0.1, 0.05)), lampMat);
      head.position.set(x, 1.15, frontZ);
      g.add(head);
    }
    g.visible = false;
    this.train = g;
    this.scene.add(g);
  }

  private makeTree(rng: () => number) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      this.geo(new THREE.CylinderGeometry(0.09, 0.17, 1.6, 8)),
      this.lambert("#4b3b2f", 1),
    );
    trunk.position.y = 0.8;
    g.add(trunk);
    const palette = [
      ["#c9772b", "#e0a247"],
      ["#a8402c", "#d1662f"],
      ["#6f8f3c", "#98b24a"],
      ["#c98f2d", "#e8c45a"],
    ];
    const pick = palette[Math.floor(rng() * palette.length)];
    const lo = new THREE.Color(pick[0]);
    const hi = new THREE.Color(pick[1]);
    const mat = this.mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    const c = new THREE.Color();
    for (let i = 0; i < 5; i += 1) {
      const r = 0.5 + rng() * 0.25;
      const geo = this.geo(new THREE.IcosahedronGeometry(r, 2));
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const cols: number[] = [];
      const seed = rng() * 10;
      for (let v = 0; v < pos.count; v += 1) {
        const x = pos.getX(v);
        const y = pos.getY(v);
        const z = pos.getZ(v);
        const n = Math.sin(x * 9.1 + seed) * Math.cos(z * 8.3 + y * 4.1) * 0.5 + Math.sin((x + y + z) * 13) * 0.25;
        const k = 1 + n * 0.16;
        pos.setXYZ(v, x * k, y * k * 0.9, z * k);
        const t = Math.min(1, Math.max(0, (y / r) * 0.5 + 0.5 + n * 0.25));
        c.copy(lo).lerp(hi, t);
        cols.push(c.r, c.g, c.b);
      }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      geo.computeVertexNormals();
      const blob = new THREE.Mesh(geo, mat);
      const ang = (i / 5) * Math.PI * 2 + rng();
      const ring = i === 4 ? 0 : 0.38;
      blob.position.set(Math.cos(ang) * ring, 1.75 + (i === 4 ? 0.55 : rng() * 0.3), Math.sin(ang) * ring);
      g.add(blob);
    }
    return g;
  }

  private makeSign(text: string) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 128;
    const g = c.getContext("2d");
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.texs.push(tex);
    if (g) {
      g.fillStyle = "#ff5a1f";
      g.fillRect(0, 0, 256, 128);
      g.strokeStyle = "#1a120c";
      g.lineWidth = 10;
      g.strokeRect(8, 8, 240, 112);
      g.fillStyle = "#1a120c";
      g.font = "700 42px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, 128, 66);
    }
    const board = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(1.5, 0.75)),
      this.mat(new THREE.MeshBasicMaterial({ map: tex })),
    );
    board.position.y = 1.35;
    const post = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.05, 0.05, 1.15, 6)), this.lambert("#d5d8dd"));
    post.position.y = 0.58;
    const group = new THREE.Group();
    group.add(post, board);
    return group;
  }

  private makeBarrel(scale = 1) {
    if (!this.drumOrange || !this.drumSilver || !this.drumBlack) {
      this.drumOrange = this.lambert("#ff4a12", 0.5);
      this.drumSilver = this.mat(
        new THREE.MeshStandardMaterial({ color: "#e8eef3", roughness: 0.22, metalness: 0.78 }),
      );
      this.drumBlack = this.lambert("#161616", 0.92);
    }
    const orange = this.drumOrange;
    const silver = this.drumSilver;
    const black = this.drumBlack;
    const g = new THREE.Group();
    const base = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.78, 0.08, 0.78)), black);
    base.position.y = 0.04;
    const body = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.3, 0.34, 1.02, 14)), orange);
    body.position.y = 0.58;
    const lip = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.28, 0.3, 0.07, 14)), orange);
    lip.position.y = 1.1;
    const handle = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.09, 0.02, 6, 12)), orange);
    handle.rotation.x = Math.PI / 2;
    handle.position.y = 1.18;
    g.add(base, body, lip, handle);
    for (const y of [0.26, 0.48, 0.7, 0.92]) {
      const band = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.355, 0.37, 0.1, 14)), silver);
      band.position.y = y;
      g.add(band);
    }
    g.scale.setScalar(scale);
    return g;
  }

  private makePothole() {
    if (!this.pitProto) this.pitProto = this.createPothole();
    return this.pitProto.clone();
  }

  private createPothole() {
    const g = new THREE.Group();
    const tex = potholeTexture(mulberry32(11));
    this.texs.push(tex);
    const mat = this.mat(
      new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.97,
        metalness: 0.02,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    const dish = new THREE.Mesh(this.geo(potholeGeometry()), mat);
    dish.castShadow = true;
    dish.receiveShadow = true;
    const core = new THREE.Mesh(
      this.geo(new THREE.CircleGeometry(0.26, 16)),
      this.mat(new THREE.MeshBasicMaterial({ color: "#070605" })),
    );
    core.rotation.x = -Math.PI / 2;
    core.position.y = 0.062;
    g.add(dish, core);
    const crackMat = this.mat(new THREE.MeshBasicMaterial({ color: "#0b0a09" }));
    const crackGeo = this.geo(new THREE.BoxGeometry(0.03, 0.012, 0.46));
    for (const a of [0.32, 1.12, 2.02, 2.78, 3.85, 4.7, 5.55]) {
      const crack = new THREE.Mesh(crackGeo, crackMat);
      crack.position.set(Math.cos(a) * 0.9, 0.058, Math.sin(a) * 0.9);
      crack.rotation.y = Math.PI / 2 - a;
      g.add(crack);
    }
    const dark = this.lambert("#2a2826", 0.96);
    const light = this.lambert("#7a7368", 0.9);
    const chipGeo = this.geo(new THREE.BoxGeometry(1, 1, 1));
    const chips: [number, number, number, number, number, number, boolean][] = [
      [0.45, 0.76, 0.16, 0.05, 0.11, 0.13, true],
      [1.45, 0.66, 0.1, 0.07, 0.13, 0.1, false],
      [2.25, 0.84, 0.14, 0.045, 0.09, 0.12, true],
      [3.2, 0.58, 0.08, 0.06, 0.1, 0.09, false],
      [4.15, 0.8, 0.13, 0.05, 0.08, 0.125, true],
      [5.25, 0.7, 0.09, 0.08, 0.09, 0.11, false],
      [0.95, 0.3, 0.07, 0.04, 0.06, 0.075, false],
    ];
    for (const [a, r, sx, sy, sz, y, pale] of chips) {
      const chip = new THREE.Mesh(chipGeo, pale ? light : dark);
      chip.scale.set(sx, sy, sz);
      chip.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      chip.rotation.set(0.35, a, 0.25);
      chip.castShadow = true;
      g.add(chip);
    }
    return g;
  }

  private makeKind(kind: Kind) {
    const g = new THREE.Group();
    if (kind === "cone") {
      g.add(this.makeBarrel(1));
    } else if (kind === "pit") {
      g.add(this.makePothole());
    } else if (kind === "pillar") {
      const shaft = new THREE.Mesh(
        this.geo(new THREE.BoxGeometry(0.62, 3.35, 0.62)),
        this.lambert("#6a7078", 0.9),
      );
      shaft.position.y = 1.68;
      const cap = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.78, 0.12, 0.78)), this.lambert("#5a6068", 0.85));
      cap.position.y = 3.28;
      const band = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.66, 0.16, 0.66)), this.lambert("#e0b000", 0.5));
      band.position.y = 0.28;
      const band2 = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.66, 0.1, 0.66)), this.lambert("#161616", 0.8));
      band2.position.y = 0.48;
      g.add(shaft, cap, band, band2);
    } else if (kind === "sign") {
      if (!this.signMats.length) {
        for (const name of STATION_NAMES) {
          const tex = metroSignTexture(name);
          this.texs.push(tex);
          this.signMats.push(this.mat(new THREE.MeshBasicMaterial({ map: tex })));
        }
      }
      const board = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1.55, 0.48)), this.signMats[0]);
      board.name = "board";
      board.position.y = 1.28;
      const hanger = this.lambert("#9aa3ad", 0.4);
      const bar = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.35, 0.05, 0.05)), hanger);
      bar.position.y = 2.15;
      for (const x of [-0.55, 0.55]) {
        const rod = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.02, 0.02, 0.78, 6)), hanger);
        rod.position.set(x, 1.72, 0);
        g.add(rod);
      }
      g.add(board, bar);
    } else if (kind === "barrier") {
      const body = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.4, 0.5, 0.36)), this.lambert("#ff5a1f"));
      body.position.y = 0.32;
      const stripe = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.42, 0.12, 0.4)), this.lambert("#f7f4ef"));
      stripe.position.y = 0.36;
      g.add(body, stripe);
    } else if (kind === "scaffold") {
      const beam = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.45, 0.2, 0.26)), this.lambert("#ff5a1f"));
      beam.position.y = 1.26;
      const stripe = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.45, 0.06, 0.28)), this.lambert("#ffc83d"));
      stripe.position.y = 1.26;
      const poleMat = this.lambert("#d5d8dd");
      const poleL = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.05, 0.05, 1.26, 6)), poleMat);
      poleL.position.set(-0.55, 0.63, 0);
      const poleR = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.05, 0.05, 1.26, 6)), poleMat);
      poleR.position.set(0.55, 0.63, 0);
      g.add(beam, stripe, poleL, poleR);
    } else if (kind === "truck") {
      const bed = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.5, 1.25, 2.2)), this.lambert("#8d949c"));
      bed.position.set(0, 1.0, -0.45);
      const cab = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.46, 1.1, 1.15)), this.lambert("#f0b429"));
      cab.position.set(0, 0.9, 1.15);
      const glass = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.3, 0.48, 0.08)), this.lambert("#1b2836"));
      glass.position.set(0, 1.12, 1.7);
      g.add(bed, cab, glass);
      const wheel = this.lambert("#1a1a1a");
      for (const [x, z] of [
        [-0.68, 0.7],
        [0.68, 0.7],
        [-0.68, -0.85],
        [0.68, -0.85],
      ] as const) {
        const w = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.26, 0.26, 0.22, 10)), wheel);
        w.rotation.z = Math.PI / 2;
        w.position.set(x, 0.26, z);
        g.add(w);
      }
    } else if (kind === "coin") {
      const cup = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.16, 0.13, 0.32, 10)), this.lambert("#f7f4ef"));
      cup.position.y = 0.72;
      const sleeve = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.175, 0.15, 0.14, 10)), this.lambert("#ff5a1f"));
      sleeve.position.y = 0.7;
      const lid = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 10)), this.lambert("#2a2420"));
      lid.position.y = 0.9;
      g.add(cup, sleeve, lid);
    } else if (kind === "poutine") {
      const box = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.42, 0.22, 0.32)), this.lambert("#b4332a"));
      box.position.y = 0.62;
      const fries = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.34, 0.1, 0.24)), this.lambert("#f2d15a"));
      fries.position.y = 0.76;
      const gravy = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.16, 0.06, 0.12)), this.lambert("#8a5a2a"));
      gravy.position.y = 0.84;
      g.add(box, fries, gravy);
    } else if (kind === "hat") {
      const dome = new THREE.Mesh(
        this.geo(new THREE.SphereGeometry(0.28, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2)),
        this.lambert("#ffe14a"),
      );
      dome.position.y = 0.78;
      const brim = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 14)), this.lambert("#f0c43a"));
      brim.position.y = 0.76;
      g.add(dome, brim);
    } else if (kind === "magnet") {
      const u = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.22, 0.07, 8, 16, Math.PI)), this.lambert("#d12b2b"));
      u.position.y = 0.86;
      u.rotation.z = Math.PI;
      const tipMat = this.lambert("#d5d8dd");
      const l = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.08, 0.16, 0.1)), tipMat);
      l.position.set(-0.22, 0.7, 0);
      const r = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.08, 0.16, 0.1)), tipMat);
      r.position.set(0.22, 0.7, 0);
      g.add(u, l, r);
    }
    return g;
  }

  private buildPlayer() {
    const skin = this.lambert("#e8b48a", 0.62);
    const skinShade = this.lambert("#c98462", 0.7);
    const lip = this.lambert("#c45a55", 0.5);
    const hair = this.lambert("#2a1a12", 0.9);
    const beanie = this.lambert("#1a1a1a", 0.8);
    const cuffMat = this.lambert("#3a3a3a", 0.65);
    const vest = this.lambert("#ff5a1f", 0.42);
    const silver = this.lambert("#f4f7fa", 0.2);
    const hoodie = this.lambert("#3e4c62", 0.75);
    const jean = this.lambert("#3d5278", 0.78);
    const jeanDark = this.lambert("#2a3c58", 0.82);
    const shoe = this.lambert("#f7f4ee", 0.35);
    const shoeDark = this.lambert("#1e1e22", 0.5);
    const sole = this.lambert("#ff5a1f", 0.5);
    const scarfC = this.lambert("#d23b32", 0.68);
    const eyeWhite = this.lambert("#fbfaf7", 0.28);
    const pupil = this.lambert("#1a120e", 0.25);
    const brow = this.lambert("#3a2418", 0.75);

    const ball = (r: number, mat: THREE.Material, seg = 12) =>
      new THREE.Mesh(this.geo(new THREE.SphereGeometry(r, seg, Math.max(8, seg - 2))), mat);
    const cap = (r: number, len: number, mat: THREE.Material) =>
      new THREE.Mesh(this.geo(new THREE.CapsuleGeometry(r, Math.max(0.04, len), 5, 10)), mat);
    const box = (w: number, h: number, d: number, mat: THREE.Material) =>
      new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, d)), mat);

    const hips = ball(0.1, jean);
    hips.scale.set(1.45, 0.7, 1.0);
    hips.position.y = 0.82;

    this.torsoPivot = new THREE.Group();
    this.torsoPivot.position.y = 0.92;

    const chest = cap(0.125, 0.34, hoodie);
    chest.scale.set(1.15, 1, 0.78);
    chest.position.y = 0.22;
    const vestBack = box(0.32, 0.38, 0.04, vest);
    vestBack.position.set(0, 0.24, 0.1);
    const vestFront = box(0.28, 0.3, 0.025, vest);
    vestFront.position.set(0, 0.25, -0.095);
    const stripeA = box(0.28, 0.04, 0.018, silver);
    stripeA.position.set(0, 0.34, 0.125);
    const stripeB = box(0.28, 0.04, 0.018, silver);
    stripeB.position.set(0, 0.16, 0.125);

    const shoulderL = ball(0.055, hoodie, 10);
    shoulderL.position.set(-0.2, 0.4, 0);
    const shoulderR = ball(0.055, hoodie, 10);
    shoulderR.position.set(0.2, 0.4, 0);

    const neck = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.045, 0.052, 0.1, 10)), skin);
    neck.position.y = 0.48;

    this.headPivot = new THREE.Group();
    this.headPivot.position.y = 0.6;
    this.headPivot.rotation.y = -0.55;
    const skull = ball(0.132, skin, 16);
    skull.scale.set(0.96, 1.16, 0.92);
    skull.position.y = 0.05;
    const jaw = ball(0.09, skin, 12);
    jaw.scale.set(0.95, 0.7, 0.85);
    jaw.position.set(0, -0.04, -0.02);
    const earL = ball(0.036, skinShade, 8);
    earL.scale.set(0.42, 1.25, 0.7);
    earL.position.set(-0.128, 0.04, 0);
    const earR = ball(0.036, skinShade, 8);
    earR.scale.set(0.42, 1.25, 0.7);
    earR.position.set(0.128, 0.04, 0);
    const hairL = ball(0.035, hair, 8);
    hairL.position.set(-0.09, -0.01, -0.03);
    const hairR = ball(0.035, hair, 8);
    hairR.position.set(0.09, -0.01, -0.03);
    const hat = ball(0.14, beanie, 14);
    hat.scale.set(1.02, 0.58, 1);
    hat.position.y = 0.14;
    const brim = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.136, 0.14, 0.048, 16)), cuffMat);
    brim.position.y = 0.075;
    const pom = ball(0.038, vest, 8);
    pom.position.y = 0.26;
    const eyeL = ball(0.03, eyeWhite, 10);
    eyeL.position.set(-0.048, 0.062, -0.108);
    const eyeR = ball(0.03, eyeWhite, 10);
    eyeR.position.set(0.048, 0.062, -0.108);
    const pupilL = ball(0.014, pupil, 8);
    pupilL.position.set(0.01, -0.04, -0.72);
    const pupilR = ball(0.014, pupil, 8);
    pupilR.position.set(0.01, -0.04, -0.72);
    const shineL = ball(0.008, eyeWhite, 6);
    shineL.position.set(0.28, 0.28, -0.7);
    const shineR = ball(0.008, eyeWhite, 6);
    shineR.position.set(0.28, 0.28, -0.7);
    eyeL.add(pupilL, shineL);
    eyeR.add(pupilR, shineR);
    this.eyeL = eyeL;
    this.eyeR = eyeR;
    const browL = box(0.052, 0.014, 0.012, brow);
    browL.position.set(-0.048, 0.108, -0.108);
    browL.rotation.z = 0.25;
    const browR = box(0.052, 0.014, 0.012, brow);
    browR.position.set(0.048, 0.108, -0.108);
    browR.rotation.z = -0.15;
    this.browL = browL;
    this.browR = browR;
    const nose = ball(0.028, skinShade, 8);
    nose.scale.set(0.7, 0.95, 1.2);
    nose.position.set(0, 0.012, -0.125);
    const mouth = box(0.05, 0.012, 0.012, lip);
    mouth.position.set(0.01, -0.048, -0.116);
    mouth.rotation.z = -0.4;
    this.mouth = mouth;
    const cheekL = ball(0.022, lip, 8);
    cheekL.position.set(-0.09, 0.01, -0.08);
    cheekL.scale.set(1, 0.7, 0.4);
    const cheekR = ball(0.022, lip, 8);
    cheekR.position.set(0.09, 0.01, -0.08);
    cheekR.scale.set(1, 0.7, 0.4);
    const tuft = ball(0.03, hair, 8);
    tuft.scale.set(0.7, 1.6, 0.7);
    tuft.position.set(0.08, 0.24, -0.02);
    tuft.rotation.z = -0.5;
    this.headPivot.add(
      skull, jaw, earL, earR, hairL, hairR, hat, brim, pom, tuft,
      eyeL, eyeR, browL, browR, nose, mouth, cheekL, cheekR,
    );

    const wrap = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.072, 0.02, 6, 12)), scarfC);
    wrap.rotation.x = Math.PI / 2;
    wrap.position.y = 0.44;
    this.scarf = new THREE.Group();
    this.scarf.position.set(0.05, 0.38, 0.08);
    const tailA = cap(0.02, 0.34, scarfC);
    tailA.position.y = -0.2;
    const tailB = cap(0.016, 0.26, scarfC);
    tailB.position.set(-0.04, -0.15, 0);
    tailB.rotation.z = 0.2;
    this.scarf.add(tailA, tailB);

    this.torsoPivot.add(
      chest, vestBack, vestFront, stripeA, stripeB,
      shoulderL, shoulderR, neck, wrap, this.headPivot, this.scarf,
    );

    const arm = (side: number) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.28, 0.38, 0);
      shoulder.rotation.z = side * 0.28;
      const upper = cap(0.04, 0.22, hoodie);
      upper.position.y = -0.16;
      const elbow = ball(0.042, skinShade, 8);
      elbow.position.y = -0.3;
      const fore = new THREE.Group();
      fore.position.y = -0.3;
      fore.rotation.x = -0.7;
      const forearm = cap(0.034, 0.18, skin);
      forearm.position.y = -0.12;
      const hand = ball(0.042, skin, 10);
      hand.scale.set(0.75, 1.05, 0.55);
      hand.position.y = -0.24;
      const thumb = ball(0.016, skinShade, 6);
      thumb.position.set(side * 0.03, -0.2, -0.015);
      fore.add(forearm, hand, thumb);
      shoulder.add(upper, elbow, fore);
      return { shoulder, fore };
    };
    const aL = arm(-1);
    const aR = arm(1);
    this.armL = aL.shoulder;
    this.foreL = aL.fore;
    this.armR = aR.shoulder;
    this.foreR = aR.fore;
    this.torsoPivot.add(this.armL, this.armR);

    const leg = (side: number) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.13, 0.8, 0);
      const thigh = cap(0.062, 0.3, jean);
      thigh.position.y = -0.22;
      const knee = ball(0.052, jeanDark, 10);
      knee.position.y = -0.42;
      const shin = new THREE.Group();
      shin.position.y = -0.42;
      shin.rotation.x = -0.12;
      const calf = cap(0.046, 0.28, jean);
      calf.position.y = -0.2;
      const sneaker = new THREE.Group();
      sneaker.position.set(0, -0.4, -0.03);
      const upper = cap(0.05, 0.12, shoe);
      upper.rotation.x = Math.PI / 2;
      const heel = ball(0.04, shoeDark, 8);
      heel.scale.set(0.8, 0.55, 0.75);
      heel.position.set(0, 0.0, 0.05);
      const soleMesh = box(0.11, 0.028, 0.24, sole);
      soleMesh.position.set(0, -0.028, -0.02);
      const lace = box(0.04, 0.01, 0.05, shoeDark);
      lace.position.set(0, 0.045, -0.03);
      sneaker.add(upper, heel, soleMesh, lace);
      shin.add(calf, sneaker);
      hip.add(thigh, knee, shin);
      return { hip, shin };
    };
    const lL = leg(-1);
    const lR = leg(1);
    this.legL = lL.hip;
    this.shinL = lL.shin;
    this.legR = lR.hip;
    this.shinR = lR.shin;

    this.bob.add(hips, this.torsoPivot, this.legL, this.legR);
    this.visual.add(this.bob);
    this.player.add(this.visual);
    this.player.scale.setScalar(1.08);
  }

  private makeShadow() {
    const mesh = new THREE.Mesh(
      this.geo(new THREE.CircleGeometry(0.42, 16)),
      this.mat(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false })),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.03;
    return mesh;
  }

  private makeBubble() {
    const mesh = new THREE.Mesh(
      this.geo(new THREE.SphereGeometry(0.85, 16, 12)),
      this.mat(
        new THREE.MeshBasicMaterial({
          color: 0xffc83d,
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
        }),
      ),
    );
    mesh.position.y = 0.9;
    mesh.visible = false;
    return mesh;
  }

  private makeParticles() {
    const geo = this.geo(new THREE.BoxGeometry(0.12, 0.12, 0.12));
    const mat = this.mat(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const mesh = new THREE.InstancedMesh(geo, mat, 80);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(80 * 3), 3);
    mesh.frustumCulled = false;
    for (let i = 0; i < 80; i += 1) {
      this.parts.push({ x: 0, y: -30, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1 });
      this.partDummy.position.set(0, -30, 0);
      this.partDummy.scale.setScalar(0.001);
      this.partDummy.updateMatrix();
      mesh.setMatrixAt(i, this.partDummy.matrix);
      mesh.setColorAt(i, new THREE.Color(0xffffff));
    }
    return mesh;
  }
}
