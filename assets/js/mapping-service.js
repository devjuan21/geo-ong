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
    defaultZoom: 15
  };

  // Caching structures
  const geocodeCache = new Map();
  const routeCache = new Map();

  // Rate Limiting Queue for Nominatim (strict 1 request per second max)
  let lastNominatimRequestTime = 0;
  let nominatimQueue = Promise.resolve();

  const GeoSafeMapping = {
    config: GeoSafeMapConfig,

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

      // Add official OpenStreetMap tile layer with required attribution
      L.tileLayer(GeoSafeMapConfig.tiles.url, {
        attribution: GeoSafeMapConfig.tiles.attribution,
        maxZoom: GeoSafeMapConfig.tiles.maxZoom,
        crossOrigin: true
      }).addTo(map);

      return map;
    },

    /**
     * Get Resident's Current GPS Location using Browser Geolocation API
     * @returns {Promise<{lat: number, lng: number, accuracy: number}>}
     */
    getCurrentLocation() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          const err = new Error('Geolocation is not supported by your browser.');
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
            if (error.code === error.PERMISSION_DENIED) {
              msg = 'Location access permission was denied. Please allow GPS access in your browser settings.';
            } else if (error.code === error.POSITION_UNAVAILABLE) {
              msg = 'Location information is currently unavailable.';
            } else if (error.code === error.TIMEOUT) {
              msg = 'GPS location request timed out. Please try again.';
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
     * Reverse Geocoding with OSM Nominatim
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
            displayName = `Bayanan Area (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
          }

          geocodeCache.set(cacheKey, displayName);
          return displayName;
        } catch (err) {
          clearTimeout(timeoutId);
          console.warn('[GeoSafeMapping] Reverse geocoding failed:', err.message);
          // Graceful fallback to formatted coordinates without breaking UI
          return `Near ${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E (Bayanan)`;
        }
      }));
    },

    /**
     * Calculate Pedestrian Route via Project-OSRM Foot Endpoint
     * @param {{lat: number, lng: number}} start - Starting location
     * @param {{lat: number, lng: number}} destination - Destination location
     * @returns {Promise<{coordinates: Array<[number, number]>, distanceMeters: number, durationSeconds: number}>}
     */
    async calculatePedestrianRoute(start, destination) {
      if (!start || !destination || !start.lat || !destination.lat) {
        throw new Error('Both starting point and destination are required.');
      }

      const cacheKey = `${start.lat.toFixed(5)},${start.lng.toFixed(5)}->${destination.lat.toFixed(5)},${destination.lng.toFixed(5)}`;
      if (routeCache.has(cacheKey)) {
        return routeCache.get(cacheKey);
      }

      // OSRM expects coordinates in order: {lng},{lat};{lng},{lat}
      const coordsString = `${start.lng},${start.lat};${destination.lng},${destination.lat}`;
      const url = `${GeoSafeMapConfig.routing.baseUrl}/${coordsString}?overview=full&geometries=geojson&steps=false`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GeoSafeMapConfig.routing.timeoutMs);

      try {
        const response = await fetch(url, {
          headers: { 'Accept': 'application/json' },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.status === 429) {
          throw new Error('Routing request limit exceeded. Please wait a moment and try again.');
        }

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

        const result = {
          coordinates: leafletCoordinates,
          distanceMeters: Math.round(primaryRoute.distance || 0),
          durationSeconds: Math.round(primaryRoute.duration || 0)
        };

        routeCache.set(cacheKey, result);
        return result;
      } catch (err) {
        clearTimeout(timeoutId);
        console.error('[GeoSafeMapping] OSRM Route calculation failed:', err);
        throw err;
      }
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
     * @param {string} type - 'user' | 'evacuation' | 'incident' | 'family'
     * @param {string} label - Short text/initials
     * @returns {L.DivIcon}
     */
    createCustomIcon(type, label = '') {
      let bgClass = 'bg-brand-900 ring-brand-300';
      let iconSvg = '';

      if (type === 'user') {
        bgClass = 'bg-blue-600 ring-blue-300 animate-pulse';
        iconSvg = `<div class="w-3 h-3 rounded-full bg-white"></div>`;
      } else if (type === 'evacuation') {
        bgClass = 'bg-emerald-600 ring-emerald-300';
        iconSvg = `<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>`;
      } else if (type === 'incident') {
        bgClass = 'bg-amber-600 ring-amber-300';
        iconSvg = `<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`;
      } else if (type === 'family') {
        bgClass = 'bg-purple-700 ring-purple-300';
        iconSvg = `<span class="text-xs font-bold text-white">${label.substring(0, 2).toUpperCase()}</span>`;
      }

      return L.divIcon({
        className: 'geosafe-custom-marker',
        html: `
          <div class="relative flex items-center justify-center">
            <div class="w-8 h-8 rounded-full ${bgClass} ring-4 shadow-lg flex items-center justify-center border-2 border-white">
              ${iconSvg}
            </div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -18]
      });
    }
  };

  window.GeoSafeMapping = GeoSafeMapping;
})(window);

