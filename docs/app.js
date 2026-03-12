const HILLSIDE_CENTER = [144.741, -37.6905];
const HILLSIDE_RADIUS_METERS = 2800;

const statusEl = document.getElementById('status');
const coordsEl = document.getElementById('coords');
const locateBtn = document.getElementById('locateBtn');
const followBtn = document.getElementById('followBtn');
const hillsideBtn = document.getElementById('hillsideBtn');

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
    layers: [
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
      },
    ],
  },
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: false,
  showUserLocation: false,
}), 'top-right');

let userMarker = null;
let userAccuracyPopup = null;
let watcherId = null;
let followMode = false;

function setStatus(text) {
  statusEl.textContent = text;
}

function setCoords({ latitude, longitude, accuracy }) {
  coordsEl.textContent = `Lat ${latitude.toFixed(5)}, Lng ${longitude.toFixed(5)} • accuracy ±${Math.round(accuracy)}m`;
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
    out body;
    >;
    out skel qt;
  `;

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: query.trim(),
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
    },
  });

  if (!response.ok) {
    throw new Error(`Building data request failed (${response.status})`);
  }

  const overpassJson = await response.json();
  const geojson = osmtogeojson(overpassJson);
  const prepared = prepareBuildings(geojson);

  if (map.getSource('buildings')) {
    map.getSource('buildings').setData(prepared);
  } else {
    map.addSource('buildings', {
      type: 'geojson',
      data: prepared,
    });

    map.addLayer({
      id: 'building-extrusions',
      type: 'fill-extrusion',
      source: 'buildings',
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': ['get', 'render_height'],
        'fill-extrusion-base': ['get', 'base_height'],
        'fill-extrusion-opacity': 0.82,
      },
    });

    map.addLayer({
      id: 'building-footprints',
      type: 'line',
      source: 'buildings',
      paint: {
        'line-color': '#334155',
        'line-width': 0.6,
      },
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
  } else {
    userMarker.setLngLat(lngLat);
  }

  if (userAccuracyPopup) {
    userAccuracyPopup.remove();
  }

  userAccuracyPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 })
    .setLngLat(lngLat)
    .setHTML(`<strong>Your location</strong><br>Accuracy: ±${Math.round(accuracy)}m`)
    .addTo(map);

  if (followMode) {
    map.easeTo({ center: lngLat, zoom: Math.max(map.getZoom(), 17), pitch: 60, duration: 900 });
  }
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
  if (!navigator.geolocation) {
    setStatus('This browser does not support geolocation.');
    return;
  }

  setStatus('Finding your location…');
  navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0,
  });
}

function startFollowing() {
  if (!navigator.geolocation) {
    setStatus('This browser does not support geolocation.');
    return;
  }

  if (watcherId !== null) {
    navigator.geolocation.clearWatch(watcherId);
  }

  watcherId = navigator.geolocation.watchPosition(handleSuccess, handleError, {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 1000,
  });
}

map.on('load', async () => {
  try {
    await loadBuildings();
  } catch (error) {
    console.error(error);
    setStatus('Map loaded, but 3D buildings could not be fetched right now.');
  }
});

locateBtn.addEventListener('click', locateOnce);

followBtn.addEventListener('click', () => {
  followMode = !followMode;
  followBtn.textContent = `Follow me: ${followMode ? 'on' : 'off'}`;
  setStatus(followMode ? 'Follow mode enabled.' : 'Follow mode disabled.');

  if (followMode) {
    startFollowing();
  } else if (watcherId !== null) {
    navigator.geolocation.clearWatch(watcherId);
    watcherId = null;
  }
});

hillsideBtn.addEventListener('click', () => {
  map.flyTo({ center: HILLSIDE_CENTER, zoom: 16, pitch: 60, bearing: -20, speed: 0.8 });
  setStatus('Jumped to Hillside 3037.');
});

locateOnce();
