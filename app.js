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
        this.selectedFlightPath = null; // Polyline for selected flight
        this.currentTime = new Date('1941-12-07T06:00:00Z').getTime();
        this.isPlaying = false;
        this.playbackSpeed = 1440; // 1 day per minute
        this.startTime = new Date('1941-12-07T00:00:00Z').getTime();
        this.endTime = new Date('1945-09-06T12:00:00Z').getTime();
        this.selectedFlightId = null;
        this.selectedBaseKey = null;
        this.searchAllMissions = false; // Toggle for searching all vs active missions
        this.squadronFilter = null; // Current squadron filter (null = no filter)

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
        }
    }

    renderSquadronTags() {
        // Get unique squadrons, sorted alphabetically
        const squadrons = [...new Set(this.flights.map(f => f.squadron))].sort();
        const container = document.getElementById('squadron-tags');
        container.innerHTML = '';

        squadrons.forEach(squadron => {
            const tag = document.createElement('button');
            tag.className = 'squadron-tag';
            tag.textContent = squadron;
            tag.style.cssText = `
                padding: 6px 12px;
                border-radius: 20px;
                border: 1px solid var(--panel-border);
                background: transparent;
                color: var(--text-primary);
                cursor: pointer;
                font-size: 0.8rem;
                transition: all 0.2s ease;
            `;

            // Highlight if this squadron is currently filtered
            if (this.squadronFilter === squadron) {
                tag.style.backgroundColor = 'var(--accent-color)';
                tag.style.borderColor = 'var(--accent-color)';
                tag.style.color = '#fff';
            }

            tag.addEventListener('mouseenter', () => {
                if (this.squadronFilter !== squadron) {
                    tag.style.backgroundColor = 'var(--panel-bg)';
                }
            });

            tag.addEventListener('mouseleave', () => {
                if (this.squadronFilter !== squadron) {
                    tag.style.backgroundColor = 'transparent';
                }
            });

            tag.addEventListener('click', () => {
                // Toggle squadron filter
                this.squadronFilter = this.squadronFilter === squadron ? null : squadron;
                this.renderSquadronTags(); // Re-render to update highlights
                this.renderFlightList(document.getElementById('flight-search').value);
            });

            container.appendChild(tag);
        });
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
            this.squadronFilter = null; // Reset squadron filter
            this.parseMissionsCSV(e.target.result);
            this.buildTimeIndex();
            this.renderSquadronTags();
            this.updateTick();
            this.renderDynamicJumpPoints();
            console.log(`Loaded ${this.flights.length} missions from ${file.name}`);
        };
        reader.readAsText(file);
    }

    parseMissionsCSV(text) {
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        // Skip header row
        for (let i = 1; i < lines.length; i++) {
            const cols = this.splitCSVLine(lines[i]);
            if (cols.length < 10) continue;
            const [id, squadron, type, description, sLat, sLng, eLat, eLng, startTime, durationHours, altitude, speed, waypointsRaw, ...rest] = cols;
            const startMs = new Date(startTime).getTime();
            if (isNaN(startMs)) continue;
            const duration = parseFloat(durationHours) * 3600 * 1000;

            let waypoints;
            if (waypointsRaw && waypointsRaw.trim()) {
                waypoints = waypointsRaw.trim().split(';').map(pair => {
                    const [lat, lng] = pair.split(':').map(Number);
                    return { lat, lng };
                });
            } else {
                waypoints = [
                    { lat: parseFloat(sLat), lng: parseFloat(sLng) },
                    { lat: parseFloat(eLat), lng: parseFloat(eLng) }
                ];
            }

            // Extract num_aircraft if present (may be in rest[2] for chronology format)
            let numAircraft = 1;
            if (rest.length > 2) {
                const numStr = rest[2].trim();
                const num = parseInt(numStr);
                if (!isNaN(num)) numAircraft = num;
            }

            // rest[0] = origin_base, rest[1] = target_name, rest[2] = num_aircraft, rest[3] = to_check, rest[4] = mission_category
            const originBaseName = (rest.length > 0 ? rest[0].trim() : '') || '';
            const targetName = (rest.length > 1 ? rest[1].trim() : '') || '';
            const missionCategory = (rest.length > 4 ? rest[4].trim() : '') || 'Other';
            const sLatNum = parseFloat(sLat.trim()) || 0;
            const sLngNum = parseFloat(sLng.trim()) || 0;
            const eLatNum = parseFloat(eLat.trim()) || 0;
            const eLngNum = parseFloat(eLng.trim()) || 0;

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

    initMap() {
        // Initialize Leaflet map
        this.map = L.map('map', {
            zoomControl: false,
            attributionControl: false,
            minZoom: 2,
            maxZoom: 20,
            worldCopyJump: true
        }).setView([20.0, 170.0], 3); // Pacific Theater (India/Philippines left, Hawaii center, US West Coast right)

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(this.map);

        // Move zoom control to top-right
        L.control.zoom({ position: 'topright' }).addTo(this.map);

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
        const showBtn = document.getElementById('show-import');
        const closeBtn = document.querySelector('.close-modal');
        const processBtn = document.getElementById('process-csv');
        const clearBtn = document.getElementById('clear-all');
        const fileInput = document.getElementById('csv-file-input');

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.loadMissionsFromFile(file);
            fileInput.value = ''; // reset so same file can be reloaded
        });

        showBtn.onclick = () => {
            this.prefillCSVInput();
            modal.classList.remove('hidden');
        };
        closeBtn.onclick = () => modal.classList.add('hidden');
        window.onclick = (e) => { if (e.target == modal) modal.classList.add('hidden'); };

        processBtn.onclick = () => {
            const data = document.getElementById('csv-input').value;
            this.parseCSV(data);
            modal.classList.add('hidden');
        };

        clearBtn.onclick = () => {
            if (confirm('Clear all missions?')) {
                this.clearAllMissions();
            }
        };
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
        if (this.selectedFlightPath) {
            this.map.removeLayer(this.selectedFlightPath);
            this.selectedFlightPath = null;
        }

        this.flights = [];
        this.flightsByStart = [];
        this.maxDuration = 0;
        this.selectedFlightId = null;
        this.selectedBaseKey = null;
        this.squadronFilter = null;
        document.getElementById('sidebar-views').classList.remove('detail-open');
        this.renderSquadronTags();
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
        const activeIds = new Set(activeFlights.map(f => f.id));

        // Remove markers for flights that are no longer active
        this.markers.forEach((marker, id) => {
            if (!activeIds.has(id)) {
                this.map.removeLayer(marker);
                this.markers.delete(id);
            }
        });

        // Update or create markers only for active flights
        for (const flight of activeFlights) {
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
                }
            }
        }
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
        const countEl = document.getElementById('active-count');
        if (countEl) countEl.textContent = activeFlights.length.toLocaleString();
        this.updateActiveMissionsPanel(activeFlights);
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
        if (!filter && !this.squadronFilter && this._lastListRender && now - this._lastListRender < 500) return;
        this._lastListRender = now;
        const lowerFilter = filter.toLowerCase();

        // Get flights to search: all or active based on toggle
        let flightsToSearch = this.searchAllMissions ? this.flights : this.getActiveFlights();

        // Filter flights based on search term and squadron filter
        const displayFlights = flightsToSearch.filter(f => {
            // Check squadron filter first
            if (this.squadronFilter && f.squadron !== this.squadronFilter) {
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

        // Show flight detail, hide base detail, slide to detail page
        document.getElementById('selected-base-details').classList.add('hidden');
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

        // Show base detail, hide flight detail, slide to detail page
        document.getElementById('selected-flight-details').classList.add('hidden');
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
        const firstLine = data.trimStart().split('\n')[0].toLowerCase();
        const prevCount = this.flights.length;

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
            });
        }

        this.squadronFilter = null;
        this.buildTimeIndex();
        this.renderSquadronTags();
        this.updateTick();
        this.renderDynamicJumpPoints();
        alert(`Successfully loaded ${this.flights.length - prevCount} missions.`);
    }

    renderDynamicJumpPoints() {
        const container = document.getElementById('custom-jumps');
        const section = document.getElementById('custom-jumps-section');
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
