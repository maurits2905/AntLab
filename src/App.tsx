import { useEffect, useRef, useState, useCallback, type PointerEvent } from "react";

type Tool = "food" | "wall" | "erase" | "nest";
type ViewMode = "colony" | "visualizer" | "science" | "wars" | "nebula" | "bio" | "physarum";
type TrailMode = "colored" | "heatmap" | "invisible";
type TrailPalette =
  | "colony"
  | "aurora"
  | "electric"
  | "thermal"
  | "ghost"
  | "acid"
  | "ice"
  | "inferno"
  | "nebula"
  | "bio";
type AntDisplay = "ants" | "particles" | "hidden";
type AntState = "searching" | "returning";

type SlimeAgent = {
  x: number;
  y: number;
  angle: number;
  species: 0 | 1 | 2;
};

type Ant = {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  speed: number;
  turnRate: number;
  exploration: number;
  pheromoneSensitivity: number;
  depositStrength: number;
  state: AntState;
  carryingFood: boolean;
  carriedQuality: number;
  turnBias: number;
  stuckTicks: number;
  age: number;
  stateAge: number;
  memoryX: number;
  memoryY: number;
  memoryStrength: number;
  trailCommitment: number;
  colony: 0 | 1;
};

type FoodSource = {
  x: number;
  y: number;
  radius: number;
  amount: number;
  maxAmount: number;
  quality: number;
};

type Settings = {
  viewMode: ViewMode;
  antCount: number;
  antSpeed: number;
  evaporation: number;
  exploration: number;
  sensorDistance: number;
  sensorAngle: number;
  brushSize: number;
  foodAmount: number;
  foodQuality: number;
  showSensors: boolean;
  showFlowField: boolean;
  showAgeContours: boolean;
  trailMode: TrailMode;
  trailPalette: TrailPalette;
  antDisplay: AntDisplay;
  trailIntensity: number;
  trailBloom: number;
  pheromoneTtl: number;
  trailThreshold: number;
  hideWorldInVisualizer: boolean;
  hideWallsInVisualizer: boolean;
  chromaticAberration: number;
  slimeTurnSpeed: number;
  slimeSpecies: 1 | 2 | 3;
};

type Stats = {
  foodCollected: number;
  foodRemaining: number;
  activeAnts: number;
  searchingAnts: number;
  returningAnts: number;
  elapsedSeconds: number;
  colony0Collected: number;
  colony1Collected: number;
};

const WORLD_WIDTH = 1100;
const WORLD_HEIGHT = 720;

const GRID_SCALE = 4;
const GRID_WIDTH = Math.floor(WORLD_WIDTH / GRID_SCALE);
const GRID_HEIGHT = Math.floor(WORLD_HEIGHT / GRID_SCALE);
const GRID_SIZE = GRID_WIDTH * GRID_HEIGHT;

