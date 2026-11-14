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

module.exports = {
  BOUNDARY_FILE_PATH,
  isPointInsideBayanan,
  getBayananBoundaryGeoJson,
  getBayananBounds,
};
