/**
 * PACIFIC WINGS - WWII Flight Tracker Engine
 * 1944-1945 Pacific Theater (China, Japan, Korea)
 */

class PacificWingsApp {
    constructor() {
        this.map = null;
        this.flights = [];
        this.bases = [];
        this.markers = new Map(); // PlaneID -> Marker
        this.baseMarkers = new Map(); // base key -> Marker
        this.targetMarkers = new Map(); // target name -> Marker
        this.trailPolylines = new Map(); // flightId -> [L.polyline, ...]
        this.selectedFlightPath = null; // Polyline for selected flight
        this.currentTime = new Date('1941-12-07T06:00:00Z').getTime();
        this.isPlaying = false;
        this.playbackSpeed = 1440; // 1 day per minute
        this.startTime = new Date('1941-12-07T00:00:00Z').getTime();
        this.endTime = new Date('1945-09-06T12:00:00Z').getTime();
        this.selectedFlightId = null;
        this.selectedBaseKey = null;
        this.searchAllMissions = false; // Toggle for searching all vs active missions
        this.selectedSquadrons = null; // Set of selected squadrons (null = all shown)

        this.init();
    }

    async init() {
        this.initMap();
        this.initEventListeners();
        this.loadEmbeddedData();
        this.buildTimeIndex();
        this.initLegend();
        this.startTick();
        this.updateUI();
        this.updateTick(); // Ensure bases and planes appear immediately on load
    }

    loadEmbeddedData() {
        // Load bases from window.BASES_DATA (bases_data.js)
        if (window.BASES_DATA) {
            this.bases = window.BASES_DATA.map(b => ({
                ...b,
                startMs: this.parseDateBoundary(b.start, false),
                endMs: this.parseDateBoundary(b.end, true),
                key: `${b.af}-${b.name}`,
            }));
        }

        // Load targets lookup from window.TARGETS_DATA (targets_data.js)
        this._targetsIndex = {};
        if (window.TARGETS_DATA) {
            for (const t of window.TARGETS_DATA) {
                const key = t.name.toLowerCase();
                this._targetsIndex[key] = t;
                for (const alias of t.aliases) {
                    const akey = alias.toLowerCase();
                    if (!this._targetsIndex[akey]) this._targetsIndex[akey] = t;
                }
            }
        }

        // Load missions from window.MISSIONS_CSV (missions_data.js)
        if (window.MISSIONS_CSV) {
            this.parseMissionsCSV(window.MISSIONS_CSV);
            this.renderSquadronTags();
            this.renderSquadronFilterPanel();
        }
    }

    renderSquadronTags() {
        // Get unique squadrons, sorted alphabetically (legacy hidden tags — kept for compat)
        const squadrons = [...new Set(this.flights.map(f => f.squadron))].sort();
        const container = document.getElementById('squadron-tags');
        container.innerHTML = '';
        squadrons.forEach(squadron => {
            const tag = document.createElement('button');
            tag.className = 'squadron-tag';
            tag.textContent = squadron;
            container.appendChild(tag);
        });
    }

    renderSquadronFilterPanel() {
        const listEl = document.getElementById('sqf-list');
        if (!listEl) return;

        const squadrons = [...new Set(this.flights.map(f => f.squadron))].sort();

        // Initialize selectedSquadrons to all if not set
        if (this.selectedSquadrons === null) {
            this.selectedSquadrons = new Set(squadrons);
        }

        // Count missions per squadron
        const counts = {};
        squadrons.forEach(sq => { counts[sq] = 0; });
        this.flights.forEach(f => { if (counts[f.squadron] !== undefined) counts[f.squadron]++; });

        listEl.innerHTML = '';
        squadrons.forEach(squadron => {
            const item = document.createElement('label');
            item.className = 'sqf-item';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = this.selectedSquadrons.has(squadron);
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    this.selectedSquadrons.add(squadron);
                } else {
                    this.selectedSquadrons.delete(squadron);
                }
                this._applySquadronFilter();
            });

            const label = document.createElement('span');
            label.className = 'sqf-label';
            label.textContent = squadron;

            const count = document.createElement('span');
            count.className = 'sqf-count';
            count.textContent = counts[squadron];

