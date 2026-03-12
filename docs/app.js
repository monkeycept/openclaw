const statusEl = document.getElementById('status');
const coordsEl = document.getElementById('coords');
const locateBtn = document.getElementById('locateBtn');
const followBtn = document.getElementById('followBtn');

const map = L.map('map', {
  zoomControl: true,
}).setView([-37.8136, 144.9631], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

let marker = null;
let accuracyCircle = null;
let watcherId = null;
let followMode = false;

function setStatus(text) {
  statusEl.textContent = text;
}

function setCoords({ latitude, longitude, accuracy }) {
  coordsEl.textContent = `Lat ${latitude.toFixed(5)}, Lng ${longitude.toFixed(5)} • accuracy ±${Math.round(accuracy)}m`;
}

function updateMap(position) {
  const { latitude, longitude, accuracy } = position.coords;
  const latLng = [latitude, longitude];

  setCoords(position.coords);

  if (!marker) {
    marker = L.marker(latLng).addTo(map).bindPopup('You are here');
  } else {
    marker.setLatLng(latLng);
  }

  if (!accuracyCircle) {
    accuracyCircle = L.circle(latLng, {
      radius: accuracy,
      color: '#38bdf8',
      fillColor: '#38bdf8',
      fillOpacity: 0.15,
    }).addTo(map);
  } else {
    accuracyCircle.setLatLng(latLng);
    accuracyCircle.setRadius(accuracy);
  }

  if (followMode) {
    map.setView(latLng, Math.max(map.getZoom(), 16), { animate: true });
  }
}

function handleSuccess(position) {
  setStatus(`Location updated at ${new Date(position.timestamp).toLocaleTimeString()}.`);
  updateMap(position);

  if (!followMode && marker) {
    marker.openPopup();
    map.flyTo(marker.getLatLng(), 16, { duration: 1.2 });
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

locateOnce();
