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
    // Draw all lines on the left map
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
    
    let selectedLineId = 1;

    // Helper to draw left map lines based on selection state
    function renderLines() {
      gLeft.selectAll('path.hurricane-line')
        .data(lineFeatures)
        .join('path')
        .attr('class', 'hurricane-line')
        .attr('d', pathLeft)
        .attr('fill', 'none')
        .attr('stroke', d => d.properties.id === selectedLineId ? '#ff4b4b' : 'gray')
        .attr('stroke-width', d => d.properties.id === selectedLineId ? 2 : 1)
        .attr('stroke-opacity', d => d.properties.id === selectedLineId ? 0.8 : 0.3)
        .attr('cursor', 'pointer')
        .style('pointer-events', 'visibleStroke')
        .on('click', (event, d) => {
          selectedLineId = d.properties.id;
          renderLines();
          renderGlyphs();
        });
        
      // Ensure the selected line is drawn on top
      gLeft.selectAll('path.hurricane-line')
        .filter(d => d.properties.id === selectedLineId)
        .raise();
    }

    // Helper to draw right map glyphs based on selection state
    function renderGlyphs() {
      const selectedLine = coneData.lines.find(l => l.id === selectedLineId) || coneData.lines[0];
      const { g: gRight, projection: projRight } = maps['map-right'];
      
      const color = d3.scaleSequential()
        .domain(d3.extent(selectedLine.glyphs, d => d.temperature))
        .interpolator(d3.interpolatePlasma);
      const size = d3.scaleSequential()
        .domain(d3.extent(selectedLine.glyphs, d => d.wind_speed))
        .range([5, 15]);

      gRight.selectAll('circle.glyph')
        .data(selectedLine.glyphs)
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
        .attr('r', d => size(d.wind_speed))
        .attr('fill', d => color(d.temperature))
        .attr('stroke', '#333')
        .attr('stroke-width', 1)
        .on('mouseover', (event, d) => {
          tooltip.transition().duration(200).style('opacity', 1);
          tooltip.html(`
            <p><strong>Category:</strong> ${d.category}</p>
            <p><strong>Wind Speed:</strong> ${d.wind_speed} mph</p>
            <p><strong>Wind Gust:</strong> ${d.wind_gust} mph</p>
            <p><strong>Precipitation:</strong> ${d.precipitation} (${d.precipitation_type.toLowerCase()})</p>
            <p><strong>Event:</strong> ${d.event_code}</p>
          `)
          .style('left', (event.pageX + 15) + 'px')
          .style('top', (event.pageY - 28) + 'px');
        })
        .on('mousemove', (event) => {
          tooltip.style('left', (event.pageX + 15) + 'px')
                 .style('top', (event.pageY - 28) + 'px');
        })
        .on('mouseout', () => {
          tooltip.transition().duration(200).style('opacity', 0);
        });
    }

    // Initialize map views
    renderLines();
    renderGlyphs();
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
