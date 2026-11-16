const fs = require('fs');
const path = require('path');

const BOUNDARY_FILE_PATH = path.join(
  __dirname,
  '..',
  '..',
  'frontend',
  'assets',
  'data',
  'barangay-bayanan-boundary.geojson'
);

const BOUNDARY_EDGE_EPSILON = 1e-9;

let cachedGeoJson = null;
let cachedPolygons = null;
let cachedBounds = null;

function loadBoundaryData() {
  if (cachedGeoJson && cachedPolygons && cachedBounds) {
    return { geoJson: cachedGeoJson, polygons: cachedPolygons, bounds: cachedBounds };
  }

  const raw = fs.readFileSync(BOUNDARY_FILE_PATH, 'utf8');
  const geoJson = JSON.parse(raw);

  if (!geoJson || geoJson.type !== 'FeatureCollection' || !Array.isArray(geoJson.features) || geoJson.features.length === 0) {
    throw new Error('Invalid Barangay Bayanan GeoJSON boundary file.');
  }

  const polygons = [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const feature of geoJson.features) {
    const geom = feature && feature.geometry;
    if (!geom || !Array.isArray(geom.coordinates)) continue;

    const featurePolys =
      geom.type === 'MultiPolygon'
        ? geom.coordinates
        : geom.type === 'Polygon'
        ? [geom.coordinates]
        : [];

    for (const poly of featurePolys) {
      polygons.push(poly);
      for (const ring of poly) {
        for (const coord of ring) {
          const lng = Number(coord[0]);
          const lat = Number(coord[1]);
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
  }

  if (polygons.length === 0 || !Number.isFinite(minLat)) {
    throw new Error('Barangay Bayanan GeoJSON contains no valid polygon geometry.');
  }

  cachedGeoJson = geoJson;
  cachedPolygons = polygons;
  cachedBounds = {
    minLat,
    maxLat,
    minLng,
    maxLng,
    centerLat: Number(((minLat + maxLat) / 2).toFixed(6)),
    centerLng: Number(((minLng + maxLng) / 2).toFixed(6)),
  };

  return { geoJson: cachedGeoJson, polygons: cachedPolygons, bounds: cachedBounds };
}

/**
 * Check whether point (px, py) lies on segment (ax, ay)-(bx, by) within epsilon.
 */
function isPointOnSegment(px, py, ax, ay, bx, by, eps = BOUNDARY_EDGE_EPSILON) {
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  const segLen = Math.hypot(bx - ax, by - ay);
  if (segLen === 0) {
    return Math.hypot(px - ax, py - ay) <= eps;
  }
  if (Math.abs(cross) / segLen > eps) {
    return false;
  }
  const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay);
  if (dot < -eps * segLen) return false;
  if (dot > segLen * segLen + eps * segLen) return false;
  return true;
}

/**
 * Ray-casting point-in-ring test with consistent boundary edge inclusion.
 */
function isPointInRing(lng, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);

    if (isPointOnSegment(lng, lat, xj, yj, xi, yi)) {
      return true;
    }

    const intersects =
      (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

/**
 * Validate whether (latitude, longitude) lies inside or on the boundary
 * of the official Barangay Bayanan, Muntinlupa City polygon.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @returns {boolean}
 */
function isPointInsideBayanan(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }

  const { polygons, bounds } = loadBoundaryData();

  // Fast bounding-box rejection (never used for acceptance)
  if (
    lat < bounds.minLat - BOUNDARY_EDGE_EPSILON ||
    lat > bounds.maxLat + BOUNDARY_EDGE_EPSILON ||
    lng < bounds.minLng - BOUNDARY_EDGE_EPSILON ||
    lng > bounds.maxLng + BOUNDARY_EDGE_EPSILON
  ) {
    return false;
  }

  for (const poly of polygons) {
    if (!poly.length) continue;
    // Must be inside outer ring (poly[0]) and outside any interior holes (poly[1..])
    if (isPointInRing(lng, lat, poly[0])) {
      let inHole = false;
      for (let h = 1; h < poly.length; h++) {
        if (isPointInRing(lng, lat, poly[h])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
  }

  return false;
}

function getBayananBoundaryGeoJson() {
  return loadBoundaryData().geoJson;
}

function getBayananBounds() {
  return { ...loadBoundaryData().bounds };
}

function isExcludedEvacuationCenter(center) {
  if (!center) return false;
  const name = String(center.name || '').toLowerCase();
  const address = String(center.address || '').toLowerCase();
  return name.includes('summitville') || address.includes('summitville');
}

const DEFAULT_GPS_ACCURACY_THRESHOLD_METERS = (() => {
  const envVal = Number(process.env.GPS_ACCURACY_THRESHOLD_METERS);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : 100;
})();

const LOCATION_VERIFICATION_STATUSES = Object.freeze({
  VERIFIED: 'verified',
  OUTSIDE_BOUNDARY: 'outside_boundary',
  PENDING_REVIEW: 'pending_review',
  GPS_DENIED: 'gps_denied',
  GPS_UNAVAILABLE: 'gps_unavailable',
  RETRY_REQUIRED: 'retry_required',
});

/**
 * Compute shortest distance in meters from point (lat, lng) to segment (aLng, aLat)-(bLng, bLat)
 * using local equirectangular projection.
 */
function distancePointToSegmentMeters(lat, lng, aLng, aLat, bLng, bLat) {
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);

  const px = 0;
  const py = 0;
  const ax = (aLng - lng) * metersPerDegLng;
  const ay = (aLat - lat) * metersPerDegLat;
  const bx = (bLng - lng) * metersPerDegLng;
  const by = (bLat - lat) * metersPerDegLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = ax + t * dx;
  const closestY = ay + t * dy;
  return Math.hypot(px - closestX, py - closestY);
}

/**
 * Compute shortest distance in meters from (latitude, longitude) to any edge
 * of the official Barangay Bayanan boundary polygon.
 */
function distanceToBayananBoundaryMeters(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Infinity;
  }

  const { polygons } = loadBoundaryData();
  let minMeters = Infinity;

  for (const poly of polygons) {
    for (const ring of poly) {
      if (!Array.isArray(ring) || ring.length < 2) continue;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const aLng = Number(ring[j][0]);
        const aLat = Number(ring[j][1]);
        const bLng = Number(ring[i][0]);
        const bLat = Number(ring[i][1]);
        const d = distancePointToSegmentMeters(lat, lng, aLng, aLat, bLng, bLat);
        if (d < minMeters) minMeters = d;
      }
    }
  }

  return Number.isFinite(minMeters) ? Number(minMeters.toFixed(2)) : Infinity;
}

/**
 * Evaluate GPS coordinates and accuracy against the official Barangay Bayanan boundary.
 */
function evaluateResidentLocation({
  latitude,
  longitude,
  accuracy,
  gpsErrorStatus = null,
  accuracyThresholdMeters = DEFAULT_GPS_ACCURACY_THRESHOLD_METERS,
} = {}) {
  const threshold = Number(accuracyThresholdMeters) > 0
    ? Number(accuracyThresholdMeters)
    : DEFAULT_GPS_ACCURACY_THRESHOLD_METERS;

  if (gpsErrorStatus === LOCATION_VERIFICATION_STATUSES.GPS_DENIED) {
    return {
      status: LOCATION_VERIFICATION_STATUSES.GPS_DENIED,
      message: 'Location permission is required for automatic verification. You can still register for Administrator review.',
      accuracy: null,
      accuracyThresholdMeters: threshold,
      boundaryDistanceMeters: null,
      insidePolygon: false,
      canProceed: true,
    };
  }

  if (gpsErrorStatus === LOCATION_VERIFICATION_STATUSES.GPS_UNAVAILABLE) {
    return {
      status: LOCATION_VERIFICATION_STATUSES.GPS_UNAVAILABLE,
      message: 'Unable to retrieve your current location. Please try again or register for Administrator review.',
      accuracy: null,
      accuracyThresholdMeters: threshold,
      boundaryDistanceMeters: null,
      insidePolygon: false,
      canProceed: true,
    };
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  const acc = Number(accuracy);

  if (
    latitude === undefined || latitude === null || latitude === '' ||
    longitude === undefined || longitude === null || longitude === '' ||
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    return {
      status: LOCATION_VERIFICATION_STATUSES.GPS_UNAVAILABLE,
      message: 'Unable to retrieve your current location. Please try again or register for Administrator review.',
      accuracy: null,
      accuracyThresholdMeters: threshold,
      boundaryDistanceMeters: null,
      insidePolygon: false,
      canProceed: true,
    };
  }

  if (!Number.isFinite(acc) || acc <= 0 || acc > threshold) {
    return {
      status: LOCATION_VERIFICATION_STATUSES.RETRY_REQUIRED,
      message: 'GPS accuracy is insufficient. Please try again in an area with a better signal.',
      accuracy: Number.isFinite(acc) && acc > 0 ? Number(acc.toFixed(2)) : null,
      accuracyThresholdMeters: threshold,
      boundaryDistanceMeters: null,
      insidePolygon: false,
      canProceed: true,
    };
  }

  const inside = isPointInsideBayanan(lat, lng);
  const distanceMeters = distanceToBayananBoundaryMeters(lat, lng);
  const roundedAcc = Number(acc.toFixed(2));

  // If the GPS accuracy radius overlaps or may cross the boundary, mark for review
  if (distanceMeters <= roundedAcc) {
    return {
      status: LOCATION_VERIFICATION_STATUSES.PENDING_REVIEW,
      message: 'Your location is near the Barangay Bayanan boundary and requires Administrator review.',
      accuracy: roundedAcc,
      accuracyThresholdMeters: threshold,
      boundaryDistanceMeters: distanceMeters,
      insidePolygon: inside,
      canProceed: true,
    };
  }

  if (inside) {
    return {
      status: LOCATION_VERIFICATION_STATUSES.VERIFIED,
      message: 'Your location is within Barangay Bayanan.',
      accuracy: roundedAcc,
      accuracyThresholdMeters: threshold,
      boundaryDistanceMeters: distanceMeters,
      insidePolygon: true,
      canProceed: true,
    };
  }

  return {
    status: LOCATION_VERIFICATION_STATUSES.OUTSIDE_BOUNDARY,
    message: 'Your current location is outside Barangay Bayanan. You can still register for Administrator review.',
    accuracy: roundedAcc,
    accuracyThresholdMeters: threshold,
    boundaryDistanceMeters: distanceMeters,
    insidePolygon: false,
    canProceed: true,
  };
}

module.exports = {
  BOUNDARY_FILE_PATH,
  DEFAULT_GPS_ACCURACY_THRESHOLD_METERS,
  LOCATION_VERIFICATION_STATUSES,
  isPointInsideBayanan,
  distanceToBayananBoundaryMeters,
  evaluateResidentLocation,
  isExcludedEvacuationCenter,
  getBayananBoundaryGeoJson,
  getBayananBounds,
};
