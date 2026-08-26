// Länder-Datenmodell für "Mini-Weltmacht". Vereinfachte Geografie: 24 Länder über
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
  neighbors: string[];
}

const BASE: Record<string, { name: string; lat: number; lon: number; income: number }> = {
  usa: { name: "USA", lat: 39, lon: -98, income: 90 },
  canada: { name: "Kanada", lat: 56, lon: -106, income: 55 },
  mexico: { name: "Mexiko", lat: 23, lon: -102, income: 45 },
  colombia: { name: "Kolumbien", lat: 4, lon: -74, income: 40 },
  peru: { name: "Peru", lat: -10, lon: -76, income: 35 },
  brazil: { name: "Brasilien", lat: -10, lon: -55, income: 70 },
  argentina: { name: "Argentinien", lat: -34, lon: -64, income: 50 },
  uk: { name: "Vereinigtes Königreich", lat: 54, lon: -2, income: 60 },
  france: { name: "Frankreich", lat: 47, lon: 2, income: 65 },
  germany: { name: "Deutschland", lat: 51, lon: 10, income: 70 },
  spain: { name: "Spanien", lat: 40, lon: -4, income: 50 },
  italy: { name: "Italien", lat: 43, lon: 12, income: 55 },
  poland: { name: "Polen", lat: 52, lon: 19, income: 45 },
  russia: { name: "Russland", lat: 61, lon: 90, income: 85 },
  china: { name: "China", lat: 35, lon: 103, income: 95 },
  india: { name: "Indien", lat: 21, lon: 78, income: 80 },
  iran: { name: "Iran", lat: 32, lon: 53, income: 45 },
  saudi: { name: "Saudi-Arabien", lat: 24, lon: 45, income: 50 },
  egypt: { name: "Ägypten", lat: 27, lon: 30, income: 40 },
  nigeria: { name: "Nigeria", lat: 9, lon: 8, income: 45 },
  southafrica: { name: "Südafrika", lat: -29, lon: 24, income: 50 },
  japan: { name: "Japan", lat: 36, lon: 138, income: 70 },
  indonesia: { name: "Indonesien", lat: -2, lon: 118, income: 45 },
  australia: { name: "Australien", lat: -25, lon: 134, income: 55 },
};

const EDGES: [string, string][] = [
  ["usa", "canada"],
  ["usa", "mexico"],
  ["mexico", "colombia"],
  ["colombia", "peru"],
  ["peru", "brazil"],
  ["peru", "argentina"],
  ["brazil", "argentina"],
  ["uk", "france"],
  ["france", "germany"],
  ["france", "spain"],
  ["france", "italy"],
  ["germany", "poland"],
  ["poland", "russia"],
  ["russia", "china"],
  ["russia", "iran"],
  ["russia", "japan"],
  ["china", "india"],
  ["china", "indonesia"],
  ["china", "japan"],
  ["india", "iran"],
  ["india", "saudi"],
  ["iran", "saudi"],
  ["saudi", "egypt"],
  ["egypt", "italy"],
  ["egypt", "nigeria"],
  ["nigeria", "southafrica"],
  ["indonesia", "australia"],
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
export const STARTING_GOLD = 120;
export const STARTING_MILITARY = 8;
export const NEUTRAL_MILITARY_MIN = 3;
export const NEUTRAL_MILITARY_MAX = 6;
export const MAX_MILITARY = 25;
export const MILITARY_COST = 12; // Gold pro Militärpunkt
