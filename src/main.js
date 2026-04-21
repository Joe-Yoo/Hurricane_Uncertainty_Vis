const US_TOPO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';
const WORLD_TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

const maps = {};
const tooltip = d3.select('body').append('div').attr('class', 'tooltip');
let tempMode = false;
const BASE_RADIUS = () => {
  const km = Number(document.getElementById('radius-slider').value);
  const proj = maps['map-left'] && maps['map-left'].projection;
  if (!proj) return km;
  return km * proj.scale() / 6371;
};

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
        const cx = event.transform.applyX(px);
        const cy = event.transform.applyY(py);
        markerGroup.select('circle.location-marker').attr('cx', cx).attr('cy', cy);
        if (containerId === 'map-left') {
          markerGroup.select('circle.location-radius')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('r', BASE_RADIUS() * event.transform.k);
        }
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
    
    const selectedIds = new Set();

    const radiusSlider = document.getElementById('radius-slider');
    const radiusLabel = document.getElementById('radius-label');
    radiusSlider.addEventListener('input', function() {
      radiusLabel.textContent = `${this.value} km`;
      const entry = maps['map-left'];
      if (!entry) return;
      const k = d3.zoomTransform(entry.svg.node()).k;
      entry.markerGroup.select('circle.location-radius').attr('r', BASE_RADIUS() * k);
      if (entry.currentCoords && entry.onPlace) entry.onPlace(entry.currentCoords);
    });

    document.getElementById('temp-toggle').addEventListener('click', function(e) {
      const option = e.target.closest('.pill-option');
      if (!option) return;
      const newMode = option.dataset.mode === 'temp';
      if (newMode === tempMode) return;
      tempMode = newMode;
      radiusSlider.disabled = !tempMode;
      this.querySelectorAll('.pill-option').forEach(el =>
        el.classList.toggle('active', el.dataset.mode === (tempMode ? 'temp' : 'normal'))
      );
      const entry = maps['map-left'];
      if (tempMode) {
        if (entry.currentCoords) {
          // Add radius below the marker (remove marker, append radius, re-append marker)
          entry.markerGroup.selectAll('circle.location-radius').remove();
          const marker = entry.markerGroup.select('circle.location-marker');
          const cx = +marker.attr('cx');
          const cy = +marker.attr('cy');
          const k = d3.zoomTransform(maps['map-left'].svg.node()).k;
          entry.markerGroup.insert('circle', 'circle.location-marker')
            .attr('class', 'location-radius')
            .attr('cx', cx).attr('cy', cy)
            .attr('r', BASE_RADIUS() * k);
          entry.onPlace(entry.currentCoords);
        }
      } else {
        entry.markerGroup.selectAll('circle.location-radius').remove();
        selectedIds.clear();
        applyLineStyles(lines);
        updateGlyphs();
      }
    });

    function applyLineStyles(selection) {
      selection
        .attr('stroke', d => selectedIds.has(d.properties.id) ? '#ffd700' : 'gray')
        .attr('stroke-width', d => selectedIds.has(d.properties.id) ? 2.5 : 1)
        .attr('stroke-opacity', d => selectedIds.has(d.properties.id) ? 0.9 : 0.3);
    }

    const lines = gLeft.selectAll('path.hurricane-line')
      .data(lineFeatures)
      .join('path')
      .attr('class', 'hurricane-line')
      .attr('d', pathLeft)
      .attr('fill', 'none')
      .attr('pointer-events', 'none');

    applyLineStyles(lines);

    // Invisible wide paths for generous hit detection
    gLeft.selectAll('path.hurricane-hit')
      .data(lineFeatures)
      .join('path')
      .attr('class', 'hurricane-hit')
      .attr('d', pathLeft)
      .attr('fill', 'none')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 10)
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        if (tempMode) return;
        if (!selectedIds.has(d.properties.id) && !event.shiftKey) {
          gLeft.selectAll('path.hurricane-line')
            .filter(ld => ld.properties.id === d.properties.id)
            .attr('stroke', '#ffe066')
            .attr('stroke-width', 1.5)
            .attr('stroke-opacity', 0.65);
        }
      })
      .on('mousemove', function(event, d) {
        if (event.shiftKey) {
          applyLineStyles(
            gLeft.selectAll('path.hurricane-line')
              .filter(ld => ld.properties.id === d.properties.id)
          );
        }
      })
      .on('mouseout', function(_event, d) {
        applyLineStyles(
          gLeft.selectAll('path.hurricane-line')
            .filter(ld => ld.properties.id === d.properties.id)
        );
      })
      .on('click', function(_event, d) {
        if (tempMode) return;
        const id = d.properties.id;
        if (selectedIds.has(id)) {
          selectedIds.delete(id);
        } else {
          selectedIds.add(id);
        }
        applyLineStyles(lines);
        updateGlyphs();
      });

    // Select lines within the location radius when a marker is placed
    maps['map-left'].onPlace = (markerCoords) => {
      if (!tempMode) return;
      selectedIds.clear();
      lineFeatures.forEach(feature => {
        const hit = feature.geometry.coordinates.some(([lon, lat]) => {
          const [lpx, lpy] = maps['map-left'].projection([lon, lat]);
          const dx = lpx - markerCoords[0];
          const dy = lpy - markerCoords[1];
          return Math.sqrt(dx * dx + dy * dy) <= BASE_RADIUS();
        });
        if (hit) selectedIds.add(feature.properties.id);
      });
      applyLineStyles(lines);
      updateGlyphs();
    };

    // Drag-to-select box on the left map (hold Shift + drag)
    const { svg: svgLeft, zoom: zoomLeft, projection: projLeft } = maps['map-left'];

    document.getElementById('reset-btn').addEventListener('click', () => {
      // Clear selections
      selectedIds.clear();
      applyLineStyles(lines);
      updateGlyphs();

      // Reset zoom on both maps
      Object.entries(maps).forEach(([_id, entry]) => {
        entry.svg.transition().duration(500).call(entry.zoom.transform, d3.zoomIdentity);
        entry.markerGroup.selectAll('circle.location-marker').remove();
        entry.markerGroup.selectAll('circle.location-radius').remove();
        entry.currentCoords = null;
      });

      // Clear search bar
      searchBar.value = '';
      suggestionsList.classList.add('hidden');
    });

    // Right-click anywhere on left map to deselect all
    svgLeft.on('contextmenu', function(event) {
      event.preventDefault();
      if (tempMode) return;
      selectedIds.clear();
      applyLineStyles(lines);
      updateGlyphs();
    });

    // Let zoom yield when shift is held so drag-select can take over
    zoomLeft.filter(event => !event.shiftKey && !event.ctrlKey && !event.button);

    // Selection rect drawn above everything else
    const selectionRect = svgLeft.append('rect')
      .attr('class', 'selection-rect')
      .attr('pointer-events', 'none')
      .style('display', 'none');

    let dragOrigin = null;

    svgLeft.call(
      d3.drag()
        .filter(event => !tempMode && event.shiftKey && event.button === 0)
        .on('start', function(event) {
          dragOrigin = [event.x, event.y];
          selectionRect
            .attr('x', event.x).attr('y', event.y)
            .attr('width', 0).attr('height', 0)
            .style('display', null);
        })
        .on('drag', function(event) {
          const x = Math.min(event.x, dragOrigin[0]);
          const y = Math.min(event.y, dragOrigin[1]);
          const w = Math.abs(event.x - dragOrigin[0]);
          const h = Math.abs(event.y - dragOrigin[1]);
          selectionRect.attr('x', x).attr('y', y).attr('width', w).attr('height', h);
        })
        .on('end', function(event) {
          selectionRect.style('display', 'none');

          const x = Math.min(event.x, dragOrigin[0]);
          const y = Math.min(event.y, dragOrigin[1]);
          const w = Math.abs(event.x - dragOrigin[0]);
          const h = Math.abs(event.y - dragOrigin[1]);
          if (w < 5 || h < 5) return;

          const transform = d3.zoomTransform(svgLeft.node());

          lineFeatures.forEach(feature => {
            const hit = feature.geometry.coordinates.some(([lon, lat]) => {
              const [px, py] = projLeft([lon, lat]);
              const [tx, ty] = transform.apply([px, py]);
              return tx >= x && tx <= x + w && ty >= y && ty <= y + h;
            });
            if (hit) selectedIds.add(feature.properties.id);
          });

          applyLineStyles(lines);
          updateGlyphs();
        })
    );

    // Draw glyphs on the right map for a given line's data
    const { g: gRight, projection: projRight } = maps['map-right'];

    function drawGlyphs(lineData) {
      if (!lineData) {
        gRight.selectAll('circle.glyph').remove();
        return;
      }
      const color = d3.scaleSequential()
        .domain(d3.extent(lineData.glyphs, d => d.temperature))
        .interpolator(d3.interpolatePlasma);
      const size = d3.scaleLinear()
        .domain(d3.extent(lineData.glyphs, d => d.wind_speed))
        .range([5, 15]);

      gRight.selectAll('circle.glyph')
        .data(lineData.glyphs)
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

    // No glyphs shown until a line is selected
    function updateGlyphs() {
      if (selectedIds.size === 0) {
        drawGlyphs(null);
      } else {
        const lastSelected = [...selectedIds].at(-1);
        const lineData = coneData.lines.find(l => l.id === lastSelected);
        drawGlyphs(lineData || null);
      }
    }
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
    markerGroup.selectAll('circle.location-radius').remove();
    markerGroup.selectAll('circle.location-marker').remove();
    if (id === 'map-left' && tempMode) {
      markerGroup.append('circle')
        .attr('class', 'location-radius')
        .attr('cx', width / 2)
        .attr('cy', height / 2)
        .attr('r', BASE_RADIUS() * LEFT_ZOOM_SCALE);
    }
    // Marker always appended last so it sits on top of the radius
    markerGroup.append('circle')
      .attr('class', 'location-marker')
      .attr('cx', width / 2)
      .attr('cy', height / 2)
      .attr('r', 7);
    if (id === 'map-left') {
      if (entry.onPlace) entry.onPlace(coords);
    }
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
