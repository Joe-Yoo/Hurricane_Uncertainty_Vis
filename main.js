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

let windAnim = null;

const settings = {
  layers: { paths: true, glyphs: true, currents: false },
  glyphStyle: 'barbs',
  props: { temp: true, precip: false, labels: false }
};

class WindAnimation {
  constructor(containerId, projection) {
    const container = document.getElementById(containerId);
    this.canvas = d3.select(`#${containerId}`).append('canvas').node();
    this.ctx = this.canvas.getContext('2d');
    this.projection = projection;
    this.particles = [];
    this.numParticles = 2000;
    this.maxAge = 60;
    this.field = null;
    this.animationId = null;
    this.active = false;
    this.resize();
  }

  resize() {
    const parent = this.canvas.parentElement;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
  }

  updateField(glyphs) {
    this.field = glyphs;
    this.initParticles();
  }

  initParticles() {
    this.particles = [];
    for (let i = 0; i < this.numParticles; i++) {
      this.particles.push(this.createParticle());
    }
  }

  createParticle() {
    if (!this.field || this.field.length === 0) return null;
    const ref = this.field[Math.floor(Math.random() * this.field.length)];
    return {
      lon: ref.longitude + (Math.random() - 0.5) * 3,
      lat: ref.latitude + (Math.random() - 0.5) * 3,
      age: Math.floor(Math.random() * this.maxAge)
    };
  }

  start() {
    if (this.active || !settings.layers.currents) return;
    this.active = true;
    this.animate();
  }

  stop() {
    this.active = false;
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  animate() {
    if (!this.active) return;

    const svgNode = this.canvas.parentNode.querySelector('svg');
    const transform = svgNode ? d3.zoomTransform(svgNode) : d3.zoomIdentity;

    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    this.ctx.globalCompositeOperation = 'destination-in';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.globalCompositeOperation = 'source-over';

    this.ctx.strokeStyle = 'rgba(74, 111, 165, 0.5)';
    this.ctx.lineWidth = 1.2;

    this.particles.forEach((p, i) => {
      if (!p) return;

      // Find closest field vector (optimized grid-based would be better, but simple search for now)
      let closest = null;
      let minDist = 2.0; // max search radius in degrees
      
      // We know glyphs are on a 3-deg grid, so we can find candidate faster
      this.field.forEach(f => {
        const d = Math.abs(p.lon - f.longitude) + Math.abs(p.lat - f.latitude);
        if (d < minDist) {
          minDist = d;
          closest = f;
        }
      });

      if (closest) {
        const angleRad = closest.wind_flow_angle * Math.PI / 180;
        const speed = Math.max(0.5, closest.wind_speed / 40) * 0.05;

        const coords1 = this.projection([p.lon, p.lat]);
        p.lon += Math.cos(angleRad) * speed;
        p.lat += Math.sin(angleRad) * speed;
        const coords2 = this.projection([p.lon, p.lat]);

        if (coords1 && coords2) {
          const t1 = transform.apply(coords1);
          const t2 = transform.apply(coords2);
          this.ctx.beginPath();
          this.ctx.moveTo(t1[0], t1[1]);
          this.ctx.lineTo(t2[0], t2[1]);
          this.ctx.stroke();
        }
      }

      p.age++;
      if (p.age > this.maxAge || minDist >= 2.0) {
        this.particles[i] = this.createParticle();
      }
    });

    this.animationId = requestAnimationFrame(() => this.animate());
  }
}

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

  const naBounds = {
    type: "LineString",
    coordinates: [[-105, 15], [-60, 45]]
  };
  projection.fitSize([width, height], naBounds);

  g.selectAll('path.country')
    .data(countries.features)
    .join('path')
    .attr('class', 'country')
    .attr('d', path);

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
      if (containerId === 'map-right' && windAnim) {
        windAnim.stop();
        if (settings.layers.currents) windAnim.start();
      }
    });

  svg.call(zoom);
  maps[containerId] = { projection, path, markerGroup, svg, zoom, g, width, height, currentCoords: null };
  
  if (containerId === 'map-right') {
    windAnim = new WindAnimation(containerId, projection);
  }
}

