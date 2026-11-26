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
      lat: 14.4101,
      lng: 121.0501
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

      if (map.attributionControl) {
        map.attributionControl.setPrefix(false);
      }

      this.addBaseTileLayer(map);

      const shouldFit = options.fitBayananBounds !== false && options.fitBoundary !== false && !options.center && !options.zoom;
      this.addBayananBoundary(map, { fitBounds: shouldFit });

      const recalc = () => {
        try {
          map.invalidateSize(false);
          if (shouldFit && cachedBoundaryBounds && cachedBoundaryBounds.isValid()) {
            map.fitBounds(cachedBoundaryBounds, { padding: [24, 24] });
          }
        } catch (e) { }
      };

      setTimeout(recalc, 250);
      window.addEventListener('resize', recalc);
      if (typeof ResizeObserver !== 'undefined') {
        try {
          const ro = new ResizeObserver(() => {
            try { map.invalidateSize(false); } catch (e) { }
          });
          ro.observe(mapEl);
        } catch (e) { }
      }

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
     * Load and render the verified Barangay Bayanan boundary polygon (red dashed outline,
     * subtle interior fill, and non-blocking exterior de-emphasis mask) and optionally
     * fit the map viewport to its bounds.
     * @param {L.Map} map
     * @param {Object} options
     * @returns {Promise<L.LatLngBounds|null>}
     */
    async addBayananBoundary(map, options = {}) {
      if (!map || typeof L === 'undefined') return null;
      const geoJson = await this.loadBayananBoundary();
      if (!geoJson) return null;

      let boundaryPane = map.getPane('bayananBoundaryPane');
      if (!boundaryPane) {
        boundaryPane = map.createPane('bayananBoundaryPane');
      }
      boundaryPane.style.zIndex = '350';
      boundaryPane.style.pointerEvents = 'none';

      if (map._bayananMaskLayer && map.hasLayer(map._bayananMaskLayer)) {
        map.removeLayer(map._bayananMaskLayer);
        map._bayananMaskLayer = null;
      }
      if (map._bayananFillLayer && map.hasLayer(map._bayananFillLayer)) {
        map.removeLayer(map._bayananFillLayer);
        map._bayananFillLayer = null;
      }
      if (map._bayananBoundaryLayer && map.hasLayer(map._bayananBoundaryLayer)) {
        map.removeLayer(map._bayananBoundaryLayer);
        map._bayananBoundaryLayer = null;
      }

      const { polygons, bounds } = extractBoundaryGeometryData(geoJson);

      map._bayananFillLayer = L.geoJSON(geoJson, {
        pane: 'bayananBoundaryPane',
        interactive: false,
        style: {
          stroke: false,
          weight: 0,
          opacity: 0,
          fillColor: '#EF4444',
          fillOpacity: 0.04
        }
      }).addTo(map);

      const outlineGroup = L.layerGroup();
      (polygons || []).forEach((poly) => {
        if (!Array.isArray(poly) || !Array.isArray(poly[0]) || poly[0].length < 3) return;
        const ringLatLngs = poly[0].map((coord) => [Number(coord[1]), Number(coord[0])]);
        outlineGroup.addLayer(
          L.polyline(ringLatLngs, {
            pane: 'bayananBoundaryPane',
            interactive: false,
            color: '#DC2626',
            weight: 3,
            opacity: 0.95,
            dashArray: '1, 7'
          })
        );
      });
      outlineGroup.addTo(map);
      map._bayananBoundaryLayer = outlineGroup;

      if (options.fitBounds !== false && bounds && bounds.isValid()) {
        try {
          map.invalidateSize(false);
        } catch (_) {
          // Ignore if map container is not yet laid out
        }
        map.fitBounds(bounds, { padding: options.padding || [24, 24] });
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
     * Calculate Pedestrian / Road Route via Project-OSRM Foot Endpoint.
     * Never returns a fabricated or straight-line fallback route on failure.
     * @param {{lat: number, lng: number}} start - Starting location
     * @param {{lat: number, lng: number}} destination - Destination location
     * @returns {Promise<{coordinates: Array<[number, number]>, distanceMeters: number, durationSeconds: number, steps: Array, alternativesCount: number}>}
     */
    async calculatePedestrianRoute(start, destination) {
      const validCoord = (pt) =>
        pt &&
        typeof pt.lat === 'number' &&
        typeof pt.lng === 'number' &&
        Number.isFinite(pt.lat) &&
        Number.isFinite(pt.lng) &&
        Math.abs(pt.lat) <= 90 &&
        Math.abs(pt.lng) <= 180 &&
        !(pt.lat === 0 && pt.lng === 0);

      if (!validCoord(start) || !validCoord(destination)) {
        throw new Error('Valid origin and destination coordinates are required for road routing.');
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new Error('Device is offline. Routing service is currently unavailable.');
      }

      const cacheKey = `foot:${start.lat.toFixed(5)},${start.lng.toFixed(5)}->${destination.lat.toFixed(5)},${destination.lng.toFixed(5)}`;
      if (routeCache.has(cacheKey)) {
        return routeCache.get(cacheKey);
      }

      // OSRM expects coordinates in order: {lng},{lat};{lng},{lat}
      const coordsString = `${start.lng},${start.lat};${destination.lng},${destination.lat}`;
      const url = `${GeoSafeMapConfig.routing.baseUrl}/${coordsString}?overview=full&geometries=geojson&steps=true&alternatives=true`;

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
          throw new Error(data.message || 'No navigable road route found between your location and the evacuation center.');
        }

        // Prefer the shortest practical road route among returned alternatives
        const sortedRoutes = [...data.routes].sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
        const primaryRoute = sortedRoutes[0];
        if (!primaryRoute.geometry || !Array.isArray(primaryRoute.geometry.coordinates) || primaryRoute.geometry.coordinates.length < 2) {
          throw new Error('Routing service returned an incomplete road geometry.');
        }

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
            instruction: this.formatManeuverInstruction(maneuver.type, maneuver.modifier, s.name),
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
          alternativesCount: data.routes.length,
          isOfflineFallback: false
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
          return `Proceed to destination${road}`;
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
        const hasHeading = Number.isFinite(Number(opts.heading));
        const angle = hasHeading ? Number(opts.heading) : 0;
        const sizePx = isCompact ? 28 : 34;
        const anchorPx = Math.round(sizePx / 2);
        const circleClass = isCompact ? 'w-7 h-7' : 'w-8 h-8';
        const svgClass = isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4';
        const staleBg = opts.stale ? 'background-color:#D97706;' : 'background-color:#2563EB;';
        const pulseBg = opts.stale ? 'bg-amber-400' : 'bg-blue-400';
        const stateClasses = [
          isSelected ? 'scale-110 shadow-xl' : 'shadow-lg',
          isMuted ? 'opacity-60 saturate-50' : '',
        ].filter(Boolean).join(' ');

        return L.divIcon({
          className: 'geosafe-custom-marker geosafe-live-gps-marker',
          html: `
            <div class="relative flex items-center justify-center" style="width:${sizePx}px;height:${sizePx}px;">
              <span class="animate-ping absolute inline-flex ${circleClass} rounded-full ${pulseBg} opacity-45 pointer-events-none"></span>
              <div style="${staleBg}" class="${circleClass} rounded-full ${stateClasses} flex items-center justify-center border-2 border-white">
                <div class="geosafe-gps-arrow-rotator flex items-center justify-center" data-has-heading="${hasHeading ? 'true' : 'false'}" style="display:${hasHeading ? 'flex' : 'none'};width:100%;height:100%;transform:rotate(${angle}deg);transition:transform 120ms linear;transform-origin:50% 50%;will-change:transform;">
                  <svg class="${svgClass} text-white drop-shadow-sm" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"></path>
                  </svg>
                </div>
                <span class="geosafe-gps-no-heading-dot rounded-full bg-white shadow-sm" style="display:${hasHeading ? 'none' : 'block'};width:${isCompact ? 9 : 11}px;height:${isCompact ? 9 : 11}px;" aria-hidden="true"></span>
              </div>
            </div>
          `,
          iconSize: [sizePx, sizePx],
          iconAnchor: [anchorPx, anchorPx],
          popupAnchor: [0, -anchorPx - 2]
        });
      } else if (type === 'evacuation') {
        bgStyle = 'background-color:#0D9488;';
        ringClass = 'ring-4 ring-teal-300';
        iconSvg = `<svg class="${isCompact ? 'w-3 h-3' : 'w-4 h-4'} text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>`;
      } else if (type === 'rescue') {
        bgStyle = 'background-color:#D93636;';
        ringClass = isSelected ? 'ring-4 ring-[#FDE047]' : 'ring-4 ring-[#FCA5A5]';
        iconSvg = `<svg class="${isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" stroke-width="2"></circle><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" d="M12 8v8M8 12h8"></path></svg>`;
      } else if (type === 'incident') {
        bgStyle = 'background-color:#D97706;';
        ringClass = isSelected ? 'ring-4 ring-[#202020]/40' : 'ring-4 ring-amber-300';
        iconSvg = `<svg class="${isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M12 9v3.5m0 3.25h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path></svg>`;
      } else if (type === 'hospital' || type === 'health_center') {
        return GeoSafeMapping.createMedicalFacilityIcon(
          type === 'hospital' ? 'Hospital' : 'Health Center',
          opts
        );
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
    },

    /**
     * Create consistent SVG map pin markers for Hospitals (red) and Health Centers (blue).
     * @param {string} facilityType - 'Hospital' or 'Health Center'
     * @param {object} [options] - { selected, muted, compact }
     * @returns {L.DivIcon}
     */
    createMedicalFacilityIcon(facilityType, options = {}) {
      const normalized = String(facilityType || '').trim().toLowerCase();
      const isHospital = normalized === 'hospital' || !normalized.includes('health center');
      const isCompact = Boolean(options.compact);
      const isSelected = Boolean(options.selected);
      const isMuted = Boolean(options.muted);

      const pinFill = isHospital ? '#DC2626' : '#2563EB';
      const title = isHospital ? 'Hospital' : 'Health Center';
      const width = isCompact ? 24 : 30;
      const height = isCompact ? 30 : 38;
      const anchorX = Math.round(width / 2);
      const anchorY = height - 1;
      const scaleCls = isSelected ? 'scale-110' : '';
      const opacityStyle = isMuted ? 'opacity:0.62;' : '';

      const svgHtml = `
        <div class="relative flex items-center justify-center transition-transform ${scaleCls}" style="${opacityStyle}width:${width}px;height:${height}px;filter:drop-shadow(0 2px 4px rgba(15,23,42,0.34));" title="${title}">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40" width="${width}" height="${height}" aria-label="${title}">
            <path d="M16 2C8.82 2 3 7.82 3 15c0 9.75 13 23 13 23s13-13.25 13-23C29 7.82 23.18 2 16 2z" fill="${pinFill}" stroke="#FFFFFF" stroke-width="1.8" stroke-linejoin="round"/>
            <path d="M8.5 20.5V13h3V9.5h9V13h3v7.5H8.5z" fill="#FFFFFF"/>
            <path d="M15 11.4h2v2h2v2h-2v2h-2v-2h-2v-2h2v-2z" fill="${pinFill}"/>
            <rect x="14.75" y="18.2" width="2.5" height="2.3" rx="0.35" fill="${pinFill}"/>
          </svg>
        </div>
      `;

      return L.divIcon({
        className: isHospital ? 'geosafe-hospital-marker' : 'geosafe-health-center-marker',
        html: svgHtml,
        iconSize: [width, height],
        iconAnchor: [anchorX, anchorY],
        popupAnchor: [0, -height + 4],
      });
    },

    NAV_STATES: Object.freeze({
      IDLE: 'Idle',
      REQUESTING_LOCATION: 'Requesting Location',
      NAVIGATING: 'Navigating',
      RECALCULATING_ROUTE: 'Recalculating Route',
      ARRIVED: 'Arrived',
      GPS_UNAVAILABLE: 'GPS Unavailable',
      NAVIGATION_STOPPED: 'Navigation Stopped'
    }),

    /**
     * Reusable Live GPS & Route Navigation Engine (shared architecture between Responder & Resident Navigation)
     * - Distinct states: Idle, Requesting Location, Navigating, Recalculating Route, Arrived, GPS Unavailable, Navigation Stopped
     * - Synchronizes live GPS every 10 seconds while active (non-overlapping)
     * - Uses navigator.geolocation.watchPosition() to detect movement between 10s intervals
     * - Ignores outdated GPS fixes and outdated route responses via sessionId, sequence & timestamp guards
     * - Confirm arrival only after consecutive valid GPS readings within proximity & accuracy thresholds
     * - Automatically stops all GPS timers/watches, clears route data, and locks Arrived state against delayed responses
     */
    createLiveNavigator(options = {}) {
      const NAV_STATES = GeoSafeMapping.NAV_STATES;
      const cfg = {
        syncIntervalMs: Number(options.syncIntervalMs) || 10000,
        staleTimeoutMs: Number(options.staleTimeoutMs) || 25000,
        maxAccuracyMeters: Number(options.maxAccuracyMeters) || 1000,
        routeAccuracyMaxMeters: Number(options.routeAccuracyMaxMeters) || 150,
        cycleMoveThresholdMeters: Number(options.cycleMoveThresholdMeters) || 5,
        watchMoveThresholdMeters: Number(options.watchMoveThresholdMeters) || 35,
        offRouteThresholdMeters: Number(options.offRouteThresholdMeters) || 45,
        routeCooldownMs: Number(options.routeCooldownMs) || 9000,
        arrivalRadiusMeters: Number(options.arrivalRadiusMeters) || 15,
        arrivalMaxAccuracyMeters: Number(options.arrivalMaxAccuracyMeters) || 150,
        consecutiveArrivalReadingsRequired: Math.max(1, Number(options.consecutiveArrivalReadingsRequired) || 2),
        arrivalRecheckIntervalMs: Number(options.arrivalRecheckIntervalMs) || 800,
        routeFn:
          typeof options.routeFn === 'function'
            ? options.routeFn
            : (start, dest) => GeoSafeMapping.calculatePedestrianRoute(start, dest),
        onStatusChange: typeof options.onStatusChange === 'function' ? options.onStatusChange : () => { },
        onGpsUpdate: typeof options.onGpsUpdate === 'function' ? options.onGpsUpdate : () => { },
        onRouteCalculated: typeof options.onRouteCalculated === 'function' ? options.onRouteCalculated : () => { },
        onRouteProgress: typeof options.onRouteProgress === 'function' ? options.onRouteProgress : () => { },
        onArrival: typeof options.onArrival === 'function' ? options.onArrival : () => { },
        onError: typeof options.onError === 'function' ? options.onError : () => { },
        onClearError: typeof options.onClearError === 'function' ? options.onClearError : () => { },
        onStop: typeof options.onStop === 'function' ? options.onStop : () => { }
      };

      const state = {
        sessionId: 0,
        navState: NAV_STATES.IDLE,
        active: false,
        arrived: false,
        arrivalNotified: false,
        consecutiveArrivalCount: 0,
        firstInsideAt: null,
        arrivalRecheckTimer: null,
        pausedByUser: false,
        watchId: null,
        syncIntervalId: null,
        staleGpsTimer: null,
        gpsRequestInFlight: false,
        gpsSeq: 0,
        latestAppliedGpsSeq: 0,
        lastPositionTimestamp: 0,
        isRouting: false,
        routeRequestSeq: 0,
        hasFittedInitialBounds: false,
        hasConfirmedFirstRoute: false,
        currentGps: null,
        destCoords: null,
        destId: null,
        lastRouteOrigin: null,
        lastRouteAttemptAt: 0,
        lastGpsAt: 0,
        routeCoords: [],
        routeData: null,
        listenersAttached: false
      };

      function setNavState(nextState, meta = {}) {
        // Once Arrived in the current session, no delayed callback can overwrite Arrived
        if (state.arrived && nextState !== NAV_STATES.ARRIVED) {
          return;
        }
        state.navState = nextState;
        cfg.onStatusChange(nextState, { ...meta, navState: nextState, state });
      }

      function clearStaleGpsWatchdog() {
        if (state.staleGpsTimer !== null) {
          clearTimeout(state.staleGpsTimer);
          state.staleGpsTimer = null;
        }
      }

      function clearArrivalRecheckTimer() {
        if (state.arrivalRecheckTimer !== null) {
          clearTimeout(state.arrivalRecheckTimer);
          state.arrivalRecheckTimer = null;
        }
      }

      function resetArrivalTracking() {
        clearArrivalRecheckTimer();
        state.consecutiveArrivalCount = 0;
        state.firstInsideAt = null;
      }

      function resetStaleGpsWatchdog() {
        clearStaleGpsWatchdog();
        if (!state.active || state.arrived) return;

        const sessionAtSchedule = state.sessionId;
        state.staleGpsTimer = setTimeout(() => {
          if (!state.active || state.arrived || state.sessionId !== sessionAtSchedule) return;
          resetArrivalTracking();
          const lastTime = state.lastGpsAt
            ? new Date(state.lastGpsAt).toLocaleTimeString('en-PH', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            })
            : 'never';
          setNavState(NAV_STATES.GPS_UNAVAILABLE, { isError: true, reason: 'STALE_GPS', lastGpsAt: state.lastGpsAt });
          cfg.onError(
            state.lastGpsAt
              ? `GPS signal lost — last update at ${lastTime}. Waiting for live coordinates...`
              : 'Waiting for initial GPS signal from device...',
            'STALE_GPS',
            true
          );
        }, cfg.staleTimeoutMs);
      }

      function scheduleArrivalRecheck() {
        clearArrivalRecheckTimer();
        if (!state.active || state.arrived || state.arrivalNotified) return;
        if (typeof navigator === 'undefined' || !navigator.geolocation) return;

        const sessionAtSchedule = state.sessionId;
        state.arrivalRecheckTimer = setTimeout(() => {
          state.arrivalRecheckTimer = null;
          if (!state.active || state.arrived || state.arrivalNotified || state.sessionId !== sessionAtSchedule) return;
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (!state.active || state.arrived || state.sessionId !== sessionAtSchedule) return;
              const seq = ++state.gpsSeq;
              state.latestAppliedGpsSeq = seq;
              handleGpsSuccess(pos, false, seq, sessionAtSchedule);
            },
            (err) => {
              if (!state.active || state.arrived || state.sessionId !== sessionAtSchedule) return;
              handleGpsError(err, sessionAtSchedule);
            },
            {
              enableHighAccuracy: true,
              timeout: 8000,
              maximumAge: 0
            }
          );
        }, cfg.arrivalRecheckIntervalMs);
      }

      function confirmArrival(gps, distMeters, sessionId) {
        if (state.arrived || state.arrivalNotified || sessionId !== state.sessionId) return;

        // Lock arrival state first so no in-flight or synchronous callback can overwrite it
        state.arrived = true;
        state.arrivalNotified = true;
        state.active = false;
        state.pausedByUser = false;
        state.isRouting = false;
        state.gpsRequestInFlight = false;

        // Invalidate all in-flight GPS and route sequence numbers
        state.routeRequestSeq += 1;
        state.gpsSeq += 1;
        state.latestAppliedGpsSeq = state.gpsSeq;

        // Stop 10s sync interval, watchPosition, timers, and lifecycle listeners immediately
        clearStaleGpsWatchdog();
        clearArrivalRecheckTimer();
        if (state.syncIntervalId !== null) {
          clearInterval(state.syncIntervalId);
          state.syncIntervalId = null;
        }
        if (state.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
          try {
            navigator.geolocation.clearWatch(state.watchId);
          } catch (_) { }
        }
        state.watchId = null;
        detachLifecycleListeners();

        // Clear active route geometry and guidance state
        state.routeCoords = [];
        state.routeData = null;

        cfg.onClearError();
        setNavState(NAV_STATES.ARRIVED, {
          isArrived: true,
          isSuccess: true,
          gps,
          distMeters
        });
        cfg.onArrival(gps, distMeters, state);
      }

      async function calculateAndDisplayRoute(originGps, forceRecalc = false) {
        const sessionAtStart = state.sessionId;
        if (!state.active || state.arrived || !state.destCoords || !originGps) return;
        if (state.isRouting && !forceRecalc) return;

        const hadValidRoute = Array.isArray(state.routeCoords) && state.routeCoords.length >= 2;
        const reqSeq = ++state.routeRequestSeq;
        state.isRouting = true;
        state.lastRouteAttemptAt = Date.now();
        state.lastRouteOrigin = { lat: originGps.lat, lng: originGps.lng };
        setNavState(NAV_STATES.RECALCULATING_ROUTE, {
          isRouting: true,
          hadValidRoute
        });

        try {
          const route = await cfg.routeFn(originGps, state.destCoords);
          // Discard delayed route response if stopped, arrived, confirming arrival inside radius, session changed, or superseded
          if (
            !state.active ||
            state.arrived ||
            state.consecutiveArrivalCount > 0 ||
            state.navState === NAV_STATES.ARRIVED ||
            sessionAtStart !== state.sessionId ||
            reqSeq !== state.routeRequestSeq
          ) {
            return;
          }

          state.routeData = route;
          state.routeCoords = Array.isArray(route.coordinates) ? route.coordinates : [];
          const isInitialRoute = !state.hasConfirmedFirstRoute;
          state.hasConfirmedFirstRoute = true;
          state.hasFittedInitialBounds = true;

          cfg.onClearError();
          cfg.onRouteCalculated(route, state.currentGps || originGps, isInitialRoute, state);
          setNavState(NAV_STATES.NAVIGATING);
        } catch (err) {
          if (
            !state.active ||
            state.arrived ||
            state.navState === NAV_STATES.ARRIVED ||
            sessionAtStart !== state.sessionId ||
            reqSeq !== state.routeRequestSeq
          ) {
            return;
          }
          if (hadValidRoute) {
            setNavState(NAV_STATES.NAVIGATING, { isWarning: true, routeDelayed: true });
            cfg.onError(
              'Temporary routing or network interruption — retaining last valid road route.',
              'ROUTE_DELAYED',
              true
            );
          } else {
            setNavState(NAV_STATES.RECALCULATING_ROUTE, { isError: true, routeUnavailable: true });
            cfg.onError(
              (err && err.message) || 'Unable to calculate a road route right now.',
              'ROUTE_UNAVAILABLE',
              true
            );
          }
        } finally {
          if (reqSeq === state.routeRequestSeq && sessionAtStart === state.sessionId) {
            state.isRouting = false;
            if (state.active && !state.arrived && state.currentGps && state.lastRouteOrigin) {
              const movedDuringRoute = computeHaversineMeters(state.currentGps, state.lastRouteOrigin);
              if (movedDuringRoute > cfg.watchMoveThresholdMeters) {
                calculateAndDisplayRoute(state.currentGps);
              }
            }
          }
        }
      }

      function handleGpsSuccess(position, isCycleSync = false, seq = 0, sessionId = state.sessionId) {
        if (
          !state.active ||
          state.arrived ||
          state.navState === NAV_STATES.ARRIVED ||
          sessionId !== state.sessionId ||
          !position ||
          !position.coords
        ) {
          return;
        }

        // Ignore outdated GPS callbacks when a newer sequence or timestamp (> 5s older) was already processed
        if (seq > 0 && seq < state.latestAppliedGpsSeq) return;
        const posTimestamp = Number(position.timestamp) || Date.now();
        if (state.lastPositionTimestamp > 0 && posTimestamp < state.lastPositionTimestamp - 5000) {
          return;
        }

        const lat = Number(position.coords.latitude);
        const lng = Number(position.coords.longitude);
        const accuracy = Number(position.coords.accuracy);
        const heading = Number(position.coords.heading);
        const speed = Number(position.coords.speed);

        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lng) ||
          Math.abs(lat) > 90 ||
          Math.abs(lng) > 180 ||
          (lat === 0 && lng === 0)
        ) {
          resetArrivalTracking();
          setNavState(NAV_STATES.GPS_UNAVAILABLE, { isError: true, reason: 'INVALID_GPS' });
          cfg.onError('Received invalid GPS coordinates from device.', 'INVALID_GPS', true);
          return;
        }

        const now = Date.now();
        state.lastPositionTimestamp = Math.max(state.lastPositionTimestamp, posTimestamp);
        state.lastGpsAt = now;
        resetStaleGpsWatchdog();

        // Reject severely inaccurate fixes (> 1000m) to avoid misleading routing or false arrival
        if (Number.isFinite(accuracy) && accuracy > cfg.maxAccuracyMeters) {
          resetArrivalTracking();
          setNavState(NAV_STATES.GPS_UNAVAILABLE, { isError: true, reason: 'INACCURATE_GPS', accuracy, updatedAt: now });
          cfg.onError(
            `GPS accuracy is currently insufficient (±${Math.round(accuracy)}m). Move to an open area and retry.`,
            'INACCURATE_GPS',
            true
          );
          return;
        }

        const gps = {
          lat,
          lng,
          accuracy: Number.isFinite(accuracy) ? accuracy : null,
          heading: Number.isFinite(heading) ? heading : null,
          speed: Number.isFinite(speed) ? speed : null,
          timestamp: now
        };
        state.currentGps = gps;
        cfg.onGpsUpdate(gps, isCycleSync, state);

        // Reliable Arrival Detection:
        // 1. Validate against active session's destination coordinates
        // 2. Require valid GPS accuracy (0 < accuracy <= arrivalMaxAccuracyMeters)
        // 3. Require consecutive valid GPS readings within arrivalRadiusMeters
        if (state.destCoords) {
          const distToDest = computeHaversineMeters(gps, state.destCoords);
          const accuracyValidForArrival =
            !Number.isFinite(accuracy) || (accuracy > 0 && accuracy <= cfg.arrivalMaxAccuracyMeters);

          if (Number.isFinite(distToDest) && distToDest <= cfg.arrivalRadiusMeters) {
            if (accuracyValidForArrival) {
              state.consecutiveArrivalCount += 1;
              if (!state.firstInsideAt) {
                state.firstInsideAt = now;
              }
              if (state.consecutiveArrivalCount >= cfg.consecutiveArrivalReadingsRequired) {
                confirmArrival(gps, distToDest, sessionId);
                return;
              }
              // Schedule a fresh high-accuracy GPS recheck to confirm consecutive arrival reading
              // and do NOT calculate or draw a tiny route while already inside the arrival radius
              scheduleArrivalRecheck();
              return;
            } else {
              // Inside radius but GPS accuracy is too coarse (> 150m): do not confirm arrival yet
              clearArrivalRecheckTimer();
            }
          } else {
            // Outside arrival proximity threshold: reset consecutive arrival readings
            resetArrivalTracking();
          }
        }

        if (!state.active || state.arrived) return;

        const hasRoute = Array.isArray(state.routeCoords) && state.routeCoords.length >= 2;
        const offRouteMeters = hasRoute
          ? GeoSafeMapping.pointToRouteDistanceMeters(gps, state.routeCoords)
          : Infinity;
        const movedFromLastOrigin = state.lastRouteOrigin
          ? computeHaversineMeters(gps, state.lastRouteOrigin)
          : Infinity;

        const accuracyOkForRoute = !Number.isFinite(accuracy) || accuracy <= cfg.routeAccuracyMaxMeters;
        const cooldownElapsed = now - state.lastRouteAttemptAt >= cfg.routeCooldownMs;

        if (!hasRoute && (state.lastRouteAttemptAt === 0 || cooldownElapsed)) {
          calculateAndDisplayRoute(gps);
        } else if (
          isCycleSync &&
          hasRoute &&
          accuracyOkForRoute &&
          (movedFromLastOrigin >= cfg.cycleMoveThresholdMeters || offRouteMeters > cfg.offRouteThresholdMeters)
        ) {
          calculateAndDisplayRoute(gps);
        } else if (
          hasRoute &&
          accuracyOkForRoute &&
          (offRouteMeters > cfg.offRouteThresholdMeters || movedFromLastOrigin > cfg.watchMoveThresholdMeters) &&
          cooldownElapsed
        ) {
          calculateAndDisplayRoute(gps);
        } else if (hasRoute) {
          cfg.onClearError();
          setNavState(NAV_STATES.NAVIGATING);
          cfg.onRouteProgress(state.routeData, gps, state);
        }
      }

      function handleGpsError(err, sessionId = state.sessionId) {
        if (!state.active || state.arrived || state.navState === NAV_STATES.ARRIVED || sessionId !== state.sessionId) {
          return;
        }
        resetArrivalTracking();
        let msg = 'Unable to retrieve your current GPS location.';
        let code = 'GPS_ERROR';
        const isInsecure =
          typeof window !== 'undefined' &&
          window.isSecureContext === false &&
          window.location &&
          window.location.hostname !== 'localhost' &&
          window.location.hostname !== '127.0.0.1';

        if (isInsecure || (err && err.code === 'INSECURE_CONTEXT_LAN')) {
          msg = 'Browser blocked GPS because this page is not running in a secure HTTPS context (or localhost).';
          code = 'HTTPS_REQUIRED';
          setNavState(NAV_STATES.GPS_UNAVAILABLE, { isError: true, reason: code });
          cfg.onError(msg, code, false);
          return;
        }

        if (err) {
          if (err.code === 1) {
            msg = 'GPS location permission was denied. Please enable location access in your browser settings and retry.';
            code = 'PERMISSION_DENIED';
            setNavState(NAV_STATES.GPS_UNAVAILABLE, { isError: true, reason: code });
            cfg.onError(msg, code, true);
            return;
          } else if (err.code === 2) {
            msg = 'GPS position is currently unavailable. Check device location services and retry.';
            code = 'POSITION_UNAVAILABLE';
          } else if (err.code === 3) {
            msg = 'GPS location request timed out. Please retry.';
            code = 'TIMEOUT';
          } else if (err.message) {
            msg = err.message;
          }
        }
        setNavState(NAV_STATES.GPS_UNAVAILABLE, { isError: true, reason: code });
        cfg.onError(msg, code, true);
      }

      function runTenSecondNavigationSync() {
        if (!state.active || state.arrived || state.navState === NAV_STATES.ARRIVED || !state.destCoords) return;
        if (typeof document !== 'undefined' && document.hidden) return;
        if (typeof navigator === 'undefined' || !navigator.geolocation) return;
        if (state.gpsRequestInFlight) return;

        const sessionAtSync = state.sessionId;
        state.gpsRequestInFlight = true;
        if (!state.hasConfirmedFirstRoute) {
          setNavState(NAV_STATES.REQUESTING_LOCATION, { isSyncing: true });
        }

        navigator.geolocation.getCurrentPosition(
          (position) => {
            state.gpsRequestInFlight = false;
            if (!state.active || state.arrived || state.sessionId !== sessionAtSync) return;
            const seq = ++state.gpsSeq;
            state.latestAppliedGpsSeq = seq;
            handleGpsSuccess(position, true, seq, sessionAtSync);
          },
          (err) => {
            state.gpsRequestInFlight = false;
            if (!state.active || state.arrived || state.sessionId !== sessionAtSync) return;
            handleGpsError(err, sessionAtSync);
          },
          {
            enableHighAccuracy: true,
            timeout: 9000,
            maximumAge: 0
          }
        );
      }

      function onVisibilityChange() {
        if (!state.active || state.arrived) return;
        if (typeof document !== 'undefined' && !document.hidden) {
          runTenSecondNavigationSync();
        }
      }

      function onOnline() {
        if (!state.active || state.arrived) return;
        runTenSecondNavigationSync();
        if (state.currentGps && state.destCoords && (!state.routeCoords || state.routeCoords.length < 2)) {
          calculateAndDisplayRoute(state.currentGps, true);
        }
      }

      function attachLifecycleListeners() {
        if (state.listenersAttached) return;
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', onVisibilityChange);
        }
        if (typeof window !== 'undefined') {
          window.addEventListener('online', onOnline);
        }
        state.listenersAttached = true;
      }

      function detachLifecycleListeners() {
        if (!state.listenersAttached) return;
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', onVisibilityChange);
        }
        if (typeof window !== 'undefined') {
          window.removeEventListener('online', onOnline);
        }
        state.listenersAttached = false;
      }

      function stop({ clearRoute = true, userPaused = false, preserveArrived = false } = {}) {
        clearStaleGpsWatchdog();
        clearArrivalRecheckTimer();
        if (state.syncIntervalId !== null) {
          clearInterval(state.syncIntervalId);
          state.syncIntervalId = null;
        }
        if (state.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
          try {
            navigator.geolocation.clearWatch(state.watchId);
          } catch (_) { }
        }
        state.watchId = null;
        state.active = false;
        state.pausedByUser = Boolean(userPaused);
        state.isRouting = false;
        state.gpsRequestInFlight = false;
        state.routeRequestSeq += 1;
        state.gpsSeq += 1;
        state.latestAppliedGpsSeq = state.gpsSeq;
        state.hasFittedInitialBounds = false;
        state.hasConfirmedFirstRoute = false;
        state.lastRouteOrigin = null;
        state.lastRouteAttemptAt = 0;
        state.lastGpsAt = 0;
        state.consecutiveArrivalCount = 0;
        state.firstInsideAt = null;
        detachLifecycleListeners();

        if (!preserveArrived) {
          state.arrived = false;
          state.arrivalNotified = false;
        }

        if (clearRoute) {
          state.routeCoords = [];
          state.routeData = null;
        }
        if (!preserveArrived) {
          if (userPaused) {
            setNavState(NAV_STATES.NAVIGATION_STOPPED, { isPaused: true });
          } else {
            state.navState = NAV_STATES.IDLE;
          }
        }
        cfg.onStop({ clearRoute, userPaused, preserveArrived, state });
      }

      function start(destCoords, destMeta = {}) {
        const lat = Number(destCoords && destCoords.lat);
        const lng = Number(destCoords && destCoords.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
          setNavState(NAV_STATES.NAVIGATION_STOPPED, { isError: true, reason: 'INVALID_DEST' });
          cfg.onError('Destination coordinates are missing or invalid.', 'INVALID_DEST', false);
          return false;
        }

        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          setNavState(NAV_STATES.GPS_UNAVAILABLE, { isError: true, reason: 'UNSUPPORTED' });
          cfg.onError('Your browser does not support GPS geolocation.', 'UNSUPPORTED', false);
          return false;
        }

        const isInsecureLan =
          typeof window !== 'undefined' &&
          window.isSecureContext === false &&
          window.location &&
          window.location.hostname !== 'localhost' &&
          window.location.hostname !== '127.0.0.1';
        if (isInsecureLan || (typeof window !== 'undefined' && window.isSecureContext === false)) {
          setNavState(NAV_STATES.GPS_UNAVAILABLE, { isError: true, reason: 'HTTPS_REQUIRED' });
          cfg.onError(
            'Browser blocked geolocation because this page is not running in a secure HTTPS context (or localhost).',
            'HTTPS_REQUIRED',
            false
          );
          return false;
        }

        // Cleanly stop any previous session and initialize a brand-new session
        stop({ clearRoute: true, userPaused: false, preserveArrived: false });
        state.sessionId += 1;
        const currentSessionId = state.sessionId;
        state.destCoords = { lat, lng };
        state.destId = destMeta && destMeta.id !== undefined ? destMeta.id : null;
        state.active = true;
        state.arrived = false;
        state.arrivalNotified = false;
        state.consecutiveArrivalCount = 0;
        state.firstInsideAt = null;
        state.pausedByUser = false;
        state.hasFittedInitialBounds = false;
        state.hasConfirmedFirstRoute = false;
        state.lastRouteAttemptAt = 0;
        state.lastGpsAt = 0;
        state.lastPositionTimestamp = 0;
        state.currentGps = null;

        attachLifecycleListeners();
        cfg.onClearError();
        setNavState(NAV_STATES.REQUESTING_LOCATION, { isAcquiring: true });
        resetStaleGpsWatchdog();

        state.watchId = navigator.geolocation.watchPosition(
          (pos) => {
            if (!state.active || state.arrived || state.sessionId !== currentSessionId) return;
            const seq = ++state.gpsSeq;
            state.latestAppliedGpsSeq = seq;
            handleGpsSuccess(pos, false, seq, currentSessionId);
          },
          (err) => handleGpsError(err, currentSessionId),
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
          }
        );

        // Immediate initial GPS & route sync + automatic 10-second live synchronization cycle
        runTenSecondNavigationSync();
        state.syncIntervalId = setInterval(runTenSecondNavigationSync, cfg.syncIntervalMs);
        return true;
      }

      function setDestination(destCoords, { recalculate = true, destId = null } = {}) {
        const lat = Number(destCoords && destCoords.lat);
        const lng = Number(destCoords && destCoords.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return false;

        // If switching destination after arrival or during active navigation, reset arrival state
        resetArrivalTracking();
        state.arrived = false;
        state.arrivalNotified = false;
        state.destCoords = { lat, lng };
        state.destId = destId;
        state.routeCoords = [];
        state.routeData = null;
        state.lastRouteOrigin = null;
        state.lastRouteAttemptAt = 0;
        state.hasFittedInitialBounds = false;
        state.hasConfirmedFirstRoute = false;
        state.routeRequestSeq += 1;
        state.isRouting = false;

        if (state.active && recalculate) {
          if (state.currentGps) {
            calculateAndDisplayRoute(state.currentGps, true);
          } else {
            runTenSecondNavigationSync();
          }
        }
        return true;
      }

      function retry() {
        if (!state.destCoords) return;
        if (!state.active || state.arrived) {
          start(state.destCoords, { id: state.destId });
          return;
        }
        cfg.onClearError();
        state.lastRouteAttemptAt = 0;
        if (state.currentGps) {
          calculateAndDisplayRoute(state.currentGps, true);
        }
        runTenSecondNavigationSync();
      }

      return {
        start,
        stop,
        setDestination,
        syncNow: runTenSecondNavigationSync,
        retry,
        recalculateRoute: () => {
          if (state.active && !state.arrived && state.currentGps && state.destCoords) {
            state.lastRouteAttemptAt = 0;
            calculateAndDisplayRoute(state.currentGps, true);
          }
        },
        getState: () => state
      };
    },

    /**
     * Normalize any heading angle into [0, 360) degrees; returns null if invalid.
     */
    normalizeHeading(deg) {
      if (deg === null || deg === undefined || deg === '') return null;
      const n = Number(deg);
      if (!Number.isFinite(n)) return null;
      return ((n % 360) + 360) % 360;
    },

    /**
     * Compute continuous wrapped angle so CSS rotation takes the shortest path across 0/360.
     */
    computeContinuousAngle(prevContinuous, nextNormalized, smoothingAlpha = 0.35) {
      if (!Number.isFinite(nextNormalized)) return prevContinuous;
      if (!Number.isFinite(prevContinuous)) return nextNormalized;
      const prevNorm = ((prevContinuous % 360) + 360) % 360;
      let delta = nextNormalized - prevNorm;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      const alpha = Number.isFinite(smoothingAlpha) ? Math.min(1, Math.max(0.05, smoothingAlpha)) : 0.35;
      return prevContinuous + delta * alpha;
    },

    getScreenOrientationAngle() {
      if (typeof window === 'undefined') return 0;
      if (window.screen && window.screen.orientation && Number.isFinite(Number(window.screen.orientation.angle))) {
        return Number(window.screen.orientation.angle);
      }
      if (Number.isFinite(Number(window.orientation))) {
        return Number(window.orientation);
      }
      return 0;
    },

    /**
     * Extract genuine tilt-compensated geographic compass heading (0-360° clockwise from North)
     * from DeviceOrientationEvent. Returns { heading, rawHeading, absoluteAvailable, source } or null.
     */
    extractCompassReading(event) {
      if (!event) return null;
      const screenAngle = GeoSafeMapping.getScreenOrientationAngle();

      // 1. iOS Safari provides webkitCompassHeading directly (clockwise from Magnetic/True North)
      if (typeof event.webkitCompassHeading === 'number' && Number.isFinite(event.webkitCompassHeading) && event.webkitCompassHeading >= 0) {
        const raw = Number(event.webkitCompassHeading);
        const heading = GeoSafeMapping.normalizeHeading(raw);
        return {
          heading,
          rawHeading: raw,
          absoluteAvailable: true,
          source: 'webkitCompassHeading',
        };
      }

      // 2. Standard W3C absolute orientation (Android Chrome deviceorientationabsolute / absolute === true)
      const isAbsolute = event.type === 'deviceorientationabsolute' || event.absolute === true;
      const hasAlpha = typeof event.alpha === 'number' && Number.isFinite(event.alpha);
      if (!hasAlpha) return null;

      if (!isAbsolute) {
        return {
          heading: null,
          rawHeading: Number(event.alpha),
          absoluteAvailable: false,
          source: 'relative-only',
        };
      }

      const deg2rad = Math.PI / 180;
      const a = Number(event.alpha) * deg2rad;
      const b = Number.isFinite(Number(event.beta)) ? Number(event.beta) * deg2rad : 0;
      const g = Number.isFinite(Number(event.gamma)) ? Number(event.gamma) * deg2rad : 0;

      const cA = Math.cos(a), sA = Math.sin(a);
      const cB = Math.cos(b), sB = Math.sin(b);
      const cG = Math.cos(g), sG = Math.sin(g);

      let east = 0;
      let north = 0;
      const absBetaDeg = Math.abs(Number(event.beta) || 0);
      if (absBetaDeg <= 75) {
        // Project device top edge (+Y) onto horizontal East-North plane
        east = -sA * cB;
        north = cA * cB;
      } else {
        // Device held upright/past vertical: project device back (-Z) onto horizontal plane
        east = -cA * sG - sA * sB * cG;
        north = -sA * sG + cA * sB * cG;
      }

      let headingRad = Math.atan2(east, north);
      if (headingRad < 0) headingRad += 2 * Math.PI;
      const heading = GeoSafeMapping.normalizeHeading(headingRad * (180 / Math.PI) + screenAngle);

      return {
        heading,
        rawHeading: Number(event.alpha),
        absoluteAvailable: true,
        source: event.type || 'deviceorientation',
      };
    },

    extractCompassHeading(event) {
      const parsed = GeoSafeMapping.extractCompassReading(event);
      return parsed && parsed.absoluteAvailable ? parsed.heading : null;
    },

    _getCompassHub() {
      if (!window.__geosafeCompassHub) {
        window.__geosafeCompassHub = {
          listening: false,
          supported: typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined',
          permissionState: (typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined' && typeof window.DeviceOrientationEvent.requestPermission === 'function')
            ? 'unknown'
            : (typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined' ? 'not_required' : 'unsupported'),
          sensorEventReceived: false,
          absoluteAvailable: false,
          rawCompassHeading: null,
          rawHeading: null,
          continuousHeading: null,
          appliedRotationDeg: null,
          lastGpsHeading: null,
          lastEventAt: 0,
          unavailableReason: '',
          subscribers: new Set(),
          diagSubscribers: new Set(),
          handler: null,
          gestureHookBound: false,
          cleanupBound: false,
        };
      }
      return window.__geosafeCompassHub;
    },

    getCompassStatus() {
      const hub = GeoSafeMapping._getCompassHub();
      let reason = hub.unavailableReason || '';
      if (!reason) {
        if (!hub.supported) {
          reason = 'DeviceOrientationEvent API not supported by this browser.';
        } else if (hub.permissionState === 'denied') {
          reason = 'Compass permission denied by user or browser policy.';
        } else if (hub.permissionState === 'unknown') {
          reason = 'Tap Location or anywhere on the map to grant iOS compass permission.';
        } else if (!hub.sensorEventReceived) {
          reason = 'Waiting for device orientation sensor event (desktop/device may lack magnetometer).';
        } else if (!hub.absoluteAvailable) {
          reason = 'Device only emitted relative orientation (no absolute north-referenced compass).';
        }
      }
      return {
        supported: hub.supported,
        permissionState: hub.permissionState,
        sensorEventReceived: hub.sensorEventReceived,
        absoluteAvailable: hub.absoluteAvailable,
        rawCompassHeading: hub.rawCompassHeading,
        hasHeading: Number.isFinite(hub.rawHeading),
        heading: hub.rawHeading,
        continuousHeading: hub.continuousHeading,
        appliedRotationDeg: hub.appliedRotationDeg,
        lastGpsHeading: hub.lastGpsHeading,
        lastEventAt: hub.lastEventAt,
        reason,
      };
    },

    _notifyCompassDiagnostics() {
      const hub = GeoSafeMapping._getCompassHub();
      if (!hub.diagSubscribers || hub.diagSubscribers.size === 0) return;
      const status = GeoSafeMapping.getCompassStatus();
      hub.diagSubscribers.forEach((cb) => {
        try { cb(status); } catch (_) { }
      });
    },

    async requestCompassPermission() {
      const hub = GeoSafeMapping._getCompassHub();
      if (typeof window === 'undefined' || typeof window.DeviceOrientationEvent === 'undefined') {
        hub.supported = false;
        hub.permissionState = 'unsupported';
        GeoSafeMapping._notifyCompassDiagnostics();
        return 'unsupported';
      }
      if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
        try {
          const result = await window.DeviceOrientationEvent.requestPermission();
          hub.permissionState = result === 'granted' ? 'granted' : 'denied';
          if (hub.permissionState === 'granted' && hub.subscribers.size > 0) {
            GeoSafeMapping._ensureCompassListeners();
          }
          GeoSafeMapping._notifyCompassDiagnostics();
          return hub.permissionState;
        } catch (_) {
          hub.permissionState = 'denied';
          GeoSafeMapping._notifyCompassDiagnostics();
          return 'denied';
        }
      }
      hub.permissionState = 'not_required';
      if (hub.subscribers.size > 0) {
        GeoSafeMapping._ensureCompassListeners();
      }
      GeoSafeMapping._notifyCompassDiagnostics();
      return 'not_required';
    },

    _bindGesturePermissionHook() {
      const hub = GeoSafeMapping._getCompassHub();
      if (hub.gestureHookBound || typeof document === 'undefined') return;
      if (typeof window === 'undefined' || typeof window.DeviceOrientationEvent === 'undefined') return;
      if (typeof window.DeviceOrientationEvent.requestPermission !== 'function') return;
      if (hub.permissionState !== 'unknown') return;

      hub.gestureHookBound = true;
      const onFirstGesture = () => {
        document.removeEventListener('pointerdown', onFirstGesture, true);
        document.removeEventListener('touchend', onFirstGesture, true);
        document.removeEventListener('click', onFirstGesture, true);
        hub.gestureHookBound = false;
        if (hub.permissionState === 'unknown') {
          GeoSafeMapping.requestCompassPermission().catch(() => {});
        }
      };
      document.addEventListener('pointerdown', onFirstGesture, { capture: true, passive: true });
      document.addEventListener('touchend', onFirstGesture, { capture: true, passive: true });
      document.addEventListener('click', onFirstGesture, { capture: true, passive: true });
    },

    _ensureCompassListeners() {
      const hub = GeoSafeMapping._getCompassHub();
      if (hub.listening || typeof window === 'undefined') return;
      if (typeof window.DeviceOrientationEvent === 'undefined') {
        hub.supported = false;
        hub.permissionState = 'unsupported';
        GeoSafeMapping._notifyCompassDiagnostics();
        return;
      }
      // iOS 13+ requires explicit user gesture before DeviceOrientationEvent.requestPermission()
      if (typeof window.DeviceOrientationEvent.requestPermission === 'function' && hub.permissionState !== 'granted') {
        GeoSafeMapping._bindGesturePermissionHook();
        GeoSafeMapping._notifyCompassDiagnostics();
        return;
      }
      if (hub.permissionState === 'unknown') {
        hub.permissionState = 'not_required';
      }

      let lastNotifyAt = 0;
      let lastNotifiedContinuous = null;
      let lastDiagAt = 0;
      hub.handler = (event) => {
        const now = Date.now();
        hub.sensorEventReceived = true;
        const parsed = GeoSafeMapping.extractCompassReading(event);
        if (parsed) {
          hub.rawCompassHeading = parsed.rawHeading;
          if (parsed.absoluteAvailable && parsed.heading !== null) {
            hub.absoluteAvailable = true;
            hub.unavailableReason = '';
            hub.rawHeading = parsed.heading;
            hub.lastEventAt = now;
            hub.continuousHeading = GeoSafeMapping.computeContinuousAngle(hub.continuousHeading, parsed.heading, 0.35);

            const diff = lastNotifiedContinuous === null ? Infinity : Math.abs(hub.continuousHeading - lastNotifiedContinuous);
            if (now - lastNotifyAt >= 50 || diff >= 1.5) {
              lastNotifyAt = now;
              lastNotifiedContinuous = hub.continuousHeading;
              hub.subscribers.forEach((cb) => {
                try {
                  cb({
                    heading: hub.rawHeading,
                    continuousHeading: hub.continuousHeading,
                    source: 'compass',
                    updatedAt: now,
                  });
                } catch (_) { }
              });
            }
          }
        }
        if (now - lastDiagAt >= 150) {
          lastDiagAt = now;
          GeoSafeMapping._notifyCompassDiagnostics();
        }
      };

      let hasAbsoluteListener = false;
      if ('ondeviceorientationabsolute' in window) {
        window.addEventListener('deviceorientationabsolute', hub.handler, true);
        hasAbsoluteListener = true;
        // Fallback to standard deviceorientation only if absolute events never arrive
        setTimeout(() => {
          if (hub.listening && !hub.absoluteAvailable && hub.handler) {
            window.addEventListener('deviceorientation', hub.handler, true);
          }
        }, 1500);
      } else {
        window.addEventListener('deviceorientation', hub.handler, true);
      }
      hub.listening = true;
      hub._hasAbsoluteListener = hasAbsoluteListener;

      if (!hub.cleanupBound) {
        hub.cleanupBound = true;
        const stopAll = () => GeoSafeMapping._teardownCompassListeners();
        window.addEventListener('pagehide', stopAll);
        window.addEventListener('beforeunload', stopAll);
        window.addEventListener('geosafe:logout', stopAll);
      }
      GeoSafeMapping._notifyCompassDiagnostics();
    },

    _teardownCompassListeners() {
      const hub = GeoSafeMapping._getCompassHub();
      if (!hub.listening || typeof window === 'undefined' || !hub.handler) return;
      try { window.removeEventListener('deviceorientationabsolute', hub.handler, true); } catch (_) { }
      try { window.removeEventListener('deviceorientation', hub.handler, true); } catch (_) { }
      hub.listening = false;
      hub.handler = null;
    },

    subscribeCompassHeading(callback) {
      if (typeof callback !== 'function') return () => { };
      const hub = GeoSafeMapping._getCompassHub();
      hub.subscribers.add(callback);
      GeoSafeMapping._ensureCompassListeners();
      if (Number.isFinite(hub.rawHeading)) {
        try {
          callback({
            heading: hub.rawHeading,
            continuousHeading: hub.continuousHeading,
            source: 'compass',
            updatedAt: hub.lastEventAt || Date.now(),
          });
        } catch (_) { }
      }
      return () => {
        hub.subscribers.delete(callback);
        if (hub.subscribers.size === 0) {
          GeoSafeMapping._teardownCompassListeners();
        }
      };
    },

    getMapBearing(map) {
      if (map && typeof map.getBearing === 'function') {
        const b = Number(map.getBearing());
        return Number.isFinite(b) ? b : 0;
      }
      return 0;
    },

    /**
     * Update an existing Leaflet user marker's directional arrow in-place without recreating the marker.
     * Accounts for map bearing so the arrow points in the true geographic direction.
     */
    updateGpsMarkerHeading(marker, headingDeg, continuousAngleDeg = null, map = null) {
      if (!marker || typeof marker.getElement !== 'function') return false;
      const el = marker.getElement();
      if (!el) return false;
      const rotator = el.querySelector('.geosafe-gps-arrow-rotator');
      const dot = el.querySelector('.geosafe-gps-no-heading-dot');
      if (!rotator) return false;
      const norm = GeoSafeMapping.normalizeHeading(headingDeg);
      const hub = GeoSafeMapping._getCompassHub();
      if (norm === null) {
        rotator.setAttribute('data-has-heading', 'false');
        rotator.style.display = 'none';
        if (dot) dot.style.display = 'block';
        hub.appliedRotationDeg = null;
        return false;
      }
      const baseAngle = Number.isFinite(Number(continuousAngleDeg)) ? Number(continuousAngleDeg) : norm;
      const mapBearing = GeoSafeMapping.getMapBearing(map || marker._map);
      const appliedAngle = baseAngle - mapBearing;
      rotator.setAttribute('data-has-heading', 'true');
      rotator.style.display = 'flex';
      if (dot) dot.style.display = 'none';
      rotator.style.transform = `rotate(${appliedAngle.toFixed(1)}deg)`;
      hub.appliedRotationDeg = GeoSafeMapping.normalizeHeading(appliedAngle);
      return true;
    },

    isGpsDebugMode() {
      if (typeof window === 'undefined') return false;
      try {
        const params = new URLSearchParams(window.location.search || '');
        if (params.get('debug') === 'gps' || params.get('gpsDebug') === '1') return true;
        if (window.localStorage && window.localStorage.getItem('geosafe_gps_debug') === '1') return true;
      } catch (_) { }
      const host = String(window.location && window.location.hostname || '').toLowerCase();
      return host === 'localhost' || host === '127.0.0.1';
    },

    attachCompassDiagnosticsPanel(map) {
      if (!map || typeof map.getContainer !== 'function' || !GeoSafeMapping.isGpsDebugMode()) return;
      const container = map.getContainer();
      if (!container || container.querySelector('.geosafe-gps-diagnostics')) return;

      const panel = document.createElement('div');
      panel.className = 'geosafe-gps-diagnostics';
      panel.style.cssText = 'position:absolute;bottom:8px;left:8px;z-index:800;background:rgba(16,29,53,0.9);color:#F8FAFC;font-size:10px;line-height:1.35;padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.18);max-width:255px;pointer-events:auto;font-family:monospace;';
      container.appendChild(panel);

      const renderDiag = (s) => {
        const permLabel = s.permissionState === 'granted'
          ? 'Granted'
          : s.permissionState === 'denied'
            ? 'Denied'
            : s.permissionState === 'not_required'
              ? 'Not required'
              : s.permissionState === 'unsupported'
                ? 'Unsupported'
                : 'Prompt pending';
        const lastTime = s.lastEventAt ? new Date(s.lastEventAt).toLocaleTimeString() : 'None';
        panel.innerHTML = `
          <div style="font-weight:700;color:#60A5FA;margin-bottom:2px;">GPS &amp; Compass Diagnostics</div>
          <div>Orientation API: <b>${s.supported ? 'Yes' : 'No'}</b></div>
          <div>Compass permission: <b>${permLabel}</b></div>
          <div>Sensor event received: <b>${s.sensorEventReceived ? 'Yes' : 'No'}</b></div>
          <div>Absolute orientation: <b>${s.absoluteAvailable ? 'Yes' : 'No'}</b></div>
          <div>Raw compass heading: <b>${s.rawCompassHeading !== null ? `${s.rawCompassHeading.toFixed(1)}°` : 'N/A'}</b></div>
          <div>Calculated geo heading: <b>${s.heading !== null ? `${s.heading.toFixed(1)}°` : 'N/A'}</b></div>
          <div>Last sensor update: <b>${lastTime}</b></div>
          <div>Current GPS heading: <b>${s.lastGpsHeading !== null ? `${s.lastGpsHeading.toFixed(1)}°` : 'N/A'}</b></div>
          <div>Marker rotation: <b>${s.appliedRotationDeg !== null ? `${s.appliedRotationDeg.toFixed(1)}°` : 'N/A'}</b></div>
          ${!s.hasHeading && s.reason ? `<div style="color:#FBBF24;margin-top:2px;">${s.reason}</div>` : ''}
        `;
      };

      const hub = GeoSafeMapping._getCompassHub();
      hub.diagSubscribers.add(renderDiag);
      renderDiag(GeoSafeMapping.getCompassStatus());

      if (typeof map.once === 'function') {
        map.once('unload', () => {
          hub.diagSubscribers.delete(renderDiag);
        });
      }
    },

    /**
     * Resolve genuine heading from live compass first, falling back to GPS movement heading ONLY when moving.
     */
    resolveHeadingForReading(reading, markerState = null) {
      const hub = GeoSafeMapping._getCompassHub();
      const gpsHeading = reading ? GeoSafeMapping.normalizeHeading(reading.heading) : null;
      hub.lastGpsHeading = gpsHeading;
      const compassFresh = Number.isFinite(hub.rawHeading) && (Date.now() - hub.lastEventAt < 15000);
      if (compassFresh) {
        return {
          heading: hub.rawHeading,
          continuousHeading: hub.continuousHeading,
          source: 'compass',
        };
      }
      // Fallback to GPS coords.heading ONLY when moving (>= 0.8 m/s) and valid [0, 360]
      const gpsSpeed = reading && Number.isFinite(Number(reading.speed)) ? Number(reading.speed) : null;
      const isMoving = gpsSpeed !== null && gpsSpeed >= 0.8;
      if (gpsHeading !== null && isMoving) {
        const prevCont = markerState && Number.isFinite(markerState.continuousHeading) ? markerState.continuousHeading : null;
        const cont = GeoSafeMapping.computeContinuousAngle(prevCont, gpsHeading, 0.5);
        return {
          heading: gpsHeading,
          continuousHeading: cont,
          source: 'gps-movement',
        };
      }
      return { heading: null, continuousHeading: null, source: 'none' };
    },

    /**
     * Render or smoothly update a live GPS marker + accuracy ring + directional heading arrow on any Leaflet map
     * without rebuilding the map or destroying layers unnecessarily.
     *
     * @param {L.Map} map
     * @param {{ marker: L.Marker|null, accuracyCircle: L.Circle|null, continuousHeading?: number|null }} markerState
     * @param {{ lat: number, lng: number, accuracy?: number|null, heading?: number|null, speed?: number|null, updatedAt?: number, isStale?: boolean }} reading
     * @param {{ title?: string, zIndexOffset?: number, openPopup?: boolean }} options
     */
    renderLiveGpsMarker(map, markerState, reading, options = {}) {
      if (!map || !markerState || !reading || !Number.isFinite(Number(reading.lat)) || !Number.isFinite(Number(reading.lng))) {
        return;
      }
      const lat = Number(reading.lat);
      const lng = Number(reading.lng);
      const accuracy = Number.isFinite(Number(reading.accuracy)) && Number(reading.accuracy) > 0 ? Number(reading.accuracy) : null;
      const isStale = Boolean(reading.isStale);
      const title = options.title || 'Your Current GPS Location';
      const timeLabel = reading.updatedAt ? new Date(reading.updatedAt).toLocaleTimeString() : new Date().toLocaleTimeString();
      const resolvedHeading = GeoSafeMapping.resolveHeadingForReading(reading, markerState);
      if (Number.isFinite(resolvedHeading.continuousHeading)) {
        markerState.continuousHeading = resolvedHeading.continuousHeading;
      }
      const headingLabel = resolvedHeading.heading !== null
        ? `<span class="block text-[10px] text-[#2563EB] font-semibold">Heading: ${Math.round(resolvedHeading.heading)}° (${resolvedHeading.source === 'compass' ? 'Compass' : 'Movement'})</span>`
        : '<span class="block text-[10px] text-[#777777]">Direction: Unavailable</span>';

      const statusBadge = isStale
        ? '<span style="display:inline-block;padding:1px 6px;border-radius:9999px;background:#FFF9E8;color:#8A6800;border:1px solid #FFE872;font-size:10px;font-weight:700;">Stale</span>'
        : '<span style="display:inline-block;padding:1px 6px;border-radius:9999px;background:#ECFDF5;color:#047857;border:1px solid #A7F3D0;font-size:10px;font-weight:700;">Live</span>';

      const popupHtml = `
        <div class="text-xs p-1 space-y-0.5">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <strong class="text-[#202020]">${title}</strong>
            ${statusBadge}
          </div>
          <span class="block font-mono text-[11px] text-[#555555]">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>
          ${accuracy ? `<span class="block text-[10px] text-[#777777]">Accuracy: ±${Math.round(accuracy)}m</span>` : ''}
          ${headingLabel}
          <span class="block text-[10px] text-[#777777]">Updated ${timeLabel}</span>
        </div>
      `;

      const mapHasMarker = markerState.marker && (typeof map.hasLayer !== 'function' || map.hasLayer(markerState.marker));
      if (!markerState.marker || !mapHasMarker) {
        if (markerState.marker) {
          try { map.removeLayer(markerState.marker); } catch (_) { }
        }
        const icon = GeoSafeMapping.createCustomIcon('user', {
          heading: resolvedHeading.continuousHeading,
          stale: isStale,
        });
        markerState.marker = L.marker([lat, lng], {
          icon,
          zIndexOffset: options.zIndexOffset || 1000
        }).addTo(map);
        markerState.marker.bindPopup(popupHtml);
        markerState._lastStale = isStale;
        if (options.openPopup) markerState.marker.openPopup();
      } else {
        markerState.marker.setLatLng([lat, lng]);
        markerState.marker.setPopupContent(popupHtml);
        if (markerState._lastStale !== isStale) {
          markerState._lastStale = isStale;
          markerState.marker.setIcon(GeoSafeMapping.createCustomIcon('user', {
            heading: resolvedHeading.heading !== null ? resolvedHeading.continuousHeading : null,
            stale: isStale,
          }));
        } else {
          GeoSafeMapping.updateGpsMarkerHeading(
            markerState.marker,
            resolvedHeading.heading,
            resolvedHeading.continuousHeading,
            map
          );
        }
      }

      // Bind a single compass subscription per markerState so turning while stationary rotates the arrow immediately
      if (!markerState._compassUnsub) {
        markerState._compassUnsub = GeoSafeMapping.subscribeCompassHeading(({ heading, continuousHeading }) => {
          if (!markerState.marker) return;
          if (typeof map.hasLayer === 'function' && !map.hasLayer(markerState.marker)) return;
          markerState.continuousHeading = continuousHeading;
          GeoSafeMapping.updateGpsMarkerHeading(markerState.marker, heading, continuousHeading, map);
        });
        const cleanupMarkerCompass = () => {
          if (markerState._compassUnsub) {
            markerState._compassUnsub();
            markerState._compassUnsub = null;
          }
        };
        if (typeof map.once === 'function') {
          map.once('unload', cleanupMarkerCompass);
        }
      }
      GeoSafeMapping.attachCompassDiagnosticsPanel(map);
      GeoSafeMapping._notifyCompassDiagnostics();

      if (accuracy !== null) {
        const prevSmoothed = Number.isFinite(markerState._smoothedAccuracy) ? markerState._smoothedAccuracy : accuracy;
        const smoothedAccuracy = markerState._smoothedAccuracy === undefined
          ? accuracy
          : prevSmoothed + 0.25 * (accuracy - prevSmoothed);
        markerState._smoothedAccuracy = smoothedAccuracy;
        const targetRadius = Math.max(1, Math.round(smoothedAccuracy));
        const ringColor = isStale ? '#D97706' : '#2563EB';
        const ringFill = isStale ? '#F59E0B' : '#3B82F6';
        if (!markerState.accuracyCircle || (typeof map.hasLayer === 'function' && !map.hasLayer(markerState.accuracyCircle))) {
          if (markerState.accuracyCircle) {
            try { map.removeLayer(markerState.accuracyCircle); } catch (_) { }
          }
          markerState.accuracyCircle = L.circle([lat, lng], {
            radius: targetRadius,
            color: ringColor,
            fillColor: ringFill,
            fillOpacity: 0.1,
            weight: 1.5,
            interactive: false
          }).addTo(map);
          markerState._lastAppliedRadius = targetRadius;
        } else {
          markerState.accuracyCircle.setLatLng([lat, lng]);
          const prevApplied = Number(markerState._lastAppliedRadius || targetRadius);
          const minDelta = Math.max(2, prevApplied * 0.08);
          if (Math.abs(targetRadius - prevApplied) >= minDelta) {
            markerState.accuracyCircle.setRadius(targetRadius);
            markerState._lastAppliedRadius = targetRadius;
          }
          markerState.accuracyCircle.setStyle({ color: ringColor, fillColor: ringFill });
        }
      } else if (markerState.accuracyCircle) {
        try { map.removeLayer(markerState.accuracyCircle); } catch (_) { }
        markerState.accuracyCircle = null;
        markerState._smoothedAccuracy = undefined;
        markerState._lastAppliedRadius = undefined;
      }
    },

    /**
     * Create a reusable, independent 10-second Live GPS Tracker for any GeoSafe map.
     * Operates independently of route navigation: starts automatically on map load,
     * uses watchPosition + 10s sync interval, guards against overlapping/stale updates,
     * refreshes on visibility/focus, and cleans up on stop/logout/unload.
     */
    createLiveGpsTracker(options = {}) {
      if (!window.__geosafeLiveGpsTrackers) {
        window.__geosafeLiveGpsTrackers = new Set();
      }

      const cfg = {
        syncIntervalMs: Number(options.syncIntervalMs) || 10000,
        staleThresholdMs: Number(options.staleThresholdMs) || 35000,
        highAccuracy: options.highAccuracy !== false,
        maximumAgeMs: Number.isFinite(Number(options.maximumAgeMs)) ? Number(options.maximumAgeMs) : 5000,
        timeoutMs: Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 12000,
        onLocation: typeof options.onLocation === 'function' ? options.onLocation : () => { },
        onStatusChange: typeof options.onStatusChange === 'function' ? options.onStatusChange : () => { },
        onError: typeof options.onError === 'function' ? options.onError : () => { },
      };

      const state = {
        active: false,
        watchId: null,
        syncIntervalId: null,
        inFlight: false,
        readingSeq: 0,
        lastAcceptedSeq: 0,
        lastReading: null,
        status: 'idle', // 'idle' | 'acquiring' | 'active' | 'stale' | 'denied' | 'unavailable' | 'stopped'
      };

      function setStatus(nextStatus, message) {
        state.status = nextStatus;
        cfg.onStatusChange({ status: nextStatus, message: message || '', reading: state.lastReading });
      }

      function acceptPosition(pos, sourceSeq) {
        if (!state.active || !pos || !pos.coords) return null;
        if (sourceSeq !== undefined && sourceSeq < state.lastAcceptedSeq) return null;
        const rawLat = Number(pos.coords.latitude);
        const rawLng = Number(pos.coords.longitude);
        if (
          !Number.isFinite(rawLat) || !Number.isFinite(rawLng) ||
          rawLat < -90 || rawLat > 90 || rawLng < -180 || rawLng > 180 ||
          (rawLat === 0 && rawLng === 0)
        ) {
          return null;
        }
        const rawAccuracy = Number.isFinite(Number(pos.coords.accuracy)) && Number(pos.coords.accuracy) > 0
          ? Number(pos.coords.accuracy)
          : null;
        const now = Date.now();
        const rawTs = Number(pos.timestamp || now);
        // Reject stale OS-cached timestamps older than staleThresholdMs
        if (rawTs > 1e12 && now - rawTs > cfg.staleThresholdMs) {
          return null;
        }
        if (state.lastReading && rawTs < state.lastReading.timestamp - 2000) {
          return null; // Prevent older cached reading from overwriting newer coordinates
        }
        // Reject coarse/inaccurate readings when we already have a much better recent fix
        if (rawAccuracy !== null && rawAccuracy > 1500) {
          return null;
        }
        if (
          rawAccuracy !== null &&
          rawAccuracy > 250 &&
          state.lastReading &&
          !state.lastReading.isStale &&
          state.lastReading.accuracy !== null &&
          state.lastReading.accuracy <= 80 &&
          now - state.lastReading.updatedAt < 20000
        ) {
          return null;
        }

        const speed = Number.isFinite(Number(pos.coords.speed)) && Number(pos.coords.speed) >= 0
          ? Number(pos.coords.speed)
          : null;
        let lat = rawLat;
        let lng = rawLng;
        if (state.lastReading) {
          const distMeters = GeoSafeMapping.computeDistanceMeters(
            { lat: state.lastReading.lat, lng: state.lastReading.lng },
            { lat: rawLat, lng: rawLng }
          );
          const dtSec = Math.max(0.1, (rawTs - state.lastReading.timestamp) / 1000);
          const prevAcc = state.lastReading.accuracy || 15;
          const curAcc = rawAccuracy || 15;
          // Reject unrealistic GPS teleportation jumps
          if (dtSec >= 0.5 && distMeters > prevAcc + curAcc + 60 && distMeters / dtSec > 55) {
            return null;
          }
          // Smooth small GPS noise while stationary/slow; track responsively while moving
          const noiseRadius = Math.max(4, curAcc * 0.35);
          const isMoving = (speed !== null && speed >= 0.8) || distMeters > 40;
          const alpha = isMoving ? (distMeters > 40 ? 1 : 0.75) : (distMeters < noiseRadius ? 0.25 : 0.5);
          lat = state.lastReading.lat + alpha * (rawLat - state.lastReading.lat);
          lng = state.lastReading.lng + alpha * (rawLng - state.lastReading.lng);
        }

        if (sourceSeq !== undefined) {
          state.lastAcceptedSeq = sourceSeq;
        }
        const reading = {
          lat,
          lng,
          rawLat,
          rawLng,
          accuracy: rawAccuracy,
          heading: Number.isFinite(Number(pos.coords.heading)) ? Number(pos.coords.heading) : null,
          speed,
          timestamp: rawTs,
          updatedAt: now,
          isStale: false,
        };
        state.lastReading = reading;
        setStatus('active', 'Live GPS active');
        cfg.onLocation(reading);
        return reading;
      }

      function handleGpsError(err) {
        if (!state.active) return;
        const code = err && err.code;
        if (code === 1) {
          setStatus('denied', 'Location access denied. Enable GPS permission in browser site settings.');
        } else if (state.lastReading) {
          state.lastReading = { ...state.lastReading, isStale: true };
          setStatus('stale', 'GPS signal temporarily unavailable — showing last valid location (stale).');
          cfg.onLocation(state.lastReading);
        } else {
          setStatus('unavailable', (err && err.message) || 'Unable to acquire current GPS location.');
        }
        cfg.onError(err);
      }

      function fetchCurrentOnce(forceFresh = false) {
        if (!state.active || state.inFlight) return Promise.resolve(state.lastReading);
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          handleGpsError(new Error('Browser geolocation is unavailable.'));
          return Promise.resolve(null);
        }

        state.inFlight = true;
        const seq = ++state.readingSeq;
        if (!state.lastReading) {
          setStatus('acquiring', 'Detecting GPS location...');
        }

        return new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              state.inFlight = false;
              const r = acceptPosition(pos, seq);
              resolve(r);
            },
            (err) => {
              state.inFlight = false;
              handleGpsError(err);
              resolve(null);
            },
            {
              enableHighAccuracy: cfg.highAccuracy,
              maximumAge: forceFresh ? 0 : cfg.maximumAgeMs,
              timeout: cfg.timeoutMs,
            }
          );
        });
      }

      function handleVisibilityOrFocus() {
        if (!state.active) return;
        if (document.visibilityState === 'visible' || document.visibilityState === undefined) {
          fetchCurrentOnce(true);
        }
      }

      function handleLogoutOrUnload() {
        stop();
      }

      function start() {
        if (state.active) return; // Prevent duplicate watchers / loops
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          state.active = true;
          handleGpsError(new Error('Browser geolocation is not supported.'));
          return;
        }

        state.active = true;
        window.__geosafeLiveGpsTrackers.add(api);

        // Request initial GPS position immediately
        fetchCurrentOnce(true);

        // Start single watchPosition for movement between 10-second ticks
        if (state.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
          try { navigator.geolocation.clearWatch(state.watchId); } catch (_) { }
          state.watchId = null;
        }
        try {
          state.watchId = navigator.geolocation.watchPosition(
            (pos) => {
              const seq = ++state.readingSeq;
              acceptPosition(pos, seq);
            },
            (err) => {
              // Avoid spamming errors on temporary watch timeouts if we already have a reading
              if (err && err.code === 1) {
                handleGpsError(err);
              } else if (state.lastReading && Date.now() - state.lastReading.updatedAt > cfg.staleThresholdMs) {
                handleGpsError(err);
              }
            },
            {
              enableHighAccuracy: cfg.highAccuracy,
              maximumAge: cfg.maximumAgeMs,
              timeout: cfg.timeoutMs,
            }
          );
        } catch (err) {
          handleGpsError(err);
        }

        // Controlled 10-second synchronization interval
        state.syncIntervalId = setInterval(() => {
          if (!state.active) return;
          if (state.lastReading && Date.now() - state.lastReading.updatedAt > cfg.staleThresholdMs) {
            state.lastReading = { ...state.lastReading, isStale: true };
            setStatus('stale', 'GPS signal stale — retrying...');
          }
          fetchCurrentOnce(true);
        }, cfg.syncIntervalMs);

        document.addEventListener('visibilitychange', handleVisibilityOrFocus);
        window.addEventListener('focus', handleVisibilityOrFocus);
        window.addEventListener('pagehide', handleLogoutOrUnload);
        window.addEventListener('beforeunload', handleLogoutOrUnload);
        window.addEventListener('geosafe:logout', handleLogoutOrUnload);
      }

      function stop() {
        if (!state.active && state.watchId === null && state.syncIntervalId === null) return;
        state.active = false;
        state.inFlight = false;
        if (state.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
          try { navigator.geolocation.clearWatch(state.watchId); } catch (_) { }
          state.watchId = null;
        }
        if (state.syncIntervalId !== null) {
          clearInterval(state.syncIntervalId);
          state.syncIntervalId = null;
        }
        document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
        window.removeEventListener('focus', handleVisibilityOrFocus);
        window.removeEventListener('pagehide', handleLogoutOrUnload);
        window.removeEventListener('beforeunload', handleLogoutOrUnload);
        window.removeEventListener('geosafe:logout', handleLogoutOrUnload);
        if (window.__geosafeLiveGpsTrackers) {
          window.__geosafeLiveGpsTrackers.delete(api);
        }
        setStatus('stopped', 'GPS tracking stopped');
      }

      const api = {
        start,
        stop,
        refreshNow: (forceFresh = true) => fetchCurrentOnce(forceFresh),
        getLastReading: () => state.lastReading,
        getStatus: () => state.status,
        isActive: () => state.active,
      };
      return api;
    },

    stopAllLiveGpsTrackers() {
      if (!window.__geosafeLiveGpsTrackers) return;
      Array.from(window.__geosafeLiveGpsTrackers).forEach((tracker) => {
        try { tracker.stop(); } catch (_) { }
      });
    }
  };

  window.GeoSafeMapping = GeoSafeMapping;
})(window);

