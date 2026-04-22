const US_TOPO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';
const WORLD_TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

const maps = {};
const tooltip = d3.select('body').append('div').attr('class', 'tooltip');

async function createMap(containerId, { interactive = true } = {}) {
  const container = document.getElementById(containerId);
  const { width, height } = container.getBoundingClientRect();

  const svg = d3.select(`#${containerId}`)
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  const g = svg.append('g');

  const markerGroup = svg.append('g').attr('class', 'markers');

  svg.append('rect')
    .attr('class', 'map-outline')
    .attr('x', 0).attr('y', 0)
    .attr('width', width).attr('height', height)
    .attr('pointer-events', 'none');

  const projection = d3.geoMercator();
  const path = d3.geoPath().projection(projection);

  const [us, world] = await Promise.all([
    d3.json(US_TOPO_URL),
    d3.json(WORLD_TOPO_URL)
  ]);
  const states = topojson.feature(us, us.objects.states);
  const countries = topojson.feature(world, world.objects.countries);

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

  const zoom = d3.zoom()
    .scaleExtent([1, 12])
    .filter(() => interactive)
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
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
  await createMap('map-left', { interactive: true });

  const coneData = await d3.json('cone_data.json');
  if (coneData && coneData.lines && coneData.lines.length > 0) {
    const { g, projection } = maps['map-left'];

    // Parse all tracks into projected pixel coordinates
    const tracks = coneData.lines.map(lineData =>
      lineData.path.split(' ').map(pt => {
        const [lon, lat] = pt.slice(1).split(',').map(Number);
        return projection([lon, lat]);
      }).filter(Boolean)
    );

    // Collect all projected points and compute convex hull
    const allPoints = tracks.flat();
    const hull = d3.polygonHull(allPoints);

    if (hull) {
      g.append('path')
        .attr('class', 'cone-hull')
        .attr('d', `M${hull.map(p => p.join(',')).join('L')}Z`)
        .attr('fill', 'rgba(220, 50, 50, 0.2)')
        .attr('stroke', 'rgba(220, 50, 50, 0.6)')
        .attr('stroke-width', 1.5);
    }

    // Draw the average track
    const numPoints = tracks[0].length;
    const avgTrack = d3.range(numPoints).map(i => [
      d3.mean(tracks, t => t[i][0]),
      d3.mean(tracks, t => t[i][1])
    ]);
    const line = d3.line().x(d => d[0]).y(d => d[1]);
    g.append('path')
      .attr('class', 'cone-avg')
      .attr('d', line(avgTrack))
      .attr('fill', 'none')
      .attr('stroke', '#cc0000')
      .attr('stroke-width', 2.5);

    // Mark the shared starting point
    const start = tracks[0][0];
    g.append('circle')
      .attr('class', 'cone-start')
      .attr('cx', start[0])
      .attr('cy', start[1])
      .attr('r', 5)
      .attr('fill', '#dc3232')
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5);
  }

  document.getElementById('reset-btn').addEventListener('click', () => {
    const entry = maps['map-left'];
    entry.svg.transition().duration(500).call(entry.zoom.transform, d3.zoomIdentity);
    entry.markerGroup.selectAll('circle.location-marker').remove();
    entry.currentCoords = null;
    searchBar.value = '';
    suggestionsList.classList.add('hidden');
  });
}

init();

const LEFT_ZOOM_SCALE = 2;

function zoomToLocation(px, py) {
  const { svg, zoom, width, height } = maps['map-left'];
  const tx = width / 2 - LEFT_ZOOM_SCALE * px;
  const ty = height / 2 - LEFT_ZOOM_SCALE * py;
  svg.transition().duration(750).call(
    zoom.transform,
    d3.zoomIdentity.translate(tx, ty).scale(LEFT_ZOOM_SCALE)
  );
}

function placeMarker(lon, lat) {
  const entry = maps['map-left'];
  const { projection, markerGroup, width, height } = entry;
  const coords = projection([lon, lat]);
  if (!coords) return;

  entry.currentCoords = coords;
  zoomToLocation(coords[0], coords[1]);

  markerGroup.selectAll('circle.location-marker').remove();
  markerGroup.append('circle')
    .attr('class', 'location-marker')
    .attr('cx', width / 2)
    .attr('cy', height / 2)
    .attr('r', 7);
}

function onLocationSelected(item) {
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
