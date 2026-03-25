/**
 * PACIFIC WINGS - WWII Flight Tracker Engine
 * 1944-1945 Pacific Theater (China, Japan, Korea)
 */

class PacificWingsApp {
    constructor() {
        this.map = null;
        this.flights = [];
        this.markers = new Map(); // PlaneID -> Marker
        this.selectedFlightPath = null; // Polyline for selected flight
        this.currentTime = new Date('1944-06-15T08:00:00Z').getTime(); // Starting with Operation Matterhorn
        this.isPlaying = false;
        this.playbackSpeed = 1; // Real-time multiplier
        this.startTime = new Date('1944-01-01T00:00:00Z').getTime();
        this.endTime = new Date('1945-09-02T12:00:00Z').getTime();
        this.selectedFlightId = null;

        this.init();
    }

    async init() {
        this.initMap();
        this.initEventListeners();
        this.generateHistoricalData();
        this.startTick();
        this.updateUI();
    }

    initMap() {
        // Initialize Leaflet map
        this.map = L.map('map', {
            zoomControl: false,
            attributionControl: false
        }).setView([32.0, 130.0], 5); // Focused on Japan/China/Korea

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
        this.selectedFlightId = null;
        document.getElementById('selected-flight-details').classList.add('hidden');
        this.renderDynamicJumpPoints();
        this.updateTick();
    }

