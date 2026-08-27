import { useEffect, useRef, useState } from "react";
// @ts-ignore - avoids type-declaration resolution issues for this three.js version in CI
import * as THREE from "three";
// @ts-ignore - three ships no bundled types for the examples/jsm/* import paths
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
// @ts-ignore - topojson-client ships no bundled TypeScript declarations
import { feature } from "topojson-client";
// @ts-ignore - no type declarations shipped for this JSON import
import worldTopology from "world-atlas/countries-110m.json";
import type { GameState } from "./main";
import { COUNTRIES } from "./countries";

const GLOBE_RADIUS = 2;
const MARKER_RADIUS = GLOBE_RADIUS * 1.01;
const BORDER_RADIUS = GLOBE_RADIUS * 1.002;

function latLonToVector3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

interface GlobeProps {
  game: GameState;
  selectedCountryId: string | null;
  onSelectCountry: (id: string) => void;
}

export function Globe({ game, selectedCountryId, onSelectCountry }: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const [hoveredCountryId, setHoveredCountryId] = useState<string | null>(null);

  // Refs so the render loop (set up once) always sees fresh props without
  // re-creating the whole Three.js scene on every state update.
  const gameRef = useRef(game);
  gameRef.current = game;
  const selectedRef = useRef(selectedCountryId);
  selectedRef.current = selectedCountryId;
  const onSelectRef = useRef(onSelectCountry);
  onSelectRef.current = onSelectCountry;
  // Tracks each country's last-seen military value so a sudden change (an attack)
  // can trigger a short flash on that marker instead of just silently updating.
  const prevMilitaryRef = useRef<Record<string, number>>({});
  const flashRef = useRef<Record<string, { start: number; color: string }>>({});

  useEffect(() => {
    const container = containerRef.current;
    const labelLayer = labelLayerRef.current;
    if (!container || !labelLayer) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 5.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3.2;
    controls.maxDistance = 8;
    controls.rotateSpeed = 0.5;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    // --- Base sphere (ocean) ---
    const sphereGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
    const sphereMat = new THREE.MeshPhongMaterial({
      color: new THREE.Color("#101a33"),
      emissive: new THREE.Color("#0a1226"),
      shininess: 6,
    });
    scene.add(new THREE.Mesh(sphereGeo, sphereMat));

    // --- Soft atmosphere glow shell ---
    const glowGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.04, 48, 48);
    const glowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#b8543f"),
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
    });
    scene.add(new THREE.Mesh(glowGeo, glowMat));

    // --- Lights ---
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(4, 3, 5);
    scene.add(sun);

    // --- Country borders from real GeoJSON (converted from TopoJSON at runtime) ---
    const worldCountries = feature(worldTopology as any, (worldTopology as any).objects.countries) as any;
    const borderPositions: number[] = [];
    for (const geom of worldCountries.features) {
      const polygons: number[][][][] =
        geom.geometry.type === "Polygon" ? [geom.geometry.coordinates] : geom.geometry.coordinates;
      for (const polygon of polygons) {
        for (const ring of polygon) {
          for (let i = 0; i < ring.length - 1; i++) {
            const [lon1, lat1] = ring[i];
            const [lon2, lat2] = ring[i + 1];
            const p1 = latLonToVector3(lat1, lon1, BORDER_RADIUS);
            const p2 = latLonToVector3(lat2, lon2, BORDER_RADIUS);
            borderPositions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
          }
        }
      }
    }
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute("position", new THREE.Float32BufferAttribute(borderPositions, 3));
    const borderMat = new THREE.LineBasicMaterial({ color: new THREE.Color("#8b96b8"), transparent: true, opacity: 0.55 });
    scene.add(new THREE.LineSegments(borderGeo, borderMat));

    // --- Neighbor lines: faint arcs showing which capitals are connected, so the
    //     adjacency graph (who can attack whom) is visible at a glance. ---
    const NEIGHBOR_RADIUS = GLOBE_RADIUS * 1.015;
    const neighborPositions: number[] = [];
    const seenPairs = new Set<string>();
    for (const country of Object.values(COUNTRIES)) {
      for (const neighborId of country.neighbors) {
        const pairKey = [country.id, neighborId].sort().join("|");
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        const neighbor = COUNTRIES[neighborId];
        const p1 = latLonToVector3(country.lat, country.lon, NEIGHBOR_RADIUS);
        const p2 = latLonToVector3(neighbor.lat, neighbor.lon, NEIGHBOR_RADIUS);
        neighborPositions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }
    }
    const neighborGeo = new THREE.BufferGeometry();
    neighborGeo.setAttribute("position", new THREE.Float32BufferAttribute(neighborPositions, 3));
    const neighborMat = new THREE.LineBasicMaterial({ color: new THREE.Color("#c9a227"), transparent: true, opacity: 0.3 });
    scene.add(new THREE.LineSegments(neighborGeo, neighborMat));

    // --- Country markers, each with a status ring (owner = solid highlight ring,
    //     neutral = faint dashed-look ring) so ownership reads clearly at a glance,
    //     independent of just the fill color. ---
    interface MarkerEntry {
      countryId: string;
      dot: THREE.Mesh;
      ring: THREE.Mesh;
      crown: THREE.Mesh | null;
      label: HTMLDivElement;
    }
    const markerGroup = new THREE.Group();
    const markers: MarkerEntry[] = [];
    const neutralColor = new THREE.Color("#8b96b8");

    for (const country of Object.values(COUNTRIES)) {
      const pos = latLonToVector3(country.lat, country.lon, MARKER_RADIUS);

      const dotGeo = new THREE.SphereGeometry(0.045, 14, 14);
      const dotMat = new THREE.MeshBasicMaterial({ color: neutralColor });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(pos);
      dot.userData.countryId = country.id;
      markerGroup.add(dot);

      const ringGeo = new THREE.RingGeometry(0.058, 0.072, 24);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(pos);
      ring.lookAt(pos.clone().multiplyScalar(2));
      markerGroup.add(ring);

      const label = document.createElement("div");
      label.className = "globe-military-label";
      label.style.display = "none";
      labelLayer.appendChild(label);

      markers.push({ countryId: country.id, dot, ring, crown: null, label });
    }

    // Kronen-Marker über jeder Hauptstadt (einmalig aus den beim Mount bekannten
    // Spielerdaten aufgebaut — Hauptstädte ändern sich während einer laufenden Partie nicht).
    for (const player of gameRef.current.players) {
      if (!player.capitalCountryId) continue;
      const country = COUNTRIES[player.capitalCountryId];
      if (!country) continue;
      const pos = latLonToVector3(country.lat, country.lon, MARKER_RADIUS + 0.09);
      const crownGeo = new THREE.ConeGeometry(0.03, 0.06, 6);
      const crownMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#c9a227") });
      const crown = new THREE.Mesh(crownGeo, crownMat);
      crown.position.copy(pos);
      crown.lookAt(pos.clone().multiplyScalar(2));
      crown.rotateX(Math.PI / 2);
      markerGroup.add(crown);
      const entry = markers.find((m) => m.countryId === player.capitalCountryId);
      if (entry) entry.crown = crown;
    }

    scene.add(markerGroup);

    // Pulsing selection ring highlighting the currently selected country.
    const selRingGeo = new THREE.RingGeometry(0.075, 0.1, 32);
    const selRingMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#c9a227"), transparent: true, side: THREE.DoubleSide });
    const selectionRing = new THREE.Mesh(selRingGeo, selRingMat);
    selectionRing.visible = false;
    scene.add(selectionRing);

    // --- Raycasting for tap/click selection ---
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const dotMeshes = markers.map((m) => m.dot);

    function pickCountry(clientX: number, clientY: number): string | null {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(dotMeshes);
      return hits.length > 0 ? (hits[0].object.userData.countryId as string) : null;
    }

    function handleClick(e: PointerEvent) {
      const countryId = pickCountry(e.clientX, e.clientY);
      if (countryId) onSelectRef.current(countryId);
    }
    function handleMove(e: PointerEvent) {
      if (e.pointerType === "touch") return; // avoid flicker on touch drag
      setHoveredCountryId(pickCountry(e.clientX, e.clientY));
    }
    renderer.domElement.addEventListener("click", handleClick);
    renderer.domElement.addEventListener("pointermove", handleMove);

    // --- Camera fly-to whichever country becomes selected ---
    let flyFrom: THREE.Vector3 | null = null;
    let flyTo: THREE.Vector3 | null = null;
    let flyStart = 0;
    let flyDistance = camera.position.length();
    const FLY_MS = 800;
    let lastSelected = "";

    function flyToCountry(countryId: string) {
      const country = COUNTRIES[countryId];
      if (!country) return;
      flyFrom = camera.position.clone().normalize();
      flyTo = latLonToVector3(country.lat, country.lon, 1);
      flyDistance = camera.position.length();
      flyStart = performance.now();
      controls.enabled = false;
    }

    function resize() {
      const w = container!.clientWidth;
      const h = container!.clientHeight;
      camera.aspect = w / h || 1;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const projected = new THREE.Vector3();
    const cameraDir = new THREE.Vector3();

    let raf = 0;
    function animate(now: number) {
      raf = requestAnimationFrame(animate);

      if (selectedRef.current && selectedRef.current !== lastSelected) {
        lastSelected = selectedRef.current;
        flyToCountry(lastSelected);
      }

      if (flyFrom && flyTo) {
        const t = Math.min(1, (now - flyStart) / FLY_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        const dir = flyFrom.clone().lerp(flyTo, eased).normalize();
        camera.position.copy(dir.multiplyScalar(flyDistance));
        camera.lookAt(0, 0, 0);
        if (t >= 1) {
          flyFrom = null;
          flyTo = null;
          controls.enabled = true;
        }
      }

      // Selection ring position + pulse
      const selectedId = selectedRef.current;
      const selectedDef = selectedId ? COUNTRIES[selectedId] : null;
      if (selectedDef) {
        const pos = latLonToVector3(selectedDef.lat, selectedDef.lon, MARKER_RADIUS + 0.001);
        selectionRing.position.copy(pos);
        selectionRing.lookAt(pos.clone().multiplyScalar(2));
        const pulse = 0.7 + 0.3 * Math.sin(now / 250);
        selectionRing.scale.setScalar(pulse);
        selRingMat.opacity = 0.5 + 0.4 * Math.sin(now / 250);
        selectionRing.visible = true;
      } else {
        selectionRing.visible = false;
      }

      camera.getWorldDirection(cameraDir);
      const rect = renderer.domElement.getBoundingClientRect();

      for (const marker of markers) {
        const countryState = gameRef.current.countries[marker.countryId];
        const owner = gameRef.current.players.find((p) => p.id === countryState?.ownerId);

        // Fill color + size by military strength.
        const military = countryState?.military ?? 0;
        (marker.dot.material as THREE.MeshBasicMaterial).color.set(owner ? owner.color : "#8b96b8");
        const scale = 0.7 + Math.min(1.1, military / 20);
        marker.dot.scale.setScalar(scale);

        // Status ring: bright white ring around your OWN countries, faint grey
        // ring around neutral ones, no ring for opponents (their fill color speaks for itself).
        const ringMat = marker.ring.material as THREE.MeshBasicMaterial;
        if (owner) {
          ringMat.color.set(0xffffff);
          ringMat.opacity = 0.55;
        } else {
          ringMat.color.set(0x8b96b8);
          ringMat.opacity = 0.25;
        }

        // Attack flash: if military dropped or ownership changed since last frame,
        // briefly flash the marker so combat outcomes are visible, not just numeric.
        const prevMilitary = prevMilitaryRef.current[marker.countryId];
        if (prevMilitary !== undefined && prevMilitary !== military) {
          flashRef.current[marker.countryId] = { start: now, color: military < prevMilitary ? "#b8543f" : "#3e8e7e" };
        }
        prevMilitaryRef.current[marker.countryId] = military;
        const flash = flashRef.current[marker.countryId];
        if (flash) {
          const elapsed = now - flash.start;
          const FLASH_MS = 700;
          if (elapsed < FLASH_MS) {
            const strength = 1 - elapsed / FLASH_MS;
            (marker.dot.material as THREE.MeshBasicMaterial).color.lerp(new THREE.Color(flash.color), strength * 0.85);
            marker.dot.scale.setScalar(scale * (1 + strength * 0.6));
          } else {
            delete flashRef.current[marker.countryId];
          }
        }

        // Project to screen space for the military-count label; hide labels on
        // the far side of the globe so numbers don't clutter through the planet.
        projected.copy(marker.dot.position).project(camera);
        const facingCamera = marker.dot.position.clone().normalize().dot(cameraDir) < -0.1;
        if (facingCamera && projected.z < 1) {
          const x = (projected.x * 0.5 + 0.5) * rect.width;
          const y = (-projected.y * 0.5 + 0.5) * rect.height;
          marker.label.style.display = "block";
          marker.label.style.transform = `translate(${x}px, ${y}px)`;
          marker.label.textContent = String(military);
          marker.label.style.borderColor = owner ? owner.color : "#8b96b8";
          marker.label.classList.toggle("is-neutral", !owner);
        } else {
          marker.label.style.display = "none";
        }

        if (marker.crown) {
          marker.crown.visible = !!owner;
        }
      }

      controls.update();
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("click", handleClick);
      renderer.domElement.removeEventListener("pointermove", handleMove);
      for (const marker of markers) marker.label.remove();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shownCountryId = hoveredCountryId ?? selectedCountryId;
  const shownCountry = shownCountryId ? COUNTRIES[shownCountryId] : null;
  const shownState = shownCountryId ? game.countries[shownCountryId] : null;
  const shownOwner = shownState ? game.players.find((p) => p.id === shownState.ownerId) : null;

  return (
    <div className="globe-panel card">
      <div ref={containerRef} className="globe-canvas" />
      <div ref={labelLayerRef} className="globe-label-layer" />
      <div className="globe-hint">🌍 Klicke ein Land an, um es auszuwählen · 👑 = Hauptstadt</div>
      {shownCountry && shownState && (
        <div className="globe-tooltip">
          <strong>{shownCountry.name}</strong>
          <span>{shownOwner ? shownOwner.name : "Neutral"}</span>
          <span className="mono">⚔️ {shownState.military} · +€{shownCountry.income} · +🛢️{shownCountry.oil}/Zug</span>
        </div>
      )}
    </div>
  );
}
