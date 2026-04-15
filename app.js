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
        this.selectedFlightPath = null; // Polyline for selected flight
        this.currentTime = new Date('1941-12-07T06:00:00Z').getTime();
        this.isPlaying = false;
        this.playbackSpeed = 1440; // 1 day per minute
        this.startTime = new Date('1941-12-07T00:00:00Z').getTime();
        this.endTime = new Date('1945-09-06T12:00:00Z').getTime();
        this.selectedFlightId = null;

        this.init();
    }

    async init() {
        this.initMap();
        this.initEventListeners();
        this.loadEmbeddedData();
        this.buildTimeIndex();
        this.startTick();
        this.updateUI();
    }

    loadEmbeddedData() {
        // Load bases from window.BASES_DATA (bases_data.js)
        if (window.BASES_DATA) {
            this.bases = window.BASES_DATA.map(b => ({
                ...b,
                startMs: new Date(b.start).getTime(),
                endMs: new Date(b.end).getTime(),
                key: `${b.af}-${b.name}`,
            }));
        }

        // Load missions from window.MISSIONS_CSV (missions_data.js)
        if (window.MISSIONS_CSV) {
            this.parseMissionsCSV(window.MISSIONS_CSV);
        }
    }

    loadMissionsFromFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            this.flights = [];
            this.markers.forEach(m => this.map.removeLayer(m));
            this.markers.clear();
            this.parseMissionsCSV(e.target.result);
            this.buildTimeIndex();
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

            this.flights.push({
                id: id.trim(),
                squadron: squadron.trim(),
                type: type.trim(),
                description: description.trim(),
                origin: `${sLat.trim()}, ${sLng.trim()}`,
                destination: `${eLat.trim()}, ${eLng.trim()}`,
                startTime,
                startMs,
                duration,
                endMs: startMs + duration,
                waypoints,
                altitude: parseFloat(altitude) || 20000,
                speed: parseFloat(speed) || 300,
                numAircraft
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
            attributionControl: false
        }).setView([32.0, 130.0], 4); // Focused on Japan/China/Korea

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(this.map);

        // Move zoom control to top-right
        L.control.zoom({ position: 'topright' }).addTo(this.map);
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

        document.getElementById('close-details').addEventListener('click', () => {
            document.getElementById('selected-flight-details').classList.add('hidden');
            this.selectedFlightId = null;
            this.renderFlightList();
        });

        document.getElementById('flight-search').addEventListener('input', (e) => {
            this.renderFlightList(e.target.value);
        });

        // Jump Point Listeners
        this.addJumpPointListeners();

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
        if (this.selectedFlightPath) {
            this.map.removeLayer(this.selectedFlightPath);
            this.selectedFlightPath = null;
        }

        this.flights = [];
        this.flightsByStart = [];
        this.maxDuration = 0;
        this.selectedFlightId = null;
        document.getElementById('selected-flight-details').classList.add('hidden');
        this.renderDynamicJumpPoints();
        this.updateTick();
    }

    // ------------------------------------------------------------------
    // Time index — built once after all flights are loaded.
    // Allows O(log n + k) active-flight lookup instead of O(n) per tick.
    // ------------------------------------------------------------------
    buildTimeIndex() {
        this.flightsByStart = [...this.flights].sort((a, b) => a.startMs - b.startMs);
        this.maxDuration = this.flights.reduce((m, f) => Math.max(m, f.duration), 0);
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
        return candidates.filter(f => f.endMs >= this.currentTime);
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

    updateSelectedPath(flight) {
        if (this.selectedFlightPath) {
            this.map.removeLayer(this.selectedFlightPath);
        }

        if (flight) {
            this.selectedFlightPath = L.polyline(flight.waypoints, {
                color: '#3b82f6',
                weight: 2,
                opacity: 0.6,
                dashArray: '5, 10'
            }).addTo(this.map);
        }
    }

    updateTick() {
        this.updateBasesOnMap();
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
                    const marker = L.circleMarker([base.lat, base.lng], {
                        radius: 7,
                        fillColor: color,
                        color: '#fff',
                        weight: 1.5,
                        opacity: 0.9,
                        fillOpacity: 0.8,
                    }).addTo(this.map);
                    marker.bindTooltip(
                        `<strong>${base.name}</strong><br>${base.af}<br><em>${base.notes}</em>`,
                        { direction: 'top', offset: [0, -8] }
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
            const pos = this.interpolatePath(flight.waypoints, progress);
            const bearing = this.getBearingAtProgress(flight.waypoints, progress);

            if (!this.markers.has(flight.id)) {
                const iconFile = this.getIconFilename(flight.type);
                const needsInvert = iconFile.includes('p40_edited') || iconFile.includes('b24') || iconFile.includes('b25');
                const imgStyle = `display:block;${needsInvert ? ' filter: invert(1);' : ''}`;
                const icon = L.divIcon({
                    className: 'plane-icon-wrapper',
                    html: `<div class="plane-marker" style="transform: rotate(${bearing}deg); transition: transform 0.3s ease; width: 32px; height: 32px;">
                            <img src="${iconFile}" width="32" height="32" style="${imgStyle}" onerror="this.src='icons/default.svg'"/>
                           </div>`,
                    iconSize: [32, 32],
                    iconAnchor: [16, 16]
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
        const segmentCount = waypoints.length - 1;
        const segmentIndex = Math.min(Math.floor(progress * segmentCount), segmentCount - 1);
        return this.calculateBearing(waypoints[segmentIndex], waypoints[segmentIndex + 1]);
    }

    interpolatePath(waypoints, progress) {
        if (waypoints.length < 2) return waypoints[0];

        const segmentCount = waypoints.length - 1;
        const segmentIndex = Math.floor(progress * segmentCount);
        const segmentProgress = (progress * segmentCount) % 1;

        if (segmentIndex >= segmentCount) return waypoints[waypoints.length - 1];

        const p1 = waypoints[segmentIndex];
        const p2 = waypoints[segmentIndex + 1];

        // Handle date line crossing - interpolate via shortest path
        let lngDiff = p2.lng - p1.lng;
        if (lngDiff > 180) lngDiff -= 360;
        else if (lngDiff < -180) lngDiff += 360;

        return {
            lat: p1.lat + (p2.lat - p1.lat) * segmentProgress,
            lng: p1.lng + lngDiff * segmentProgress
        };
    }

    getIconFilename(type) {
        if (type.includes('B-29'))                              return 'icons/b29.svg';
        if (type.includes('B-24') || type.includes('Liberator')) return 'icons/b24.png';
        if (type.includes('B-25') || type.includes('Mitchell')) return 'icons/b25.png';
        if (type.includes('A6M5') || type.includes('Zero'))     return 'icons/a6m5.svg';
        if (type.includes('F6F'))                               return 'icons/f6f.svg';
        if (type.includes('P-51'))                              return 'icons/p51.svg';
        if (type.includes('Ki-43') || type.includes('Oscar'))   return 'icons/ki43.svg';
        if (type.includes('Ki-46') || type.includes('Dinah'))   return 'icons/ki46.svg';
        if (type.includes('P-38') || type.includes('Lightning')) return 'icons/p38.svg';
        if (type.includes('P-40') || type.includes('Warhawk')) return 'icons/p40_edited.png';
        return 'icons/default.svg';
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
        document.getElementById('total-count').textContent = this.getActiveFlights().length;
    }

    renderFlightList(filter = '') {
        // Throttle list rebuilds to every 500ms unless a search filter is active
        const now = Date.now();
        if (!filter && this._lastListRender && now - this._lastListRender < 500) return;
        this._lastListRender = now;

        const listContainer = document.getElementById('flight-list');
        const lowerFilter = filter.toLowerCase();
        const activeFlights = this.getActiveFlights()
            .filter(f => !lowerFilter ||
                f.id.toLowerCase().includes(lowerFilter) ||
                f.type.toLowerCase().includes(lowerFilter));

        // Simple update logic: clear and rebuild (for larger sets use virtual scrolling)
        listContainer.innerHTML = '';
        activeFlights.forEach(flight => {
            const li = document.createElement('li');
            li.className = `flight-item ${this.selectedFlightId === flight.id ? 'selected' : ''}`;
            li.innerHTML = `
                <div class="flight-item-info">
                    <span class="flight-callsign">${flight.id}</span>
                    <span class="flight-type">${flight.type}</span>
                </div>
                <div class="flight-alt">${flight.altitude.toLocaleString()}'</div>
            `;
            li.addEventListener('click', () => this.selectFlight(flight.id));
            listContainer.appendChild(li);
        });
    }

    selectFlight(id) {
        this.selectedFlightId = id;
        const flight = this.flights.find(f => f.id === id);
        if (!flight) return;

        // Show details panel
        const panel = document.getElementById('selected-flight-details');
        panel.classList.remove('hidden');

        document.getElementById('plane-type').textContent = flight.type;
        document.getElementById('plane-id').textContent = `Callsign: ${flight.id}`;
        document.getElementById('plane-squadron').textContent = flight.squadron;
        document.getElementById('plane-origin').textContent = flight.origin;
        document.getElementById('plane-dest').textContent = flight.destination;
        document.getElementById('plane-alt').textContent = `${flight.altitude.toLocaleString()} ft`;
        document.getElementById('plane-speed').textContent = `${flight.speed} mph`;
        document.getElementById('plane-description').textContent = flight.description || '';

        // Focus map
        const marker = this.markers.get(id);
        if (marker) {
            this.map.panTo(marker.getLatLng());
        }

        this.updateSelectedPath(flight);
        this.renderFlightList(document.getElementById('flight-search').value);
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
                this.flights.push({
                    id: `IMPORTED-${index}-${Date.now()}`,
                    type: type || 'Unknown Aircraft',
                    squadron: squadron || 'Unknown Squadron',
                    origin: `${sLat}, ${sLng}`,
                    destination: `${eLat}, ${eLng}`,
                    startTime: sTime,
                    startMs,
                    duration,
                    endMs: startMs + duration,
                    waypoints: [
                        { lat: parseFloat(sLat), lng: parseFloat(sLng) },
                        { lat: parseFloat(eLat), lng: parseFloat(eLng) }
                    ],
                    altitude: 20000,
                    speed: 300,
                    description: desc
                });
            });
        }

        this.buildTimeIndex();
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