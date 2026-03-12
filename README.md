# openclaw workspace

## Hillside 3037 3D map app

A tiny static app for GitHub Pages lives in `docs/`.

### What it does
- shows a 3D-capable map centered on Hillside 3037
- asks for location permission in the browser
- drops a marker on your current position
- optional follow mode for live movement
- loads nearby OpenStreetMap building footprints and renders them as 3D house blocks
- lets you place a `.glb` model at any address by entering an address plus a GLB URL or local file

### Publish with GitHub Pages
In GitHub:
1. Open **Settings** → **Pages**
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**
3. Choose branch **master** and folder **/docs**
4. Save

Your app should then appear at:
`https://monkeycept.github.io/openclaw/`

### iPhone use
- open the GitHub Pages URL in Safari
- tap **Find my location**
- allow location access
- use two fingers to tilt and rotate the 3D map
- to place a GLB, enter an address and either paste a model URL or choose a local `.glb`
- optional: use **Add to Home Screen** for app-like launching

### Notes
- 3D building shapes come from OpenStreetMap data fetched live from Overpass
- address lookup uses OpenStreetMap Nominatim
- some house heights are estimated when exact height data is missing
- remote GLB files must allow cross-origin loading