async function init() {
  try {
    await Promise.all([
      createMap('map-left', { interactive: true }),
      createMap('map-right', { interactive: false }),
    ]);

    const coneData = await d3.json('realistic_hurricane_glyphs.json');
    if (!coneData) throw new Error("Could not load realistic_hurricane_glyphs.json");
    
    if (coneData.lines && coneData.lines.length > 0) {
    const { g: gLeft, path: pathLeft } = maps['map-left'];
    
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

    // Settings Sidebar Handlers
    document.getElementById('layer-paths').addEventListener('change', function() {
      settings.layers.paths = this.checked;
      gLeft.selectAll('path.hurricane-line').style('display', settings.layers.paths ? null : 'none');
    });

    document.getElementById('layer-glyphs').addEventListener('change', function() {
      settings.layers.glyphs = this.checked;
      updateGlyphs();
    });

    document.getElementById('layer-currents').addEventListener('change', function() {
      settings.layers.currents = this.checked;
      if (settings.layers.currents) windAnim.start();
      else windAnim.stop();
    });

    document.getElementsByName('glyph-style').forEach(el => {
      el.addEventListener('change', function() {
        settings.glyphStyle = this.value;
        updateGlyphs();
      });
    });

    document.getElementById('prop-temp').addEventListener('change', function() {
      settings.props.temp = this.checked;
      updateGlyphs();
    });

    document.getElementById('prop-precip').addEventListener('change', function() {
      settings.props.precip = this.checked;
      updateGlyphs();
    });

    document.getElementById('prop-labels').addEventListener('change', function() {
      settings.props.labels = this.checked;
      updateGlyphs();
    });

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

    const barbToggleLegacy = document.getElementById('barb-toggle');
    if (barbToggleLegacy) {
      barbToggleLegacy.addEventListener('change', function() {
        settings.glyphStyle = this.checked ? 'barbs' : 'circles';
        updateGlyphs();
      });
    }

    function applyLineStyles(selection) {
      selection
        .attr('stroke', d => selectedIds.has(d.properties.id) ? '#4a6fa5' : '#adb5bd')
        .attr('stroke-width', d => selectedIds.has(d.properties.id) ? 3 : 1)
        .attr('stroke-opacity', d => selectedIds.has(d.properties.id) ? 1 : 0.2);
    }

    const lines = gLeft.selectAll('path.hurricane-line')
      .data(lineFeatures)
      .join('path')
      .attr('class', 'hurricane-line')
      .attr('d', pathLeft)
      .attr('fill', 'none');

    applyLineStyles(lines);

    gLeft.selectAll('path.hurricane-hit')
      .data(lineFeatures)
      .join('path')
      .attr('class', 'hurricane-hit')
      .attr('d', pathLeft)
      .attr('fill', 'none')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 15)
      .style('cursor', 'pointer')
      .on('mouseover', function(_event, d) {
        if (tempMode) return;
        if (!selectedIds.has(d.properties.id)) {
          gLeft.selectAll('path.hurricane-line')
            .filter(ld => ld.properties.id === d.properties.id)
            .attr('stroke', '#4a6fa5')
            .attr('stroke-width', 2)
            .attr('stroke-opacity', 0.5);
        }
      })
      .on('mouseout', function(_event, d) {
        applyLineStyles(gLeft.selectAll('path.hurricane-line').filter(ld => ld.properties.id === d.properties.id));
      })
      .on('click', function(_event, d) {
        if (tempMode) return;
        const id = d.properties.id;
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        applyLineStyles(lines);
        updateGlyphs();
      });

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

    const { g: gRight, projection: projRight } = maps['map-right'];

    function updateGlyphs() {
      const selectedLines = coneData.lines.filter(l => selectedIds.has(l.id));
      let allGlyphs = [];
      selectedLines.forEach(l => { allGlyphs = allGlyphs.concat(l.glyphs); });

      gRight.selectAll('g.glyph-group').remove();
      windAnim.stop();

      if (allGlyphs.length === 0) return;
      
      if (settings.layers.currents) {
        windAnim.updateField(allGlyphs);
        windAnim.start();
      }

      if (!settings.layers.glyphs) return;

      const colorScale = d3.scaleSequential()
        .domain(d3.extent(allGlyphs, d => d.temperature))
        .interpolator(d3.interpolateRdYlBu);

      function getWindBarbPath(speed) {
        let knots = Math.round(speed);
        if (knots < 5) return "M0,0 A1.5,1.5 0 1,1 0,0.1 Z";
        let path = "M0,0 L0,-14 ", yOffset = -14;
        let fifties = Math.floor(knots / 50); knots %= 50;
        let tens = Math.floor(knots / 10); knots %= 10;
        let fives = Math.floor(knots / 5);
        for (let i=0; i<fifties; i++) { path += `M0,${yOffset} L6,${yOffset+1} L0,${yOffset+2} `; yOffset += 3; }
        for (let i=0; i<tens; i++) { path += `M0,${yOffset} L7,${yOffset-2} `; yOffset += 2.5; }
        for (let i=0; i<fives; i++) { path += `M0,${yOffset+0.5} L4,${yOffset-1} `; yOffset += 2.5; }
        return path;
      }

      const glyphGroups = gRight.selectAll('g.glyph-group')
        .data(allGlyphs)
        .join('g')
        .attr('class', 'glyph-group')
        .attr('transform', d => {
          const coords = projRight([d.longitude, d.latitude]);
          if (!coords) return `translate(-9999,-9999)`;
          return settings.glyphStyle === 'barbs' ? `translate(${coords[0]}, ${coords[1]}) rotate(${d.wind_flow_angle})` 
                                                : `translate(${coords[0]}, ${coords[1]})`;
        })
        .on('mouseover', (event, d) => {
          tooltip.transition().duration(200).style('opacity', 1);
          tooltip.html(`
            <p><strong>Intensity</strong> <span>Cat ${d.category}</span></p>
            <p><strong>Wind Speed</strong> <span>${d.wind_speed} mph</span></p>
            <p><strong>Heading</strong> <span>${d.wind_flow_angle}°</span></p>
            <p><strong>Temp</strong> <span>${d.temperature}°C</span></p>
            <p><strong>Precip</strong> <span>${d.precipitation} in/hr</span></p>
          `)
          .style('left', (event.pageX + 15) + 'px')
          .style('top', (event.pageY - 28) + 'px');
        })
        .on('mousemove', (event) => {
          tooltip.style('left', (event.pageX + 15) + 'px').style('top', (event.pageY - 28) + 'px');
        })
        .on('mouseout', () => {
          tooltip.transition().duration(200).style('opacity', 0);
        });

      if (settings.props.precip) {
        glyphGroups.append('circle')
          .attr('class', 'precip-aura')
          .attr('r', d => d.precipitation * 8)
          .attr('fill', '#4a6fa5')
          .attr('fill-opacity', 0.15)
          .attr('stroke', '#4a6fa5')
          .attr('stroke-opacity', 0.3)
          .attr('stroke-width', 0.5);
      }

      if (settings.glyphStyle === 'barbs') {
        glyphGroups.append('path')
          .attr('d', d => getWindBarbPath(d.wind_speed))
          .attr('stroke', d => settings.props.temp ? colorScale(d.temperature) : '#333')
          .attr('stroke-width', 1.2)
          .attr('fill', d => d.wind_speed >= 50 && settings.props.temp ? colorScale(d.temperature) : 'none');
      } else {
        const size = d3.scaleLinear().domain(d3.extent(allGlyphs, d => d.wind_speed)).range([4, 12]);
        glyphGroups.append('circle')
          .attr('r', d => size(d.wind_speed))
          .attr('fill', d => settings.props.temp ? colorScale(d.temperature) : '#4a6fa5')
          .attr('fill-opacity', 0.8)
          .attr('stroke', '#fff')
          .attr('stroke-width', 1);
      }

      if (settings.props.labels) {
        glyphGroups.append('text')
          .attr('y', 15)
          .attr('text-anchor', 'middle')
          .attr('font-size', '8px')
          .attr('fill', '#666')
          .text(d => `${d.wind_speed}m`);
      }

      glyphGroups.append('circle').attr('r', 10).attr('fill', 'transparent');
    }

    updateGlyphs();

    document.getElementById('reset-btn').addEventListener('click', () => {
      selectedIds.clear();
      applyLineStyles(lines);
      updateGlyphs();
      Object.entries(maps).forEach(([_id, entry]) => {
        entry.svg.transition().duration(500).call(entry.zoom.transform, d3.zoomIdentity);
        entry.markerGroup.selectAll('circle.location-marker').remove();
        entry.markerGroup.selectAll('circle.location-radius').remove();
        entry.currentCoords = null;
      });
      searchBar.value = '';
      suggestionsList.classList.add('hidden');
    });
  }
  } catch (err) {
    console.error("Initialization error:", err);
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
  svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

function placeMarker(lon, lat) {
  Object.entries(maps).forEach(([id, entry]) => {
    const { projection, markerGroup, width, height } = entry;
    const coords = projection([lon, lat]);
    if (!coords) return;
    entry.currentCoords = coords;
    zoomToLocation(id, coords[0], coords[1]);
    markerGroup.selectAll('circle.location-radius').remove();
    markerGroup.selectAll('circle.location-marker').remove();
    if (id === 'map-left' && tempMode) {
      markerGroup.append('circle').attr('class', 'location-radius').attr('cx', width/2).attr('cy', height/2).attr('r', BASE_RADIUS()*LEFT_ZOOM_SCALE);
    }
    markerGroup.append('circle').attr('class', 'location-marker').attr('cx', width/2).attr('cy', height/2).attr('r', 7);
    if (id === 'map-left' && entry.onPlace) entry.onPlace(coords);
  });
}

function onLocationSelected(item) { placeMarker(parseFloat(item.lon), parseFloat(item.lat)); }
async function handleSearch(query) {
  if (!query) return;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=us&limit=1&addressdetails=0`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const data = await res.json();
  if (data.length > 0) { searchBar.value = data[0].display_name; suggestionsList.classList.add('hidden'); onLocationSelected(data[0]); }
}

const searchBar = document.getElementById('search-bar'), searchBtn = document.getElementById('search-btn'), suggestionsList = document.getElementById('suggestions');
let debounceTimer = null;
function showSuggestions(items) {
  suggestionsList.innerHTML = '';
  if (items.length === 0) { suggestionsList.classList.add('hidden'); return; }
  items.forEach((item) => {
    const li = document.createElement('li'); li.textContent = item.display_name;
    li.addEventListener('mousedown', () => { searchBar.value = item.display_name; suggestionsList.classList.add('hidden'); onLocationSelected(item); });
    suggestionsList.appendChild(li);
  });
  suggestionsList.classList.remove('hidden');
}
async function fetchSuggestions(query) {
  if (query.length < 2) { suggestionsList.classList.add('hidden'); return; }
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=us&limit=6&addressdetails=0`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const data = await res.json();
  showSuggestions(data);
}
searchBar.addEventListener('input', () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(() => fetchSuggestions(searchBar.value.trim()), 250); });
searchBar.addEventListener('blur', () => { setTimeout(() => suggestionsList.classList.add('hidden'), 150); });
searchBtn.addEventListener('click', () => handleSearch(searchBar.value.trim()));
searchBar.addEventListener('keydown', (e) => { if (e.key === 'Enter') { suggestionsList.classList.add('hidden'); handleSearch(searchBar.value.trim()); } });
