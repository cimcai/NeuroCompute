export type Species =
  | "trees" | "flowers" | "bees" | "butterflies"
  | "birds" | "bunnies" | "foxes" | "bears" | "buffalos";

export const SPECIES: Species[] = [
  "trees", "flowers", "bees", "butterflies",
  "birds", "bunnies", "foxes", "bears", "buffalos",
];

export const SPECIES_META: Record<Species, { emoji: string; label: string; color: string }> = {
  trees:       { emoji: "🌲", label: "Trees",       color: "#2D7A2D" },
  flowers:     { emoji: "🌸", label: "Flowers",     color: "#EC4899" },
  bees:        { emoji: "🐝", label: "Bees",        color: "#FACC15" },
  butterflies: { emoji: "🦋", label: "Butterflies", color: "#A78BFA" },
  birds:       { emoji: "🐦", label: "Birds",       color: "#60A5FA" },
  bunnies:     { emoji: "🐰", label: "Bunnies",     color: "#F9A8D4" },
  foxes:       { emoji: "🦊", label: "Foxes",       color: "#FB923C" },
  bears:       { emoji: "🐻", label: "Bears",       color: "#92400E" },
  buffalos:    { emoji: "🦬", label: "Buffalos",    color: "#78716C" },
};

export type Biome = "grassland" | "forest" | "jungle" | "desert" | "wetlands" | "tundra";

export const BIOMES: { id: Biome; name: string; emoji: string; modifiers: Partial<Record<Species, number>> }[] = [
  { id: "grassland", name: "Grassland", emoji: "🌾", modifiers: { flowers: 1.3, bunnies: 1.2, buffalos: 1.5, butterflies: 1.2 } },
  { id: "forest",    name: "Forest",    emoji: "🌲", modifiers: { trees: 1.5, birds: 1.3, bears: 1.3, foxes: 1.1 } },
  { id: "jungle",    name: "Jungle",    emoji: "🌴", modifiers: { trees: 1.6, butterflies: 1.5, birds: 1.4, bees: 1.3 } },
  { id: "desert",    name: "Desert",    emoji: "🏜️", modifiers: { trees: 0.4, flowers: 0.5, bees: 0.6, bunnies: 0.7, foxes: 1.1 } },
  { id: "wetlands",  name: "Wetlands",  emoji: "🌿", modifiers: { flowers: 1.2, butterflies: 1.4, birds: 1.3, bears: 0.8 } },
  { id: "tundra",    name: "Tundra",    emoji: "❄️", modifiers: { trees: 0.3, flowers: 0.3, bees: 0.2, bears: 1.4, foxes: 1.2 } },
];

export type State = Record<Species, number>;

export interface SimSnapshot {
  tick: number;
  state: State;
  biodiversity: number;     // 0..9 (species alive)
  totalCreatures: number;
  shannon: number;          // Shannon diversity index
}

export interface SimConfig {
  biome: Biome;
  initial: State;
  ticks: number;             // total ticks to run
  weatherChaos: number;      // 0..1 random shock magnitude
  predationStrength: number; // 0..2 multiplier on predator-prey rates
}

