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
  props: { prox: true, icon: true, barbs: true }
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

  const defs = svg.append('defs');
  const filter = defs.append('filter').attr('id', 'glow');
  filter.append('feGaussianBlur').attr('stdDeviation', '2.5').attr('result', 'coloredBlur');
  const feMerge = filter.append('feMerge');
  feMerge.append('feMergeNode').attr('in', 'coloredBlur');
  feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

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

    const rightMap = maps['map-right'];
    const flCoords = rightMap.projection([-81.5, 27.5]);
    if (flCoords) {
      const scale = 1.5;
      const tx = rightMap.width / 2 - scale * flCoords[0];
      const ty = rightMap.height / 2 - scale * flCoords[1];
      const initialTransform = d3.zoomIdentity.translate(tx, ty).scale(scale);
      rightMap.targetTransform = initialTransform;
      rightMap.svg.call(rightMap.zoom.transform, initialTransform);
    }

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


    document.getElementById('layer-glyphs').addEventListener('change', function() {
      settings.layers.glyphs = this.checked;
      updateGlyphs();
    });

    document.getElementById('layer-currents').addEventListener('change', function() {
      settings.layers.currents = this.checked;
      if (settings.layers.currents) windAnim.start();
      else windAnim.stop();
    });

    document.getElementById('prop-barbs').addEventListener('change', function() {
      settings.props.barbs = this.checked;
      updateGlyphs();
    });

    document.getElementById('prop-prox').addEventListener('change', function() {
      settings.props.prox = this.checked;
      updateGlyphs();
    });

    document.getElementById('prop-icon').addEventListener('change', function() {
      settings.props.icon = this.checked;
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
        if (tempMode) return;
        applyLineStyles(gLeft.selectAll('path.hurricane-line').filter(ld => ld.properties.id === d.properties.id));
      })
      .on('click', function(_event, d) {
        if (tempMode) return;
        const id = d.properties.id;
        
        if (!maps['map-left'].currentCoords) {
          if (selectedIds.has(id)) {
            selectedIds.delete(id);
          } else {
            selectedIds.clear();
            selectedIds.add(id);
          }
        } else {
          if (selectedIds.has(id)) selectedIds.delete(id);
          else selectedIds.add(id);
        }
        
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
      let aggregatedGlyphs = [];

      if (selectedLines.length > 0) {
        const gridMap = new Map();
        
        const { svg: svgRight, projection: projRight, width, height, targetTransform } = maps['map-right'];
        const transform = targetTransform || d3.zoomTransform(svgRight.node());
        const margin = 50;

        selectedLines.forEach(l => {
          l.glyphs.forEach(g => {
            const coords = projRight([g.longitude, g.latitude]);
            if (!coords) return;
            
            const sx = transform.applyX(coords[0]);
            const sy = transform.applyY(coords[1]);
            if (sx < -margin || sx > width + margin || sy < -margin || sy > height + margin) return;

            const key = `${g.longitude.toFixed(2)},${g.latitude.toFixed(2)}`;
            if (!gridMap.has(key)) {
              gridMap.set(key, {
                longitude: g.longitude,
                latitude: g.latitude,
                count: 0,
                proximity_to_eye_sum: 0,
                wind_speed_sum: 0,
                precipitation_sum: 0,
                wind_gust_sum: 0,
                temperature_sum: 0,
                wind_u_sum: 0,
                wind_v_sum: 0,
                has_warning: false,
                has_advisory: false
              });
            }
            const agg = gridMap.get(key);
            agg.count++;
            agg.proximity_to_eye_sum += g.proximity_to_eye;
            agg.wind_speed_sum += g.wind_speed;
            agg.precipitation_sum += g.precipitation;
            agg.wind_gust_sum += (g.wind_gust || g.wind_speed * 1.25);
            agg.temperature_sum += (g.temperature || 28.0);
            
            const angleRad = (g.wind_flow_angle - 90) * (Math.PI / 180);
            agg.wind_u_sum += Math.cos(angleRad);
            agg.wind_v_sum += Math.sin(angleRad);
            
            if (g.event_code === "WARNING") agg.has_warning = true;
            if (g.event_code === "ADVISORY") agg.has_advisory = true;
          });
        });

        function calcCategory(speed) {
          if (speed >= 157) return 5;
          if (speed >= 130) return 4;
          if (speed >= 111) return 3;
          if (speed >= 96) return 2;
          if (speed >= 74) return 1;
          return 0;
        }

        aggregatedGlyphs = Array.from(gridMap.values()).map(agg => {
          const avg_u = agg.wind_u_sum / agg.count;
          const avg_v = agg.wind_v_sum / agg.count;
          let angleDeg = Math.atan2(avg_v, avg_u) * (180 / Math.PI) + 90;
          if (angleDeg < 0) angleDeg += 360;

          const avg_speed = agg.wind_speed_sum / agg.count;

          return {
            longitude: agg.longitude,
            latitude: agg.latitude,
            proximity_to_eye: +(agg.proximity_to_eye_sum / agg.count).toFixed(2),
            wind_speed: Math.round(avg_speed),
            wind_gust: Math.round(agg.wind_gust_sum / agg.count),
            temperature: +(agg.temperature_sum / agg.count).toFixed(1),
            wind_flow_angle: Math.round(angleDeg),
            precipitation: +(agg.precipitation_sum / agg.count).toFixed(2),
            event_code: agg.has_warning ? "WARNING" : (agg.has_advisory ? "ADVISORY" : "NONE"),
            category: calcCategory(avg_speed)
          };
        });
      }

      gRight.selectAll('g.glyph-group').remove();
      windAnim.stop();

      if (aggregatedGlyphs.length === 0) return;
      
      if (settings.layers.currents) {
        windAnim.updateField(aggregatedGlyphs);
        windAnim.start();
      }

      if (!settings.layers.glyphs) return;

      const colorScale = d3.scaleSequential()
        .domain(d3.extent(aggregatedGlyphs, d => d.proximity_to_eye))
        .interpolator(d3.interpolateRdYlBu);

      function getWindBarbPath(speed) {
        let knots = Math.round(speed);
        let s = 0.5; // Scale factor to reduce height from 14 to ~2
        if (knots < 5) return `M0,0 A${1.5*s},${1.5*s} 0 1,1 0,${0.1*s} Z`;
        let path = `M0,0 L0,${-14*s} `, yOffset = -14*s;
        let fifties = Math.floor(knots / 50); knots %= 50;
        let tens = Math.floor(knots / 10); knots %= 10;
        let fives = Math.floor(knots / 5);
        for (let i=0; i<fifties; i++) { path += `M0,${yOffset} L${6*s},${yOffset+1*s} L0,${yOffset+2*s} `; yOffset += 3*s; }
        for (let i=0; i<tens; i++) { path += `M0,${yOffset} L${7*s},${yOffset-2*s} `; yOffset += 2.5*s; }
        for (let i=0; i<fives; i++) { path += `M0,${yOffset+0.5*s} L${4*s},${yOffset-1*s} `; yOffset += 2.5*s; }
        return path;
      }

      const glyphGroups = gRight.selectAll('g.glyph-group')
        .data(aggregatedGlyphs)
        .join('g')
        .attr('class', 'glyph-group')
        .attr('transform', d => {
          const coords = projRight([d.longitude, d.latitude]);
          if (!coords) return `translate(-9999,-9999)`;
          return `translate(${coords[0]}, ${coords[1]})`;
        })
        .on('mouseover', (event, d) => {
          tooltip.transition().duration(200).style('opacity', 1);
          tooltip.html(`
            <p><strong>Category</strong> <span>${d.category}</span></p>
            <p><strong>Dist to Eye</strong> <span>${(d.proximity_to_eye * 111.1).toFixed(2)} km</span></p>
            <p><strong>Wind Speed</strong> <span>${d.wind_speed} mph</span></p>
            <p><strong>Wind Gust</strong> <span>${d.wind_gust} mph</span></p>
            <p><strong>Precipitation</strong> <span>${d.precipitation} in/hr</span></p>
            <p><strong>Temperature</strong> <span>${d.temperature} °C</span></p>
            ${d.event_code !== "NONE" ? `<p><strong>Event</strong> <span>${d.event_code}</span></p>` : ''}
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

      if (settings.props.prox) {
        glyphGroups.append('circle')
          .attr('r', 24)
          .attr('fill', d => colorScale(d.proximity_to_eye))
          .attr('fill-opacity', 0.45)
          .style('mix-blend-mode', 'multiply')
          .style('filter', 'blur(12px)');
      }

      if (settings.props.icon) {
        glyphGroups.each(function(d) {
          if (d.event_code === "WARNING" || d.event_code === "ADVISORY") {
             const mark = d.event_code === "WARNING" ? "+" : "~";
             
             d3.select(this).append('circle')
               .attr('cx', 0).attr('cy', 0)
               .attr('r', 3)
               .attr('fill', '#111')
               .style('pointer-events', 'none');

             d3.select(this).append('text')
               .attr('x', 0).attr('y', 2) 
               .attr('text-anchor', 'middle')
               .attr('font-size', 6)
               .attr('font-weight', 'bold')
               .attr('fill', '#fff')
               .text(mark)
               .style('pointer-events', 'none');
          }
        });
      }

      if (settings.props.barbs) {
        glyphGroups.append('g')
          .attr('transform', d => `rotate(${d.wind_flow_angle})`)
          .append('path')
          .attr('d', d => getWindBarbPath(d.wind_speed))
          .attr('stroke', '#111')
          .attr('stroke-width', .4)
          .attr('fill', d => d.wind_speed >= 50 ? '#111' : 'none');
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
  const targetTransform = d3.zoomIdentity.translate(tx, ty).scale(scale);
  maps[mapId].targetTransform = targetTransform;
  svg.transition().duration(750).call(zoom.transform, targetTransform);
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
  
  const reminder = document.getElementById('selection-reminder');
  if (reminder) reminder.classList.add('hidden');
  document.querySelectorAll('.settings-sidebar input[type="checkbox"]').forEach(cb => {
    cb.disabled = false;
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
