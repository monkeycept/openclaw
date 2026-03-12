import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

const HILLSIDE_CENTER = [144.741, -37.6905];
const HILLSIDE_RADIUS_METERS = 2800;
const MODEL_LAYER_ID = 'custom-3d-models';

const statusEl = document.getElementById('status');
const coordsEl = document.getElementById('coords');
const locateBtn = document.getElementById('locateBtn');
const followBtn = document.getElementById('followBtn');
const hillsideBtn = document.getElementById('hillsideBtn');
const modelForm = document.getElementById('modelForm');
const addressInput = document.getElementById('addressInput');
const modelUrlInput = document.getElementById('modelUrlInput');
const modelFileInput = document.getElementById('modelFileInput');
const scaleInput = document.getElementById('scaleInput');
const rotationInput = document.getElementById('rotationInput');
const heightInput = document.getElementById('heightInput');
const placedModelsEl = document.getElementById('placedModels');

const map = new maplibregl.Map({
  container: 'map',
  center: HILLSIDE_CENTER,
  zoom: 15,
  pitch: 58,
  bearing: -20,
  antialias: true,
  style: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  },
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');

let userMarker = null;
let userAccuracyPopup = null;
let watcherId = null;
let followMode = false;
let scene;
let camera;
let renderer;
const gltfLoader = new GLTFLoader();
const placedModels = [];

function setStatus(text) { statusEl.textContent = text; }
function setCoords({ latitude, longitude, accuracy }) {
  coordsEl.textContent = `Lat ${latitude.toFixed(5)}, Lng ${longitude.toFixed(5)} • accuracy ±${Math.round(accuracy)}m`;
}
function degToRad(value) { return (value * Math.PI) / 180; }
function renderPlacedModelsList() {
  placedModelsEl.innerHTML = '';
  if (!placedModels.length) return;
  for (const model of placedModels) {
    const item = document.createElement('div');
    item.className = 'placed-model';
    item.textContent = `${model.address} → ${model.sourceLabel}`;
    placedModelsEl.appendChild(item);
  }
}
function buildingHeight(properties = {}) {
  const levels = Number.parseFloat(properties['building:levels'] || properties.levels || '');
  const explicitHeight = Number.parseFloat(String(properties.height || '').replace(/[^\d.]/g, ''));
  if (Number.isFinite(explicitHeight) && explicitHeight > 0) return explicitHeight;
  if (Number.isFinite(levels) && levels > 0) return Math.max(4, levels * 3.2);
  return 8 + ((Number(properties.id) || 1) % 5) * 2.5;
}
function prepareBuildings(geojson) {
  return {
    type: 'FeatureCollection',
    features: (geojson.features || [])
      .filter((feature) => feature.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'))
      .filter((feature) => feature.properties && feature.properties.building)
      .map((feature, index) => ({
        ...feature,
        properties: {
          ...feature.properties,
          id: feature.properties.id || index + 1,
          render_height: buildingHeight(feature.properties),
          base_height: 0,
          color: feature.properties.building === 'house' ? '#c08457' : '#94a3b8',
        },
      })),
  };
}
async function loadBuildings() {
  setStatus('Loading 3D buildings around Hillside 3037…');
  const query = `
    [out:json][timeout:25];
    (
      way["building"](around:${HILLSIDE_RADIUS_METERS},${HILLSIDE_CENTER[1]},${HILLSIDE_CENTER[0]});
      relation["building"](around:${HILLSIDE_RADIUS_METERS},${HILLSIDE_CENTER[1]},${HILLSIDE_CENTER[0]});
    );
    out body; >; out skel qt;`;
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', body: query.trim(), headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
  });
  if (!response.ok) throw new Error(`Building data request failed (${response.status})`);
  const prepared = prepareBuildings(osmtogeojson(await response.json()));
  if (map.getSource('buildings')) {
    map.getSource('buildings').setData(prepared);
  } else {
    map.addSource('buildings', { type: 'geojson', data: prepared });
    map.addLayer({
      id: 'building-extrusions', type: 'fill-extrusion', source: 'buildings',
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': ['get', 'render_height'],
        'fill-extrusion-base': ['get', 'base_height'],
        'fill-extrusion-opacity': 0.82,
      },
    });
    map.addLayer({
      id: 'building-footprints', type: 'line', source: 'buildings',
      paint: { 'line-color': '#334155', 'line-width': 0.6 },
    });
  }
  setStatus(`Loaded ${prepared.features.length} 3D buildings around Hillside 3037.`);
}
function updateUserLocation(position) {
  const { latitude, longitude, accuracy } = position.coords;
  const lngLat = [longitude, latitude];
  setCoords(position.coords);
  if (!userMarker) {
    userMarker = new maplibregl.Marker({ color: '#38bdf8' })
      .setLngLat(lngLat)
      .setPopup(new maplibregl.Popup({ offset: 25 }).setText('You are here'))
      .addTo(map);
  } else userMarker.setLngLat(lngLat);
  if (userAccuracyPopup) userAccuracyPopup.remove();
  userAccuracyPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 })
    .setLngLat(lngLat)
    .setHTML(`<strong>Your location</strong><br>Accuracy: ±${Math.round(accuracy)}m`)
    .addTo(map);
  if (followMode) map.easeTo({ center: lngLat, zoom: Math.max(map.getZoom(), 17), pitch: 60, duration: 900 });
}
function handleSuccess(position) {
  setStatus(`Location updated at ${new Date(position.timestamp).toLocaleTimeString()}.`);
  updateUserLocation(position);
  if (!followMode && userMarker) {
    userMarker.togglePopup();
    map.flyTo({ center: userMarker.getLngLat(), zoom: 17, pitch: 60, speed: 0.9 });
  }
}
function handleError(error) {
  const messages = {
    1: 'Location permission denied. Enable it in Safari settings and try again.',
    2: 'Location unavailable right now. Try stepping outside or checking signal.',
    3: 'Location request timed out. Try again.',
  };
  setStatus(messages[error.code] || `Location failed: ${error.message}`);
}
function locateOnce() {
  if (!navigator.geolocation) return setStatus('This browser does not support geolocation.');
  setStatus('Finding your location…');
  navigator.geolocation.getCurrentPosition(handleSuccess, handleError, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}
function startFollowing() {
  if (!navigator.geolocation) return setStatus('This browser does not support geolocation.');
  if (watcherId !== null) navigator.geolocation.clearWatch(watcherId);
  watcherId = navigator.geolocation.watchPosition(handleSuccess, handleError, { enableHighAccuracy: true, timeout: 15000, maximumAge: 1000 });
}
async function geocodeAddress(address) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', address);
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Geocoding failed (${response.status})`);
  const results = await response.json();
  if (!results.length) throw new Error('Address not found');
  return { lng: Number(results[0].lon), lat: Number(results[0].lat), label: results[0].display_name };
}
function ensureModelLayer() {
  if (map.getLayer(MODEL_LAYER_ID)) return;
  const customLayer = {
    id: MODEL_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd(mapInstance, gl) {
      camera = new THREE.Camera();
      scene = new THREE.Scene();
      const lightA = new THREE.DirectionalLight(0xffffff, 1.2);
      lightA.position.set(0, -70, 100).normalize();
      const lightB = new THREE.DirectionalLight(0xffffff, 0.7);
      lightB.position.set(0, 70, 80).normalize();
      scene.add(lightA);
      scene.add(lightB);
      renderer = new THREE.WebGLRenderer({ canvas: mapInstance.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },
    render(mapInstance, matrix) {
      const m = new THREE.Matrix4().fromArray(matrix);
      camera.projectionMatrix = m;
      renderer.resetState();
      renderer.render(scene, camera);
      mapInstance.triggerRepaint();
    },
  };
  map.addLayer(customLayer);
}
async function loadModelSource(url) {
  return await gltfLoader.loadAsync(url);
}
function addMapPin(lngLat, label) {
  const popup = new maplibregl.Popup({ offset: 25 }).setText(label);
  new maplibregl.Marker({ color: '#f59e0b' }).setLngLat(lngLat).setPopup(popup).addTo(map);
}
async function placeModelAtAddress({ address, modelUrl, scale, rotationDeg, heightMeters, sourceLabel }) {
  setStatus(`Geocoding ${address}…`);
  const location = await geocodeAddress(address);
  ensureModelLayer();
  setStatus('Loading GLB…');
  const gltf = await loadModelSource(modelUrl);
  const model = gltf.scene;
  const merc = maplibregl.MercatorCoordinate.fromLngLat([location.lng, location.lat], heightMeters);
  const metersScale = merc.meterInMercatorCoordinateUnits();
  model.scale.setScalar(scale * metersScale);
  model.rotation.x = Math.PI / 2;
  model.rotation.y = degToRad(rotationDeg);
  model.position.set(merc.x, merc.y, merc.z);
  scene.add(model);
  placedModels.push({ address: location.label, sourceLabel });
  renderPlacedModelsList();
  addMapPin([location.lng, location.lat], location.label);
  map.flyTo({ center: [location.lng, location.lat], zoom: 18, pitch: 65, bearing: -20, speed: 0.8 });
  setStatus(`Placed model at ${location.label}.`);
}
modelForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const address = addressInput.value.trim();
  const urlValue = modelUrlInput.value.trim();
  const file = modelFileInput.files?.[0];
  if (!address) return setStatus('Enter an address first.');
  if (!urlValue && !file) return setStatus('Add a GLB URL or choose a local .glb file.');
  let modelUrl = urlValue;
  let sourceLabel = urlValue || (file ? file.name : 'GLB');
  if (file) modelUrl = URL.createObjectURL(file);
  try {
    await placeModelAtAddress({
      address,
      modelUrl,
      scale: Number(scaleInput.value) || 1,
      rotationDeg: Number(rotationInput.value) || 0,
      heightMeters: Number(heightInput.value) || 0,
      sourceLabel,
    });
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Could not place model.');
  }
});
locateBtn.addEventListener('click', locateOnce);
followBtn.addEventListener('click', () => {
  followMode = !followMode;
  followBtn.textContent = `Follow me: ${followMode ? 'on' : 'off'}`;
  setStatus(followMode ? 'Follow mode enabled.' : 'Follow mode disabled.');
  if (followMode) startFollowing();
  else if (watcherId !== null) { navigator.geolocation.clearWatch(watcherId); watcherId = null; }
});
hillsideBtn.addEventListener('click', () => {
  map.flyTo({ center: HILLSIDE_CENTER, zoom: 16, pitch: 60, bearing: -20, speed: 0.8 });
  setStatus('Jumped to Hillside 3037.');
});
map.on('load', async () => {
  try {
    ensureModelLayer();
    await loadBuildings();
  } catch (error) {
    console.error(error);
    setStatus('Map loaded, but some 3D data could not be fetched right now.');
  }
});
locateOnce();