            item.appendChild(cb);
            item.appendChild(label);
            item.appendChild(count);
            listEl.appendChild(item);
        });

        // Wire up Select All / Unselect All
        const selectAllBtn = document.getElementById('sqf-select-all');
        const unselectAllBtn = document.getElementById('sqf-unselect-all');
        if (selectAllBtn) {
            selectAllBtn.onclick = () => {
                this.selectedSquadrons = new Set(squadrons);
                listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
                this._applySquadronFilter();
            };
        }
        if (unselectAllBtn) {
            unselectAllBtn.onclick = () => {
                this.selectedSquadrons = new Set();
                listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
                this._applySquadronFilter();
            };
        }
    }

    _applySquadronFilter() {
        this.updatePlanesOnMap();
        this.updateStats();
        this.renderFlightList(document.getElementById('flight-search').value);
    }

    _isSquadronVisible(squadron) {
        if (this.selectedSquadrons === null) return true;
        return this.selectedSquadrons.has(squadron);
    }

    _updateTrails(visibleFlights) {
        const TRAIL_GAME_WINDOW_MS = 4 * 60 * 60 * 1000; // trail covers last 4 game-hours of a flight
        const FADE_DURATION_MS    = 6 * 60 * 60 * 1000; // post-landing trail fades over 6 game-hours
        const TRAIL_SAMPLE_POINTS = 40;
        const TRAIL_SEGMENTS = 6;
        const BASE_OPACITIES = [0.06, 0.13, 0.23, 0.37, 0.55, 0.72];
        const WEIGHTS        = [1,    1,    1.5,  1.5,  2,    2];
        const COLOR = '#ffffff';

        // Recently-landed flights that are still within the fade window
        const fadingFlights = this.flights.filter(f =>
            f.endMs < this.currentTime &&
            this.currentTime - f.endMs < FADE_DURATION_MS &&
            this._isSquadronVisible(f.squadron)
        );

        const allTrailIds = new Set([
            ...visibleFlights.map(f => f.id),
            ...fadingFlights.map(f => f.id)
        ]);

        // Remove polylines for flights outside both sets
        this.trailPolylines.forEach((segs, id) => {
            if (!allTrailIds.has(id)) {
                segs.forEach(p => this.map.removeLayer(p));
                this.trailPolylines.delete(id);
            }
        });

        const renderTrail = (flight, trailStart, trailEnd, opacityScale) => {
            const span = trailEnd - trailStart;
            if (span <= 0) return;

            const points = [];
            for (let i = 0; i <= TRAIL_SAMPLE_POINTS; i++) {
                const t = trailStart + (i / TRAIL_SAMPLE_POINTS) * span;
                const progress = (t - flight.startMs) / flight.duration;
                const pos = this.getPlanePoseAtProgress(flight.waypoints, progress).position;
                points.push([pos.lat, pos.lng]);
            }

            if (!this.trailPolylines.has(flight.id)) {
                const segs = Array.from({ length: TRAIL_SEGMENTS }, (_, i) =>
                    L.polyline([], {
                        color: COLOR,
                        weight: WEIGHTS[i],
                        opacity: BASE_OPACITIES[i],
                        interactive: false,
                        pane: 'shadowPane'
                    }).addTo(this.map)
                );
                this.trailPolylines.set(flight.id, segs);
            }

            const segs = this.trailPolylines.get(flight.id);
            const n = points.length;
            for (let s = 0; s < TRAIL_SEGMENTS; s++) {
                const startIdx = Math.floor((s / TRAIL_SEGMENTS) * (n - 1));
                const endIdx   = Math.floor(((s + 1) / TRAIL_SEGMENTS) * (n - 1));
                segs[s].setLatLngs(points.slice(startIdx, endIdx + 1));
                segs[s].setStyle({ opacity: BASE_OPACITIES[s] * opacityScale });
            }
        };

        // Active flights — trail follows current position
        for (const flight of visibleFlights) {
            const trailStart = Math.max(this.currentTime - TRAIL_GAME_WINDOW_MS, flight.startMs);
            renderTrail(flight, trailStart, this.currentTime, 1.0);
        }

        // Fading flights — trail frozen at landing position, opacity decays to 0
        for (const flight of fadingFlights) {
            const age = this.currentTime - flight.endMs;
            const opacityScale = 1.0 - (age / FADE_DURATION_MS);
            const trailStart = Math.max(flight.endMs - TRAIL_GAME_WINDOW_MS, flight.startMs);
            renderTrail(flight, trailStart, flight.endMs, opacityScale);
        }
    }

    _clearAllTrails() {
        this.trailPolylines.forEach(segs => segs.forEach(p => this.map.removeLayer(p)));
        this.trailPolylines.clear();
    }

    parseDateBoundary(dateStr, endOfDay = false) {
        // Ensure UTC parsing by adding T00:00:00Z if not present
        const normalizedStr = dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00Z';
        const ms = new Date(normalizedStr).getTime();
        if (Number.isNaN(ms)) return ms;
        if (!endOfDay) return ms;
        return ms + (24 * 60 * 60 * 1000) - 1;
    }

    loadMissionsFromFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            this.flights = [];
            this.markers.forEach(m => this.map.removeLayer(m));
            this.markers.clear();
            this._clearAllTrails();
            this.selectedSquadrons = null; // Reset squadron filter
            this.parseMissionsCSV(e.target.result);
            this.buildTimeIndex();
            this.renderSquadronTags();
            this.renderSquadronFilterPanel();
            this.updateTick();
            this.renderDynamicJumpPoints();
            console.log(`Loaded ${this.flights.length} missions from ${file.name}`);
        };
        reader.readAsText(file);
    }

    parseMissionsCSV(text) {
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        let parsedCount = 0;
        // Skip header row
        for (let i = 1; i < lines.length; i++) {
            try {
                const cols = this.splitCSVLine(lines[i]);
                if (cols.length < 9) continue;

                // Columns: id, squadron, type, description, sLat, sLng, eLat, eLng, startTime, duration, altitude, speed, waypoints, origin_base, target_name, num_aircraft, to_check, mission_category
                const [id, squadron, type, description, sLat, sLng, eLat, eLng, startTime, durationHours, altitude, speed, waypointsRaw, ...rest] = cols;

                // Validate critical fields
                const sLatNum = parseFloat(sLat.trim());
                const sLngNum = parseFloat(sLng.trim());
                const eLatNum = parseFloat(eLat.trim());
                const eLngNum = parseFloat(eLng.trim());

                // Skip rows with invalid coordinates
                if (isNaN(sLatNum) || isNaN(sLngNum) || isNaN(eLatNum) || isNaN(eLngNum)) {
                    continue;
                }

                const startMs = new Date(startTime).getTime();
                if (isNaN(startMs)) continue;

                const duration = parseFloat(durationHours) * 3600 * 1000;

                let waypoints;
                if (waypointsRaw && waypointsRaw.trim()) {
                    waypoints = waypointsRaw.trim().split(';').map(pair => {
                        const [lat, lng] = pair.split(':').map(Number);
                        if (!isNaN(lat) && !isNaN(lng)) {
                            return { lat, lng };
                        }
                        return null;
                    }).filter(wp => wp !== null);
                }

                if (!waypoints || waypoints.length === 0) {
                    waypoints = [
                        { lat: sLatNum, lng: sLngNum },
                        { lat: eLatNum, lng: eLngNum }
                    ];
                }

                // Extract optional fields from rest array
                let numAircraft = 1;
                if (rest.length > 2) {
                    const numStr = rest[2].trim();
                    const num = parseInt(numStr);
                    if (!isNaN(num) && num > 0) numAircraft = num;
                }

                // rest[0] = origin_base, rest[1] = target_name, rest[2] = num_aircraft, rest[3] = to_check, rest[4] = mission_category
                const originBaseName = (rest.length > 0 ? rest[0].trim() : '') || '';
                const targetName = (rest.length > 1 ? rest[1].trim() : '') || '';
                const missionCategory = (rest.length > 4 ? rest[4].trim() : '') || 'Other';

                this.flights.push({
                    id: id.trim(),
                    squadron: squadron.trim(),
                    type: type.trim(),
                    description: description.replace(/\s*===== PAGE \d+ =====\s*/g, ' ').replace(/\s+/g, ' ').trim(),
                    origin: `${sLat.trim()}, ${sLng.trim()}`,
                    originLatLng: { lat: sLatNum, lng: sLngNum },
                    originBaseName,
                    destination: `${eLat.trim()}, ${eLng.trim()}`,
                    destLatLng: { lat: eLatNum, lng: eLngNum },
                    startTime,
                    startMs,
                    duration,
                    endMs: startMs + duration,
                    waypoints,
                    altitude: parseFloat(altitude) || 20000,
                    speed: parseFloat(speed) || 300,
                    numAircraft,
                    targetName,
                    missionCategory
                });
                parsedCount++;
            } catch (err) {
                // Skip malformed rows silently
                continue;
            }
        }
    }

    // Splits a CSV line respecting double-quoted fields
    splitCSVLine(line) {
        const cols = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { inQuotes = !inQuotes; continue; }
            if (ch === ',' && !inQuotes) { cols.push(cur); cur = ''; continue; }
            cur += ch;
        }
        cols.push(cur);
        return cols;
    }

    // ── Basemap helpers ─────────────────────────────────────────────────────

    // Recursively shift all [lng, lat] coordinates by a longitude offset
    _shiftGeoJSONLng(geojson, offset) {
        function shiftCoords(c) {
            if (typeof c[0] === 'number') return [c[0] + offset, c[1]];
            return c.map(shiftCoords);
        }
        return {
            ...geojson,
            features: geojson.features.map(f => f.geometry ? {
                ...f,
                geometry: { ...f.geometry, coordinates: shiftCoords(f.geometry.coordinates) }
            } : f)
        };
    }

    // Area-weighted centroid across ALL polygons in a MultiPolygon (returns [lat, lng]).
    // Using the weighted average rather than just the largest polygon avoids cases
    // where near-equal-sized islands cause the label to land on the wrong one
    // (e.g. the 1938 "Saipan" feature covers the whole Marianas chain).
    // Handles features that straddle the antimeridian by normalising longitudes
    // to a ±180° window around a global reference before accumulating.
    _multipolygonCenter(coordinates) {
        // First pass: pick a reference longitude from the raw average of all coords
        const allLngs = [];
        for (const polygon of coordinates) {
            for (const pt of polygon[0]) allLngs.push(pt[0]);
        }
        const refLng = allLngs.reduce((a, b) => a + b, 0) / allLngs.length;

        function normLng(lng) {
            let d = lng - refLng;
            while (d > 180) d -= 360;
            while (d < -180) d += 360;
            return refLng + d;
        }

        // Second pass: accumulate area-weighted centroid across every polygon
        let totalArea = 0, sumCx = 0, sumCy = 0;
        for (const polygon of coordinates) {
            const ring = polygon[0];
            let area = 0, cx = 0, cy = 0;
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const xi = normLng(ring[i][0]), yi = ring[i][1];
                const xj = normLng(ring[j][0]), yj = ring[j][1];
                const cross = xi * yj - xj * yi;
                area += cross;
                cx += (xi + xj) * cross;
                cy += (yi + yj) * cross;
            }
            area = Math.abs(area) / 2;
            if (area > 0) {
                sumCx += cx / 6;   // == area * centroid_x
                sumCy += cy / 6;
                totalArea += area;
            }
        }
        if (totalArea === 0) return [0, 0];

        let lng = sumCx / totalArea;
        while (lng > 180) lng -= 360;
        while (lng < -180) lng += 360;
        return [sumCy / totalArea, lng]; // [lat, lng]
    }

    // Add a GeoJSON layer at 0°, -360°, and +360° so the map tiles horizontally.
    // Pass nameProp to render labels from that feature property.
    // Pass group (a L.LayerGroup) to collect polygons into it.
    // Pass labelsGroup to collect label markers separately.
    // Pass labelCollector (array) to store {marker, bounds} for dynamic visibility.
    _addRepeatableGeoJSON(geojson, options, nameProp, group, labelsGroup, labelCollector) {
        const target = group || this.map;
        const labelsTarget = labelsGroup || target;
        [-360, 0, 360].forEach(offset => {
            const data = offset === 0 ? geojson : this._shiftGeoJSONLng(geojson, offset);
            const opts = { ...options };
            if (nameProp) {
                opts.onEachFeature = (feature, layer) => {
                    const name = feature.properties[nameProp]
                        || feature.properties.NAME
                        || feature.properties.name;
                    if (!name) return;
                    const center = layer.getBounds().getCenter();
                    const marker = L.marker(center, {
                        icon: L.divIcon({
                            className: 'basemap-label',
                            html: `<span>${name}</span>`,
                            iconSize: null,
                            iconAnchor: [0, 0]
                        }),
                        interactive: false,
                        zIndexOffset: -9999
                    }).addTo(labelsTarget);

                    if (labelCollector) {
                        labelCollector.push({
                            marker,
                            bounds: layer.getBounds()
                        });
                    }
                };
            }
            L.geoJSON(data, opts).addTo(target);
        });
    }

    async _loadBasemap() {
        const MODERN_FILL_STYLE = {
            style: {
                fillColor: '#0e0e0e',
                fillOpacity: 1,
                color: 'transparent',
                weight: 0
            },
            interactive: false
        };
        const HIST_BOUNDARY_STYLE = {
            style: {
                fill: false,
                fillOpacity: 0,
                color: 'rgba(102, 102, 102, 0.5)',
                weight: 0.8
            },
            interactive: false
        };

        // Historical mode: modern land geometry + 1938 boundaries/labels.
        this._historicalGroup = L.layerGroup().addTo(this.map);
        this._historicalMinorIslandsGroup = L.layerGroup();
        this._historicalLabelsGroup = L.layerGroup();
        this._historicalLabelEntries = [];

        // Modern CARTO tile — created now but not added until toggled
        this._modernTile = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            subdomains: 'abcd',
            maxZoom: 20
        });

        this._basemapMode = 'historical';

        try {
            const [hist, modern, modernMinorIslands] = await Promise.all([
                fetch('https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/world_1938.geojson').then(r => r.json()),
                fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_map_units.geojson').then(r => r.json()),
                fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_scale_rank_minor_islands.geojson').then(r => r.json())
            ]);

            const modernLand = {
                type: 'FeatureCollection',
                features: modern.features.filter(f => f.geometry)
            };

            const hist1938Named = {
                type: 'FeatureCollection',
                features: hist.features.filter(f => f.geometry && f.properties && f.properties.NAME)
            };

            const modernMinor = {
                type: 'FeatureCollection',
                features: modernMinorIslands.features.filter(f => f.geometry)
            };

            this._addRepeatableGeoJSON(modernLand, MODERN_FILL_STYLE, null, this._historicalGroup);
            this._addRepeatableGeoJSON(modernMinor, MODERN_FILL_STYLE, null, this._historicalMinorIslandsGroup);
            this._addRepeatableGeoJSON(
                hist1938Named,
                HIST_BOUNDARY_STYLE,
                'NAME',
                this._historicalGroup,
                this._historicalLabelsGroup,
                this._historicalLabelEntries
            );
            this._updateIslandsVisibility();
        } catch {
            // Silent fallback — ocean background from CSS remains visible
        }
    }

    _updateHistoricalLabelVisibility() {
        if (!this.map || !this._historicalLabelEntries) return;

        // Pixel-space threshold: show labels only when their feature is large enough
        // on screen (dynamic behavior instead of fixed zoom).
        const minLabelPixelSpan = 28;

        for (const entry of this._historicalLabelEntries) {
            const { marker, bounds } = entry;
            const sw = this.map.latLngToLayerPoint(bounds.getSouthWest());
            const ne = this.map.latLngToLayerPoint(bounds.getNorthEast());
            const width = Math.abs(ne.x - sw.x);
            const height = Math.abs(sw.y - ne.y);
            const show = Math.max(width, height) >= minLabelPixelSpan;
            marker.setOpacity(show ? 1 : 0);
        }
    }

    _updateIslandsVisibility() {
        if (!this._historicalMinorIslandsGroup || !this._historicalLabelsGroup) return;
        if (this._basemapMode !== 'historical') return;

        // Extra tiny-island detail appears only when zooming in.
        if (this.map.getZoom() >= 5) {
            if (!this.map.hasLayer(this._historicalMinorIslandsGroup)) {
                this._historicalMinorIslandsGroup.addTo(this.map);
            }
            if (!this.map.hasLayer(this._historicalLabelsGroup)) {
                this._historicalLabelsGroup.addTo(this.map);
            }
        } else if (this.map.hasLayer(this._historicalMinorIslandsGroup)) {
            this._historicalMinorIslandsGroup.remove();
        }

        // Labels are always mounted in historical mode, then filtered dynamically
        // by rendered feature size.
        if (!this.map.hasLayer(this._historicalLabelsGroup)) {
            this._historicalLabelsGroup.addTo(this.map);
        }
        this._updateHistoricalLabelVisibility();
    }

    _toggleBasemap() {
        const btn = document.getElementById('basemap-toggle-btn');
        if (this._basemapMode === 'historical') {
            this._historicalGroup.remove();
            if (this._historicalMinorIslandsGroup) this._historicalMinorIslandsGroup.remove();
            if (this._historicalLabelsGroup) this._historicalLabelsGroup.remove();
            this._modernTile.addTo(this.map);
            this._basemapMode = 'modern';
            btn.textContent = 'Modern map';
            btn.classList.add('active');
        } else {
            this._modernTile.remove();
            this._historicalGroup.addTo(this.map);
            this._basemapMode = 'historical';
            btn.textContent = '1938 map';
            btn.classList.remove('active');
            this._updateIslandsVisibility();
        }
    }

    initMap() {
        // Initialize Leaflet map
        this.map = L.map('map', {
            zoomControl: false,
            attributionControl: false,
            minZoom: 2,
            maxZoom: 20,
            worldCopyJump: true
        }).setView([20.0, 170.0], 3); // Pacific Theater (India/Philippines left, Hawaii center, US West Coast right)

        // Load basemap layers (historical = modern geometry + 1938 boundaries/names)
        this._loadBasemap();


        // Basemap toggle control (top-right, above zoom)
        const BasemapToggle = L.Control.extend({
            options: { position: 'topright' },
            onAdd: () => {
                const div = L.DomUtil.create('div', 'basemap-toggle-wrap leaflet-bar');
                div.innerHTML = '<button id="basemap-toggle-btn" class="basemap-toggle-btn">1938 map</button>';
                L.DomEvent.disableClickPropagation(div);
                return div;
            }
        });
        new BasemapToggle().addTo(this.map);
        document.addEventListener('click', e => {
            if (e.target.id === 'basemap-toggle-btn') this._toggleBasemap();
        });

        // Move zoom control to top-right
        L.control.zoom({ position: 'topright' }).addTo(this.map);

        // Show/hide tiny modern-island detail based on zoom level
        this.map.on('zoomend', () => this._updateIslandsVisibility());
        this.map.on('moveend', () => this._updateHistoricalLabelVisibility());

        // Planes: keep interpolation aligned during zoom animation.
        this.map.on('zoom viewreset', () => this.updatePlanesOnMap());

        // Bases use divIcon (marker pane) so zoom is handled natively.
        // On moveend, re-normalize longitudes in place without recreating markers.
        this.map.on('moveend', () => {
            const mapCenterLng = this.map.getCenter().lng;
            for (const base of this.bases) {
                const marker = this.baseMarkers.get(base.key);
                if (marker) {
                    let lng = base.lng;
                    while (lng < mapCenterLng - 180) lng += 360;
                    while (lng > mapCenterLng + 180) lng -= 360;
                    marker.setLatLng([base.lat, lng]);
                }
            }
            if (window.TARGETS_DATA) {
                for (const t of window.TARGETS_DATA) {
                    const marker = this.targetMarkers.get(t.name);
                    if (marker) {
                        let lng = t.lng;
                        while (lng < mapCenterLng - 180) lng += 360;
                        while (lng > mapCenterLng + 180) lng -= 360;
                        marker.setLatLng([t.lat, lng]);
                    }
                }
            }
        });
    }

    initEventListeners() {
        const playBtn = document.getElementById('play-pause');
        playBtn.addEventListener('click', () => {
            this.isPlaying = !this.isPlaying;
            playBtn.textContent = this.isPlaying ? '⏸' : '▶';
        });

        const slider = document.getElementById('timeline-slider');
        slider.addEventListener('input', (e) => {
            const ratio = e.target.value / 100000;
            this.currentTime = this.startTime + (this.endTime - this.startTime) * ratio;
            this.updateTick();
        });

        const speedSelect = document.getElementById('time-speed');
        speedSelect.addEventListener('change', (e) => {
            this.playbackSpeed = parseInt(e.target.value);
        });

        document.getElementById('next-day').addEventListener('click', () => {
            this.currentTime += 24 * 60 * 60 * 1000;
            this.updateTick();
        });

        document.getElementById('prev-day').addEventListener('click', () => {
            this.currentTime -= 24 * 60 * 60 * 1000;
            this.updateTick();
        });

        document.getElementById('next-hour').addEventListener('click', () => {
            this.currentTime += 60 * 60 * 1000;
            this.updateTick();
        });

        document.getElementById('prev-hour').addEventListener('click', () => {
            this.currentTime -= 60 * 60 * 1000;
            this.updateTick();
        });

        // Detail page close button — slide back to default panels
        document.getElementById('detail-close').addEventListener('click', () => {
            this._closeDetailView();
        });

        // SW panel collapse/expand — delegate from sidebar
        document.getElementById('sidebar-default').addEventListener('click', (e) => {
            const hd = e.target.closest('.sw-panel-hd');
            if (!hd) return;
            const panel = hd.closest('.sw-panel');
            const bd = panel && panel.querySelector('.sw-panel-bd');
            const btn = hd.querySelector('.sw-collapse-btn');
            if (!bd) return;
            const collapsing = !bd.classList.contains('collapsed');
            bd.classList.toggle('collapsed', collapsing);
            if (btn) btn.textContent = collapsing ? '+' : '−';
        });

        document.getElementById('flight-search').addEventListener('input', (e) => {
            this.renderFlightList(e.target.value);
        });

        document.getElementById('search-all-toggle').addEventListener('click', () => {
            this.searchAllMissions = !this.searchAllMissions;
            const btn = document.getElementById('search-all-toggle');
            btn.classList.toggle('active', this.searchAllMissions);
            btn.textContent = this.searchAllMissions ? 'All' : 'Active';
            this.renderFlightList(document.getElementById('flight-search').value);
        });

        // Mission ID Jump
        const missionIdInput = document.getElementById('mission-id-jump');
        if (missionIdInput) {
            missionIdInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const missionId = missionIdInput.value.trim();
                    if (missionId) {
                        const success = this.jumpToMissionId(missionId);
                        const errorDiv = document.getElementById('mission-id-error');
                        if (!success) {
                            if (errorDiv) {
                                errorDiv.textContent = `Mission "${missionId}" not found`;
                                errorDiv.style.display = 'block';
                            }
                        } else {
                            missionIdInput.value = '';
                            if (errorDiv) errorDiv.style.display = 'none';
                        }
                    }
                }
            });
            missionIdInput.addEventListener('input', () => {
                const errorDiv = document.getElementById('mission-id-error');
                if (errorDiv) errorDiv.style.display = 'none';
            });
        }

        // Jump Point Listeners
        this.addJumpPointListeners();

        // Legend Toggle
        const toggleLegendBtn = document.getElementById('toggle-legend');
        if (toggleLegendBtn) {
            toggleLegendBtn.addEventListener('click', () => {
                const content = document.getElementById('legend-content');
                content.classList.toggle('collapsed');
                toggleLegendBtn.textContent = content.classList.contains('collapsed') ? '+' : '−';
            });
        }

        this.setupImportModal();
        this.setupAboutModal();
    }

    addJumpPointListeners() {
        document.querySelectorAll('.jump-btn').forEach(btn => {
            btn.onclick = () => {
                this.currentTime = new Date(btn.dataset.time).getTime();
                this.updateTick();
                this.isPlaying = false;
                document.getElementById('play-pause').textContent = '▶';
            };
        });
    }

    setupImportModal() {
        const modal = document.getElementById('import-modal');
        const closeBtn = document.querySelector('.close-modal');
        const processBtn = document.getElementById('process-csv');
        const clearCsvBtn = document.getElementById('clear-csv');
        const fileInput = document.getElementById('csv-file-input');
        const csvInput = document.getElementById('csv-input');

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.loadMissionsFromFile(file);
            fileInput.value = ''; // reset so same file can be reloaded
        });

        closeBtn.onclick = () => modal.classList.add('hidden');
        window.onclick = (e) => { if (e.target == modal) modal.classList.add('hidden'); };

        processBtn.onclick = () => {
            const data = csvInput.value;
            this.parseCSV(data);
        };

        clearCsvBtn.onclick = () => {
            csvInput.value = '';
            csvInput.focus();
        };
    }

    setupAboutModal() {
        const modal = document.getElementById('about-modal');
        const closeBtn = document.getElementById('about-close');
        const openBtn = document.getElementById('about-btn');

        openBtn.onclick = () => modal.classList.remove('hidden');
        closeBtn.onclick = () => modal.classList.add('hidden');
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
    }

    initLegend() {
        const legendGrid = document.getElementById('legend-grid');
        if (!legendGrid) return;

        // Build legend from AIRCRAFT_DATA — skip generic categories and unknowns
        const skipTypes = new Set(['Heavy Bomber', 'Medium Bomber', 'Light Bomber', 'Fighter', 'Unknown Aircraft']);
        const legendTypes = (window.AIRCRAFT_DATA || []).filter(d => !skipTypes.has(d.type));

        // Normalize icon display size for legend (cap at 40px wide)
        legendGrid.innerHTML = legendTypes.map(ac => {
            const legendW = Math.min(ac.width, 40);
            const legendH = Math.round(legendW * ac.height / ac.width);
            const imgStyle = ac.needsInvert ? 'filter: invert(1);' : '';
            return `
                <div class="legend-aircraft">
                    <div class="legend-icon" style="width:44px;display:flex;align-items:center;justify-content:center;">
                        <img src="${ac.icon}" width="${legendW}" height="${legendH}" style="${imgStyle}" onerror="this.src='icons/default.svg'">
                    </div>
                    <div class="legend-info">
                        <div class="legend-name">${ac.type}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    prefillCSVInput() {
        // Format current flights as CSV for the textarea
        const header = "squadron, type, description, start_lat, start_lng, end_lat, end_lng, start_time, duration_hours";
        const rows = this.flights.map(f => {
            const s = f.waypoints[0];
            const e = f.waypoints[f.waypoints.length - 1];
            const duration = (f.endMs - f.startMs) / (3600 * 1000);
            return `${f.squadron}, ${f.type}, ${f.description || 'N/A'}, ${s.lat}, ${s.lng}, ${e.lat}, ${e.lng}, ${f.startTime}, ${duration}`;
        }).join('\n');

        document.getElementById('csv-input').value = header + '\n' + rows;
    }

    clearAllMissions() {
        // Remove markers and paths from map
        this.markers.forEach(marker => this.map.removeLayer(marker));
        this.markers.clear();
        this.targetMarkers.forEach(marker => this.map.removeLayer(marker));
        this.targetMarkers.clear();
        this._clearAllTrails();
        if (this.selectedFlightPath) {
            this.map.removeLayer(this.selectedFlightPath);
            this.selectedFlightPath = null;
        }

        this.flights = [];
        this.flightsByStart = [];
        this.maxDuration = 0;
        this.selectedFlightId = null;
        this.selectedBaseKey = null;
        this.selectedSquadrons = null;
        document.getElementById('sidebar-views').classList.remove('detail-open');
        this.renderSquadronTags();
        this.renderSquadronFilterPanel();
        this.renderDynamicJumpPoints();
        this.updateTick();
    }

    // ------------------------------------------------------------------
    // Time index — built once after all flights are loaded.
    // Allows O(log n + k) active-flight lookup instead of O(n) per tick.
    // ------------------------------------------------------------------
    buildTimeIndex() {
        this.flightsByStart = [...this.flights].sort((a, b) => a.startMs - b.startMs);
        // Exclude NaN durations (empty duration field) so maxDuration stays numeric
        this.maxDuration = this.flights.reduce((m, f) => isNaN(f.duration) ? m : Math.max(m, f.duration), 0);
    }

    // First index where flightsByStart[i].startMs > time
    _upperBound(time) {
        let lo = 0, hi = this.flightsByStart.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.flightsByStart[mid].startMs <= time) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    // First index where flightsByStart[i].startMs >= time
    _lowerBound(time) {
        let lo = 0, hi = this.flightsByStart.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.flightsByStart[mid].startMs < time) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    getActiveFlights() {
        if (!this.flightsByStart || !this.flightsByStart.length) return [];
        // Candidates: started on or before now, started no earlier than (now - maxDuration)
        const hi = this._upperBound(this.currentTime);
        const lo = this._lowerBound(this.currentTime - this.maxDuration);
        const candidates = this.flightsByStart.slice(lo, hi);
        return candidates.filter(f => !isNaN(f.endMs) && f.endMs >= this.currentTime);
    }

    startTick() {
        const tickRate = 50; // ms
        setInterval(() => {
            if (this.isPlaying) {
                // Increment time
                // In world time, 50ms real time * playbackSpeed
                // If playbackSpeed is 1, 1 second = 1 second.
                // We want slightly faster default experience.
                const increment = (tickRate * this.playbackSpeed);
                this.currentTime += increment;

                if (this.currentTime > this.endTime) {
                    this.currentTime = this.startTime;
                }

                this.updateTick();
            }
        }, tickRate);
    }

    // Adjusts waypoint longitudes so consecutive points never jump > 180°,
    // letting Leaflet draw the path across the date line instead of around the world.
    normalizePath(waypoints) {
        if (waypoints.length < 2) return waypoints;
        const result = [{ ...waypoints[0] }];
        for (let i = 1; i < waypoints.length; i++) {
            let lng = waypoints[i].lng;
            const prevLng = result[i - 1].lng;
            let diff = lng - prevLng;
            if (diff > 180) diff -= 360;
            else if (diff < -180) diff += 360;
            result.push({ lat: waypoints[i].lat, lng: prevLng + diff });
        }
        return result;
    }

    updateSelectedPath(flight) {
        if (this.selectedFlightPath) {
            this.map.removeLayer(this.selectedFlightPath);
        }

        if (flight) {
            this.selectedFlightPath = L.polyline(this.normalizePath(flight.waypoints), {
                color: '#3b82f6',
                weight: 2,
                opacity: 0.6,
                dashArray: '5, 10'
            }).addTo(this.map);
        }
    }

    updateTick() {
        this.updateBasesOnMap();
        this.updateTargetsOnMap();
        this.updatePlanesOnMap();
        this.updateTimelineUI();
        this.updateStats();
        this.renderFlightList(document.getElementById('flight-search').value);
        this.updateSelectedDetails();
    }

    // AF color assignments for base markers
    _afColor(af) {
        const colors = {
            'Hawaiian AF': '#fbbf24', 'FEAF': '#f97316', 'Fifth AF': '#60a5fa',
            'Seventh AF': '#34d399', 'Tenth AF': '#a78bfa', 'Eleventh AF': '#94a3b8',
            'Thirteenth AF': '#fb923c', 'Fourteenth AF': '#f87171',
            'Twentieth AF': '#ef4444',
        };
        return colors[af] || '#e2e8f0';
    }

    updateBasesOnMap() {
        const activeKeys = new Set();

        for (const base of this.bases) {
            const active = this.currentTime >= base.startMs && this.currentTime <= base.endMs;
            if (active) {
                activeKeys.add(base.key);
                if (!this.baseMarkers.has(base.key)) {
                    const color = this._afColor(base.af);
                    // Normalize longitude to the visible side of the map
                    const mapCenterLng = this.map.getCenter().lng;
                    let lng = base.lng;
                    while (lng < mapCenterLng - 180) lng += 360;
                    while (lng > mapCenterLng + 180) lng -= 360;
                    const dotIcon = L.divIcon({
                        className: 'base-icon-wrapper',
                        html: `<div class="base-dot" style="background:${color};"></div>`,
                        iconSize: [16, 16],
                        iconAnchor: [8, 8]
                    });
                    const marker = L.marker([base.lat, lng], { icon: dotIcon }).addTo(this.map);
                    marker.on('click', () => this.selectBase(base.key));
                    marker.bindTooltip(
                        `<strong>${base.name}</strong><br>${base.af}`,
                        { direction: 'top', offset: [0, -10] }
                    );
                    this.baseMarkers.set(base.key, marker);
                }
            }
        }

        // Remove bases no longer active
        this.baseMarkers.forEach((marker, key) => {
            if (!activeKeys.has(key)) {
                this.map.removeLayer(marker);
                this.baseMarkers.delete(key);
            }
        });

    }

    updateTargetsOnMap() {
        // Collect canonical target names for currently active missions
        const activeFlights = this.getActiveFlights();
        const activeCanonicalNames = new Set(); // canonical targetData.name values
        for (const flight of activeFlights) {
            if (!flight.targetName) continue;
            const targetData = this._targetsIndex && this._targetsIndex[flight.targetName.toLowerCase()];
            if (targetData) activeCanonicalNames.add(targetData.name);
        }

        // Show markers for active targets
        for (const canonicalName of activeCanonicalNames) {
            if (this.targetMarkers.has(canonicalName)) continue;
            const targetData = this._targetsIndex && this._targetsIndex[canonicalName.toLowerCase()];
            if (!targetData) continue;
            const mapCenterLng = this.map.getCenter().lng;
            let lng = targetData.lng;
            while (lng < mapCenterLng - 180) lng += 360;
            while (lng > mapCenterLng + 180) lng -= 360;
            const icon = L.divIcon({
                className: 'target-icon-wrapper',
                html: `<div class="target-marker"></div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });
            const marker = L.marker([targetData.lat, lng], { icon, zIndexOffset: -100 }).addTo(this.map);
            marker.on('click', () => this.selectTarget(canonicalName));
            marker.bindTooltip(
                `<strong>${targetData.name}</strong><br><span style="opacity:0.7">${targetData.type}</span>`,
                { direction: 'top', offset: [0, -10] }
            );
            this.targetMarkers.set(canonicalName, marker);
        }

        // Remove targets no longer referenced by active missions
        this.targetMarkers.forEach((marker, key) => {
            if (!activeCanonicalNames.has(key)) {
                this.map.removeLayer(marker);
                this.targetMarkers.delete(key);
            }
        });
    }

    updatePlanesOnMap() {
        const activeFlights = this.getActiveFlights();
        const visibleFlights = activeFlights.filter(f => this._isSquadronVisible(f.squadron));
        const visibleIds = new Set(visibleFlights.map(f => f.id));

        // Remove markers for flights that are no longer active or are filtered out
        this.markers.forEach((marker, id) => {
            if (!visibleIds.has(id)) {
                this.map.removeLayer(marker);
                this.markers.delete(id);
            }
        });

        // Update or create markers only for visible active flights
        for (const flight of visibleFlights) {
            const progress = (this.currentTime - flight.startMs) / flight.duration;
            const pose = this.getPlanePoseAtProgress(flight.waypoints, progress);
            const pos = pose.position;
            const bearing = pose.bearing;

            if (!this.markers.has(flight.id)) {
                const ac = this.getAircraftData(flight.type);
                const imgStyle = `display:block;${ac.needsInvert ? ' filter: invert(1);' : ''}`;
                const hitPad = 12;
                const wrapperW = ac.width + hitPad * 2;
                const wrapperH = ac.height + hitPad * 2;
                const isSelected = this.selectedFlightId === flight.id;
                const icon = L.divIcon({
                    className: 'plane-icon-wrapper',
                    html: `<div class="plane-hover-area${isSelected ? ' selected' : ''}" style="width:${wrapperW}px;height:${wrapperH}px;">
                            <div class="plane-label">${flight.id}</div>
                            <div class="plane-marker" style="transform:rotate(${bearing}deg);width:${ac.width}px;height:${ac.height}px;">
                              <img src="${ac.icon}" width="${ac.width}" height="${ac.height}" style="${imgStyle}" onerror="this.src='icons/default.svg'"/>
                            </div>
                           </div>`,
                    iconSize: [wrapperW, wrapperH],
                    iconAnchor: [Math.round(wrapperW / 2), Math.round(wrapperH / 2)]
                });
                const marker = L.marker([pos.lat, pos.lng], { icon }).addTo(this.map);
                marker.on('click', () => this.selectFlight(flight.id));
                this.markers.set(flight.id, marker);
            } else {
                const marker = this.markers.get(flight.id);
                marker.setLatLng([pos.lat, pos.lng]);
                const el = marker.getElement();
                if (el) {
                    const inner = el.querySelector('.plane-marker');
                    if (inner) inner.style.transform = `rotate(${bearing}deg)`;
                    const hoverArea = el.querySelector('.plane-hover-area');
                    if (hoverArea) hoverArea.classList.toggle('selected', this.selectedFlightId === flight.id);
                }
            }
        }

        this._updateTrails(visibleFlights);
    }

    getPlanePoseAtProgress(waypoints, progress) {
        if (waypoints.length < 2) {
            return {
                position: waypoints[0],
                bearing: 0
            };
        }

        const normalized = this.normalizePath(waypoints);
        const segmentCount = normalized.length - 1;
        const scaledProgress = Math.min(Math.max(progress, 0), 1) * segmentCount;
        const segmentIndex = Math.min(Math.floor(scaledProgress), segmentCount - 1);
        const segmentProgress = scaledProgress - segmentIndex;
        const p1 = normalized[segmentIndex];
        const p2 = normalized[segmentIndex + 1];

        if (!this.map) {
            return {
                position: {
                    lat: p1.lat + (p2.lat - p1.lat) * segmentProgress,
                    lng: p1.lng + (p2.lng - p1.lng) * segmentProgress
                },
                bearing: this.calculateBearing(p1, p2)
            };
        }

        const zoom = this.map.getZoom();
        const point1 = this.map.project(L.latLng(p1.lat, p1.lng), zoom);
        const point2 = this.map.project(L.latLng(p2.lat, p2.lng), zoom);
        const interpolated = L.point(
            point1.x + (point2.x - point1.x) * segmentProgress,
            point1.y + (point2.y - point1.y) * segmentProgress
        );
        const position = this.map.unproject(interpolated, zoom);
        const dx = point2.x - point1.x;
        const dy = point2.y - point1.y;
        const bearing = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;

        return {
            position: {
                lat: position.lat,
                lng: position.lng
            },
            bearing
        };
    }

    calculateBearing(from, to) {
        const toRad = deg => deg * Math.PI / 180;
        const toDeg = rad => rad * 180 / Math.PI;

        // Handle date line crossing - use shortest path
        let dLng = to.lng - from.lng;
        if (dLng > 180) dLng -= 360;
        else if (dLng < -180) dLng += 360;

        dLng = toRad(dLng);
        const lat1 = toRad(from.lat);
        const lat2 = toRad(to.lat);
        const y = Math.sin(dLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
        return (toDeg(Math.atan2(y, x)) + 360) % 360;
    }

    getBearingAtProgress(waypoints, progress) {
        return this.getPlanePoseAtProgress(waypoints, progress).bearing;
    }

    interpolatePath(waypoints, progress) {
        return this.getPlanePoseAtProgress(waypoints, progress).position;
    }

    getAircraftData(type) {
        // Build a lookup index from window.AIRCRAFT_DATA on first call
        if (!this._aircraftIndex) {
            this._aircraftIndex = {};
            (window.AIRCRAFT_DATA || []).forEach(d => {
                this._aircraftIndex[d.type.toLowerCase()] = d;
            });
        }
        const t = type.toLowerCase();
        // Exact match first
        if (this._aircraftIndex[t]) return this._aircraftIndex[t];
        // Partial match
        for (const [key, data] of Object.entries(this._aircraftIndex)) {
            if (t.includes(key) || key.includes(t)) return data;
        }
        // Fallback: try common keywords
        if (t.includes('b-29') || t.includes('superfortress')) return this._aircraftIndex['b-29 superfortress'];
        if (t.includes('b-24') || t.includes('liberator'))     return this._aircraftIndex['b-24 liberator'];
        if (t.includes('b-25') || t.includes('mitchell'))      return this._aircraftIndex['b-25 mitchell'];
        if (t.includes('b-17') || t.includes('fortress'))      return this._aircraftIndex['b-17 flying fortress'];
        if (t.includes('b-26') || t.includes('marauder'))      return this._aircraftIndex['b-26 marauder'];
        if (t.includes('p-38') || t.includes('lightning'))     return this._aircraftIndex['p-38 lightning'];
        if (t.includes('p-51') || t.includes('mustang'))       return this._aircraftIndex['p-51 mustang'];
        if (t.includes('p-40') || t.includes('warhawk'))       return this._aircraftIndex['p-40 warhawk'];
        if (t.includes('p-47') || t.includes('thunderbolt'))   return this._aircraftIndex['p-47 thunderbolt'];
        if (t.includes('p-39') || t.includes('airacobra'))     return this._aircraftIndex['p-39 airacobra'];
        if (t.includes('a-20') || t.includes('havoc'))         return this._aircraftIndex['a-20 havoc'];
        if (t.includes('a-26') || t.includes('invader'))       return this._aircraftIndex['a-26 invader'];
        if (t.includes('a-36') || t.includes('apache'))        return this._aircraftIndex['a-36 apache'];
        if (t.includes('f4u') || t.includes('corsair'))        return this._aircraftIndex['f4u corsair'];
        if (t.includes('f6f') || t.includes('hellcat'))        return this._aircraftIndex['f6f hellcat'];
        if (t.includes('zero') || t.includes('a6m'))           return this._aircraftIndex['a6m zero'];
        if (t.includes('heavy bomber'))                         return this._aircraftIndex['heavy bomber'];
        if (t.includes('medium bomber'))                        return this._aircraftIndex['medium bomber'];
        if (t.includes('light bomber'))                         return this._aircraftIndex['light bomber'];
        if (t.includes('fighter'))                              return this._aircraftIndex['fighter'];
        // Ultimate fallback
        return { icon: 'icons/default.svg', width: 24, height: 24, needsInvert: false };
    }

    getIconFilename(type) {
        return this.getAircraftData(type).icon;
    }

    getMarkerColor(type) {
        if (type.includes('B-29')) return '#ef4444';
        if (type.includes('F6F') || type.includes('P-51') || type.includes('P-38') || type.includes('Lightning')) return '#60a5fa';
        if (type.includes('Zero') || type.includes('A6M5') || type.includes('Oscar') || type.includes('Ki-43')) return '#f97316';
        return '#10b981'; // Recon / default
    }

    updateTimelineUI() {
        const date = new Date(this.currentTime);
        document.getElementById('current-date').textContent = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        document.getElementById('current-time').textContent = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

        const slider = document.getElementById('timeline-slider');
        const ratio = (this.currentTime - this.startTime) / (this.endTime - this.startTime);
        slider.value = ratio * 100000;
    }

    updateStats() {
        const activeFlights = this.getActiveFlights();
        const visibleFlights = activeFlights.filter(f => this._isSquadronVisible(f.squadron));
        const countEl = document.getElementById('active-count');
        if (countEl) countEl.textContent = visibleFlights.length.toLocaleString();
        this.updateActiveMissionsPanel(visibleFlights);
    }

    updateActiveMissionsPanel(activeFlights) {
        const listEl = document.getElementById('active-missions-list');
        if (!listEl) return;

        const now = Date.now();
        if (this._lastActivePanelRender && now - this._lastActivePanelRender < 500) return;
        this._lastActivePanelRender = now;

        listEl.innerHTML = '';
        const top = activeFlights.slice(0, 6);
        top.forEach(flight => {
            const item = document.createElement('div');
            item.className = 'sw-flight-item';
            const cat = flight.missionCategory || '';
            item.innerHTML = `
                <div class="sw-fi-info">
                    <span class="sw-fi-type">${flight.type}</span>
                    <span class="sw-fi-sq">${flight.squadron}</span>
                </div>
                ${cat ? `<span class="sw-fi-cat">${cat.toUpperCase()}</span>` : ''}
            `;
            item.addEventListener('click', () => this.selectFlight(flight.id));
            listEl.appendChild(item);
        });
        if (activeFlights.length > 6) {
            const more = document.createElement('div');
            more.className = 'sw-more-label';
            more.textContent = `+${activeFlights.length - 6} more missions`;
            listEl.appendChild(more);
        }
    }

    renderFlightList(filter = '') {
        const listContainer = document.getElementById('flight-list');
        if (!listContainer) return;

        // Throttle list rebuilds to every 500ms unless a search filter is active
        const now = Date.now();
        const hasSquadronFilter = this.selectedSquadrons !== null && this.selectedSquadrons.size !== this.flights.length;
        if (!filter && !hasSquadronFilter && this._lastListRender && now - this._lastListRender < 500) return;
        this._lastListRender = now;
        const lowerFilter = filter.toLowerCase();

        // Get flights to search: all or active based on toggle
        let flightsToSearch = this.searchAllMissions ? this.flights : this.getActiveFlights();

        // Filter flights based on search term and squadron filter
        const displayFlights = flightsToSearch.filter(f => {
            // Check squadron filter first
            if (!this._isSquadronVisible(f.squadron)) {
                return false;
            }

            // Then check search term
            if (!lowerFilter) return true;
            return f.id.toLowerCase().includes(lowerFilter) ||
                   f.type.toLowerCase().includes(lowerFilter) ||
                   f.squadron.toLowerCase().includes(lowerFilter) ||
                   (f.description && f.description.toLowerCase().includes(lowerFilter));
        });

        // Simple update logic: clear and rebuild (for larger sets use virtual scrolling)
        listContainer.innerHTML = '';
        displayFlights.slice(0, 100).forEach(flight => {  // Limit to 100 results
            const li = document.createElement('li');
            li.className = `flight-item ${this.selectedFlightId === flight.id ? 'selected' : ''}`;
            const isActive = this.currentTime >= flight.startMs && this.currentTime <= flight.endMs;
            const activeIndicator = isActive ? '●' : '○';
            li.innerHTML = `
                <div class="flight-item-info">
                    <span class="flight-callsign">${activeIndicator} ${flight.id}</span>
                    <span class="flight-type">${flight.type}</span>
                </div>
                <div class="flight-alt">${flight.altitude.toLocaleString()}'</div>
            `;
            li.addEventListener('click', () => this.selectFlight(flight.id));
            listContainer.appendChild(li);
        });

        // Show result count if searching all and filter is active
        if (this.searchAllMissions && lowerFilter && displayFlights.length > 100) {
            const moreLi = document.createElement('li');
            moreLi.style.padding = '12px';
            moreLi.style.fontSize = '0.85rem';
            moreLi.style.color = 'var(--text-secondary)';
            moreLi.textContent = `... and ${displayFlights.length - 100} more results`;
            listContainer.appendChild(moreLi);
        }
    }

    _openDetailView() {
        document.getElementById('sidebar-views').classList.add('detail-open');
        // Reset detail page scroll to top
        document.getElementById('sidebar-detail').scrollTop = 0;
    }

    _closeDetailView() {
        // Deselect flight marker
        if (this.selectedFlightId) {
            const m = this.markers.get(this.selectedFlightId);
            if (m) {
                const el = m.getElement();
                if (el) {
                    const area = el.querySelector('.plane-hover-area');
                    if (area) area.classList.remove('selected');
                }
            }
        }
        document.getElementById('sidebar-views').classList.remove('detail-open');
        this.selectedFlightId = null;
        this.selectedBaseKey = null;
        this.renderFlightList();
    }

    selectFlight(id) {
        // Clear previous selection visual
        if (this.selectedFlightId) {
            const prev = this.markers.get(this.selectedFlightId);
            if (prev) {
                const prevEl = prev.getElement();
                if (prevEl) {
                    const area = prevEl.querySelector('.plane-hover-area');
                    if (area) area.classList.remove('selected');
                }
            }
        }

        this.selectedFlightId = id;
        const flight = this.flights.find(f => f.id === id);
        if (!flight) return;

        // Apply selected visual to new marker
        const selMarker = this.markers.get(id);
        if (selMarker) {
            const selEl = selMarker.getElement();
            if (selEl) {
                const area = selEl.querySelector('.plane-hover-area');
                if (area) area.classList.add('selected');
            }
        }

        // Show flight detail, hide base/target detail, slide to detail page
        document.getElementById('selected-base-details').classList.add('hidden');
        document.getElementById('selected-target-details').classList.add('hidden');
        this.selectedBaseKey = null;
        const panel = document.getElementById('selected-flight-details');
        panel.classList.remove('hidden');
        this._openDetailView();

        document.getElementById('plane-type').textContent = flight.type;
        document.getElementById('plane-id').textContent = flight.id;
        document.getElementById('plane-squadron').textContent = flight.squadron;

        // Display origin location with coordinates as secondary text
        const originEl = document.getElementById('plane-origin');
        originEl.innerHTML = '';
        const originName = flight.originBaseName || 'Unknown';
        const originLat = flight.originLatLng?.lat || 0;
        const originLng = flight.originLatLng?.lng || 0;
        const originCoords = originLat && originLng ? `${originLat.toFixed(2)}°, ${originLng.toFixed(2)}°` : 'Unknown';
        originEl.innerHTML = `<strong>${originName}</strong><br><span style="font-size:0.85em;opacity:0.7;">${originCoords}</span>`;

        // Display destination location with coordinates as secondary text
        const destEl = document.getElementById('plane-dest');
        destEl.innerHTML = '';
        const destName = flight.targetName || 'Unknown';
        const destLat = flight.destLatLng?.lat || 0;
        const destLng = flight.destLatLng?.lng || 0;
        const destCoords = destLat && destLng ? `${destLat.toFixed(2)}°, ${destLng.toFixed(2)}°` : 'Unknown';
        destEl.innerHTML = `<strong>${destName}</strong><br><span style="font-size:0.85em;opacity:0.7;">${destCoords}</span>`;

        document.getElementById('plane-alt').textContent = `${flight.altitude.toLocaleString()} ft`;
        document.getElementById('plane-speed').textContent = `${flight.speed} mph`;
        document.getElementById('plane-quantity').textContent = flight.numAircraft > 1 ? flight.numAircraft : 'N/A';
        document.getElementById('plane-category').textContent = flight.missionCategory || 'Unknown';
        document.getElementById('plane-description').textContent = flight.description || '';

        // Focus map
        const marker = this.markers.get(id);
        if (marker) {
            this.map.panTo(marker.getLatLng());
        }

        this.updateSelectedPath(flight);
        this.renderFlightList(document.getElementById('flight-search').value);
    }

    selectBase(key) {
        const base = this.bases.find(b => b.key === key);
        if (!base) return;

        this.selectedBaseKey = key;

        // Show base detail, hide flight/target detail, slide to detail page
        document.getElementById('selected-flight-details').classList.add('hidden');
        document.getElementById('selected-target-details').classList.add('hidden');
        this.selectedFlightId = null;

        const fmt = dateStr => {
            const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00Z');
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        };

        document.getElementById('base-name').textContent = base.name;
        document.getElementById('base-af').textContent = base.af;
        document.getElementById('base-active').textContent = `${fmt(base.start)} – ${fmt(base.end)}`;
        document.getElementById('base-location').textContent =
            `${base.lat.toFixed(2)}° N, ${base.lng.toFixed(2)}° E`;
        document.getElementById('base-notes').textContent = base.notes || '';

        document.getElementById('selected-base-details').classList.remove('hidden');
        this._openDetailView();
    }

    selectTarget(canonicalName) {
        const targetData = this._targetsIndex && this._targetsIndex[canonicalName.toLowerCase()];
        if (!targetData) return;

        // Hide other detail panels
        document.getElementById('selected-flight-details').classList.add('hidden');
        document.getElementById('selected-base-details').classList.add('hidden');
        this.selectedFlightId = null;
        this.selectedBaseKey = null;

        document.getElementById('target-name').textContent = targetData.name;
        document.getElementById('target-type').textContent = targetData.type || 'Target';
        document.getElementById('target-country').textContent = targetData.country || '-';
        document.getElementById('target-location').textContent =
            `${targetData.lat.toFixed(2)}° N, ${targetData.lng.toFixed(2)}° E`;

        // List missions that targeted this location
        const list = document.getElementById('target-missions-list');
        list.innerHTML = '';
        const missions = this.flights.filter(f =>
            f.targetName && f.targetName.toLowerCase() === canonicalName.toLowerCase()
        );
        if (missions.length === 0) {
            list.innerHTML = '<div style="opacity:0.5;font-size:0.85em;">No missions in current data.</div>';
        } else {
            for (const m of missions) {
                const item = document.createElement('div');
                item.className = 'sw-flight-item';
                const cat = m.missionCategory || '';
                item.innerHTML = `
                    <div class="sw-fi-info">
                        <span class="sw-fi-type">${m.type}</span>
                        <span class="sw-fi-sq">${m.squadron}</span>
                    </div>
                    ${cat ? `<span class="sw-fi-cat">${cat.toUpperCase()}</span>` : ''}
                `;
                item.addEventListener('click', () => this.selectFlight(m.id));
                list.appendChild(item);
            }
        }

        document.getElementById('selected-target-details').classList.remove('hidden');
        this._openDetailView();
    }

    jumpToMissionId(missionId) {
        const flight = this.flights.find(f => f.id === missionId);
        if (!flight) {
            return false; // Mission not found
        }

        // Stop playback
        this.isPlaying = false;
        document.getElementById('play-pause').textContent = '▶';

        // Jump to mission start time
        this.currentTime = flight.startMs;

        // Select the flight (shows details panel and updates map)
        this.selectFlight(missionId);

        // Zoom to mission origin
        const lat = flight.originLatLng?.lat || flight.waypoints[0]?.lat;
        const lng = flight.originLatLng?.lng || flight.waypoints[0]?.lng;
        if (lat && lng) {
            this.map.setView([lat, lng], 7, { animate: true });
        }

        // Update timeline and map
        this.updateTick();

        // Clear error message
        const errorDiv = document.getElementById('mission-id-error');
        if (errorDiv) {
            errorDiv.style.display = 'none';
            errorDiv.textContent = '';
        }

        return true;
    }

    updateSelectedDetails() {
        if (!this.selectedFlightId) return;
        const flight = this.flights.find(f => f.id === this.selectedFlightId);
        const isActive = this.currentTime >= flight.startMs && this.currentTime <= flight.endMs;

        if (!isActive) {
            // Flight finished or hasn't started
            // In a real app we might show "Landed" or "Scheduled"
        }
    }

    updateUI() {
        // Initial UI state
        this.updateTimelineUI();
    }

    parseCSV(data) {
        if (!data || !data.trim()) {
            this.showNotification('Please paste CSV data first', 'error');
            return;
        }

        const firstLine = data.trimStart().split('\n')[0].toLowerCase();
        const prevCount = this.flights.length;
        let loadedCount = 0;

        try {
            // Route to the richer parser if this looks like missions_chronology.csv
            if (firstLine.startsWith('id,')) {
                this.parseMissionsCSV(data);
            } else {
                // Legacy format: squadron, type, description, start_lat, start_lng,
                //                end_lat, end_lng, start_time, duration_hours
                const lines = data.split('\n');
                lines.forEach((line, index) => {
                    if (index === 0 && line.includes('squadron')) return;
                    if (!line.trim()) return;

                    const parts = this.splitCSVLine(line);
                    if (parts.length < 8) return;

                    const [squadron, type, desc, sLat, sLng, eLat, eLng, sTime, durationHours] = parts;
                    const startMs = new Date(sTime).getTime();
                    if (isNaN(startMs)) return;

                    const duration = parseFloat(durationHours) * 3600 * 1000;
                    const sLatNum = parseFloat(sLat);
                    const sLngNum = parseFloat(sLng);
                    const eLatNum = parseFloat(eLat);
                    const eLngNum = parseFloat(eLng);
                    this.flights.push({
                        id: `IMPORTED-${index}-${Date.now()}`,
                        type: type || 'Unknown Aircraft',
                        squadron: squadron || 'Unknown Squadron',
                        origin: `${sLat}, ${sLng}`,
                        originLatLng: { lat: sLatNum, lng: sLngNum },
                        originBaseName: '',
                        destination: `${eLat}, ${eLng}`,
                        destLatLng: { lat: eLatNum, lng: eLngNum },
                        startTime: sTime,
                        startMs,
                        duration,
                        endMs: startMs + duration,
                        waypoints: [
                            { lat: sLatNum, lng: sLngNum },
                            { lat: eLatNum, lng: eLngNum }
                        ],
                        altitude: 20000,
                        speed: 300,
                        description: desc,
                        targetName: ''
                    });
                    loadedCount++;
                });
            }

            this.selectedSquadrons = null;
            this.buildTimeIndex();
            this.renderSquadronTags();
            this.renderSquadronFilterPanel();
            this.updateTick();
            this.renderDynamicJumpPoints();

            // Close modal
            const modal = document.getElementById('import-modal');
            if (modal) {
                modal.classList.add('hidden');
            }

            const newCount = this.flights.length - prevCount;
            if (newCount > 0) {
                this.showNotification(`✓ Loaded ${newCount} mission${newCount !== 1 ? 's' : ''}`, 'success');
            } else {
                this.showNotification('No valid missions found in CSV data', 'warning');
            }
        } catch (err) {
            console.error('CSV parsing error:', err);
            this.showNotification(`Error loading CSV: ${err.message}`, 'error');
        }
    }

    showNotification(message, type = 'info') {
        // Remove old notification if exists
        const oldNotif = document.getElementById('load-notification');
        if (oldNotif) {
            clearTimeout(oldNotif._timeout);
            oldNotif.remove();
        }

        // Create notification element
        const notif = document.createElement('div');
        notif.id = 'load-notification';

        // Set color based on type
        const colors = {
            success: '#10b981',
            error: '#ef4444',
            warning: '#f59e0b',
            info: '#3b82f6'
        };
        const bgColor = colors[type] || colors.info;

        notif.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 16px 24px;
            border-radius: 8px;
            font-size: 0.9rem;
            font-weight: 500;
            color: white;
            background-color: ${bgColor};
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;
        notif.textContent = message;
        document.body.appendChild(notif);

        // Auto-dismiss after 3 seconds
        notif._timeout = setTimeout(() => {
            notif.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notif.remove(), 300);
        }, 3000);
    }

    renderDynamicJumpPoints() {
        const container = document.getElementById('custom-jumps');
        const section = document.getElementById('custom-jumps-section');

        // Skip if elements don't exist
        if (!container || !section) return;

        const importedFlights = this.flights.filter(f => f.id.startsWith('IMPORTED'));

        container.innerHTML = '';

        if (importedFlights.length > 0) {
            section.classList.remove('hidden');
            importedFlights.forEach(flight => {
                const btn = document.createElement('button');
                btn.className = 'jump-btn';
                btn.dataset.time = flight.startTime;

                // Format the label neatly
                const date = new Date(flight.startTime);
                const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                btn.textContent = `${flight.squadron} (${dateStr})`;

                container.appendChild(btn);
            });
            this.addJumpPointListeners();
        } else {
            section.classList.add('hidden');
        }
    }
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new PacificWingsApp();
});
