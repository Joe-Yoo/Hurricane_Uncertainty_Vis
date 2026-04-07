const US_TOPO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';
const WORLD_TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

const maps = {};

async function createMap(containerId, { interactive = true } = {}) {
  const container = document.getElementById(containerId);
  const { width, height } = container.getBoundingClientRect();

  const svg = d3.select(`#${containerId}`)
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  // Map group — receives zoom transform
  const g = svg.append('g');

  // Marker group — sits above map, outside zoom group so it never scales
  const markerGroup = svg.append('g').attr('class', 'markers');

  // Viewbox outline drawn last so it sits on top
  svg.append('rect')
    .attr('class', 'map-outline')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', width)
    .attr('height', height)
    .attr('pointer-events', 'none');

  const projection = d3.geoMercator();

  const path = d3.geoPath().projection(projection);

  const [us, world] = await Promise.all([
    d3.json(US_TOPO_URL),
    d3.json(WORLD_TOPO_URL)
  ]);
  const states = topojson.feature(us, us.objects.states);
  const countries = topojson.feature(world, world.objects.countries);

  // Extend the map bounds to cover Southeast US, zoomed out 2x
  const naBounds = {
    type: "LineString",
    coordinates: [[-105, 15], [-60, 45]]
  };
  projection.fitSize([width, height], naBounds);

  g.selectAll('path.country')
    .data(countries.features)
    .join('path')
    .attr('class', 'country')
    .attr('d', path)
    .attr('fill', '#d9e8f5')
    .attr('stroke', '#999')
    .attr('stroke-width', 0.5);

  g.selectAll('path.state')
    .data(states.features)
    .join('path')
    .attr('class', 'state')
    .attr('d', path)
    .attr('fill', 'none');

// Attach zoom to both maps; non-interactive map filters out user events
  const zoom = d3.zoom()
    .scaleExtent([1, 12])
    .filter(() => interactive)
    .on('zoom', (event) => {
      g.attr('transform', event.transform);

      // Keep marker over the correct geographic point as user zooms/pans
      const entry = maps[containerId];
      if (entry && entry.currentCoords) {
        const [px, py] = entry.currentCoords;
        markerGroup.select('circle.location-marker')
          .attr('cx', event.transform.applyX(px))
          .attr('cy', event.transform.applyY(py));
      }
    });

  svg.call(zoom);

  maps[containerId] = { projection, path, markerGroup, svg, zoom, g, width, height, currentCoords: null };
}

async function init() {
  await Promise.all([
    createMap('map-left', { interactive: true }),
    createMap('map-right', { interactive: false }),
  ]);

  const coneData = await d3.json('cone_data.json');
  if (coneData && coneData.lines && coneData.lines.length > 0) {
    // 1. Draw all lines on the left map
    const { g: gLeft, path: pathLeft } = maps['map-left'];
    
    // Parse the Mlon,lat Llon,lat SVG path strings back into coordinates for D3 mapping
    const lineFeatures = coneData.lines.map(lineData => {
      const coords = lineData.path.split(' ').map(pt => {
        const [lon, lat] = pt.slice(1).split(',').map(Number);
        return [lon, lat];
      });
      return {
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: { id: lineData.id }
      };
    });

    gLeft.selectAll('path.hurricane-line')
      .data(lineFeatures)
      .join('path')
      .attr('class', 'hurricane-line')
      .attr('d', pathLeft)
      .attr('fill', 'none')
      .attr('stroke', '#ff4b4b')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.6);

    // 2. Draw glyphs of line 1 on the right map
    const line1 = coneData.lines[0];
    const { g: gRight, projection: projRight } = maps['map-right'];

    gRight.selectAll('circle.glyph')
      .data(line1.glyphs)
      .join('circle')
      .attr('class', 'glyph')
      .attr('cx', d => {
        const coords = projRight([d.longitude, d.latitude]);
        return coords ? coords[0] : 0;
      })
      .attr('cy', d => {
        const coords = projRight([d.longitude, d.latitude]);
        return coords ? coords[1] : 0;
      })
      .attr('r', 5)
      .attr('fill', 'orange')
      .attr('stroke', '#333')
      .attr('stroke-width', 1);
  }
}

init();

const RIGHT_ZOOM_SCALE = 5;
const LEFT_ZOOM_SCALE = 2;

function zoomToLocation(mapId, px, py) {
  const { svg, zoom, width, height } = maps[mapId];
  const scale = mapId === 'map-left' ? LEFT_ZOOM_SCALE : RIGHT_ZOOM_SCALE;
  const tx = width / 2 - scale * px;
  const ty = height / 2 - scale * py;
  svg.transition().duration(750).call(
    zoom.transform,
    d3.zoomIdentity.translate(tx, ty).scale(scale)
  );
}

function placeMarker(lon, lat) {
  Object.entries(maps).forEach(([id, entry]) => {
    const { projection, markerGroup, width, height } = entry;
    const coords = projection([lon, lat]);
    if (!coords) return;

    entry.currentCoords = coords;

    zoomToLocation(id, coords[0], coords[1]);

    // After zoom the location will be at the SVG center
    markerGroup.selectAll('circle.location-marker').remove();
    markerGroup.append('circle')
      .attr('class', 'location-marker')
      .attr('cx', width / 2)
      .attr('cy', height / 2)
      .attr('r', 7);
  });
}

function onLocationSelected(item) {
  console.log('Selected location:', item.display_name);
  placeMarker(parseFloat(item.lon), parseFloat(item.lat));
}

async function handleSearch(query) {
  if (!query) return;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=us&limit=1&addressdetails=0`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const data = await res.json();
  if (data.length > 0) {
    searchBar.value = data[0].display_name;
    suggestionsList.classList.add('hidden');
    onLocationSelected(data[0]);
  }
}

const searchBar = document.getElementById('search-bar');
const searchBtn = document.getElementById('search-btn');
const suggestionsList = document.getElementById('suggestions');

let debounceTimer = null;

function showSuggestions(items) {
  suggestionsList.innerHTML = '';
  if (items.length === 0) {
    suggestionsList.classList.add('hidden');
    return;
  }
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item.display_name;
    li.addEventListener('mousedown', () => {
      searchBar.value = item.display_name;
      suggestionsList.classList.add('hidden');
      onLocationSelected(item);
    });
    suggestionsList.appendChild(li);
  });
  suggestionsList.classList.remove('hidden');
}

async function fetchSuggestions(query) {
  if (query.length < 2) {
    suggestionsList.classList.add('hidden');
    return;
  }
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=us&limit=6&addressdetails=0`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const data = await res.json();
  showSuggestions(data);
}

searchBar.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => fetchSuggestions(searchBar.value.trim()), 250);
});

searchBar.addEventListener('blur', () => {
  setTimeout(() => suggestionsList.classList.add('hidden'), 150);
});

searchBtn.addEventListener('click', () => handleSearch(searchBar.value.trim()));
searchBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    suggestionsList.classList.add('hidden');
    handleSearch(searchBar.value.trim());
  }
});