export const PRESET_WORLDS: { id: string; name: string; emoji: string; description: string; state: State; biome: Biome }[] = [
  {
    id: "primordial",
    name: "Primordial Garden",
    emoji: "🌱",
    description: "A handful of trees and flowers — what will grow?",
    biome: "grassland",
    state: { trees: 4, flowers: 6, bees: 0, butterflies: 0, birds: 0, bunnies: 0, foxes: 0, bears: 0, buffalos: 0 },
  },
  {
    id: "pollinator-paradise",
    name: "Pollinator Paradise",
    emoji: "🐝",
    description: "Heavy on bees & butterflies. Will they crash without flowers?",
    biome: "grassland",
    state: { trees: 2, flowers: 12, bees: 8, butterflies: 6, birds: 0, bunnies: 0, foxes: 0, bears: 0, buffalos: 0 },
  },
  {
    id: "predator-test",
    name: "Predator Test",
    emoji: "🦊",
    description: "Foxes & bears with limited prey — classic boom-bust setup.",
    biome: "forest",
    state: { trees: 8, flowers: 4, bees: 2, butterflies: 1, birds: 3, bunnies: 6, foxes: 4, bears: 2, buffalos: 0 },
  },
  {
    id: "lush-jungle",
    name: "Lush Jungle",
    emoji: "🌴",
    description: "Maximum tree cover, bird-heavy. Bees vs birds.",
    biome: "jungle",
    state: { trees: 14, flowers: 8, bees: 6, butterflies: 5, birds: 7, bunnies: 3, foxes: 1, bears: 1, buffalos: 0 },
  },
  {
    id: "savage-desert",
    name: "Savage Desert",
    emoji: "🏜️",
    description: "Hard mode — most species struggle, foxes thrive.",
    biome: "desert",
    state: { trees: 2, flowers: 1, bees: 1, butterflies: 0, birds: 1, bunnies: 2, foxes: 3, bears: 0, buffalos: 0 },
  },
  {
    id: "balanced-biome",
    name: "Balanced Biome",
    emoji: "⚖️",
    description: "All 9 species seeded equally. Which dominates?",
    biome: "wetlands",
    state: { trees: 4, flowers: 4, bees: 4, butterflies: 4, birds: 4, bunnies: 4, foxes: 4, bears: 4, buffalos: 4 },
  },
  {
    id: "frozen-edge",
    name: "Frozen Edge",
    emoji: "❄️",
    description: "Tundra survival. Only the toughest persist.",
    biome: "tundra",
    state: { trees: 1, flowers: 0, bees: 0, butterflies: 0, birds: 2, bunnies: 3, foxes: 4, bears: 3, buffalos: 0 },
  },
];

function emptyState(): State {
  return { trees: 0, flowers: 0, bees: 0, butterflies: 0, birds: 0, bunnies: 0, foxes: 0, bears: 0, buffalos: 0 };
}

function shannonIndex(s: State): number {
  const total = SPECIES.reduce((sum, sp) => sum + s[sp], 0);
  if (total === 0) return 0;
  let h = 0;
  for (const sp of SPECIES) {
    const p = s[sp] / total;
    if (p > 0) h -= p * Math.log(p);
  }
  return h;
}

function biodiversityCount(s: State): number {
  return SPECIES.reduce((n, sp) => n + (s[sp] >= 1 ? 1 : 0), 0);
}

