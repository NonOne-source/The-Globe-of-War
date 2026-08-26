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
  const [hoveredCountryId, setHoveredCountryId] = useState<string | null>(null);

  // Refs so the render loop (set up once) always sees fresh props without
  // re-creating the whole Three.js scene on every state update.
  const gameRef = useRef(game);
  gameRef.current = game;
  const selectedRef = useRef(selectedCountryId);
  selectedRef.current = selectedCountryId;
  const onSelectRef = useRef(onSelectCountry);
  onSelectRef.current = onSelectCountry;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
    const neighborMat = new THREE.LineBasicMaterial({ color: new THREE.Color("#c9a227"), transparent: true, opacity: 0.35 });
    scene.add(new THREE.LineSegments(neighborGeo, neighborMat));

    // --- Country markers ---
    const markerGroup = new THREE.Group();
    const markerMeshes: THREE.Mesh[] = [];
    const neutralColor = new THREE.Color("#8b96b8");
    for (const country of Object.values(COUNTRIES)) {
      const pos = latLonToVector3(country.lat, country.lon, MARKER_RADIUS);
      const owner = gameRef.current.players.find((p) => p.id === gameRef.current.countries[country.id]?.ownerId);
      const geo = new THREE.SphereGeometry(0.045, 14, 14);
      const mat = new THREE.MeshBasicMaterial({ color: owner ? new THREE.Color(owner.color) : neutralColor });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.userData.countryId = country.id;
      markerGroup.add(mesh);
      markerMeshes.push(mesh);
    }
    scene.add(markerGroup);

    // Pulsing ring highlighting the currently selected country.
    const ringGeo = new THREE.RingGeometry(0.065, 0.09, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#c9a227"), transparent: true, side: THREE.DoubleSide });
    const selectionRing = new THREE.Mesh(ringGeo, ringMat);
    selectionRing.visible = false;
    scene.add(selectionRing);

    // --- Raycasting for tap/click selection ---
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function pickCountry(clientX: number, clientY: number): string | null {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(markerMeshes);
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
        ringMat.opacity = 0.5 + 0.4 * Math.sin(now / 250);
        selectionRing.visible = true;
      } else {
        selectionRing.visible = false;
      }

      // Refresh marker colors + size (ownership and military can change every turn)
      for (const mesh of markerMeshes) {
        const cid = mesh.userData.countryId as string;
        const countryState = gameRef.current.countries[cid];
        const owner = gameRef.current.players.find((p) => p.id === countryState?.ownerId);
        (mesh.material as THREE.MeshBasicMaterial).color.set(owner ? owner.color : "#8b96b8");
        const military = countryState?.military ?? 0;
        const scale = 0.7 + Math.min(1.1, military / 20);
        mesh.scale.setScalar(scale);
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
      <div className="globe-hint">🌍 Klicke ein Land an, um es auszuwählen</div>
      {shownCountry && shownState && (
        <div className="globe-tooltip">
          <strong>{shownCountry.name}</strong>
          <span>{shownOwner ? shownOwner.name : "Neutral"}</span>
          <span className="mono">⚔️ {shownState.military} · +€{shownCountry.income}/Zug</span>
        </div>
      )}
    </div>
  );
}