    generateHistoricalData() {
        // Generating a set of representative historical 1944-1945 missions
        const missions = [
            {
                id: 'B29-MATTERHORN-01',
                type: 'B-29 Superfortress',
                squadron: '58th Bombardment Wing',
                origin: 'Xinjin, China',
                destination: 'Yawata, Japan',
                startTime: '1944-06-15T07:00:00Z',
                duration: 12 * 3600 * 1000,
                waypoints: [
                    { lat: 30.34, lng: 103.84 }, // Xinjin (Takeoff)
                    { lat: 29.56, lng: 106.59 }, // Chongqing
                    { lat: 31.23, lng: 121.47 }, // Shanghai (Pass-by)
                    { lat: 33.88, lng: 130.82 }, // Yawata (Target)
                    { lat: 32.75, lng: 129.87 }, // Return leg
                    { lat: 30.34, lng: 103.84 }  // Xinjin (Landing)
                ],
                altitude: 28000,
                speed: 350
            },
            {
                id: 'A6M5-INTERCEPT-01',
                type: 'A6M5 Zero',
                squadron: '302nd Naval Air Group',
                origin: 'Atsugi, Japan',
                destination: 'Tokyo Bay Intercept',
                startTime: '1944-06-15T11:00:00Z',
                duration: 2 * 3600 * 1000,
                waypoints: [
                    { lat: 35.45, lng: 139.45 }, // Atsugi
                    { lat: 35.68, lng: 139.76 }, // Tokyo Central
                    { lat: 35.20, lng: 139.65 }, // Yokosuka
                    { lat: 35.45, lng: 139.45 }  // Return
                ],
                altitude: 15000,
                speed: 330
            },
            {
                id: 'F6F-HELLCAT-TF38',
                type: 'F6F Hellcat',
                squadron: 'VF-15 (USS Essex)',
                origin: 'Task Force 38 (Philippine Sea)',
                destination: 'Okinawa Strikes',
                startTime: '1944-10-10T06:00:00Z',
                duration: 4 * 3600 * 1000,
                waypoints: [
                    { lat: 22.0, lng: 130.0 }, // TF 38 Location
                    { lat: 26.21, lng: 127.68 }, // Naha, Okinawa
                    { lat: 26.70, lng: 128.00 }, // Northern Okinawa
                    { lat: 22.0, lng: 130.0 }  // Back to Carrier
                ],
                altitude: 12000,
                speed: 380
            },
            {
                id: 'P51-ESCORT-01',
                type: 'P-51D Mustang',
                squadron: '15th Fighter Group',
                origin: 'Iwo Jima',
                destination: 'Tokyo Escort',
                startTime: '1945-04-07T08:00:00Z',
                duration: 7 * 3600 * 1000,
                waypoints: [
                    { lat: 24.78, lng: 141.32 }, // Iwo Jima
                    { lat: 30.0, lng: 140.0 },   // Midpoint
                    { lat: 35.68, lng: 139.76 }, // Tokyo
                    { lat: 34.0, lng: 139.0 },   // Return route
                    { lat: 24.78, lng: 141.32 }  // Home
                ],
                altitude: 25000,
                speed: 430
            },
            {
                id: 'B29-MARCH9-RAID',
                type: 'B-29 Superfortress',
                squadron: '314th Bombardment Wing',
                origin: 'Guam',
                destination: 'Tokyo (Operation Meetinghouse)',
                startTime: '1945-03-09T17:00:00Z',
                duration: 14 * 3600 * 1000,
                waypoints: [
                    { lat: 13.44, lng: 144.79 }, // Guam
                    { lat: 20.0, lng: 143.0 },
                    { lat: 35.68, lng: 139.76 }, // Tokyo
                    { lat: 30.0, lng: 145.0 },
                    { lat: 13.44, lng: 144.79 }
                ],
                altitude: 7000, // Low level raid
                speed: 300
            },
            {
                id: 'Ki43-BUSY-OSAKA',
                type: 'Ki-43 Oscar',
                squadron: '59th Sentai',
                origin: 'Itami Base',
                destination: 'Osaka Patrol',
                startTime: '1945-03-09T22:00:00Z',
                duration: 3 * 3600 * 1000,
                waypoints: [
                    { lat: 34.78, lng: 135.43 }, // Itami
                    { lat: 34.69, lng: 135.50 }, // Osaka
                    { lat: 34.33, lng: 135.30 }, // Kansai area
                    { lat: 34.78, lng: 135.43 }  // Base
                ],
                altitude: 18000,
                speed: 320
            },
            {
                id: 'B29-ENOLA-GAY',
                type: 'B-29 Superfortress',
                squadron: '509th Composite Group (Enola Gay)',
                origin: 'Tinian (North Field)',
                destination: 'Tinian (Round Trip)',
                startTime: '1945-08-05T16:45:00Z',
                duration: 12.5 * 3600 * 1000,
                waypoints: [
                    { lat: 15.07, lng: 145.63 }, // Tinian Takeoff
                    { lat: 24.78, lng: 141.32 }, // Iwo Jima Rendezvous
                    { lat: 34.3947, lng: 132.4547 }, // Hiroshima Hypocenter
                    { lat: 32.0, lng: 136.0 }, // Return
                    { lat: 15.07, lng: 145.63 }  // Tinian Landing
                ],
                altitude: 31060,
                speed: 330,
                description: "Primary target: Hiroshima. Visual release of 'Little Boy' at 08:15 local. Return flight across Iwo Jima."
            },
            {
                id: 'B29-BOCKSCAR',
                type: 'B-29 Superfortress',
                squadron: '509th Composite Group (Bockscar)',
                origin: 'Tinian (North Field)',
                destination: 'Okinawa / Tinian',
                startTime: '1945-08-08T17:47:00Z',
                duration: 13.5 * 3600 * 1000,
                waypoints: [
                    { lat: 15.07, lng: 145.63 }, // Tinian Takeoff
                    { lat: 30.28, lng: 130.65 }, // Yakushima Rendezvous
                    { lat: 33.88, lng: 130.88 }, // Kokura (Obscured)
                    { lat: 32.7737, lng: 129.8633 }, // Nagasaki Hypocenter
                    { lat: 26.35, lng: 127.76 }, // Okinawa Emergency Landing
                    { lat: 15.01, lng: 145.62 }  // Tinian Landing
                ],
                altitude: 30000,
                speed: 340,
                description: "Nagasaki strike after Kokura was obscured. Landed at Okinawa Kadena due to fuel shortage."
            }
        ];

        // Add some more random activity around Korea and Manchuria (China)
        for (let i = 0; i < 20; i++) {
            const date = new Date(1944, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28));
            missions.push({
                id: `RECON-${i}`,
                type: Math.random() > 0.5 ? 'Ki-46 Dinah' : 'P-38 Lightning',
                squadron: 'Special Recon Unit',
                origin: 'Seoul (Keijo)',
                destination: 'Mukden (Shenyang)',
                startTime: date.toISOString(),
                duration: 5 * 3600 * 1000,
                waypoints: [
                    { lat: 37.56, lng: 126.97 }, // Seoul
                    { lat: 38.99, lng: 125.75 }, // Pyongyang
                    { lat: 41.80, lng: 123.43 }, // Mukden (Shenyang)
                    { lat: 37.56, lng: 126.97 }
                ],
                altitude: 32000,
                speed: 380
            });
        }

