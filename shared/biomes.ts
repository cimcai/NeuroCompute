export interface Biome {
  id: string;
  name: string;
  color: string;
  description: string;
  terrain: "water" | "lowland" | "upland" | "extreme" | "urban";
  passable: boolean;
  movementCost: number;
  adjacentBiomes: string[];
  emoji: string;
}

export const BIOMES: Biome[] = [
  {
    id: "deep_ocean",
    name: "Deep Ocean",
    color: "#1A4F7A",
    description: "Vast abyssal waters teeming with deep-sea life. Impassable by land agents.",
    terrain: "water",
    passable: false,
    movementCost: 999,
    adjacentBiomes: ["shallow_ocean", "arctic_ocean"],
    emoji: "🌊",
  },
  {
    id: "shallow_ocean",
    name: "Shallow Sea",
    color: "#2E86AB",
    description: "Coastal waters with coral reefs and abundant marine fauna.",
    terrain: "water",
    passable: false,
    movementCost: 999,
    adjacentBiomes: ["deep_ocean", "beach", "wetlands"],
    emoji: "🐠",
  },
  {
    id: "arctic_ocean",
    name: "Arctic Sea",
    color: "#2A6496",
    description: "Frigid polar seas with drifting ice floes.",
    terrain: "water",
    passable: false,
    movementCost: 999,
    adjacentBiomes: ["deep_ocean", "tundra"],
    emoji: "🧊",
  },
  {
    id: "beach",
    name: "Beach & Coast",
    color: "#F0C040",
    description: "Sandy shores where land meets sea. A hub of coastal civilizations.",
    terrain: "lowland",
    passable: true,
    movementCost: 1,
    adjacentBiomes: ["shallow_ocean", "grassland", "desert", "wetlands"],
    emoji: "🏖️",
  },
  {
    id: "grassland",
    name: "Grassland",
    color: "#5BA84A",
    description: "Rolling plains of rich grass supporting herds of grazing creatures.",
    terrain: "lowland",
    passable: true,
    movementCost: 1,
    adjacentBiomes: ["forest", "savanna", "farmland", "beach", "wetlands"],
    emoji: "🌾",
  },
  {
    id: "forest",
    name: "Temperate Forest",
    color: "#2D7A2D",
    description: "Dense woodland with oaks, maples and a rich understory of fauna.",
    terrain: "lowland",
    passable: true,
    movementCost: 2,
    adjacentBiomes: ["grassland", "jungle", "mountain", "wetlands"],
    emoji: "🌲",
  },
  {
    id: "jungle",
    name: "Tropical Jungle",
    color: "#0F6B4A",
    description: "Lush equatorial rainforest, the most biodiverse habitat on the map.",
    terrain: "lowland",
    passable: true,
    movementCost: 3,
    adjacentBiomes: ["forest", "wetlands", "beach", "savanna"],
    emoji: "🌴",
  },
  {
    id: "savanna",
    name: "Savanna",
    color: "#C9933A",
    description: "Warm open woodland with scattered acacia trees and migratory herds.",
    terrain: "lowland",
    passable: true,
    movementCost: 1,
    adjacentBiomes: ["grassland", "desert", "jungle", "beach"],
    emoji: "🦁",
  },
  {
    id: "desert",
    name: "Desert",
    color: "#E8B84B",
    description: "Arid expanses of dunes and sun-cracked earth. Few species survive here.",
    terrain: "lowland",
    passable: true,
    movementCost: 2,
    adjacentBiomes: ["savanna", "beach", "mountain"],
    emoji: "🏜️",
  },
  {
    id: "wetlands",
    name: "Wetlands & Swamp",
    color: "#5C7A3E",
    description: "Waterlogged marshes rich with amphibians, insects, and migratory birds.",
    terrain: "lowland",
    passable: true,
    movementCost: 3,
    adjacentBiomes: ["grassland", "forest", "jungle", "shallow_ocean", "beach"],
    emoji: "🐸",
  },
  {
    id: "mountain",
    name: "Mountain",
    color: "#7A7A7A",
    description: "Rocky highlands where only hardy creatures and alpine flora survive.",
    terrain: "upland",
    passable: true,
    movementCost: 3,
    adjacentBiomes: ["forest", "tundra", "desert", "grassland"],
    emoji: "⛰️",
  },
  {
    id: "tundra",
    name: "Tundra",
    color: "#B8C8C8",
    description: "Frozen plains at the poles. Life clings on here in sparse, resilient forms.",
    terrain: "upland",
    passable: true,
    movementCost: 2,
    adjacentBiomes: ["arctic_ocean", "mountain"],
    emoji: "❄️",
  },
  {
    id: "volcanic",
    name: "Volcanic Wastes",
    color: "#8B2000",
    description: "Scorched lava fields and caldera vents. Hostile to most life.",
    terrain: "extreme",
    passable: true,
    movementCost: 4,
    adjacentBiomes: ["mountain", "desert"],
    emoji: "🌋",
  },
  {
    id: "farmland",
    name: "Farmland & Plains",
    color: "#A8C878",
    description: "Cultivated fields shaped by civilization. The breadbasket of the world.",
    terrain: "lowland",
    passable: true,
    movementCost: 1,
    adjacentBiomes: ["grassland", "settlement"],
    emoji: "🌽",
  },
  {
    id: "settlement",
    name: "Settlement",
    color: "#C8B89A",
    description: "A node-built town or city. The heart of civilization on this world.",
    terrain: "urban",
    passable: true,
    movementCost: 1,
    adjacentBiomes: ["farmland", "grassland", "beach"],
    emoji: "🏙️",
  },
];

export const BIOME_BY_ID = new Map<string, Biome>(BIOMES.map(b => [b.id, b]));
export const BIOME_BY_COLOR = new Map<string, Biome>(BIOMES.map(b => [b.color.toLowerCase(), b]));

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function getBiomeByColor(hex: string): Biome | undefined {
  const exact = BIOME_BY_COLOR.get(hex.toLowerCase());
  if (exact) return exact;
  // Nearest by RGB Euclidean distance
  const [r, g, b] = hexToRgb(hex);
  let best: Biome | undefined;
  let bestDist = Infinity;
  for (const biome of BIOMES) {
    const [br, bg, bb] = hexToRgb(biome.color);
    const dist = (r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2;
    if (dist < bestDist) { bestDist = dist; best = biome; }
  }
  return best;
}

export function getBiomeNeighborSuggestions(biomeId: string): string[] {
  return BIOME_BY_ID.get(biomeId)?.adjacentBiomes ?? [];
}

export const BIOME_COLORS = BIOMES.map(b => b.color);
