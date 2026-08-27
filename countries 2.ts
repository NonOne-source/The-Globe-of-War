// Länder-Datenmodell für "Mini-Weltmacht". Vereinfachte Geografie: 35 Länder über
// alle Kontinente verteilt, verbunden über ein Nachbarschaftsnetz. Manche Verbindungen
// sind bewusst vereinfachte "Seewege" (z. B. Ägypten–Italien übers Mittelmeer, oder
// Japan–Russland), damit auch Inseln und entfernte Regionen erreichbar bleiben, ohne
// jedes Land der Erde abbilden zu müssen.

export interface CountryDef {
  id: string;
  name: string;
  lat: number;
  lon: number;
  income: number; // Gold pro Zug, wenn im eigenen Besitz
  oil: number; // Öl pro Zug, wenn im eigenen Besitz (limitiert Militärbau)
  neighbors: string[];
}

const BASE: Record<string, { name: string; lat: number; lon: number; income: number; oil: number }> = {
  usa: { name: "USA", lat: 39, lon: -98, income: 90, oil: 10 },
  canada: { name: "Kanada", lat: 56, lon: -106, income: 55, oil: 8 },
  mexico: { name: "Mexiko", lat: 23, lon: -102, income: 45, oil: 6 },
  colombia: { name: "Kolumbien", lat: 4, lon: -74, income: 40, oil: 4 },
  venezuela: { name: "Venezuela", lat: 8, lon: -66, income: 35, oil: 12 },
  peru: { name: "Peru", lat: -10, lon: -76, income: 35, oil: 0 },
  brazil: { name: "Brasilien", lat: -10, lon: -55, income: 70, oil: 3 },
  argentina: { name: "Argentinien", lat: -34, lon: -64, income: 50, oil: 2 },
  chile: { name: "Chile", lat: -33, lon: -71, income: 40, oil: 0 },
  uk: { name: "Vereinigtes Königreich", lat: 54, lon: -2, income: 60, oil: 4 },
  france: { name: "Frankreich", lat: 47, lon: 2, income: 65, oil: 0 },
  germany: { name: "Deutschland", lat: 51, lon: 10, income: 70, oil: 0 },
  netherlands: { name: "Niederlande", lat: 52, lon: 5, income: 45, oil: 2 },
  spain: { name: "Spanien", lat: 40, lon: -4, income: 50, oil: 0 },
  italy: { name: "Italien", lat: 43, lon: 12, income: 55, oil: 0 },
  poland: { name: "Polen", lat: 52, lon: 19, income: 45, oil: 0 },
  russia: { name: "Russland", lat: 61, lon: 90, income: 85, oil: 20 },
  turkey: { name: "Türkei", lat: 39, lon: 35, income: 50, oil: 1 },
  china: { name: "China", lat: 35, lon: 103, income: 95, oil: 6 },
  india: { name: "Indien", lat: 21, lon: 78, income: 80, oil: 2 },
  pakistan: { name: "Pakistan", lat: 30, lon: 70, income: 40, oil: 1 },
  iran: { name: "Iran", lat: 32, lon: 53, income: 45, oil: 15 },
  saudi: { name: "Saudi-Arabien", lat: 24, lon: 45, income: 50, oil: 18 },
  egypt: { name: "Ägypten", lat: 27, lon: 30, income: 40, oil: 3 },
  nigeria: { name: "Nigeria", lat: 9, lon: 8, income: 45, oil: 10 },
  kenya: { name: "Kenia", lat: 1, lon: 38, income: 30, oil: 0 },
  southafrica: { name: "Südafrika", lat: -29, lon: 24, income: 50, oil: 1 },
  morocco: { name: "Marokko", lat: 32, lon: -6, income: 35, oil: 0 },
  japan: { name: "Japan", lat: 36, lon: 138, income: 70, oil: 0 },
  southkorea: { name: "Südkorea", lat: 36, lon: 128, income: 55, oil: 0 },
  vietnam: { name: "Vietnam", lat: 14, lon: 108, income: 40, oil: 2 },
  indonesia: { name: "Indonesien", lat: -2, lon: 118, income: 45, oil: 5 },
  philippines: { name: "Philippinen", lat: 13, lon: 122, income: 35, oil: 0 },
  australia: { name: "Australien", lat: -25, lon: 134, income: 55, oil: 4 },
  newzealand: { name: "Neuseeland", lat: -41, lon: 174, income: 35, oil: 0 },
};

const EDGES: [string, string][] = [
  ["usa", "canada"], ["usa", "mexico"],
  ["mexico", "colombia"],
  ["colombia", "venezuela"], ["colombia", "peru"],
  ["peru", "chile"], ["peru", "brazil"],
  ["brazil", "argentina"], ["brazil", "venezuela"],
  ["argentina", "chile"],
  ["uk", "france"], ["uk", "netherlands"],
  ["france", "germany"], ["france", "spain"], ["france", "italy"],
  ["germany", "netherlands"], ["germany", "poland"],
  ["poland", "russia"],
  ["russia", "turkey"], ["russia", "china"], ["russia", "iran"], ["russia", "japan"],
  ["turkey", "iran"], ["turkey", "egypt"],
  ["italy", "egypt"], ["italy", "morocco"],
  ["spain", "morocco"],
  ["egypt", "saudi"], ["egypt", "kenya"], ["egypt", "nigeria"],
  ["saudi", "iran"], ["saudi", "pakistan"],
  ["iran", "pakistan"],
  ["india", "pakistan"], ["india", "china"],
  ["china", "vietnam"], ["china", "southkorea"],
  ["vietnam", "indonesia"],
  ["indonesia", "philippines"], ["indonesia", "australia"],
  ["australia", "newzealand"],
  ["japan", "southkorea"], ["japan", "philippines"],
  ["nigeria", "southafrica"], ["nigeria", "kenya"],
  ["kenya", "southafrica"],
];

function buildNeighbors(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const id of Object.keys(BASE)) map[id] = [];
  for (const [a, b] of EDGES) {
    map[a].push(b);
    map[b].push(a);
  }
  return map;
}

const NEIGHBORS = buildNeighbors();

export const COUNTRIES: Record<string, CountryDef> = Object.fromEntries(
  Object.entries(BASE).map(([id, def]) => [id, { id, ...def, neighbors: NEIGHBORS[id] }]),
);

export const COUNTRY_ORDER = Object.keys(BASE);

export const PLAYER_COLORS = ["#C9A227", "#3E8E7E", "#B8543F", "#6C7DD9", "#D98E4A", "#9B6BC9"];

// Balancing-Konstanten, in beiden Client & Server importiert.
export const STARTING_GOLD = 150;
export const STARTING_OIL = 25;
export const STARTING_MILITARY = 8;
export const NEUTRAL_MILITARY_MIN = 3;
export const NEUTRAL_MILITARY_MAX = 6;
export const MAX_MILITARY = 25;
export const MILITARY_COST_GOLD = 12; // Gold pro Militärpunkt
export const MILITARY_COST_OIL = 1; // Öl pro Militärpunkt
export const TURN_TIME_MS = 90_000; // Zeitlimit pro Zug, danach automatisches Zugende
export const UNREST_THRESHOLD = 3; // Länder mit weniger Militär riskieren eine Rebellion
export const UNREST_CHANCE = 0.12;
export const FRONTLINE_DEFENSE_BONUS = 0.12; // +12% Verteidigung pro angrenzendem eigenen Land
export const RANDOM_EVENT_CHANCE = 0.2;