const NEST_RADIUS = 28;
const MAX_PHEROMONE = 950;

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function distanceSquared(ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

function angleTo(fromX: number, fromY: number, toX: number, toY: number) {
  return Math.atan2(toY - fromY, toX - fromX);
}

function normalizeAngle(angle: number) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function mixAngle(current: number, target: number, amount: number) {
  const diff = normalizeAngle(target - current);
  return current + diff * amount;
}

function gridIndex(gx: number, gy: number) {
  return gy * GRID_WIDTH + gx;
}

function gridIndexFromWorld(x: number, y: number) {
  const gx = clamp(Math.floor(x / GRID_SCALE), 0, GRID_WIDTH - 1);
  const gy = clamp(Math.floor(y / GRID_SCALE), 0, GRID_HEIGHT - 1);
  return gridIndex(gx, gy);
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function createAnt(nestX: number, nestY: number, colony: 0 | 1 = 0): Ant {
  const angle = randomBetween(0, Math.PI * 2);
  const speed = randomBetween(0.82, 1.34);
  return {
    x: nestX + randomBetween(-NEST_RADIUS * 0.45, NEST_RADIUS * 0.45),
    y: nestY + randomBetween(-NEST_RADIUS * 0.45, NEST_RADIUS * 0.45),
    angle,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    speed,
    turnRate: randomBetween(0.045, 0.105),
    exploration: randomBetween(0.55, 1.35),
    pheromoneSensitivity: randomBetween(0.75, 1.75),
    depositStrength: randomBetween(0.72, 1.35),
    state: "searching",
    carryingFood: false,
    carriedQuality: 1,
    turnBias: randomBetween(-0.018, 0.018),
    stuckTicks: 0,
    age: randomBetween(0, 1000),
    stateAge: randomBetween(0, 80),
    memoryX: nestX,
    memoryY: nestY,
    memoryStrength: 0,
    trailCommitment: randomBetween(0.35, 0.9),
    colony
  };
}

function makeAnts(count: number, nestX: number, nestY: number, colony: 0 | 1 = 0) {
  return Array.from({ length: count }, () => createAnt(nestX, nestY, colony));
}

// Star field for nebula/bio backgrounds — generated once, stored as module-level array
const STAR_FIELD = Array.from({ length: 220 }, () => ({
  x: Math.random() * WORLD_WIDTH,
  y: Math.random() * WORLD_HEIGHT,
  r: Math.random() * 1.4 + 0.3,
  a: Math.random() * 0.7 + 0.15
}));

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trailCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const trailCanvas0Ref = useRef<HTMLCanvasElement | null>(null);
  const trailCanvas1Ref = useRef<HTMLCanvasElement | null>(null);

  const antsRef = useRef<Ant[]>([]);
  const foodRef = useRef<FoodSource[]>([]);

  // Single-colony pheromone arrays (non-wars modes)
  const foodPheromoneRef = useRef<Float32Array>(new Float32Array(GRID_SIZE));
  const homePheromoneRef = useRef<Float32Array>(new Float32Array(GRID_SIZE));
  const foodAgeRef = useRef<Uint16Array>(new Uint16Array(GRID_SIZE));
  const homeAgeRef = useRef<Uint16Array>(new Uint16Array(GRID_SIZE));

  // Wars-mode per-colony pheromone arrays
  const colony0FoodRef = useRef<Float32Array>(new Float32Array(GRID_SIZE));
  const colony0HomeRef = useRef<Float32Array>(new Float32Array(GRID_SIZE));
  const colony1FoodRef = useRef<Float32Array>(new Float32Array(GRID_SIZE));
  const colony1HomeRef = useRef<Float32Array>(new Float32Array(GRID_SIZE));
  const colony0FoodAgeRef = useRef<Uint16Array>(new Uint16Array(GRID_SIZE));
  const colony0HomeAgeRef = useRef<Uint16Array>(new Uint16Array(GRID_SIZE));
  const colony1FoodAgeRef = useRef<Uint16Array>(new Uint16Array(GRID_SIZE));
  const colony1HomeAgeRef = useRef<Uint16Array>(new Uint16Array(GRID_SIZE));

  const wallsRef = useRef<Uint8Array>(new Uint8Array(GRID_SIZE));

  // Physarum slime simulation — up to 3 species with separate trail maps
  const slimeAgentsRef = useRef<SlimeAgent[]>([]);
  const slimeTrailRef = useRef<Float32Array[]>([
    new Float32Array(GRID_SIZE),
    new Float32Array(GRID_SIZE),
    new Float32Array(GRID_SIZE)
  ]);
  const slimeScratchRef = useRef<Float32Array>(new Float32Array(GRID_SIZE));

  // Nests: nestRef = single-colony nest, nestARef/nestBRef = wars-mode nests
  const nestRef = useRef({ x: WORLD_WIDTH * 0.38, y: WORLD_HEIGHT * 0.52 });
  const nestARef = useRef({ x: 300, y: 360 });
  const nestBRef = useRef({ x: 800, y: 360 });

  const pointerRef = useRef({ isDown: false, x: 0, y: 0 });
  const animationRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(performance.now());
  const lastStatsUpdateRef = useRef<number>(0);
  const foodCollectedRef = useRef<number>(0);
  const colony0CollectedRef = useRef<number>(0);
  const colony1CollectedRef = useRef<number>(0);

  const [tool, setTool] = useState<Tool>("food");
  const [isPaused, setIsPaused] = useState(false);

  const [settings, setSettings] = useState<Settings>({
    viewMode: "colony",
    antCount: 320,
    antSpeed: 1.2,
    evaporation: 0.986,
    exploration: 0.72,
    sensorDistance: 24,
    sensorAngle: 0.72,
    brushSize: 16,
    foodAmount: 260,
    foodQuality: 1.0,
    showSensors: false,
    showFlowField: false,
    showAgeContours: false,
    trailMode: "colored",
    trailPalette: "colony",
    antDisplay: "ants",
    trailIntensity: 1.25,
    trailBloom: 0.7,
    pheromoneTtl: 900,
    trailThreshold: 12,
    hideWorldInVisualizer: true,
    hideWallsInVisualizer: true,
    chromaticAberration: 0,
    slimeTurnSpeed: 0.38,
    slimeSpecies: 1
  });

  const settingsRef = useRef(settings);
  const isPausedRef = useRef(isPaused);

  const [stats, setStats] = useState<Stats>({
    foodCollected: 0,
    foodRemaining: 0,
    activeAnts: 0,
    searchingAnts: 0,
    returningAnts: 0,
    elapsedSeconds: 0,
    colony0Collected: 0,
    colony1Collected: 0
  });

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    antsRef.current = makeAnts(
      settingsRef.current.antCount,
      nestRef.current.x,
      nestRef.current.y,
      0
    );
    startedAtRef.current = performance.now();

    animationRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mode = settingsRef.current.viewMode;
    if (mode !== "wars" && mode !== "physarum") {
      resizeAntPopulation(settings.antCount);
    }
  }, [settings.antCount]);

  function resizeAntPopulation(newCount: number) {
    const ants = antsRef.current;
    const nest = nestRef.current;

    if (newCount > ants.length) {
      for (let i = ants.length; i < newCount; i++) {
        ants.push(createAnt(nest.x, nest.y, 0));
      }
    } else {
      ants.length = newCount;
    }
  }

  function resetSimulation() {
    const s = settingsRef.current;
    const mode = s.viewMode;

    if (mode === "physarum") {
      clearSlimeTrail();
      initSlimeAgents(s.antCount, s.slimeSpecies);
      startedAtRef.current = performance.now();
      return;
    }

    const nest = nestRef.current;

    if (mode === "wars") {
      const nestA = nestARef.current;
      const nestB = nestBRef.current;
      const countEach = 200;
      antsRef.current = [
        ...makeAnts(countEach, nestA.x, nestA.y, 0),
        ...makeAnts(countEach, nestB.x, nestB.y, 1)
      ];
    } else {
      antsRef.current = makeAnts(s.antCount, nest.x, nest.y, 0);
    }

    foodRef.current = [];
    clearTrails();
    clearWalls();

    foodCollectedRef.current = 0;
    colony0CollectedRef.current = 0;
    colony1CollectedRef.current = 0;
    startedAtRef.current = performance.now();
  }

  function clearTrails() {
    foodPheromoneRef.current = new Float32Array(GRID_SIZE);
    homePheromoneRef.current = new Float32Array(GRID_SIZE);
    foodAgeRef.current = new Uint16Array(GRID_SIZE);
    homeAgeRef.current = new Uint16Array(GRID_SIZE);

    colony0FoodRef.current = new Float32Array(GRID_SIZE);
    colony0HomeRef.current = new Float32Array(GRID_SIZE);
    colony1FoodRef.current = new Float32Array(GRID_SIZE);
    colony1HomeRef.current = new Float32Array(GRID_SIZE);
    colony0FoodAgeRef.current = new Uint16Array(GRID_SIZE);
    colony0HomeAgeRef.current = new Uint16Array(GRID_SIZE);
    colony1FoodAgeRef.current = new Uint16Array(GRID_SIZE);
    colony1HomeAgeRef.current = new Uint16Array(GRID_SIZE);
  }

  function clearWalls() {
    wallsRef.current = new Uint8Array(GRID_SIZE);
  }

  function clearSlimeTrail() {
    slimeTrailRef.current = [
      new Float32Array(GRID_SIZE),
      new Float32Array(GRID_SIZE),
      new Float32Array(GRID_SIZE)
    ];
    slimeScratchRef.current = new Float32Array(GRID_SIZE);
  }

  function initSlimeAgents(count: number, species: 1 | 2 | 3) {
    const agents: SlimeAgent[] = [];
    const cx = WORLD_WIDTH / 2;
    const cy = WORLD_HEIGHT / 2;

    for (let i = 0; i < count; i++) {
      const sp = species === 1 ? 0 : (i % species) as 0 | 1 | 2;
      // Ring spawn facing inward — creates beautiful central convergence
      const ringAngle = (i / count) * Math.PI * 2;
      const ringR = Math.min(WORLD_WIDTH, WORLD_HEIGHT) * 0.32;
      const px = cx + Math.cos(ringAngle) * ringR;
      const py = cy + Math.sin(ringAngle) * ringR;
      const faceInward = Math.atan2(cy - py, cx - px);
      agents.push({
        x: clamp(px, 20, WORLD_WIDTH - 20),
        y: clamp(py, 20, WORLD_HEIGHT - 20),
        angle: faceInward + randomBetween(-0.4, 0.4),
        species: sp
      });
    }
    slimeAgentsRef.current = agents;
  }

  function applyMode(nextMode: ViewMode) {
    if (nextMode === "colony") {
      setSettings((current) => ({
        ...current,
        viewMode: "colony",
        antCount: Math.min(current.antCount, 420),
        antSpeed: 1.05,
        exploration: 0.72,
        evaporation: 0.985,
        sensorDistance: 22,
        showSensors: false,
        showFlowField: false,
        showAgeContours: false,
        antDisplay: "ants",
        trailMode: "colored",
        trailPalette: "colony",
        trailIntensity: 1.15,
        trailBloom: 0.55,
        pheromoneTtl: 900,
        trailThreshold: 12,
        hideWorldInVisualizer: false,
        hideWallsInVisualizer: false,
        chromaticAberration: 0
      }));
    }

    if (nextMode === "visualizer") {
      clearTrails();

      setSettings((current) => ({
        ...current,
        viewMode: "visualizer",
        antCount: Math.max(current.antCount, 1600),
        antSpeed: 2.05,
        exploration: 1.02,
        evaporation: 0.991,
        sensorDistance: 36,
        showSensors: false,
        showFlowField: true,
        showAgeContours: true,
        antDisplay: "hidden",
        trailMode: "heatmap",
        trailPalette: "aurora",
        trailIntensity: 2.6,
        trailBloom: 1.8,
        pheromoneTtl: 720,
        trailThreshold: 22,
        hideWorldInVisualizer: true,
        hideWallsInVisualizer: true,
        chromaticAberration: 0.5
      }));
    }

    if (nextMode === "science") {
      setSettings((current) => ({
        ...current,
        viewMode: "science",
        antCount: Math.min(current.antCount, 700),
        antSpeed: 1.25,
        exploration: 0.85,
        evaporation: 0.988,
        sensorDistance: 30,
        showSensors: true,
        showFlowField: true,
        showAgeContours: true,
        antDisplay: "particles",
        trailMode: "colored",
        trailPalette: "electric",
        trailIntensity: 1.7,
        trailBloom: 0.9,
        pheromoneTtl: 780,
        trailThreshold: 12,
        hideWorldInVisualizer: false,
        hideWallsInVisualizer: false,
        chromaticAberration: 0.3
      }));
    }

    if (nextMode === "wars") {
      clearTrails();

      // Build wars ants from both nests
      const countEach = 200;
      const nestA = nestARef.current;
      const nestB = nestBRef.current;
      antsRef.current = [
        ...makeAnts(countEach, nestA.x, nestA.y, 0),
        ...makeAnts(countEach, nestB.x, nestB.y, 1)
      ];

      colony0CollectedRef.current = 0;
      colony1CollectedRef.current = 0;

      // Seed 3 food sources between nests
      foodRef.current = [
        makeFoodAt(500, 260, 260, 1.0),
        makeFoodAt(600, 430, 260, 1.0),
        makeFoodAt(540, 360, 260, 1.0)
      ];

      setSettings((current) => ({
        ...current,
        viewMode: "wars",
        antCount: 400,
        antSpeed: 1.1,
        exploration: 0.88,
        evaporation: 0.987,
        sensorDistance: 24,
        showSensors: false,
        showFlowField: false,
        showAgeContours: false,
        antDisplay: "ants",
        trailMode: "colored",
        trailPalette: "colony",
        trailIntensity: 1.4,
        trailBloom: 0.8,
        pheromoneTtl: 900,
        trailThreshold: 12,
        hideWorldInVisualizer: false,
        hideWallsInVisualizer: false,
        chromaticAberration: 0
      }));
    }

    if (nextMode === "nebula") {
      clearTrails();

      setSettings((current) => ({
        ...current,
        viewMode: "nebula",
        antCount: 1800,
        antSpeed: 1.8,
        exploration: 1.15,
        evaporation: 0.992,
        sensorDistance: 38,
        showSensors: false,
        showFlowField: false,
        showAgeContours: false,
        antDisplay: "hidden",
        trailMode: "heatmap",
        trailPalette: "nebula",
        trailIntensity: 3.0,
        trailBloom: 2.2,
        pheromoneTtl: 1200,
        trailThreshold: 18,
        hideWorldInVisualizer: true,
        hideWallsInVisualizer: true,
        chromaticAberration: 1.8
      }));
    }

    if (nextMode === "bio") {
      clearTrails();

      setSettings((current) => ({
        ...current,
        viewMode: "bio",
        antCount: 1400,
        antSpeed: 1.4,
        exploration: 0.95,
        evaporation: 0.991,
        sensorDistance: 32,
        showSensors: false,
        showFlowField: false,
        showAgeContours: false,
        antDisplay: "hidden",
        trailMode: "heatmap",
        trailPalette: "bio",
        trailIntensity: 2.8,
        trailBloom: 2.0,
        pheromoneTtl: 1500,
        trailThreshold: 16,
        hideWorldInVisualizer: true,
        hideWallsInVisualizer: true,
        chromaticAberration: 1.2
      }));
    }

    if (nextMode === "physarum") {
      clearSlimeTrail();
      initSlimeAgents(1400, settingsRef.current.slimeSpecies);

      setSettings((current) => ({
        ...current,
        viewMode: "physarum",
        antCount: 1400,
        antSpeed: 1.1,
        evaporation: 0.981,
        sensorDistance: 22,
        sensorAngle: 0.42,
        showSensors: false,
        showFlowField: false,
        showAgeContours: false,
        antDisplay: "hidden",
        trailMode: "heatmap",
        trailPalette: "aurora",
        trailIntensity: 6.0,
        trailBloom: 1.8,
        pheromoneTtl: 9999,
        trailThreshold: 0,
        hideWorldInVisualizer: true,
        hideWallsInVisualizer: true,
        chromaticAberration: 0.7,
        slimeTurnSpeed: 0.38,
        slimeSpecies: 1
      }));
    }
  }

  function seedDemo() {
    resetSimulation();

    nestRef.current = { x: 360, y: 370 };

    foodRef.current = [
      makeFood(885, 235),
      makeFood(820, 520),
      makeFood(990, 430),
      makeFood(250, 190)
    ];

    drawWallLine(560, 140, 560, 360, 18, false);
    drawWallLine(560, 360, 760, 360, 18, false);
    drawWallLine(760, 360, 760, 590, 18, false);
    drawWallLine(760, 590, 960, 590, 18, false);
    drawWallLine(725, 155, 965, 155, 18, false);
    drawWallLine(965, 155, 965, 320, 18, false);
  }

  function generateMaze() {
    clearWalls();
    clearTrails();

    for (let y = 90; y < WORLD_HEIGHT - 80; y += 90) {
      const gapX = randomBetween(430, WORLD_WIDTH - 190);

      for (let x = 500; x < WORLD_WIDTH - 80; x += GRID_SCALE) {
        if (Math.abs(x - gapX) > 72) {
          paintWallAt(x, y, 11, false);
        }
      }
    }

    for (let x = 560; x < WORLD_WIDTH - 130; x += 120) {
      const gapY = randomBetween(130, WORLD_HEIGHT - 120);

      for (let y = 90; y < WORLD_HEIGHT - 80; y += GRID_SCALE) {
        if (Math.abs(y - gapY) > 72) {
          paintWallAt(x, y, 11, false);
        }
      }
    }
  }

  function makeFoodAt(x: number, y: number, amount: number, quality: number): FoodSource {
    return {
      x,
      y,
      radius: clamp(10 + Math.sqrt(amount) * 0.28, 11, 24),
      amount,
      maxAmount: amount,
      quality
    };
  }

  function makeFood(x: number, y: number): FoodSource {
    const amount = settingsRef.current.foodAmount;
    const quality = settingsRef.current.foodQuality;
    return makeFoodAt(x, y, amount, quality);
  }

  function addFood(x: number, y: number) {
    if (isWallAt(x, y)) return;
    foodRef.current.push(makeFood(x, y));
  }

  function edgeDepositFactor(x: number, y: number) {
    const minDistance = Math.min(x, y, WORLD_WIDTH - x, WORLD_HEIGHT - y);

    if (minDistance < 24) return 0;
    if (minDistance < 90) return smoothstep(24, 90, minDistance);

    return 1;
  }

  function depositIntoLayer(
    map: Float32Array,
    ageMap: Uint16Array,
    x: number,
    y: number,
    amount: number,
    radius = 1
  ) {
    const edgeFactor = edgeDepositFactor(x, y);
    if (edgeFactor <= 0) return;

    const gx = clamp(Math.floor(x / GRID_SCALE), 0, GRID_WIDTH - 1);
    const gy = clamp(Math.floor(y / GRID_SCALE), 0, GRID_HEIGHT - 1);
    const adjustedAmount = amount * edgeFactor;

    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        const tx = gx + ox;
        const ty = gy + oy;

        if (tx < 0 || ty < 0 || tx >= GRID_WIDTH || ty >= GRID_HEIGHT) continue;

        const index = gridIndex(tx, ty);
        if (wallsRef.current[index]) continue;

        const distance = Math.sqrt(ox * ox + oy * oy);
        const falloff = 1 / (1 + distance * 1.35);

        map[index] = clamp(map[index] + adjustedAmount * falloff, 0, MAX_PHEROMONE);
        ageMap[index] = 0;
      }
    }
  }

  function depositFoodPheromone(x: number, y: number, amount: number, radius = 1) {
    depositIntoLayer(foodPheromoneRef.current, foodAgeRef.current, x, y, amount, radius);
  }

  function depositHomePheromone(x: number, y: number, amount: number, radius = 1) {
    depositIntoLayer(homePheromoneRef.current, homeAgeRef.current, x, y, amount, radius);
  }

  function depositColonyFood(colony: 0 | 1, x: number, y: number, amount: number, radius = 1) {
    if (colony === 0) {
      depositIntoLayer(colony0FoodRef.current, colony0FoodAgeRef.current, x, y, amount, radius);
    } else {
      depositIntoLayer(colony1FoodRef.current, colony1FoodAgeRef.current, x, y, amount, radius);
    }
  }

  function depositColonyHome(colony: 0 | 1, x: number, y: number, amount: number, radius = 1) {
    if (colony === 0) {
      depositIntoLayer(colony0HomeRef.current, colony0HomeAgeRef.current, x, y, amount, radius);
    } else {
      depositIntoLayer(colony1HomeRef.current, colony1HomeAgeRef.current, x, y, amount, radius);
    }
  }

  function layerValue(map: Float32Array, ageMap: Uint16Array, index: number) {
    const currentSettings = settingsRef.current;
    const raw = map[index];

    if (raw < currentSettings.trailThreshold) return 0;

    const age = ageMap[index];

    if (age > currentSettings.pheromoneTtl) return 0;

    const freshness = 1 - age / currentSettings.pheromoneTtl;

    return raw * freshness;
  }

  // SebLague-style: sample pheromones in a small circle around the sensor point
  function smellLayer(
    map: Float32Array,
    ageMap: Uint16Array,
    x: number,
    y: number,
    angle: number,
    distance: number
  ) {
    const sx = x + Math.cos(angle) * distance;
    const sy = y + Math.sin(angle) * distance;

    if (sx < 0 || sy < 0 || sx >= WORLD_WIDTH || sy >= WORLD_HEIGHT) return 0;
    if (isWallAt(sx, sy)) return 0;

    const cgx = clamp(Math.floor(sx / GRID_SCALE), 1, GRID_WIDTH - 2);
    const cgy = clamp(Math.floor(sy / GRID_SCALE), 1, GRID_HEIGHT - 2);

    // Sum 3×3 area for smoother, more accurate trail sensing
    let total = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        total += layerValue(map, ageMap, gridIndex(cgx + dx, cgy + dy));
      }
    }
    return total / 9;
  }

  // Species color palettes for physarum multi-species
  const SLIME_SPECIES_COLORS = [
    { r: 80, g: 255, b: 160 },   // species 0: green
    { r: 255, g: 120, b: 60 },   // species 1: orange
    { r: 80, g: 180, b: 255 }    // species 2: blue
  ] as const;

  // Sample slime trail at sensor point — own species attracted, others repelled (SebLague speciesMask * 2 - 1)
  function sampleSlimeTrail(x: number, y: number, angle: number, distance: number, species: 0 | 1 | 2): number {
    const sx = x + Math.cos(angle) * distance;
    const sy = y + Math.sin(angle) * distance;

    if (sx < 0 || sy < 0 || sx >= WORLD_WIDTH || sy >= WORLD_HEIGHT) return 0;

    const cgx = clamp(Math.floor(sx / GRID_SCALE), 1, GRID_WIDTH - 2);
    const cgy = clamp(Math.floor(sy / GRID_SCALE), 1, GRID_HEIGHT - 2);
    const numSpecies = settingsRef.current.slimeSpecies;

    let total = 0;
    for (let sp = 0; sp < numSpecies; sp++) {
      const trail = slimeTrailRef.current[sp];
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          sum += trail[gridIndex(cgx + dx, cgy + dy)];
        }
      }
      // own species = +1 (attract), other species = -1 (repel)
      total += (sp === species ? 1 : -1) * sum;
    }
    return total;
  }

  function updateSlimeAgent(agent: SlimeAgent) {
    const s = settingsRef.current;
    const sensorDist = s.sensorDistance;
    const sensorAngle = s.sensorAngle;
    const turnSpeed = s.slimeTurnSpeed;
    const speed = s.antSpeed;
    const trail = slimeTrailRef.current[agent.species];

    // Sense all three directions (inter-species weighting done in sampleSlimeTrail)
    const sF = sampleSlimeTrail(agent.x, agent.y, agent.angle, sensorDist, agent.species);
    const sL = sampleSlimeTrail(agent.x, agent.y, agent.angle - sensorAngle, sensorDist, agent.species);
    const sR = sampleSlimeTrail(agent.x, agent.y, agent.angle + sensorAngle, sensorDist, agent.species);

    // SebLague exact turning logic: randomSteerStrength per frame (scaleToRange01 hash)
    const rnd = Math.random();

    if (sF > sL && sF > sR) {
      // Forward is strongest — continue straight (no turn)
    } else if (sF < sL && sF < sR) {
      // Both sides stronger — random direction (full ±1 range)
      agent.angle += (rnd - 0.5) * 2.0 * turnSpeed;
    } else if (sR > sL) {
      // Right is stronger — turn right (randomised amount [0, turnSpeed])
      agent.angle += rnd * turnSpeed;
    } else if (sL > sR) {
      // Left is stronger — turn left
      agent.angle -= rnd * turnSpeed;
    }
    // Exactly equal left/right: no turn (SebLague: else branch is empty)

    // Move forward
    const newX = agent.x + Math.cos(agent.angle) * speed;
    const newY = agent.y + Math.sin(agent.angle) * speed;

    // Boundary: randomise angle so agents don't pile up at edges
    if (newX < 2 || newX >= WORLD_WIDTH - 2 || newY < 2 || newY >= WORLD_HEIGHT - 2) {
      agent.x = clamp(newX, 2, WORLD_WIDTH - 2);
      agent.y = clamp(newY, 2, WORLD_HEIGHT - 2);
      agent.angle = randomBetween(0, Math.PI * 2);
    } else {
      agent.x = newX;
      agent.y = newY;
    }

    // Deposit: clamp to MAX_PHEROMONE (SebLague: min(1, old + weight * dt))
    const gx = clamp(Math.floor(agent.x / GRID_SCALE), 0, GRID_WIDTH - 1);
    const gy = clamp(Math.floor(agent.y / GRID_SCALE), 0, GRID_HEIGHT - 1);
    const gi = gridIndex(gx, gy);
    trail[gi] = Math.min(trail[gi] + s.trailIntensity, MAX_PHEROMONE);
  }

  function updateSlimePheromones() {
    const s = settingsRef.current;
    const trails = slimeTrailRef.current;
    const scratch = slimeScratchRef.current;
    const numSpecies = s.slimeSpecies;

    // SebLague exact formula:
    //   diffuseWeight = saturate(diffuseRate * deltaTime)
    //   blended = original*(1-diffuseWeight) + blurred*diffuseWeight
    //   result = max(0, blended - decayRate * deltaTime)
    // diffuseRate=4 at 60fps → diffuseWeight≈0.067 (subtle spread per frame)
    // decayRate scaled to our pheromone range: (1-evaporation)*MAX_PHEROMONE*3
    const diffuseWeight = Math.min(1, 4.0 / 60);
    const decayPerFrame = (1 - s.evaporation) * MAX_PHEROMONE * 3.2;

    for (let sp = 0; sp < numSpecies; sp++) {
      const trail = trails[sp];

      for (let y = 1; y < GRID_HEIGHT - 1; y++) {
        for (let x = 1; x < GRID_WIDTH - 1; x++) {
          const i = gridIndex(x, y);
          // 3×3 mean blur (SebLague's diffuseMap kernel)
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              sum += trail[gridIndex(x + dx, y + dy)];
            }
          }
          const blurred = sum / 9;
          // Blend: weighted mix of original and blurred
          const blended = trail[i] * (1 - diffuseWeight) + blurred * diffuseWeight;
          // Subtractive decay — weak trails vanish cleanly (no slow fade to near-zero)
          scratch[i] = Math.max(0, blended - decayPerFrame);
        }
      }
      trail.set(scratch);
    }
  }

  function drawSlimePheromones(ctx: CanvasRenderingContext2D) {
    const s = settingsRef.current;
    const trails = slimeTrailRef.current;
    const numSpecies = s.slimeSpecies;
    const offscreen = getOrCreateOffscreen(trailCanvasRef, WORLD_WIDTH, WORLD_HEIGHT);
    const image = new ImageData(WORLD_WIDTH, WORLD_HEIGHT);

    // Render at full canvas resolution — nearest-neighbour grid lookup
    for (let py = 0; py < WORLD_HEIGHT; py++) {
      const gy = py >> 2;
      const gyBase = gy * GRID_WIDTH;
      for (let px = 0; px < WORLD_WIDTH; px++) {
        const gi = gyBase + (px >> 2);

        let r = 0, g = 0, b = 0, maxVal = 0;

        for (let sp = 0; sp < numSpecies; sp++) {
          const value = trails[sp][gi];
          if (value <= 0) continue;
          if (value > maxVal) maxVal = value;

          // Steeper curve for sharper bright trails (SebLague-style crisp lines)
          const t = Math.min(1, value / MAX_PHEROMONE);
          const bright = t * t * (3 - 2 * t); // smoothstep → brighter core
          const heat = Math.min(1, value / (MAX_PHEROMONE * 0.4));

          if (numSpecies === 1) {
            // Single species: palette-based coloring
            const norm = Math.min(1, value / (MAX_PHEROMONE * 0.55));
            const color = paletteColor(s.trailPalette, norm, norm * 0.45, norm, heat, bright);
            if (color.r > r) r = color.r;
            if (color.g > g) g = color.g;
            if (color.b > b) b = color.b;
          } else {
            // Multi-species: vivid species colors, additive blend
            const sc = SLIME_SPECIES_COLORS[sp];
            r = Math.min(255, r + sc.r * bright * (1 + heat));
            g = Math.min(255, g + sc.g * bright * (1 + heat));
            b = Math.min(255, b + sc.b * bright * (1 + heat));
          }
        }

        if (maxVal <= 0.5) continue;

        const alpha = Math.min(245, 20 + (Math.min(1, maxVal / (MAX_PHEROMONE * 0.3))) * 230);
        const p = (py * WORLD_WIDTH + px) * 4;
        image.data[p]     = r > 255 ? 255 : r;
        image.data[p + 1] = g > 255 ? 255 : g;
        image.data[p + 2] = b > 255 ? 255 : b;
        image.data[p + 3] = alpha;
      }
    }

    renderTrailCanvas(ctx, offscreen, image, "screen");
  }

  function isWallAt(x: number, y: number) {
    if (x < 0 || y < 0 || x >= WORLD_WIDTH || y >= WORLD_HEIGHT) return true;
    return wallsRef.current[gridIndexFromWorld(x, y)] > 0;
  }

  function wallSensor(x: number, y: number, angle: number, distance: number) {
    const sx = x + Math.cos(angle) * distance;
    const sy = y + Math.sin(angle) * distance;
    return isWallAt(sx, sy);
  }

  function paintWallAt(x: number, y: number, radius: number, erase: boolean) {
    const gridRadius = Math.ceil(radius / GRID_SCALE);
    const centerX = Math.floor(x / GRID_SCALE);
    const centerY = Math.floor(y / GRID_SCALE);

    for (let gy = centerY - gridRadius; gy <= centerY + gridRadius; gy++) {
      for (let gx = centerX - gridRadius; gx <= centerX + gridRadius; gx++) {
        if (gx < 0 || gy < 0 || gx >= GRID_WIDTH || gy >= GRID_HEIGHT) continue;

        const dx = gx - centerX;
        const dy = gy - centerY;

        if (dx * dx + dy * dy <= gridRadius * gridRadius) {
          wallsRef.current[gridIndex(gx, gy)] = erase ? 0 : 1;
        }
      }
    }
  }

  function drawWallLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    radius: number,
    erase: boolean
  ) {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 5);

    for (let i = 0; i <= steps; i++) {
      const t = i / Math.max(1, steps);
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;

      paintWallAt(x, y, radius, erase);
    }
  }

  function updateAnt(ant: Ant) {
    const currentSettings = settingsRef.current;
    const isWars = currentSettings.viewMode === "wars";

    ant.age += 1;
    ant.stateAge += 1;

    // Route pheromone maps based on mode and colony
    let followFoodMap: Float32Array;
    let followFoodAgeMap: Uint16Array;
    let followHomeMap: Float32Array;
    let followHomeAgeMap: Uint16Array;

    if (isWars) {
      if (ant.colony === 0) {
        followFoodMap = colony0FoodRef.current;
        followFoodAgeMap = colony0FoodAgeRef.current;
        followHomeMap = colony0HomeRef.current;
        followHomeAgeMap = colony0HomeAgeRef.current;
      } else {
        followFoodMap = colony1FoodRef.current;
        followFoodAgeMap = colony1FoodAgeRef.current;
        followHomeMap = colony1HomeRef.current;
        followHomeAgeMap = colony1HomeAgeRef.current;
      }
    } else {
      followFoodMap = foodPheromoneRef.current;
      followFoodAgeMap = foodAgeRef.current;
      followHomeMap = homePheromoneRef.current;
      followHomeAgeMap = homeAgeRef.current;
    }

    const followMap = ant.state === "searching" ? followFoodMap : followHomeMap;
    const followAgeMap = ant.state === "searching" ? followFoodAgeMap : followHomeAgeMap;

    const sensorDistance = currentSettings.sensorDistance;
    const sensorAngle = currentSettings.sensorAngle;

    // Determine which nest this ant belongs to
    const homeNest = isWars
      ? (ant.colony === 0 ? nestARef.current : nestBRef.current)
      : nestRef.current;

    const nestDistSq = distanceSquared(ant.x, ant.y, homeNest.x, homeNest.y);

    // Wall avoidance
    const leftWall = wallSensor(ant.x, ant.y, ant.angle - sensorAngle, sensorDistance);
    const centerWall = wallSensor(ant.x, ant.y, ant.angle, sensorDistance * 0.85);
    const rightWall = wallSensor(ant.x, ant.y, ant.angle + sensorAngle, sensorDistance);

    if (centerWall) {
      ant.angle += Math.random() < 0.5 ? -0.8 : 0.8;
      ant.stuckTicks++;
    } else if (leftWall && !rightWall) {
      ant.angle += 0.34;
    } else if (rightWall && !leftWall) {
      ant.angle -= 0.34;
    }

    // Trail sensing
    const left = smellLayer(followMap, followAgeMap, ant.x, ant.y, ant.angle - sensorAngle, sensorDistance);
    const center = smellLayer(followMap, followAgeMap, ant.x, ant.y, ant.angle, sensorDistance);
    const right = smellLayer(followMap, followAgeMap, ant.x, ant.y, ant.angle + sensorAngle, sensorDistance);

    const weightedLeft = left * ant.pheromoneSensitivity;
    const weightedCenter = center * ant.pheromoneSensitivity;
    const weightedRight = right * ant.pheromoneSensitivity;

    const signalTotal = weightedLeft + weightedCenter + weightedRight;
    const strongestSignal = Math.max(weightedLeft, weightedCenter, weightedRight);
    const signalConfidence = clamp(strongestSignal / 380, 0, 1);

    // Suppress trail-following when searching near nest — prevents circling behaviour
    const nearNest = nestDistSq < (NEST_RADIUS * 4.8) * (NEST_RADIUS * 4.8);
    const suppressTrail = ant.state === "searching" && (nearNest || ant.stateAge < 45);

    if (!suppressTrail && signalTotal > currentSettings.trailThreshold * 1.5) {
      // Signal-difference-based turning: continuous turn proportional to L-R imbalance
      const leftDiff = weightedLeft - weightedCenter * 0.72;
      const rightDiff = weightedRight - weightedCenter * 0.72;
      const commitment = clamp(signalConfidence * ant.trailCommitment, 0, 1);
      const turnStrength = ant.turnRate * (1.8 + commitment * 3.2);

      if (leftDiff > 0 && leftDiff > rightDiff) {
        ant.angle -= turnStrength * clamp(leftDiff / (signalTotal + 1), 0, 1);
      } else if (rightDiff > 0 && rightDiff > leftDiff) {
        ant.angle += turnStrength * clamp(rightDiff / (signalTotal + 1), 0, 1);
      }
    }

    if (ant.state === "searching") {
      const closestFood = getClosestFoodInRange(ant.x, ant.y, 90);

      if (closestFood) {
        const foodAngle = angleTo(ant.x, ant.y, closestFood.x, closestFood.y);
        ant.angle = mixAngle(ant.angle, foodAngle, 0.07);
      }

      if (!closestFood && ant.memoryStrength > 0.05 && Math.random() < 0.018) {
        const memoryAngle = angleTo(ant.x, ant.y, ant.memoryX, ant.memoryY);
        ant.angle = mixAngle(ant.angle, memoryAngle, ant.memoryStrength * 0.035);
        ant.memoryStrength *= 0.9991;
      }

      const nestDistance = Math.sqrt(nestDistSq);
      const homeTrailDecay = clamp(1 - ant.stateAge / 900, 0.12, 1);
      const nestProximity = clamp(1 - nestDistance / 620, 0.08, 1);

      if (ant.age % 2 < 1) {
        if (isWars) {
          depositColonyHome(ant.colony, ant.x, ant.y, 0.34 * ant.depositStrength * homeTrailDecay * nestProximity, 1);
        } else {
          depositHomePheromone(ant.x, ant.y, 0.34 * ant.depositStrength * homeTrailDecay * nestProximity, 1);
        }
      }
    } else {
      const homeAngle = angleTo(ant.x, ant.y, homeNest.x, homeNest.y);
      const homeDistance = Math.sqrt(nestDistSq);
      // Stronger pull when close to nest (0.07 far → 0.24 close)
      const homePull = clamp(0.07 + (1 - homeDistance / 580) * 0.17, 0.07, 0.24);

      ant.angle = mixAngle(ant.angle, homeAngle, homePull);

      const foodTrailDecay = clamp(1 - ant.stateAge / 950, 0.22, 1);
      const distanceBoost = clamp(homeDistance / 380, 0.32, 1.35);

      if (isWars) {
        depositColonyFood(ant.colony, ant.x, ant.y, 2.7 * ant.depositStrength * ant.carriedQuality * distanceBoost * foodTrailDecay, 2);
      } else {
        depositFoodPheromone(ant.x, ant.y, 2.7 * ant.depositStrength * ant.carriedQuality * distanceBoost * foodTrailDecay, 2);
      }
    }

    ant.turnBias += randomBetween(-0.0055, 0.0055);
    ant.turnBias = clamp(ant.turnBias, -0.045, 0.045);

    // Returning ants commit to the route — far less random wandering
    const explorationScale = ant.state === "returning" ? 0.28 : 1.0;
    const trailStability = 1 - signalConfidence * 0.72;
    const randomTurn =
      (Math.random() - 0.5) *
      ant.turnRate *
      ant.exploration *
      currentSettings.exploration *
      2.55 *
      trailStability *
      explorationScale;

    ant.angle += randomTurn + ant.turnBias;

    const oldX = ant.x;
    const oldY = ant.y;

    const maxSpeed =
      ant.speed *
      currentSettings.antSpeed *
      (ant.state === "returning" ? 1.06 : 1);

    // Velocity-based movement (SebLague SteerTowards): smooth curved paths via acceleration
    const targetVx = Math.cos(ant.angle) * maxSpeed;
    const targetVy = Math.sin(ant.angle) * maxSpeed;
    const steerX = targetVx - ant.vx;
    const steerY = targetVy - ant.vy;
    const steerLen = Math.hypot(steerX, steerY);
    const maxSteer = maxSpeed * 0.28; // max steering force per frame
    if (steerLen > maxSteer) {
      ant.vx += (steerX / steerLen) * maxSteer;
      ant.vy += (steerY / steerLen) * maxSteer;
    } else {
      ant.vx += steerX;
      ant.vy += steerY;
    }
    // Clamp to max speed
    const vLen = Math.hypot(ant.vx, ant.vy);
    if (vLen > maxSpeed) {
      ant.vx = (ant.vx / vLen) * maxSpeed;
      ant.vy = (ant.vy / vLen) * maxSpeed;
    }
    // Derive facing angle from velocity for next frame's sensing
    if (vLen > 0.001) ant.angle = Math.atan2(ant.vy, ant.vx);

    ant.x += ant.vx;
    ant.y += ant.vy;

    let collided = false;
    const margin = 12;

    if (ant.x < margin || ant.x > WORLD_WIDTH - margin) {
      ant.x = clamp(ant.x, margin, WORLD_WIDTH - margin);
      ant.angle = Math.PI - ant.angle + randomBetween(-0.5, 0.5);
      collided = true;
    }

    if (ant.y < margin || ant.y > WORLD_HEIGHT - margin) {
      ant.y = clamp(ant.y, margin, WORLD_HEIGHT - margin);
      ant.angle = -ant.angle + randomBetween(-0.5, 0.5);
      collided = true;
    }

    if (isWallAt(ant.x, ant.y)) {
      ant.x = oldX;
      ant.y = oldY;
      ant.angle += Math.PI * randomBetween(0.68, 1.28);
      ant.stuckTicks++;
      collided = true;
    } else {
      ant.stuckTicks = Math.max(0, ant.stuckTicks - 1);
    }

    // Smart unstuck: test 8 directions, pick the one with the most clear steps ahead
    if (ant.stuckTicks > 8) {
      let bestAngle = ant.angle;
      let bestClear = -1;

      for (let i = 0; i < 8; i++) {
        const testAngle = (i / 8) * Math.PI * 2;
        let clearSteps = 0;

        for (let s = 1; s <= 4; s++) {
          const tx = ant.x + Math.cos(testAngle) * maxSpeed * s;
          const ty = ant.y + Math.sin(testAngle) * maxSpeed * s;
          if (!isWallAt(tx, ty)) clearSteps++;
        }

        if (clearSteps > bestClear) {
          bestClear = clearSteps;
          bestAngle = testAngle;
        }
      }

      ant.angle = bestAngle;
      ant.stuckTicks = 0;
    }

    if (collided) {
      ant.angle = normalizeAngle(ant.angle);
    }

    handleFoodAndNest(ant);
  }

  function getClosestFoodInRange(x: number, y: number, range: number) {
    let best: FoodSource | null = null;
    let bestDistance = range * range;

    for (const food of foodRef.current) {
      if (food.amount <= 0) continue;

      const d = distanceSquared(x, y, food.x, food.y);

      if (d < bestDistance) {
        best = food;
        bestDistance = d;
      }
    }

    return best;
  }

  function handleFoodAndNest(ant: Ant) {
    const isWars = settingsRef.current.viewMode === "wars";
    const homeNest = isWars
      ? (ant.colony === 0 ? nestARef.current : nestBRef.current)
      : nestRef.current;

    if (ant.state === "searching") {
      for (const food of foodRef.current) {
        if (food.amount <= 0) continue;

        const pickupDistance = food.radius + 4;

        if (distanceSquared(ant.x, ant.y, food.x, food.y) <= pickupDistance * pickupDistance) {
          food.amount -= 1;

          ant.state = "returning";
          ant.stateAge = 0;
          ant.carryingFood = true;
          ant.carriedQuality = food.quality;
          ant.memoryX = food.x;
          ant.memoryY = food.y;
          ant.memoryStrength = clamp(0.45 + food.quality * 0.18, 0.45, 0.96);
          ant.angle = angleTo(ant.x, ant.y, homeNest.x, homeNest.y);

          if (isWars) {
            depositColonyFood(ant.colony, ant.x, ant.y, 44 * food.quality * ant.depositStrength, 2);
          } else {
            depositFoodPheromone(ant.x, ant.y, 44 * food.quality * ant.depositStrength, 2);
          }

          break;
        }
      }

      foodRef.current = foodRef.current.filter((food) => food.amount > 0);
    } else {
      if (distanceSquared(ant.x, ant.y, homeNest.x, homeNest.y) <= NEST_RADIUS * NEST_RADIUS) {
        foodCollectedRef.current += 1;

        if (isWars) {
          if (ant.colony === 0) colony0CollectedRef.current += 1;
          else colony1CollectedRef.current += 1;
        }

        ant.state = "searching";
        ant.stateAge = 0;
        ant.carryingFood = false;
        ant.carriedQuality = 1;
        ant.angle += Math.PI + randomBetween(-0.85, 0.85);

        if (isWars) {
          depositColonyHome(ant.colony, ant.x, ant.y, 34 * ant.depositStrength, 2);
        } else {
          depositHomePheromone(ant.x, ant.y, 34 * ant.depositStrength, 2);
        }
      }
    }
  }

  function updatePheromonesForMap(
    foodMap: Float32Array,
    homeMap: Float32Array,
    foodAge: Uint16Array,
    homeAge: Uint16Array
  ) {
    const currentSettings = settingsRef.current;
    const walls = wallsRef.current;
    const evaporation = currentSettings.evaporation;
    const ttl = currentSettings.pheromoneTtl;

    for (let i = 0; i < GRID_SIZE; i++) {
      if (walls[i]) {
        foodMap[i] = 0;
        homeMap[i] = 0;
        foodAge[i] = 0;
        homeAge[i] = 0;
        continue;
      }

      if (foodMap[i] > 0) {
        foodAge[i] += 1;
        foodMap[i] *= evaporation;

        if (foodAge[i] > ttl || foodMap[i] < 0.03) {
          foodMap[i] = 0;
          foodAge[i] = 0;
        }
      }

      if (homeMap[i] > 0) {
        homeAge[i] += 1;
        homeMap[i] *= evaporation;

        if (homeAge[i] > ttl || homeMap[i] < 0.03) {
          homeMap[i] = 0;
          homeAge[i] = 0;
        }
      }
    }

    diffuseLite(foodMap, foodAge);
    diffuseLite(homeMap, homeAge);
  }

  function updatePheromones() {
    const isWars = settingsRef.current.viewMode === "wars";

    if (isWars) {
      updatePheromonesForMap(
        colony0FoodRef.current,
        colony0HomeRef.current,
        colony0FoodAgeRef.current,
        colony0HomeAgeRef.current
      );
      updatePheromonesForMap(
        colony1FoodRef.current,
        colony1HomeRef.current,
        colony1FoodAgeRef.current,
        colony1HomeAgeRef.current
      );
    } else {
      updatePheromonesForMap(
        foodPheromoneRef.current,
        homePheromoneRef.current,
        foodAgeRef.current,
        homeAgeRef.current
      );
    }
  }

  function diffuseLite(map: Float32Array, ageMap: Uint16Array) {
    for (let y = 1; y < GRID_HEIGHT - 1; y += 2) {
      for (let x = 1; x < GRID_WIDTH - 1; x += 2) {
        const i = gridIndex(x, y);

        const left = i - 1;
        const right = i + 1;
        const up = i - GRID_WIDTH;
        const down = i + GRID_WIDTH;

        const average = (map[left] + map[right] + map[up] + map[down]) / 4;
        const oldValue = map[i];
        const newValue = oldValue * 0.958 + average * 0.042;

        map[i] = newValue;

        if (newValue > oldValue) {
          const neighborAge =
            (ageMap[left] + ageMap[right] + ageMap[up] + ageMap[down]) / 4;

          ageMap[i] = Math.max(ageMap[i], Math.floor(neighborAge + 2));
        }
      }
    }
  }

  function tick() {
    if (!isPausedRef.current) {
      const mode = settingsRef.current.viewMode;

      if (mode === "physarum") {
        for (const agent of slimeAgentsRef.current) {
          updateSlimeAgent(agent);
        }
        updateSlimePheromones();
      } else {
        for (const ant of antsRef.current) {
          updateAnt(ant);
        }
        updatePheromones();
      }
    }

    draw();

    const now = performance.now();

    if (now - lastStatsUpdateRef.current > 250) {
      updateStats();
      lastStatsUpdateRef.current = now;
    }

    animationRef.current = requestAnimationFrame(tick);
  }

  function updateStats() {
    const ants = antsRef.current;
    const searching = ants.filter((ant) => ant.state === "searching").length;
    const returning = ants.length - searching;
    const remaining = foodRef.current.reduce((sum, food) => sum + food.amount, 0);

    setStats({
      foodCollected: foodCollectedRef.current,
      foodRemaining: remaining,
      activeAnts: ants.length,
      searchingAnts: searching,
      returningAnts: returning,
      elapsedSeconds: Math.floor((performance.now() - startedAtRef.current) / 1000),
      colony0Collected: colony0CollectedRef.current,
      colony1Collected: colony1CollectedRef.current
    });
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const currentSettings = settingsRef.current;
    const isVisualizer = currentSettings.viewMode === "visualizer";
    const isWars = currentSettings.viewMode === "wars";
    const isNebula = currentSettings.viewMode === "nebula";
    const isBio = currentSettings.viewMode === "bio";
    const isPhysarum = currentSettings.viewMode === "physarum";

    drawBackground(ctx);

    // Physarum uses its own trail map and rendering
    if (isPhysarum) {
      drawSlimePheromones(ctx);
      return;
    }

    if (currentSettings.trailMode !== "invisible") {
      if (isWars) {
        drawPheromonesWars(ctx);
      } else {
        drawPheromones(ctx);
      }
    }

    if (currentSettings.showFlowField && currentSettings.trailMode !== "invisible") {
      drawFlowField(ctx);
    }

    if (currentSettings.showAgeContours && currentSettings.trailMode !== "invisible") {
      drawAgeContours(ctx);
    }

    const shouldHideWorld =
      (isVisualizer || isNebula || isBio) &&
      currentSettings.hideWorldInVisualizer &&
      currentSettings.antDisplay === "hidden";

    const shouldHideWalls =
      (isVisualizer || isNebula || isBio) &&
      currentSettings.hideWallsInVisualizer &&
      currentSettings.antDisplay === "hidden";

    if (!shouldHideWalls) {
      drawWalls(ctx);
    }

    if (!shouldHideWorld) {
      drawFood(ctx);
      if (isWars) {
        drawNestWars(ctx);
      } else {
        drawNest(ctx);
      }
    }

    if (currentSettings.antDisplay === "ants") {
      if (isWars) {
        drawAntsWars(ctx);
      } else {
        drawAnts(ctx);
      }
    } else if (currentSettings.antDisplay === "particles") {
      drawAntParticles(ctx);
    }

    if (currentSettings.showSensors && currentSettings.antDisplay !== "hidden") {
      drawSensors(ctx);
    }
  }

  function drawBackground(ctx: CanvasRenderingContext2D) {
    const currentSettings = settingsRef.current;
    const mode = currentSettings.viewMode;

    if (mode === "physarum") {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      return;
    }

    if (mode === "nebula" || mode === "bio") {
      // Pure black (nebula) or deep ocean (bio)
      ctx.fillStyle = mode === "bio" ? "#000508" : "#000000";
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

      // Star field for both art modes
      ctx.save();
      for (const star of STAR_FIELD) {
        ctx.beginPath();
        ctx.fillStyle = `rgba(255,255,255,${star.a * (mode === "bio" ? 0.4 : 0.85)})`;
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    if (mode === "wars") {
      // Dark base
      ctx.fillStyle = "#070911";
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

      // Subtle territory tints
      const leftGrad = ctx.createLinearGradient(0, 0, WORLD_WIDTH * 0.5, 0);
      leftGrad.addColorStop(0, "rgba(255,179,71,0.055)");
      leftGrad.addColorStop(1, "rgba(255,179,71,0)");
      ctx.fillStyle = leftGrad;
      ctx.fillRect(0, 0, WORLD_WIDTH * 0.5, WORLD_HEIGHT);

      const rightGrad = ctx.createLinearGradient(WORLD_WIDTH, 0, WORLD_WIDTH * 0.5, 0);
      rightGrad.addColorStop(0, "rgba(0,229,255,0.055)");
      rightGrad.addColorStop(1, "rgba(0,229,255,0)");
      ctx.fillStyle = rightGrad;
      ctx.fillRect(WORLD_WIDTH * 0.5, 0, WORLD_WIDTH * 0.5, WORLD_HEIGHT);

      // Subtle grid
      ctx.strokeStyle = "rgba(255,255,255,0.018)";
      ctx.lineWidth = 1;
      for (let x = 0; x < WORLD_WIDTH; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, WORLD_HEIGHT);
        ctx.stroke();
      }
      for (let y = 0; y < WORLD_HEIGHT; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(WORLD_WIDTH, y);
        ctx.stroke();
      }
      return;
    }

    const visualMode = mode === "visualizer";

    const gradient = ctx.createRadialGradient(
      WORLD_WIDTH * 0.45,
      WORLD_HEIGHT * 0.35,
      80,
      WORLD_WIDTH * 0.5,
      WORLD_HEIGHT * 0.5,
      WORLD_WIDTH
    );

    gradient.addColorStop(0, visualMode ? "#0e1726" : "#171c25");
    gradient.addColorStop(1, "#05070b");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    ctx.strokeStyle = visualMode ? "rgba(255,255,255,0.018)" : "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;

    for (let x = 0; x < WORLD_WIDTH; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD_HEIGHT);
      ctx.stroke();
    }

    for (let y = 0; y < WORLD_HEIGHT; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD_WIDTH, y);
      ctx.stroke();
    }
  }

  function paletteColor(
    palette: TrailPalette,
    foodPower: number,
    homePower: number,
    combinedPower: number,
    heat: number,
    freshness: number
  ) {
    if (palette === "thermal") {
      return {
        r: clamp(heat * 285 + freshness * 35, 0, 255),
        g: clamp(Math.pow(heat, 1.45) * 185 + homePower * 55, 0, 255),
        b: clamp((1 - heat) * 72 + foodPower * 60, 0, 255)
      };
    }

    if (palette === "electric") {
      return {
        r: clamp(foodPower * 80 + combinedPower * 55 + freshness * 45, 0, 255),
        g: clamp(homePower * 255 + combinedPower * 175, 0, 255),
        b: clamp(foodPower * 255 + combinedPower * 245, 0, 255)
      };
    }

    if (palette === "ghost") {
      const v = clamp(140 + combinedPower * 130 + freshness * 40, 0, 255);
      return {
        r: clamp(v * 0.66 + foodPower * 70, 0, 255),
        g: clamp(v * 0.78 + homePower * 65, 0, 255),
        b: v
      };
    }

    if (palette === "acid") {
      return {
        r: clamp(foodPower * 85 + heat * 90, 0, 255),
        g: clamp(combinedPower * 255 + freshness * 35, 0, 255),
        b: clamp(homePower * 70 + foodPower * 45, 0, 255)
      };
    }

    if (palette === "aurora") {
      return {
        r: clamp(foodPower * 76 + homePower * 32 + heat * 95, 0, 255),
        g: clamp(homePower * 248 + combinedPower * 120 + freshness * 20, 0, 255),
        b: clamp(foodPower * 218 + combinedPower * 175 + freshness * 25, 0, 255)
      };
    }

    if (palette === "ice") {
      return {
        r: clamp(combinedPower * 125 + freshness * 70, 0, 255),
        g: clamp(combinedPower * 220 + homePower * 65, 0, 255),
        b: clamp(170 + foodPower * 85 + heat * 55, 0, 255)
      };
    }

    if (palette === "inferno") {
      return {
        r: clamp(120 + heat * 160 + foodPower * 50, 0, 255),
        g: clamp(heat * 120 + freshness * 80, 0, 255),
        b: clamp(foodPower * 60 + homePower * 20, 0, 255)
      };
    }

    if (palette === "nebula") {
      return {
        r: clamp(foodPower * 200 + heat * 180, 0, 255),
        g: clamp(homePower * 80 + heat * 120, 0, 255),
        b: clamp(60 + foodPower * 220 + heat * 40, 0, 255)
      };
    }

    if (palette === "bio") {
      return {
        r: clamp(combinedPower * 20, 0, 255),
        g: clamp(80 + homePower * 220 + freshness * 80, 0, 255),
        b: clamp(100 + foodPower * 255 + heat * 80, 0, 255)
      };
    }

    // Default: colony
    return {
      r: clamp(foodPower * 120 + homePower * 65 + freshness * 32, 0, 255),
      g: clamp(homePower * 235 + foodPower * 150, 0, 255),
      b: clamp(foodPower * 255 + homePower * 70, 0, 255)
    };
  }

  function buildTrailImage(
    foodMap: Float32Array,
    homeMap: Float32Array,
    foodAge: Uint16Array,
    homeAge: Uint16Array,
    palette: TrailPalette
  ): ImageData {
    const currentSettings = settingsRef.current;
    // Render at full canvas resolution — nearest-neighbour grid lookup, zero upscale blur
    const image = new ImageData(WORLD_WIDTH, WORLD_HEIGHT);
    const ttl = currentSettings.pheromoneTtl;
    const intensity = currentSettings.trailIntensity;
    const isHeatmap = currentSettings.trailMode === "heatmap";

    for (let py = 0; py < WORLD_HEIGHT; py++) {
      const gy = py >> 2; // Math.floor(py / GRID_SCALE)
      const gyBase = gy * GRID_WIDTH;
      for (let px = 0; px < WORLD_WIDTH; px++) {
        const gi = gyBase + (px >> 2); // Math.floor(px / GRID_SCALE)
        const fRaw = foodMap[gi];
        const hRaw = homeMap[gi];
        if (fRaw < 0.1 && hRaw < 0.1) continue;

        const foodFreshness = fRaw > 0 ? (1 - foodAge[gi] / ttl > 0 ? 1 - foodAge[gi] / ttl : 0) : 0;
        const homeFreshness = hRaw > 0 ? (1 - homeAge[gi] / ttl > 0 ? 1 - homeAge[gi] / ttl : 0) : 0;
        const foodValue = fRaw * foodFreshness * intensity;
        const homeValue = hRaw * homeFreshness * intensity;
        const foodPower = 1 - Math.exp(-foodValue / 90);
        const homePower = 1 - Math.exp(-homeValue / 80);
        const combinedPower = foodPower + homePower > 1 ? 1 : foodPower + homePower;

        if (combinedPower <= 0.006) continue;

        const heat = Math.min(1, Math.log1p(foodValue + homeValue) / 7.25);
        const freshness = foodFreshness > homeFreshness ? foodFreshness : homeFreshness;

        const color = paletteColor(palette, foodPower, homePower, combinedPower, heat, freshness);
        const alphaBase = isHeatmap
          ? (40 + heat * 220 > 245 ? 245 : 40 + heat * 220)
          : (24 + combinedPower * 200 > 230 ? 230 : 24 + combinedPower * 200);
        const alpha = alphaBase * (0.4 + freshness * 0.8 > 1 ? 1 : 0.4 + freshness * 0.8);

        const p = (py * WORLD_WIDTH + px) * 4;
        image.data[p]     = color.r;
        image.data[p + 1] = color.g;
        image.data[p + 2] = color.b;
        image.data[p + 3] = alpha > 245 ? 245 : alpha;
      }
    }

    return image;
  }

  function applyChromaAberration(src: ImageData, shift: number): ImageData {
    const dst = new ImageData(src.width, src.height);
    const w = src.width;
    const h = src.height;
    const px = Math.round(shift);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const di = (y * w + x) * 4;
        const rx = clamp(x - px, 0, w - 1);
        const bx = clamp(x + px, 0, w - 1);
        const ri = (y * w + rx) * 4;
        const gi = di;
        const bi = (y * w + bx) * 4;
        dst.data[di]     = src.data[ri];
        dst.data[di + 1] = src.data[gi + 1];
        dst.data[di + 2] = src.data[bi + 2];
        dst.data[di + 3] = Math.max(src.data[ri + 3], src.data[gi + 3], src.data[bi + 3]);
      }
    }
    return dst;
  }

  function renderTrailCanvas(
    ctx: CanvasRenderingContext2D,
    offscreen: HTMLCanvasElement,
    image: ImageData,
    compositeOp: GlobalCompositeOperation = "screen"
  ) {
    const currentSettings = settingsRef.current;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;

    const ca = currentSettings.chromaticAberration;
    const finalImage = ca > 0.1 ? applyChromaAberration(image, ca * 2.5) : image;
    offCtx.putImageData(finalImage, 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = compositeOp;

    if (currentSettings.trailBloom > 0) {
      const bloom = currentSettings.trailBloom;

      // Bloom at canvas native resolution — no drawImage scaling needed (1:1)
      // Radii are in CSS pixels, so scale stays the same regardless of trail resolution
      ctx.filter = `blur(${bloom * 12}px)`;
      ctx.globalAlpha = clamp(bloom * 0.18, 0, 0.55);
      ctx.drawImage(offscreen, 0, 0);

      ctx.filter = `blur(${bloom * 5}px)`;
      ctx.globalAlpha = clamp(bloom * 0.32, 0, 0.75);
      ctx.drawImage(offscreen, 0, 0);

      ctx.filter = `blur(${bloom * 2}px)`;
      ctx.globalAlpha = clamp(bloom * 0.55, 0, 0.92);
      ctx.drawImage(offscreen, 0, 0);

      ctx.filter = "none";
      ctx.globalAlpha = 1;
    }

    // Crisp core pass — no scaling, offscreen and ctx are same pixel dimensions
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, 0, 0);
    ctx.restore();
  }

  function getOrCreateOffscreen(
    ref: React.MutableRefObject<HTMLCanvasElement | null>,
    width: number = WORLD_WIDTH,
    height: number = WORLD_HEIGHT
  ): HTMLCanvasElement {
    if (!ref.current || ref.current.width !== width || ref.current.height !== height) {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      ref.current = c;
    }
    return ref.current;
  }

  function drawPheromones(ctx: CanvasRenderingContext2D) {
    const currentSettings = settingsRef.current;
    const offscreen = getOrCreateOffscreen(trailCanvasRef, WORLD_WIDTH, WORLD_HEIGHT);

    const image = buildTrailImage(
      foodPheromoneRef.current,
      homePheromoneRef.current,
      foodAgeRef.current,
      homeAgeRef.current,
      currentSettings.trailPalette
    );

    renderTrailCanvas(ctx, offscreen, image, "screen");
  }

  function drawPheromonesWars(ctx: CanvasRenderingContext2D) {
    const currentSettings = settingsRef.current;
    const ttl = currentSettings.pheromoneTtl;
    const intensity = currentSettings.trailIntensity;
    const bloom = currentSettings.trailBloom;
    const isHeatmap = currentSettings.trailMode === "heatmap";

    const food0 = colony0FoodRef.current;
    const home0 = colony0HomeRef.current;
    const foodAge0 = colony0FoodAgeRef.current;
    const homeAge0 = colony0HomeAgeRef.current;
    const food1 = colony1FoodRef.current;
    const home1 = colony1HomeRef.current;
    const foodAge1 = colony1FoodAgeRef.current;
    const homeAge1 = colony1HomeAgeRef.current;

    // Build both colony images at full canvas resolution (nearest-neighbour lookup)
    const offscreen0 = getOrCreateOffscreen(trailCanvas0Ref, WORLD_WIDTH, WORLD_HEIGHT);
    const offscreen1 = getOrCreateOffscreen(trailCanvas1Ref, WORLD_WIDTH, WORLD_HEIGHT);
    const image0 = new ImageData(WORLD_WIDTH, WORLD_HEIGHT);
    const image1 = new ImageData(WORLD_WIDTH, WORLD_HEIGHT);

    for (let py = 0; py < WORLD_HEIGHT; py++) {
      const gy = py >> 2;
      const gyBase = gy * GRID_WIDTH;
      for (let px = 0; px < WORLD_WIDTH; px++) {
        const gi = gyBase + (px >> 2);
        const p = (py * WORLD_WIDTH + px) * 4;

        // Colony 0 (amber)
        const f0 = food0[gi], h0 = home0[gi];
        if (f0 >= 0.1 || h0 >= 0.1) {
          const ff0 = f0 > 0 ? (1 - foodAge0[gi] / ttl > 0 ? 1 - foodAge0[gi] / ttl : 0) : 0;
          const hf0 = h0 > 0 ? (1 - homeAge0[gi] / ttl > 0 ? 1 - homeAge0[gi] / ttl : 0) : 0;
          const fv0 = f0 * ff0 * intensity, hv0 = h0 * hf0 * intensity;
          const fp0 = 1 - Math.exp(-fv0 / 90), hp0 = 1 - Math.exp(-hv0 / 80);
          const cp0 = fp0 + hp0 > 1 ? 1 : fp0 + hp0;
          if (cp0 > 0.006) {
            const heat = Math.min(1, Math.log1p(fv0 + hv0) / 7.25);
            const fresh = ff0 > hf0 ? ff0 : hf0;
            const aBase = isHeatmap ? 40 + heat * 220 : 24 + cp0 * 200;
            const alpha = (aBase > 245 ? 245 : aBase) * (0.4 + fresh * 0.8 > 1 ? 1 : 0.4 + fresh * 0.8);
            image0.data[p]     = Math.min(255, 180 + fp0 * 75 + heat * 60);
            image0.data[p + 1] = Math.min(255, 90 + fp0 * 100 + hp0 * 80 + heat * 40);
            image0.data[p + 2] = Math.min(255, fp0 * 30 + hp0 * 20);
            image0.data[p + 3] = alpha > 245 ? 245 : alpha;
          }
        }

        // Colony 1 (cyan)
        const f1 = food1[gi], h1 = home1[gi];
        if (f1 >= 0.1 || h1 >= 0.1) {
          const ff1 = f1 > 0 ? (1 - foodAge1[gi] / ttl > 0 ? 1 - foodAge1[gi] / ttl : 0) : 0;
          const hf1 = h1 > 0 ? (1 - homeAge1[gi] / ttl > 0 ? 1 - homeAge1[gi] / ttl : 0) : 0;
          const fv1 = f1 * ff1 * intensity, hv1 = h1 * hf1 * intensity;
          const fp1 = 1 - Math.exp(-fv1 / 90), hp1 = 1 - Math.exp(-hv1 / 80);
          const cp1 = fp1 + hp1 > 1 ? 1 : fp1 + hp1;
          if (cp1 > 0.006) {
            const heat = Math.min(1, Math.log1p(fv1 + hv1) / 7.25);
            const fresh = ff1 > hf1 ? ff1 : hf1;
            const aBase = isHeatmap ? 40 + heat * 220 : 24 + cp1 * 200;
            const alpha = (aBase > 245 ? 245 : aBase) * (0.4 + fresh * 0.8 > 1 ? 1 : 0.4 + fresh * 0.8);
            image1.data[p]     = Math.min(255, fp1 * 20 + hp1 * 10);
            image1.data[p + 1] = Math.min(255, 160 + fp1 * 80 + heat * 50);
            image1.data[p + 2] = Math.min(255, 180 + fp1 * 75 + hp1 * 55 + heat * 40);
            image1.data[p + 3] = alpha > 245 ? 245 : alpha;
          }
        }
      }
    }

    const offCtx0 = offscreen0.getContext("2d");
    if (offCtx0) offCtx0.putImageData(image0, 0, 0);
    const offCtx1 = offscreen1.getContext("2d");
    if (offCtx1) offCtx1.putImageData(image1, 0, 0);

    // Render both colonies — 1:1, no upscale
    for (const offscreen of [offscreen0, offscreen1]) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      if (bloom > 0) {
        ctx.filter = `blur(${bloom * 8}px)`;
        ctx.globalAlpha = clamp(bloom * 0.28, 0, 0.65);
        ctx.drawImage(offscreen, 0, 0);
        ctx.filter = `blur(${bloom * 3}px)`;
        ctx.globalAlpha = clamp(bloom * 0.45, 0, 0.85);
        ctx.drawImage(offscreen, 0, 0);
        ctx.filter = "none";
        ctx.globalAlpha = 1;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(offscreen, 0, 0);
      ctx.restore();
    }
  }

  function drawFlowField(ctx: CanvasRenderingContext2D) {
    const foodMap = foodPheromoneRef.current;
    const homeMap = homePheromoneRef.current;
    const foodAge = foodAgeRef.current;
    const homeAge = homeAgeRef.current;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1;

    const step = 28;

    for (let y = step; y < WORLD_HEIGHT - step; y += step) {
      for (let x = step; x < WORLD_WIDTH - step; x += step) {
        const gx = Math.floor(x / GRID_SCALE);
        const gy = Math.floor(y / GRID_SCALE);

        if (gx <= 1 || gy <= 1 || gx >= GRID_WIDTH - 2 || gy >= GRID_HEIGHT - 2) continue;

        const i = gridIndex(gx, gy);

        const combined = layerValue(foodMap, foodAge, i) + layerValue(homeMap, homeAge, i);
        if (combined < 18) continue;

        const left =
          layerValue(foodMap, foodAge, gridIndex(gx - 1, gy)) +
          layerValue(homeMap, homeAge, gridIndex(gx - 1, gy));

        const right =
          layerValue(foodMap, foodAge, gridIndex(gx + 1, gy)) +
          layerValue(homeMap, homeAge, gridIndex(gx + 1, gy));

        const up =
          layerValue(foodMap, foodAge, gridIndex(gx, gy - 1)) +
          layerValue(homeMap, homeAge, gridIndex(gx, gy - 1));

        const down =
          layerValue(foodMap, foodAge, gridIndex(gx, gy + 1)) +
          layerValue(homeMap, homeAge, gridIndex(gx, gy + 1));

        const dx = right - left;
        const dy = down - up;
        const length = Math.hypot(dx, dy);

        if (length < 1) continue;

        const ux = dx / length;
        const uy = dy / length;
        const alpha = clamp(combined / 500, 0.08, 0.42);
        const lineLength = clamp(8 + combined / 40, 8, 24);

        ctx.strokeStyle = `rgba(220, 244, 255, ${alpha})`;

        ctx.beginPath();
        ctx.moveTo(x - ux * lineLength * 0.5, y - uy * lineLength * 0.5);
        ctx.lineTo(x + ux * lineLength * 0.5, y + uy * lineLength * 0.5);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function drawAgeContours(ctx: CanvasRenderingContext2D) {
    const foodMap = foodPheromoneRef.current;
    const homeMap = homePheromoneRef.current;
    const foodAge = foodAgeRef.current;
    const homeAge = homeAgeRef.current;

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.lineWidth = 1;

    const step = 24;

    for (let y = step; y < WORLD_HEIGHT - step; y += step) {
      for (let x = step; x < WORLD_WIDTH - step; x += step) {
        const gx = Math.floor(x / GRID_SCALE);
        const gy = Math.floor(y / GRID_SCALE);
        const i = gridIndex(gx, gy);

        const combined = layerValue(foodMap, foodAge, i) + layerValue(homeMap, homeAge, i);
        if (combined < 60) continue;

        const age = Math.min(
          foodMap[i] > 0 ? foodAge[i] : Number.MAX_SAFE_INTEGER,
          homeMap[i] > 0 ? homeAge[i] : Number.MAX_SAFE_INTEGER
        );

        const freshness = clamp(1 - age / settingsRef.current.pheromoneTtl, 0, 1);
        const radius = clamp(combined / 90, 1.5, 5.5);

        ctx.strokeStyle = `rgba(255,255,255,${0.035 + freshness * 0.08})`;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function drawWalls(ctx: CanvasRenderingContext2D) {
    const walls = wallsRef.current;

    ctx.fillStyle = "rgba(48,55,71,0.94)";

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (walls[gridIndex(x, y)]) {
          ctx.fillRect(x * GRID_SCALE, y * GRID_SCALE, GRID_SCALE, GRID_SCALE);
        }
      }
    }

    ctx.strokeStyle = "rgba(255,255,255,0.055)";
    ctx.lineWidth = 1;

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (walls[gridIndex(x, y)]) {
          ctx.strokeRect(x * GRID_SCALE, y * GRID_SCALE, GRID_SCALE, GRID_SCALE);
        }
      }
    }
  }

  function drawFood(ctx: CanvasRenderingContext2D) {
    for (const food of foodRef.current) {
      const ratio = clamp(food.amount / food.maxAmount, 0.1, 1);

      ctx.beginPath();
      ctx.fillStyle = `rgba(126, 231, 135, ${0.12 + ratio * 0.24})`;
      ctx.arc(food.x, food.y, food.radius + 16, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = "#7ee787";
      ctx.arc(food.x, food.y, food.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 2;
      ctx.arc(food.x, food.y, food.radius + 2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "#dfffe4";
      ctx.font = "bold 11px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(String(food.amount), food.x, food.y - food.radius - 10);

      ctx.fillStyle = "rgba(223,255,228,0.74)";
      ctx.font = "10px system-ui";
      ctx.fillText(`q ${food.quality.toFixed(1)}`, food.x, food.y + food.radius + 16);
    }
  }

  function drawNestShape(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    glowColor: string,
    coreColor: string,
    label: string
  ) {
    const t = performance.now() / 1000;
    const pulse = Math.sin(t * 2.2) * 0.5 + 0.5;

    // Pulsing outer glow
    ctx.beginPath();
    ctx.fillStyle = glowColor;
    ctx.arc(x, y, NEST_RADIUS + 14 + pulse * 8, 0, Math.PI * 2);
    ctx.fill();

    // Core disc with gradient
    const coreGrad = ctx.createRadialGradient(x, y, 0, x, y, NEST_RADIUS);
    coreGrad.addColorStop(0, "#1a0f05");
    coreGrad.addColorStop(0.45, coreColor);
    coreGrad.addColorStop(1, "#1c1108");
    ctx.beginPath();
    ctx.fillStyle = coreGrad;
    ctx.arc(x, y, NEST_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // Outer hexagonal arc segments
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const seg = i / 6;
      const startA = seg * Math.PI * 2 - Math.PI / 6;
      const endA = (seg + 1 / 6) * Math.PI * 2 - Math.PI / 6;
      const alpha = 0.18 + (i % 2 === 0 ? 0.12 : 0) + pulse * 0.08;
      ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(x, y, NEST_RADIUS + 4, startA + 0.1, endA - 0.1);
      ctx.stroke();
    }

    // Inner hex ring
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const seg = i / 6;
      const startA = seg * Math.PI * 2;
      const endA = (seg + 1 / 6) * Math.PI * 2;
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.beginPath();
      ctx.arc(x, y, NEST_RADIUS * 0.66, startA + 0.12, endA - 0.12);
      ctx.stroke();
    }

    // Dark entrance hole with depth gradient
    const holeGrad = ctx.createRadialGradient(x, y, 0, x, y, NEST_RADIUS * 0.52);
    holeGrad.addColorStop(0, "rgba(0,0,0,0.96)");
    holeGrad.addColorStop(0.55, "rgba(0,0,0,0.55)");
    holeGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.fillStyle = holeGrad;
    ctx.arc(x, y, NEST_RADIUS * 0.52, 0, Math.PI * 2);
    ctx.fill();

    // Outer ring
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 2;
    ctx.arc(x, y, NEST_RADIUS + 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#ffe4b5";
    ctx.font = "bold 11px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(label, x, y + NEST_RADIUS + 22);
  }

  function drawNest(ctx: CanvasRenderingContext2D) {
    const nest = nestRef.current;
    drawNestShape(ctx, nest.x, nest.y, "rgba(255,185,89,0.18)", "#c98735", "Nest");
  }

  function drawNestWars(ctx: CanvasRenderingContext2D) {
    const nestA = nestARef.current;
    const nestB = nestBRef.current;
    drawNestShape(ctx, nestA.x, nestA.y, "rgba(255,179,71,0.22)", "#d4832a", "Colony A");
    drawNestShape(ctx, nestB.x, nestB.y, "rgba(0,229,255,0.18)", "#0099bb", "Colony B");
  }

  function drawAnts(ctx: CanvasRenderingContext2D) {
    for (const ant of antsRef.current) {
      ctx.save();
      ctx.translate(ant.x, ant.y);
      ctx.rotate(ant.angle);

      const bodyColor = ant.state === "returning" ? "#ffe07a" : "#eef3fb";
      const legColor = ant.state === "returning" ? "rgba(255,210,80,0.55)" : "rgba(190,205,230,0.55)";

      // Glow halo when carrying food
      if (ant.carryingFood) {
        ctx.beginPath();
        ctx.fillStyle = "rgba(126,231,135,0.18)";
        ctx.arc(-3, 0, 11, 0, Math.PI * 2);
        ctx.fill();
      }

      // Shadow ellipse
      ctx.beginPath();
      ctx.fillStyle = ant.state === "returning" ? "rgba(255,224,122,0.18)" : "rgba(238,243,251,0.1)";
      ctx.ellipse(0, 0, 9, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // 3 pairs of legs — drawn before body so body overlaps them
      ctx.strokeStyle = legColor;
      ctx.lineWidth = 0.65;
      const legBases = [-2, 1, 4];
      for (const lx of legBases) {
        ctx.beginPath();
        ctx.moveTo(lx, -2.1);
        ctx.lineTo(lx - 1.5, -5.5);
        ctx.lineTo(lx + 0.5, -8.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(lx, 2.1);
        ctx.lineTo(lx - 1.5, 5.5);
        ctx.lineTo(lx + 0.5, 8.5);
        ctx.stroke();
      }

      // Body segments: abdomen, thorax, head
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.ellipse(-3.5, 0, 3.8, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(1.5, 0, 4.3, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(6.2, 0, 2.4, 2.1, 0, 0, Math.PI * 2);
      ctx.fill();

      // Antennae
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(7, -1.3);
      ctx.lineTo(9.5, -4);
      ctx.lineTo(10.8, -3.2);
      ctx.moveTo(7, 1.3);
      ctx.lineTo(9.5, 4);
      ctx.lineTo(10.8, 3.2);
      ctx.stroke();

      // Food pellet when carrying
      if (ant.carryingFood) {
        ctx.beginPath();
        ctx.fillStyle = "#7ee787";
        ctx.arc(-8.3, 0, 2.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  function drawAntsWars(ctx: CanvasRenderingContext2D) {
    for (const ant of antsRef.current) {
      ctx.save();
      ctx.translate(ant.x, ant.y);
      ctx.rotate(ant.angle);

      const isColony0 = ant.colony === 0;
      const carrying = ant.carryingFood;

      const bodyColor = isColony0
        ? (carrying ? "#ffcc44" : "#ffb347")
        : (carrying ? "#44eeff" : "#00e5ff");

      const legColor = isColony0
        ? "rgba(255,179,71,0.5)"
        : "rgba(0,229,255,0.45)";

      // Glow when carrying food
      if (carrying) {
        ctx.beginPath();
        ctx.fillStyle = isColony0 ? "rgba(255,200,60,0.25)" : "rgba(0,229,255,0.22)";
        ctx.arc(-3, 0, 12, 0, Math.PI * 2);
        ctx.fill();
      }

      // Shadow
      ctx.beginPath();
      ctx.fillStyle = isColony0 ? "rgba(255,179,71,0.22)" : "rgba(0,229,255,0.18)";
      ctx.ellipse(0, 0, 9, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // Legs
      ctx.strokeStyle = legColor;
      ctx.lineWidth = 0.65;
      const legBases = [-2, 1, 4];
      for (const lx of legBases) {
        ctx.beginPath();
        ctx.moveTo(lx, -2.1);
        ctx.lineTo(lx - 1.5, -5.5);
        ctx.lineTo(lx + 0.5, -8.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(lx, 2.1);
        ctx.lineTo(lx - 1.5, 5.5);
        ctx.lineTo(lx + 0.5, 8.5);
        ctx.stroke();
      }

      // Body segments
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.ellipse(-3.5, 0, 3.8, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(1.5, 0, 4.3, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(6.2, 0, 2.4, 2.1, 0, 0, Math.PI * 2);
      ctx.fill();

      // Antennae
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(7, -1.3);
      ctx.lineTo(9.5, -4);
      ctx.lineTo(10.8, -3.2);
      ctx.moveTo(7, 1.3);
      ctx.lineTo(9.5, 4);
      ctx.lineTo(10.8, 3.2);
      ctx.stroke();

      if (carrying) {
        ctx.beginPath();
        ctx.fillStyle = "#7ee787";
        ctx.arc(-8.3, 0, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  function drawAntParticles(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";

    for (const ant of antsRef.current) {
      const alpha = ant.state === "returning" ? 0.62 : 0.34;
      const radius = ant.state === "returning" ? 1.7 : 1.15;

      ctx.beginPath();
      ctx.fillStyle =
        ant.state === "returning"
          ? `rgba(255, 224, 122, ${alpha})`
          : `rgba(230, 242, 255, ${alpha})`;
      ctx.arc(ant.x, ant.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawSensors(ctx: CanvasRenderingContext2D) {
    const currentSettings = settingsRef.current;
    const ants = antsRef.current.slice(0, 85);

    ctx.strokeStyle = "rgba(255,255,255,0.13)";
    ctx.lineWidth = 1;

    for (const ant of ants) {
      for (const offset of [-currentSettings.sensorAngle, 0, currentSettings.sensorAngle]) {
        const angle = ant.angle + offset;

        ctx.beginPath();
        ctx.moveTo(ant.x, ant.y);
        ctx.lineTo(
          ant.x + Math.cos(angle) * currentSettings.sensorDistance,
          ant.y + Math.sin(angle) * currentSettings.sensorDistance
        );
        ctx.stroke();
      }
    }
  }

  function getCanvasPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();

    const x = ((event.clientX - rect.left) / rect.width) * WORLD_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * WORLD_HEIGHT;

    return { x, y };
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    const point = getCanvasPoint(event);
    pointerRef.current = { isDown: true, x: point.x, y: point.y };
    event.currentTarget.setPointerCapture(event.pointerId);

    applyTool(point.x, point.y);
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (!pointerRef.current.isDown) return;

    const point = getCanvasPoint(event);

    if (tool === "wall" || tool === "erase") {
      drawWallLine(
        pointerRef.current.x,
        pointerRef.current.y,
        point.x,
        point.y,
        settingsRef.current.brushSize,
        tool === "erase"
      );
    } else {
      applyTool(point.x, point.y);
    }

    pointerRef.current = { isDown: true, x: point.x, y: point.y };
  }

  function handlePointerUp() {
    pointerRef.current.isDown = false;
  }

  function applyTool(x: number, y: number) {
    if (tool === "food") {
      addFood(x, y);
    }

    if (tool === "wall") {
      paintWallAt(x, y, settingsRef.current.brushSize, false);
    }

    if (tool === "erase") {
      paintWallAt(x, y, settingsRef.current.brushSize, true);
    }

    if (tool === "nest") {
      nestRef.current = {
        x: clamp(x, NEST_RADIUS, WORLD_WIDTH - NEST_RADIUS),
        y: clamp(y, NEST_RADIUS, WORLD_HEIGHT - NEST_RADIUS)
      };
    }
  }

  const handleSavePng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `antlab-${Date.now()}.png`;
    link.click();
  }, []);

  // Derived values for stats UI
  const isWarsMode = settings.viewMode === "wars";
  const totalAnts = stats.activeAnts;
  const searchingPct = totalAnts > 0 ? (stats.searchingAnts / totalAnts) * 100 : 0;
  const returningPct = totalAnts > 0 ? (stats.returningAnts / totalAnts) * 100 : 0;

  // Mode accent color driven by CSS variable
  const modeAccentMap: Record<ViewMode, string> = {
    colony: "#7ee787",
    visualizer: "#67b7ff",
    science: "#ffcc44",
    wars: "#ffb347",
    nebula: "#e040fb",
    bio: "#00e5ff",
    physarum: "#39ff8f"
  };
  const accent = modeAccentMap[settings.viewMode];

  return (
    <main className="app" style={{ "--mode-accent": accent } as React.CSSProperties}>
      <aside className="panel">
        <div className="titleBlock">
          <p className="eyebrow">Browser sandbox</p>
          <h1>AntLab</h1>
          <p>
            Pheromone-trail ant colony simulator with colony wars, science analysis, and generative art modes.
          </p>
        </div>

        <section className="section">
          <h2 className="sectionHeader">Simulation</h2>
          <div className="modeRow">
            <button
              className={`modeCard${settings.viewMode === "colony" ? " active" : ""}`}
              onClick={() => applyMode("colony")}
            >
              <span className="modeIcon">🐜</span>
              <span className="modeName">Colony</span>
              <span className="modeSubtitle">foraging sim</span>
            </button>
            <button
              className={`modeCard${settings.viewMode === "wars" ? " active" : ""}`}
              onClick={() => applyMode("wars")}
            >
              <span className="modeIcon">⚔️</span>
              <span className="modeName">Wars</span>
              <span className="modeSubtitle">colony conflict</span>
            </button>
            <button
              className={`modeCard${settings.viewMode === "science" ? " active" : ""}`}
              onClick={() => applyMode("science")}
            >
              <span className="modeIcon">🔬</span>
              <span className="modeName">Science</span>
              <span className="modeSubtitle">analysis</span>
            </button>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionHeader">Visual Art</h2>
          <div className="modeRow">
            <button
              className={`modeCard${settings.viewMode === "visualizer" ? " active" : ""}`}
              onClick={() => applyMode("visualizer")}
            >
              <span className="modeIcon">🌌</span>
              <span className="modeName">Trail Art</span>
              <span className="modeSubtitle">aurora trails</span>
            </button>
            <button
              className={`modeCard${settings.viewMode === "nebula" ? " active" : ""}`}
              onClick={() => applyMode("nebula")}
            >
              <span className="modeIcon">🔮</span>
              <span className="modeName">Nebula</span>
              <span className="modeSubtitle">cosmic drift</span>
            </button>
            <button
              className={`modeCard${settings.viewMode === "bio" ? " active" : ""}`}
              onClick={() => applyMode("bio")}
            >
              <span className="modeIcon">🌊</span>
              <span className="modeName">Bio</span>
              <span className="modeSubtitle">deep ocean</span>
            </button>
          </div>
          <div className="modeRow" style={{ marginTop: "0.5rem" }}>
            <button
              className={`modeCard${settings.viewMode === "physarum" ? " active" : ""}`}
              onClick={() => applyMode("physarum")}
            >
              <span className="modeIcon">🧫</span>
              <span className="modeName">Physarum</span>
              <span className="modeSubtitle">slime networks</span>
            </button>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionHeader">Tools</h2>
          <div className="toolGrid">
            <button className={tool === "food" ? "active" : ""} onClick={() => setTool("food")}>
              🍃 Food
            </button>
            <button className={tool === "wall" ? "active" : ""} onClick={() => setTool("wall")}>
              🧱 Wall
            </button>
            <button className={tool === "erase" ? "active" : ""} onClick={() => setTool("erase")}>
              ✏️ Erase
            </button>
            <button className={tool === "nest" ? "active" : ""} onClick={() => setTool("nest")}>
              🏠 Nest
            </button>
          </div>
        </section>

        <section className="section">
          <h2 className="sectionHeader">Simulation</h2>

          <Slider
            label="Ant count"
            value={settings.antCount}
            min={20}
            max={2600}
            step={20}
            display={String(settings.antCount)}
            onChange={(value) => setSettings((current) => ({ ...current, antCount: value }))}
          />

          <Slider
            label="Ant speed"
            value={settings.antSpeed}
            min={0.3}
            max={3.8}
            step={0.1}
            display={`${settings.antSpeed.toFixed(1)}×`}
            onChange={(value) => setSettings((current) => ({ ...current, antSpeed: value }))}
          />

          <Slider
            label="Exploration"
            value={settings.exploration}
            min={0.05}
            max={2.8}
            step={0.05}
            display={settings.exploration.toFixed(2)}
            onChange={(value) => setSettings((current) => ({ ...current, exploration: value }))}
          />

          <Slider
            label="Trail persistence"
            value={settings.evaporation}
            min={0.965}
            max={0.999}
            step={0.001}
            display={settings.evaporation.toFixed(3)}
            onChange={(value) => setSettings((current) => ({ ...current, evaporation: value }))}
          />

          <Slider
            label="Sensor distance"
            value={settings.sensorDistance}
            min={8}
            max={70}
            step={1}
            display={`${settings.sensorDistance}px`}
            onChange={(value) => setSettings((current) => ({ ...current, sensorDistance: value }))}
          />

          <Slider
            label="Brush size"
            value={settings.brushSize}
            min={4}
            max={48}
            step={1}
            display={`${settings.brushSize}px`}
            onChange={(value) => setSettings((current) => ({ ...current, brushSize: value }))}
          />
        </section>

        <section className="section">
          <h2 className="sectionHeader">Visualization</h2>

          <label>
            Ant display
            <select
              value={settings.antDisplay}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  antDisplay: event.target.value as AntDisplay
                }))
              }
            >
              <option value="ants">Ant models</option>
              <option value="particles">Particle ants</option>
              <option value="hidden">Hidden ants</option>
            </select>
          </label>

          <label>
            Trail mode
            <select
              value={settings.trailMode}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  trailMode: event.target.value as TrailMode
                }))
              }
            >
              <option value="colored">Colored trails</option>
              <option value="heatmap">Heatmap</option>
              <option value="invisible">Invisible</option>
            </select>
          </label>

          <label>
            Trail palette
            <select
              value={settings.trailPalette}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  trailPalette: event.target.value as TrailPalette
                }))
              }
            >
              <option value="colony">Colony</option>
              <option value="aurora">Aurora</option>
              <option value="electric">Electric</option>
              <option value="thermal">Thermal</option>
              <option value="ghost">Ghost</option>
              <option value="acid">Acid</option>
              <option value="ice">Ice</option>
              <option value="inferno">Inferno</option>
              <option value="nebula">Nebula</option>
              <option value="bio">Bioluminescence</option>
            </select>
          </label>

          <Slider
            label="Trail intensity"
            value={settings.trailIntensity}
            min={0.35}
            max={4.5}
            step={0.05}
            display={`${settings.trailIntensity.toFixed(2)}×`}
            onChange={(value) => setSettings((current) => ({ ...current, trailIntensity: value }))}
          />

          <Slider
            label="Trail bloom"
            value={settings.trailBloom}
            min={0}
            max={2.8}
            step={0.05}
            display={settings.trailBloom.toFixed(2)}
            onChange={(value) => setSettings((current) => ({ ...current, trailBloom: value }))}
          />

          <Slider
            label="Chromatic aberration"
            value={settings.chromaticAberration}
            min={0}
            max={3}
            step={0.1}
            display={settings.chromaticAberration.toFixed(1)}
            onChange={(value) => setSettings((current) => ({ ...current, chromaticAberration: value }))}
          />

          {settings.viewMode === "physarum" && (
            <>
              <Slider
                label="Turn speed"
                value={settings.slimeTurnSpeed}
                min={0.05}
                max={1.2}
                step={0.01}
                display={settings.slimeTurnSpeed.toFixed(2)}
                onChange={(value) => setSettings((current) => ({ ...current, slimeTurnSpeed: value }))}
              />
              <label>
                Species
                <select
                  value={settings.slimeSpecies}
                  onChange={(e) => {
                    const sp = Number(e.target.value) as 1 | 2 | 3;
                    setSettings((cur) => ({ ...cur, slimeSpecies: sp }));
                    initSlimeAgents(settings.antCount, sp);
                    clearSlimeTrail();
                  }}
                >
                  <option value={1}>1 species</option>
                  <option value={2}>2 species</option>
                  <option value={3}>3 species</option>
                </select>
              </label>
            </>
          )}

          <Slider
            label="Trail lifetime"
            value={settings.pheromoneTtl}
            min={120}
            max={2400}
            step={60}
            display={`${Math.round(settings.pheromoneTtl / 60)}s`}
            onChange={(value) => setSettings((current) => ({ ...current, pheromoneTtl: value }))}
          />

          <Slider
            label="Trail threshold"
            value={settings.trailThreshold}
            min={0}
            max={110}
            step={2}
            display={String(settings.trailThreshold)}
            onChange={(value) => setSettings((current) => ({ ...current, trailThreshold: value }))}
          />

          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.hideWorldInVisualizer}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  hideWorldInVisualizer: event.target.checked
                }))
              }
            />
            Hide food/nest in art modes
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.hideWallsInVisualizer}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  hideWallsInVisualizer: event.target.checked
                }))
              }
            />
            Hide walls in art modes
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.showFlowField}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  showFlowField: event.target.checked
                }))
              }
            />
            Show flow field
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.showAgeContours}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  showAgeContours: event.target.checked
                }))
              }
            />
            Show age contours
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.showSensors}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  showSensors: event.target.checked
                }))
              }
            />
            Show ant sensors
          </label>
        </section>

        <section className="section">
          <h2 className="sectionHeader">Food settings</h2>

          <Slider
            label="Food amount"
            value={settings.foodAmount}
            min={25}
            max={1000}
            step={25}
            display={String(settings.foodAmount)}
            onChange={(value) => setSettings((current) => ({ ...current, foodAmount: value }))}
          />

          <Slider
            label="Food quality"
            value={settings.foodQuality}
            min={0.2}
            max={3}
            step={0.1}
            display={`${settings.foodQuality.toFixed(1)}×`}
            onChange={(value) => setSettings((current) => ({ ...current, foodQuality: value }))}
          />
        </section>

        <section className="section actions">
          <button onClick={() => setIsPaused((value) => !value)}>
            {isPaused ? "▶ Play" : "⏸ Pause"}
          </button>
          <button onClick={resetSimulation}>↺ Reset</button>
          <button onClick={clearTrails}>✦ Clear trails</button>
          <button onClick={clearWalls}>⬛ Clear walls</button>
          <button onClick={seedDemo}>🎮 Demo setup</button>
          <button onClick={generateMaze}>🌀 Random maze</button>
          <button className="savePngBtn" onClick={handleSavePng}>
            📷 Save PNG
          </button>
        </section>

        <section className="section">
          <h2 className="sectionHeader">Stats</h2>
          <div className="stats">
            <p>
              <span>Food collected</span>
              <strong>{stats.foodCollected}</strong>
            </p>
            <p>
              <span>Food remaining</span>
              <strong>{stats.foodRemaining}</strong>
            </p>
            <p>
              <span>Active ants</span>
              <strong>{stats.activeAnts}</strong>
            </p>

            <div className="statBarGroup">
              <div className="statBarLabel">
                <span>Searching</span>
                <strong>{stats.searchingAnts}</strong>
              </div>
              <div className="statBarTrack">
                <div
                  className="statBarFill searching"
                  style={{ width: `${searchingPct.toFixed(1)}%` }}
                />
              </div>
            </div>

            <div className="statBarGroup">
              <div className="statBarLabel">
                <span>Returning</span>
                <strong>{stats.returningAnts}</strong>
              </div>
              <div className="statBarTrack">
                <div
                  className="statBarFill returning"
                  style={{ width: `${returningPct.toFixed(1)}%` }}
                />
              </div>
            </div>

            {isWarsMode && (
              <>
                <div className="colonyStats">
                  <div className="colonyStatRow colonyA">
                    <span className="colonyDot" />
                    <span>Colony A</span>
                    <strong>{stats.colony0Collected}</strong>
                  </div>
                  <div className="colonyStatRow colonyB">
                    <span className="colonyDot" />
                    <span>Colony B</span>
                    <strong>{stats.colony1Collected}</strong>
                  </div>
                </div>
              </>
            )}

            <p>
              <span>Time elapsed</span>
              <strong>{formatTime(stats.elapsedSeconds)}</strong>
            </p>
          </div>
        </section>
      </aside>

      <section className="stage">
        <div className="stageHeader">
          <div>
            <p className="eyebrow">Pheromone arena</p>
            <h2>Lab arena</h2>
            <p>
              Mode: <strong>{settings.viewMode}</strong> · Tool: <strong>{tool}</strong>
            </p>
          </div>

          <div className="legend">
            <span>
              <i className="dot foodTrail" /> Food trail
            </span>
            <span>
              <i className="dot homeTrail" /> Home trail
            </span>
            {isWarsMode && (
              <>
                <span>
                  <i className="dot colonyADot" /> Colony A
                </span>
                <span>
                  <i className="dot colonyBDot" /> Colony B
                </span>
              </>
            )}
            <span>
              <i className="dot wallDot" /> Wall
            </span>
          </div>
        </div>

        <canvas
          ref={canvasRef}
          width={WORLD_WIDTH}
          height={WORLD_HEIGHT}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </section>
    </main>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span className="labelRow">
        <span>{props.label}</span>
        <strong>{props.display}</strong>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}
