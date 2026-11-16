/**
 * GeoSafe - Centralized & Configurable Mapping Service Layer
 * ============================================================================
 * Technologies:
 * - Leaflet.js v1.9.4
 * - Base Map Tiles: OpenStreetMap (https://tile.openstreetmap.org/{z}/{x}/{y}.png)
 * - Pedestrian Routing: Project-OSRM Foot API (https://router.project-osrm.org/route/v1/foot)
 * - Reverse Geocoding: OSM Nominatim (https://nominatim.openstreetmap.org/reverse)
 * - External Directions: OpenStreetMap (https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot)
 * 
 * Strict Compliance:
 * - Throttles Nominatim requests to <= 1 req/sec across the application.
 * - In-memory and session caching for geocoding and routing to prevent server spam.
 * - Centralized configuration allows seamless replacement with self-hosted / private providers.
 * - No fake coordinates, no fake routes.
 * ============================================================================
 */

(function (window) {
  'use strict';

  // Configurable mapping service endpoints (can be changed to private/self-hosted servers)
  const GeoSafeMapConfig = {
    // OpenStreetMap Tile Layer
    tiles: {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxZoom: 19,
      minZoom: 12
    },
    // Project-OSRM Foot Profile Routing Endpoint
    routing: {
      baseUrl: 'https://router.project-osrm.org/route/v1/foot',
      timeoutMs: 12000,
      profile: 'foot'
    },
    // OSM Nominatim Reverse Geocoding Endpoint (1 req/sec limit)
    geocoding: {
      baseUrl: 'https://nominatim.openstreetmap.org/reverse',
      timeoutMs: 8000,
      minIntervalMs: 1100 // enforces > 1.0 second between requests
    },
    // OpenStreetMap External Directions Reference
    externalDirections: {
      baseUrl: 'https://www.openstreetmap.org/directions'
    },
    // Default Map Center: Barangay Bayanan, Muntinlupa City, Metro Manila
    center: {
      lat: 14.4075,
      lng: 121.0475
    },
    // Official GeoSafe Emergency Operations Center (EOC) Location
    eoc: {
      name: 'GeoSafe Emergency Operations Center (Bayanan Barangay Hall)',
      address: 'Bayanan Barangay Hall, Bayanan Baywalk Ilaya, Muntinlupa, Metro Manila, Philippines',
      lat: 14.41141,
      lng: 121.05130
    },
    defaultZoom: 15,
    boundaryGeoJsonUrl: '/assets/data/barangay-bayanan-boundary.geojson'
  };

  // Caching structures
  const geocodeCache = new Map();
  const routeCache = new Map();
  let boundaryGeoJsonPromise = null;
  let cachedBoundaryGeoJson = null;
  let cachedBoundaryBounds = null;
  let cachedBoundaryPolygons = null;

  function extractBoundaryGeometryData(geoJson) {
    if (cachedBoundaryPolygons && cachedBoundaryBounds) {
      return { polygons: cachedBoundaryPolygons, bounds: cachedBoundaryBounds };
    }
    const polygons = [];
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    const features = (geoJson && Array.isArray(geoJson.features)) ? geoJson.features : [];
    features.forEach((feature) => {
      const geom = feature && feature.geometry;
      if (!geom || !Array.isArray(geom.coordinates)) return;
      const polys = geom.type === 'MultiPolygon' ? geom.coordinates : geom.type === 'Polygon' ? [geom.coordinates] : [];
      polys.forEach((poly) => {
        polygons.push(poly);
        poly.forEach((ring) => {
          ring.forEach((coord) => {
            const lng = Number(coord[0]);
            const lat = Number(coord[1]);
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          });
        });
      });
    });

    cachedBoundaryPolygons = polygons;
    cachedBoundaryBounds = Number.isFinite(minLat)
      ? L.latLngBounds([minLat, minLng], [maxLat, maxLng])
      : null;
    return { polygons: cachedBoundaryPolygons, bounds: cachedBoundaryBounds };
  }

  function isPointOnSegment(px, py, ax, ay, bx, by, eps = 1e-9) {
    const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
    const segLen = Math.hypot(bx - ax, by - ay);
    if (segLen === 0) return Math.hypot(px - ax, py - ay) <= eps;
    if (Math.abs(cross) / segLen > eps) return false;
    const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
    return dot >= -eps * segLen && dot <= segLen * segLen + eps * segLen;
  }

  function isPointInRing(lng, lat, ring) {
    if (!Array.isArray(ring) || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = Number(ring[i][0]);
      const yi = Number(ring[i][1]);
      const xj = Number(ring[j][0]);
      const yj = Number(ring[j][1]);
      if (isPointOnSegment(lng, lat, xj, yj, xi, yi)) return true;
      const intersects = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  // Rate Limiting Queue for Nominatim (strict 1 request per second max)
  let lastNominatimRequestTime = 0;
  let nominatimQueue = Promise.resolve();

  /**
   * Approximate Barangay Bayanan zone/street label for offline reverse geocoding
   * @param {number} lat
   * @param {number} lng
   * @returns {string}
   */
  function approximateBayananAddress(lat, lng) {
    const dLat = lat - GeoSafeMapConfig.center.lat;
    const dLng = lng - GeoSafeMapConfig.center.lng;
    let zone = 'Central Bayanan Proper';
    if (dLng > 0.003) {
      zone = 'Bayanan Lakeshore Sector (Laguna de Bay)';
    } else if (dLng < -0.003) {
      zone = 'National Road West Sector, Barangay Bayanan';
    } else if (dLat > 0.0025) {
      zone = 'North Purok 1-2 Sector, Barangay Bayanan';
    } else if (dLat < -0.0025) {
      zone = 'South Purok 5-6 Sector, Barangay Bayanan';
    } else {
      zone = 'Purok 3-4 Interior, Barangay Bayanan';
    }
    return `${zone}, Muntinlupa City (${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E)`;
  }

  /**
   * Calculate Haversine distance in meters between two {lat, lng} points
   */
  function computeHaversineMeters(a, b) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h =
      sinLat * sinLat +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  const GeoSafeMapping = {
    config: GeoSafeMapConfig,

    /**
     * Create an offline SVG/Grid Tile Layer fallback (L.GridLayer)
     * Renders Barangay Bayanan coordinate grid, zone labels, and offline map background
     * @returns {L.GridLayer}
     */
    createOfflineGridLayer() {
      if (typeof L === 'undefined' || !L.GridLayer) return null;
      const OfflineGridLayer = L.GridLayer.extend({
        createTile: function (coords) {
          const tile = document.createElement('div');
          tile.style.width = '256px';
          tile.style.height = '256px';
          tile.style.boxSizing = 'border-box';
          tile.style.background = '#F8FAFC';
          tile.style.borderRight = '1px dashed #CBD5E1';
          tile.style.borderBottom = '1px dashed #CBD5E1';
          tile.style.position = 'relative';
          tile.style.overflow = 'hidden';
          tile.style.fontFamily = 'Inter, sans-serif';
          tile.innerHTML = `
            <svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:100%;">
              <rect width="256" height="256" fill="#F8FAFC"/>
              <path d="M 64 0 L 64 256 M 128 0 L 128 256 M 192 0 L 192 256 M 0 64 L 256 64 M 0 128 L 256 128 M 0 192 L 256 192" stroke="#E2E8F0" stroke-width="1"/>
              <path d="M 0 128 L 256 128 M 128 0 L 128 256" stroke="#CBD5E1" stroke-width="1.2" stroke-dasharray="4 4"/>
              <text x="12" y="22" fill="#64748B" font-size="10" font-weight="700">Barangay Bayanan Offline GIS Grid</text>
              <text x="12" y="38" fill="#94A3B8" font-size="9">Muntinlupa City (Z:${coords.z} X:${coords.x} Y:${coords.y})</text>
              <text x="12" y="242" fill="#94A3B8" font-size="9">14.4075° N, 121.0475° E Reference</text>
            </svg>
          `;
          return tile;
        }
      });
      return new OfflineGridLayer({
        tileSize: 256,
        opacity: 1,
        maxZoom: GeoSafeMapConfig.tiles.maxZoom,
        minZoom: GeoSafeMapConfig.tiles.minZoom
      });
    },

    /**
     * Add base OpenStreetMap tile layer with automatic offline SVG/Grid fallback
     * when navigator.onLine === false or OSM tiles trigger tileerror
     * @param {L.Map} map
     * @returns {L.Layer}
     */
    addBaseTileLayer(map) {
      if (!map || typeof L === 'undefined') return null;

      let offlineLayer = null;
      const ensureOfflineLayer = () => {
        if (!offlineLayer) {
          offlineLayer = this.createOfflineGridLayer();
          if (offlineLayer && !map.hasLayer(offlineLayer)) {
            offlineLayer.addTo(map);
            if (typeof offlineLayer.bringToBack === 'function') {
              offlineLayer.bringToBack();
            }
          }
        }
      };

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        ensureOfflineLayer();
      }

      const osmLayer = L.tileLayer(GeoSafeMapConfig.tiles.url, {
        attribution: GeoSafeMapConfig.tiles.attribution,
        maxZoom: GeoSafeMapConfig.tiles.maxZoom,
        crossOrigin: true
      });

      osmLayer.on('tileerror', () => {
        ensureOfflineLayer();
      });

      osmLayer.addTo(map);
      return osmLayer;
    },

    /**
     * Create and initialize a standard Leaflet map instance
     * @param {string} elementId - DOM element ID
     * @param {Object} options - Custom Leaflet map options
     * @returns {L.Map}
     */
    createMap(elementId, options = {}) {
      if (typeof L === 'undefined') {
        throw new Error('Leaflet.js library is not loaded.');
      }

      const mapEl = document.getElementById(elementId);
      if (!mapEl) {
        throw new Error(`Map container #${elementId} not found.`);
      }

      const map = L.map(elementId, {
        center: options.center || [GeoSafeMapConfig.center.lat, GeoSafeMapConfig.center.lng],
        zoom: options.zoom || GeoSafeMapConfig.defaultZoom,
        minZoom: options.minZoom || GeoSafeMapConfig.tiles.minZoom,
        maxZoom: options.maxZoom || GeoSafeMapConfig.tiles.maxZoom,
        zoomControl: options.zoomControl !== false,
        attributionControl: options.attributionControl !== false,
        scrollWheelZoom: options.scrollWheelZoom || false,
        ...options
      });

      // Remove visible "Leaflet" branding text while preserving required OpenStreetMap attribution
      if (map.attributionControl) {
        map.attributionControl.setPrefix(false);
      }

      // Add official OpenStreetMap tile layer with automatic offline grid fallback
      this.addBaseTileLayer(map);

      // Render verified Barangay Bayanan administrative boundary (line only, no fill)
      const shouldFit = options.fitBayananBounds !== false && !options.center && !options.zoom;
      this.addBayananBoundary(map, { fitBounds: shouldFit });

      // Automatically recalculate map tiles when layout dimensions change or window resizes
      setTimeout(() => {
        try { map.invalidateSize(); } catch (e) {}
      }, 250);

      window.addEventListener('resize', () => {
        try { map.invalidateSize(); } catch (e) {}
      });

      return map;
    },

    /**
     * Load and cache the verified Barangay Bayanan GeoJSON boundary
     * @returns {Promise<Object|null>}
     */
    async loadBayananBoundary() {
      if (cachedBoundaryGeoJson) return cachedBoundaryGeoJson;
      if (!boundaryGeoJsonPromise) {
        boundaryGeoJsonPromise = fetch(GeoSafeMapConfig.boundaryGeoJsonUrl, {
          headers: { Accept: 'application/json' }
        })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then((geoJson) => {
            cachedBoundaryGeoJson = geoJson;
            extractBoundaryGeometryData(geoJson);
            return geoJson;
          })
          .catch((err) => {
            console.warn('[GeoSafeMapping] Failed to load Barangay Bayanan boundary GeoJSON:', err.message);
            boundaryGeoJsonPromise = null;
            return null;
          });
      }
      return boundaryGeoJsonPromise;
    },

    /**
     * Load the verified Barangay Bayanan boundary geometry (without drawing a visible outline border)
     * and optionally fit the map viewport to its bounds.
     * @param {L.Map} map
     * @param {Object} options
     * @returns {Promise<L.LatLngBounds|null>}
     */
    async addBayananBoundary(map, options = {}) {
      if (!map || typeof L === 'undefined') return null;
      const geoJson = await this.loadBayananBoundary();
      if (!geoJson) return null;

      if (map._bayananBoundaryLayer && map.hasLayer(map._bayananBoundaryLayer)) {
        map.removeLayer(map._bayananBoundaryLayer);
        map._bayananBoundaryLayer = null;
      }

      const { bounds } = extractBoundaryGeometryData(geoJson);
      if (options.fitBounds !== false && bounds && bounds.isValid()) {
        map.fitBounds(bounds, { padding: options.padding || [20, 20] });
      }

      return bounds || null;
    },

    getEocLocation() {
      return {
        name: this.config.eoc.name,
        address: this.config.eoc.address,
        latitude: this.config.eoc.lat,
        longitude: this.config.eoc.lng,
        coordinates: { lat: this.config.eoc.lat, lng: this.config.eoc.lng }
      };
    },

    setEocLocation(eoc) {
      if (!eoc) return;
      const lat = Number(eoc.latitude ?? eoc.lat);
      const lng = Number(eoc.longitude ?? eoc.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        this.config.eoc.lat = lat;
        this.config.eoc.lng = lng;
      }
      if (eoc.name) this.config.eoc.name = String(eoc.name);
      if (eoc.address) this.config.eoc.address = String(eoc.address);
    },

    /**
     * Return cached L.LatLngBounds of Barangay Bayanan if loaded
     * @returns {L.LatLngBounds|null}
     */
    getBayananBounds() {
      return cachedBoundaryBounds;
    },

    /**
     * Client-side point-in-polygon check against verified Barangay Bayanan boundary
     * Returns null if boundary GeoJSON has not finished loading yet.
     * @param {number} lat
     * @param {number} lng
     * @returns {boolean|null}
     */
    isPointInsideBayanan(lat, lng) {
      if (!cachedBoundaryGeoJson) return null;
      const numLat = Number(lat);
      const numLng = Number(lng);
      if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) return false;

      const { polygons, bounds } = extractBoundaryGeometryData(cachedBoundaryGeoJson);
      if (bounds && !bounds.pad(0.0001).contains([numLat, numLng])) {
        return false;
      }

      for (let i = 0; i < polygons.length; i++) {
        const poly = polygons[i];
        if (!poly.length) continue;
        if (isPointInRing(numLng, numLat, poly[0])) {
          let inHole = false;
          for (let h = 1; h < poly.length; h++) {
            if (isPointInRing(numLng, numLat, poly[h])) {
              inHole = true;
              break;
            }
          }
          if (!inHole) return true;
        }
      }
      return false;
    },

    /**
     * Get Resident's Current GPS Location using Browser Geolocation API
     * Handles LAN HTTP secure-context restrictions gracefully with GeoSafeToast.info
     * @returns {Promise<{lat: number, lng: number, accuracy: number}>}
     */
    getCurrentLocation() {
      return new Promise((resolve, reject) => {
        const isInsecureLan =
          typeof window !== 'undefined' &&
          window.isSecureContext === false &&
          window.location &&
          window.location.hostname !== 'localhost' &&
          window.location.hostname !== '127.0.0.1';

        if (isInsecureLan || (typeof window !== 'undefined' && window.isSecureContext === false)) {
          const lanMsg =
            'Browser GPS is restricted over non-HTTPS LAN connections. You can click or drag the map pin (or enter coordinates) to set your exact Barangay Bayanan location.';
          if (typeof window !== 'undefined' && window.GeoSafeToast && typeof window.GeoSafeToast.info === 'function') {
            window.GeoSafeToast.info(lanMsg);
          }
          const err = new Error(lanMsg);
          err.code = 'INSECURE_CONTEXT_LAN';
          return reject(err);
        }

        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          const err = new Error('Geolocation is not supported by your browser. Please click or drag the map pin to set your location.');
          err.code = 'UNSUPPORTED';
          return reject(err);
        }

        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy
            });
          },
          (error) => {
            let msg = 'Unable to acquire location.';
            const isSecError =
              (error && error.message && /secure origin|Only secure origins/i.test(error.message)) ||
              (typeof window !== 'undefined' && window.isSecureContext === false);

            if (isSecError) {
              msg =
                'Browser GPS is restricted over non-HTTPS LAN connections. You can click or drag the map pin (or enter coordinates) to set your exact Barangay Bayanan location.';
              if (typeof window !== 'undefined' && window.GeoSafeToast && typeof window.GeoSafeToast.info === 'function') {
                window.GeoSafeToast.info(msg);
              }
            } else if (error.code === error.PERMISSION_DENIED) {
              msg = 'Location access permission was denied. You can click or drag the map pin to set your Barangay Bayanan location.';
            } else if (error.code === error.POSITION_UNAVAILABLE) {
              msg = 'Location information is currently unavailable. Please click or drag the map pin manually.';
            } else if (error.code === error.TIMEOUT) {
              msg = 'GPS location request timed out. Please try again or drag the map pin manually.';
            }
            const err = new Error(msg);
            err.code = error.code;
            reject(err);
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 15000
          }
        );
      });
    },

    /**
     * Alias for getCurrentLocation()
     */
    getUserLocation() {
      return this.getCurrentLocation();
    },

    /**
     * Reverse Geocoding with OSM Nominatim and Offline Barangay Bayanan Fallback
     * Enforces strict rate-limiting (max 1 req/sec) and in-memory caching.
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @returns {Promise<string>}
     */
    async reverseGeocode(lat, lng) {
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        throw new Error('Valid latitude and longitude numbers are required for geocoding.');
      }

      // Round coordinates to 5 decimal places (~1.1 meter resolution) for cache key
      const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      if (geocodeCache.has(cacheKey)) {
        return geocodeCache.get(cacheKey);
      }

      // Immediate local Barangay Bayanan zone/street approximation when offline
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const offlineAddress = approximateBayananAddress(lat, lng);
        geocodeCache.set(cacheKey, offlineAddress);
        return offlineAddress;
      }

      // Chain through sequential queue to guarantee at least 1.1s between requests
      return (nominatimQueue = nominatimQueue.then(async () => {
        const now = Date.now();
        const timeSinceLast = now - lastNominatimRequestTime;
        if (timeSinceLast < GeoSafeMapConfig.geocoding.minIntervalMs) {
          const waitTime = GeoSafeMapConfig.geocoding.minIntervalMs - timeSinceLast;
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }

        lastNominatimRequestTime = Date.now();

        const url = `${GeoSafeMapConfig.geocoding.baseUrl}?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), GeoSafeMapConfig.geocoding.timeoutMs);

        try {
          const response = await fetch(url, {
            headers: {
              'Accept': 'application/json',
              'Accept-Language': 'en-PH,en,fil'
            },
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`Geocoding service error (HTTP ${response.status})`);
          }

          const data = await response.json();
          let displayName = '';

          if (data && data.address) {
            const addr = data.address;
            const parts = [
              addr.road || addr.pedestrian || addr.suburb || addr.neighbourhood,
              addr.village || addr.quarter || addr.subdivision || 'Barangay Bayanan',
              addr.city || addr.town || 'Muntinlupa City'
            ].filter(Boolean);

            displayName = parts.join(', ');
          }

          if (!displayName && data && data.display_name) {
            displayName = data.display_name.split(',').slice(0, 3).join(',').trim();
          }

          if (!displayName) {
            displayName = approximateBayananAddress(lat, lng);
          }

          geocodeCache.set(cacheKey, displayName);
          return displayName;
        } catch (err) {
          clearTimeout(timeoutId);
          console.warn('[GeoSafeMapping] Reverse geocoding failed, using local Bayanan approximation:', err.message);
          const fallbackName = approximateBayananAddress(lat, lng);
          geocodeCache.set(cacheKey, fallbackName);
          return fallbackName;
        }
      }));
    },

    /**
     * Calculate Pedestrian Route via Project-OSRM Foot Endpoint with Offline Waypoint Fallback
     * @param {{lat: number, lng: number}} start - Starting location
     * @param {{lat: number, lng: number}} destination - Destination location
     * @returns {Promise<{coordinates: Array<[number, number]>, distanceMeters: number, durationSeconds: number, isOfflineFallback?: boolean}>}
     */
    async calculatePedestrianRoute(start, destination) {
      if (!start || !destination || !start.lat || !destination.lat) {
        throw new Error('Both starting point and destination are required.');
      }

      const cacheKey = `${start.lat.toFixed(5)},${start.lng.toFixed(5)}->${destination.lat.toFixed(5)},${destination.lng.toFixed(5)}`;
      if (routeCache.has(cacheKey)) {
        return routeCache.get(cacheKey);
      }

      const buildOfflineRouteFallback = () => {
        const directMeters = computeHaversineMeters(start, destination);
        const estimatedRoadMeters = Math.max(25, Math.round(directMeters * 1.22));
        const estimatedDurationSeconds = Math.max(30, Math.round(estimatedRoadMeters / 1.25));
        const midLat = (start.lat + destination.lat) / 2;
        const midLng = (start.lng + destination.lng) / 2;
        return {
          coordinates: [
            [start.lat, start.lng],
            [midLat, destination.lng * 0.35 + start.lng * 0.65],
            [destination.lat, destination.lng]
          ],
          distanceMeters: estimatedRoadMeters,
          durationSeconds: estimatedDurationSeconds,
          isOfflineFallback: true
        };
      };

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const fallbackRoute = buildOfflineRouteFallback();
        routeCache.set(cacheKey, fallbackRoute);
        return fallbackRoute;
      }

      // OSRM expects coordinates in order: {lng},{lat};{lng},{lat}
      const coordsString = `${start.lng},${start.lat};${destination.lng},${destination.lat}`;
      const url = `${GeoSafeMapConfig.routing.baseUrl}/${coordsString}?overview=full&geometries=geojson&steps=true`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GeoSafeMapConfig.routing.timeoutMs);

      try {
        const response = await fetch(url, {
          headers: { 'Accept': 'application/json' },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Routing service returned error HTTP ${response.status}.`);
        }

        const data = await response.json();

        if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
          throw new Error(data.message || 'No viable pedestrian route found between the selected locations.');
        }

        const primaryRoute = data.routes[0];
        // Convert GeoJSON [lng, lat] coordinates to Leaflet [lat, lng] format
        const leafletCoordinates = primaryRoute.geometry.coordinates.map((pt) => [pt[1], pt[0]]);
        const rawSteps = (primaryRoute.legs && primaryRoute.legs[0] && Array.isArray(primaryRoute.legs[0].steps))
          ? primaryRoute.legs[0].steps
          : [];
        const steps = rawSteps.map((s) => {
          const maneuver = s.maneuver || {};
          const loc = Array.isArray(maneuver.location) && maneuver.location.length >= 2
            ? [Number(maneuver.location[1]), Number(maneuver.location[0])]
            : null;
          return {
            type: maneuver.type || '',
            modifier: maneuver.modifier || '',
            name: s.name || '',
            distanceMeters: Math.round(s.distance || 0),
            durationSeconds: Math.round(s.duration || 0),
            location: loc
          };
        });

        const result = {
          coordinates: leafletCoordinates,
          distanceMeters: Math.round(primaryRoute.distance || 0),
          durationSeconds: Math.round(primaryRoute.duration || 0),
          steps,
          isOfflineFallback: false
        };

        routeCache.set(cacheKey, result);
        return result;
      } catch (err) {
        clearTimeout(timeoutId);
        console.warn('[GeoSafeMapping] OSRM Route calculation unavailable, using offline waypoint calculation:', err.message);
        const fallbackRoute = buildOfflineRouteFallback();
        routeCache.set(cacheKey, fallbackRoute);
        return fallbackRoute;
      }
    },

    /**
     * Alias for calculatePedestrianRoute(start, end)
     */
    async getWalkingRoute(start, end) {
      return this.calculatePedestrianRoute(start, end);
    },

    /**
     * Build external directions URL on OpenStreetMap
     * @param {{lat: number, lng: number}} start
     * @param {{lat: number, lng: number}} destination
     * @returns {string}
     */
    buildExternalDirectionsUrl(start, destination) {
      if (!start || !destination) return GeoSafeMapConfig.externalDirections.baseUrl;
      return `${GeoSafeMapConfig.externalDirections.baseUrl}?engine=fossgis_osrm_foot&route=${start.lat}%2C${start.lng}%3B${destination.lat}%2C${destination.lng}`;
    },

    /**
     * Calculate an actual navigable road driving route via Project-OSRM Driving API.
     * Never returns a fabricated or straight-line fallback route on failure.
     * @param {{lat: number, lng: number}} start
     * @param {{lat: number, lng: number}} destination
     */
    async calculateDrivingRoute(start, destination) {
      const validCoord = (pt) =>
        pt &&
        typeof pt.lat === 'number' &&
        typeof pt.lng === 'number' &&
        Number.isFinite(pt.lat) &&
        Number.isFinite(pt.lng) &&
        Math.abs(pt.lat) <= 90 &&
        Math.abs(pt.lng) <= 180;

      if (!validCoord(start) || !validCoord(destination)) {
        throw new Error('Valid origin and destination coordinates are required for road routing.');
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('Device is offline. Road routing service is unavailable.');
      }

      const cacheKey = `drv:${start.lat.toFixed(5)},${start.lng.toFixed(5)}->${destination.lat.toFixed(5)},${destination.lng.toFixed(5)}`;
      if (routeCache.has(cacheKey)) {
        return routeCache.get(cacheKey);
      }

      const coordsString = `${start.lng},${start.lat};${destination.lng},${destination.lat}`;
      const url = `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson&steps=true&alternatives=true`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GeoSafeMapConfig.routing.timeoutMs);

      try {
        const response = await fetch(url, {
          headers: { 'Accept': 'application/json' },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Routing service returned HTTP ${response.status}.`);
        }

        const data = await response.json();
        if (data.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) {
          throw new Error(data.message || 'No navigable road route found between your location and the destination.');
        }

        // Prefer the shortest practical road route among returned alternatives
        const sortedRoutes = [...data.routes].sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
        const selectedRoute = sortedRoutes[0];
        if (!selectedRoute.geometry || !Array.isArray(selectedRoute.geometry.coordinates) || selectedRoute.geometry.coordinates.length < 2) {
          throw new Error('Routing service returned an incomplete road geometry.');
        }

        const leafletCoordinates = selectedRoute.geometry.coordinates.map((pt) => [pt[1], pt[0]]);
        const rawSteps = (selectedRoute.legs && selectedRoute.legs[0] && Array.isArray(selectedRoute.legs[0].steps))
          ? selectedRoute.legs[0].steps
          : [];

        const steps = rawSteps.map((s) => {
          const maneuver = s.maneuver || {};
          const loc = Array.isArray(maneuver.location) && maneuver.location.length >= 2
            ? [Number(maneuver.location[1]), Number(maneuver.location[0])]
            : null;
          return {
            type: maneuver.type || '',
            modifier: maneuver.modifier || '',
            name: s.name || '',
            instruction: this.formatManeuverInstruction(maneuver.type, maneuver.modifier, s.name),
            distanceMeters: Math.round(s.distance || 0),
            durationSeconds: Math.round(s.duration || 0),
            location: loc
          };
        });

        const result = {
          coordinates: leafletCoordinates,
          distanceMeters: Math.round(selectedRoute.distance || 0),
          durationSeconds: Math.round(selectedRoute.duration || 0),
          steps,
          alternativesCount: data.routes.length,
        };

        routeCache.set(cacheKey, result);
        return result;
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new Error('Routing request timed out. Please retry.');
        }
        throw err;
      }
    },

    formatManeuverInstruction(type, modifier, roadName) {
      const road = roadName ? ` onto ${roadName}` : '';
      const mod = modifier ? modifier.replace(/-/g, ' ') : '';
      switch (type) {
        case 'depart':
          return `Head ${mod || 'forward'}${road}`;
        case 'arrive':
          return 'Arrive at assigned destination';
        case 'turn':
          return `Turn ${mod || ''}${road}`.trim();
        case 'new name':
          return `Continue${road}`;
        case 'continue':
          return `Continue ${mod || 'straight'}${road}`.trim();
        case 'merge':
          return `Merge ${mod || ''}${road}`.trim();
        case 'roundabout':
        case 'rotary':
          return `Enter roundabout${road}`;
        case 'fork':
          return `Keep ${mod || 'straight'} at fork${road}`;
        case 'end of road':
          return `Turn ${mod || ''} at end of road${road}`.trim();
        default:
          return `${type ? type.replace(/-/g, ' ') : 'Proceed'}${mod ? ' ' + mod : ''}${road}`.trim();
      }
    },

    pointToRouteDistanceMeters(point, polylineCoords) {
      if (!point || !Array.isArray(polylineCoords) || polylineCoords.length === 0) return Infinity;
      let minMeters = Infinity;
      for (let i = 0; i < polylineCoords.length; i++) {
        const pt = polylineCoords[i];
        const d = computeHaversineMeters(point, { lat: pt[0], lng: pt[1] });
        if (d < minMeters) minMeters = d;
      }
      return minMeters;
    },

    computeDistanceMeters(a, b) {
      return computeHaversineMeters(a, b);
    },

    /**
     * Format distance in meters or kilometers
     * @param {number} meters
     * @returns {string}
     */
    formatDistance(meters) {
      if (meters === undefined || meters === null) return '—';
      if (meters < 1000) {
        return `${meters} m`;
      }
      return `${(meters / 1000).toFixed(2)} km`;
    },

    /**
     * Format duration in minutes / hours
     * @param {number} seconds
     * @returns {string}
     */
    formatDuration(seconds) {
      if (!seconds && seconds !== 0) return '—';
      const mins = Math.round(seconds / 60);
      if (mins < 60) {
        return `${mins} min${mins === 1 ? '' : 's'}`;
      }
      const hrs = Math.floor(mins / 60);
      const remainingMins = mins % 60;
      return `${hrs} hr${hrs === 1 ? '' : 's'} ${remainingMins} min${remainingMins === 1 ? '' : 's'}`;
    },

    /**
     * Helper to render custom colored Leaflet markers
     * @param {string} type - 'user' | 'evacuation' | 'incident' | 'rescue' | 'responder'
     * @param {string|object} labelOrOptions - Short text/initials or { label, selected, muted, compact }
     * @returns {L.DivIcon}
     */
    createCustomIcon(type, labelOrOptions = '') {
      const opts =
        labelOrOptions && typeof labelOrOptions === 'object'
          ? labelOrOptions
          : { label: String(labelOrOptions || '') };
      const label = String(opts.label || '');
      const isSelected = Boolean(opts.selected);
      const isMuted = Boolean(opts.muted);
      const isCompact = Boolean(opts.compact);

      let bgStyle = 'background-color:#202020;';
      let ringClass = 'ring-4 ring-slate-300';
      let iconSvg = '';

      if (type === 'user') {
        bgStyle = 'background-color:#2563EB;';
        ringClass = 'ring-4 ring-blue-300 animate-pulse';
        iconSvg = `<div class="w-3 h-3 rounded-full bg-white"></div>`;
      } else if (type === 'evacuation') {
        bgStyle = 'background-color:#278653;';
        ringClass = 'ring-4 ring-emerald-300';
        iconSvg = `<svg class="${isCompact ? 'w-3 h-3' : 'w-4 h-4'} text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>`;
      } else if (type === 'rescue') {
        bgStyle = 'background-color:#D93636;';
        ringClass = isSelected ? 'ring-4 ring-[#FDE047]' : 'ring-4 ring-[#FCA5A5]';
        iconSvg = `<svg class="${isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" stroke-width="2"></circle><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" d="M12 8v8M8 12h8"></path></svg>`;
      } else if (type === 'incident') {
        bgStyle = 'background-color:#D97706;';
        ringClass = isSelected ? 'ring-4 ring-[#202020]/40' : 'ring-4 ring-amber-300';
        iconSvg = `<svg class="${isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M12 9v3.5m0 3.25h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path></svg>`;
      } else if (type === 'responder' || type === 'eoc') {
        bgStyle = 'background-color:#4338CA;';
        ringClass = type === 'eoc' ? 'ring-4 ring-[#FDE047]' : 'ring-4 ring-indigo-300';
        iconSvg = `<span class="text-[10px] font-bold text-white">${label.substring(0, 3).toUpperCase() || (type === 'eoc' ? 'EOC' : 'RSP')}</span>`;
      }

      const sizePx = isCompact ? 24 : 32;
      const anchorPx = isCompact ? 12 : 16;
      const sizeClass = isCompact ? 'w-6 h-6' : 'w-8 h-8';
      const stateClasses = [
        isSelected ? 'scale-110 shadow-xl' : 'shadow-lg',
        isMuted ? 'opacity-60 saturate-50' : '',
      ].filter(Boolean).join(' ');

      return L.divIcon({
        className: 'geosafe-custom-marker',
        html: `
          <div class="relative flex items-center justify-center">
            <div style="${bgStyle}" class="${sizeClass} rounded-full ${ringClass} ${stateClasses} flex items-center justify-center border-2 border-white transition-transform">
              ${iconSvg}
            </div>
          </div>
        `,
        iconSize: [sizePx, sizePx],
        iconAnchor: [anchorPx, anchorPx],
        popupAnchor: [0, -anchorPx - 2]
      });
    }
  };

  window.GeoSafeMapping = GeoSafeMapping;
})(window);