/** Apply one ecology tick. Returns the new state. */
function step(prev: State, cfg: SimConfig, rand: () => number): State {
  const biome = BIOMES.find(b => b.id === cfg.biome)!;
  // Floor modifier so caps never collapse to 0 (would produce NaN/Infinity below).
  const m = (sp: Species) => Math.max(0.05, biome.modifiers[sp] ?? 1);
  const next = { ...prev };
  const pred = cfg.predationStrength;

  // Trees: slow growth toward carrying cap, depend on biome
  const treeCap = Math.max(1, 25 * m("trees"));
  next.trees += (prev.trees * 0.06 * (1 - prev.trees / treeCap)) + 0.05 * m("trees");
  if (prev.trees > treeCap) next.trees -= (prev.trees - treeCap) * 0.05;

  // Flowers: spawn from trees & bees, consumed by herbivores
  const flowerCap = Math.max(1, 30 * m("flowers"));
  const flowerGrowth = (prev.trees * 0.08 + prev.bees * 0.15 + 0.1) * m("flowers");
  const flowerEaten = prev.bunnies * 0.15 + prev.buffalos * 0.25 + prev.butterflies * 0.05;
  next.flowers += flowerGrowth * (1 - prev.flowers / flowerCap) - flowerEaten;

  // Bees: need flowers, eaten by birds
  if (prev.flowers > 0) {
    next.bees += prev.bees * 0.1 * Math.min(1, prev.flowers / 10) * m("bees") - prev.bees * 0.04;
  } else {
    next.bees -= prev.bees * 0.18;
  }
  next.bees -= prev.birds * 0.08 * pred;

  // Butterflies: need flowers, fragile
  if (prev.flowers > 0) {
    next.butterflies += prev.butterflies * 0.12 * Math.min(1, prev.flowers / 8) * m("butterflies") - prev.butterflies * 0.06;
  } else {
    next.butterflies -= prev.butterflies * 0.25;
  }
  next.butterflies -= prev.birds * 0.05 * pred;

  // Birds: need trees, eat bees+butterflies
  if (prev.trees > 0) {
    const food = prev.bees + prev.butterflies;
    next.birds += prev.birds * 0.07 * Math.min(1, prev.trees / 5) * Math.min(1, food / 4 + 0.3) * m("birds") - prev.birds * 0.04;
  } else {
    next.birds -= prev.birds * 0.15;
  }

  // Bunnies: eat flowers, reproduce fast
  if (prev.flowers > 1) {
    next.bunnies += prev.bunnies * 0.18 * Math.min(1, prev.flowers / 6) * m("bunnies") + 0.05 * m("bunnies");
  } else {
    next.bunnies -= prev.bunnies * 0.12;
  }
  next.bunnies -= prev.foxes * 0.18 * pred + prev.bears * 0.05 * pred;

  // Foxes: eat bunnies
  if (prev.bunnies > 1) {
    next.foxes += prev.foxes * 0.1 * Math.min(1, prev.bunnies / 5) * m("foxes") - prev.foxes * 0.04;
  } else {
    next.foxes -= prev.foxes * 0.18;
  }
  next.foxes -= prev.bears * 0.04 * pred;

  // Bears: need trees + meat (bunnies/foxes)
  const meat = prev.bunnies + prev.foxes;
  if (prev.trees > 3 && meat > 1) {
    next.bears += prev.bears * 0.05 * Math.min(1, meat / 6) * m("bears") - prev.bears * 0.03;
  } else {
    next.bears -= prev.bears * 0.1;
  }

  // Buffalos: need lots of flowers
  if (prev.flowers > 4) {
    next.buffalos += prev.buffalos * 0.07 * Math.min(1, prev.flowers / 12) * m("buffalos") - prev.buffalos * 0.03;
  } else {
    next.buffalos -= prev.buffalos * 0.12;
  }
  next.buffalos -= prev.bears * 0.03 * pred;

  // Weather chaos — random species-wide shock
  if (cfg.weatherChaos > 0 && rand() < cfg.weatherChaos * 0.15) {
    const sp = SPECIES[Math.floor(rand() * SPECIES.length)];
    const shock = (rand() - 0.5) * cfg.weatherChaos * 0.6;
    next[sp] += next[sp] * shock;
  }

  // Floor & cap (also defends against any accidental NaN/Infinity)
  for (const sp of SPECIES) {
    if (!Number.isFinite(next[sp])) next[sp] = 0;
    next[sp] = Math.max(0, next[sp]);
    if (next[sp] < 0.5 && next[sp] > 0) {
      // small populations slide toward extinction
      if (rand() < 0.25) next[sp] = 0;
    }
    next[sp] = Math.min(next[sp], 200);
  }

  return next;
}

/** Run a full simulation, returning a snapshot every `sampleEvery` ticks (always includes start & end). */
export function runSimulation(cfg: SimConfig, sampleEvery = 5, seed = 1): SimSnapshot[] {
  let s = { ...cfg.initial };
  // simple LCG so runs are reproducible per seed
  let r = seed >>> 0;
  const rand = () => {
    r = (r * 1664525 + 1013904223) >>> 0;
    return r / 0xffffffff;
  };

  const snapshots: SimSnapshot[] = [
    { tick: 0, state: { ...s }, biodiversity: biodiversityCount(s), totalCreatures: SPECIES.reduce((n, sp) => n + Math.round(s[sp]), 0), shannon: shannonIndex(s) },
  ];

  for (let t = 1; t <= cfg.ticks; t++) {
    s = step(s, cfg, rand);
    if (t === cfg.ticks || t % sampleEvery === 0) {
      snapshots.push({
        tick: t,
        state: { ...s },
        biodiversity: biodiversityCount(s),
        totalCreatures: SPECIES.reduce((n, sp) => n + Math.round(s[sp]), 0),
        shannon: shannonIndex(s),
      });
    }
  }
  return snapshots;
}

/** Convert a leaderboard score row into a starting State. */
export function stateFromScoreRow(row: {
  treeCount: number; birdCount: number; bunnyCount: number; foxCount: number;
  bearCount: number; buffaloCount: number; beeCount: number; butterflyCount: number; flowerCount: number;
}): State {
  return {
    trees: row.treeCount, flowers: row.flowerCount, bees: row.beeCount, butterflies: row.butterflyCount,
    birds: row.birdCount, bunnies: row.bunnyCount, foxes: row.foxCount, bears: row.bearCount, buffalos: row.buffaloCount,
  };
}

export { emptyState, biodiversityCount, shannonIndex };