        this.flights = missions.map(m => ({
            ...m,
            startMs: new Date(m.startTime).getTime(),
            endMs: new Date(m.startTime).getTime() + m.duration
        }));
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
        this.updatePlanesOnMap();
        this.updateTimelineUI();
        this.updateStats();
        this.renderFlightList(document.getElementById('flight-search').value);
        this.updateSelectedDetails();
    }

    updatePlanesOnMap() {
        this.flights.forEach(flight => {
            const isVisible = this.currentTime >= flight.startMs && this.currentTime <= flight.endMs;

            if (isVisible) {
                // Interpolate position
                const progress = (this.currentTime - flight.startMs) / flight.duration;
                const pos = this.interpolatePath(flight.waypoints, progress);

                if (!this.markers.has(flight.id)) {
                    // Create marker
                    const icon = L.divIcon({
                        className: 'plane-icon-wrapper',
                        html: `<div class="plane-marker ${flight.type.toLowerCase().includes('b-29') ? 'bomber' : 'fighter'}">
                                <svg viewBox="0 0 24 24" width="24" height="24" fill="${this.getMarkerColor(flight.type)}">
                                    <path d="M21,16L22,13V11L13,5V3H11V5L2,11V13L3,16H11V21H12V16H21Z" />
                                </svg>
                               </div>`,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    });
                    const marker = L.marker([pos.lat, pos.lng], { icon }).addTo(this.map);

                    marker.on('click', () => this.selectFlight(flight.id));
                    this.markers.set(flight.id, marker);
                } else {
                    const marker = this.markers.get(flight.id);
                    marker.setLatLng([pos.lat, pos.lng]);

                    // Rotate based on bearing (simplified)
                    // In a real app we'd calculate heading between waypoints
                }
            } else {
                // Remove marker if it exists
                if (this.markers.has(flight.id)) {
                    this.map.removeLayer(this.markers.get(flight.id));
                    this.markers.delete(flight.id);
                }
            }
        });
    }

    interpolatePath(waypoints, progress) {
        if (waypoints.length < 2) return waypoints[0];

        const segmentCount = waypoints.length - 1;
        const segmentIndex = Math.floor(progress * segmentCount);
        const segmentProgress = (progress * segmentCount) % 1;

        if (segmentIndex >= segmentCount) return waypoints[waypoints.length - 1];

        const p1 = waypoints[segmentIndex];
        const p2 = waypoints[segmentIndex + 1];

        return {
            lat: p1.lat + (p2.lat - p1.lat) * segmentProgress,
            lng: p1.lng + (p2.lng - p1.lng) * segmentProgress
        };
    }

    getMarkerColor(type) {
        if (type.includes('B-29')) return '#ef4444'; // Bomber (Red)
        if (type.includes('F6F') || type.includes('P-51') || type.includes('Zero') || type.includes('Oscar')) return '#60a5fa'; // Fighter (Blue)
        return '#10b981'; // Scout (Green)
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
        const activeCount = this.flights.filter(f => this.currentTime >= f.startMs && this.currentTime <= f.endMs).length;
        document.getElementById('total-count').textContent = activeCount;
    }

    renderFlightList(filter = '') {
        const listContainer = document.getElementById('flight-list');
        const activeFlights = this.flights
            .filter(f => this.currentTime >= f.startMs && this.currentTime <= f.endMs)
            .filter(f => f.id.toLowerCase().includes(filter.toLowerCase()) || f.type.toLowerCase().includes(filter.toLowerCase()));

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
        const lines = data.split('\n');
        lines.forEach((line, index) => {
            if (index === 0 && line.includes('squadron')) return; // Skip header
            if (!line.trim()) return;

            const parts = line.split(',').map(p => p.trim());
            if (parts.length < 8) return;

            const [squadron, type, desc, sLat, sLng, eLat, eLng, sTime, durationHours] = parts;

            const startMs = new Date(sTime).getTime();
            if (isNaN(startMs)) return;

            const mission = {
                id: `IMPORTED-${index}-${Date.now()}`,
                type: type || 'Unknown Aircraft',
                squadron: squadron || 'Unknown Squadron',
                origin: `Lat: ${sLat}, Lng: ${sLng}`,
                destination: `Lat: ${eLat}, Lng: ${eLng}`,
                startTime: sTime,
                startMs: startMs,
                duration: parseFloat(durationHours) * 3600 * 1000,
                endMs: startMs + (parseFloat(durationHours) * 3600 * 1000),
                waypoints: [
                    { lat: parseFloat(sLat), lng: parseFloat(sLng) },
                    { lat: parseFloat(eLat), lng: parseFloat(eLng) }
                ],
                altitude: 20000,
                speed: 300,
                description: desc
            };

            this.flights.push(mission);
        });

        this.updateTick();
        this.renderDynamicJumpPoints();
        alert(`Successfully loaded ${this.flights.filter(f => f.id.startsWith('IMPORTED')).length} custom missions.`);
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
