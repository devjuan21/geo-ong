const pool = require('../models/db');

function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function isWithinMetroManilaBounds(lat, lng) {
  return isValidLatLng(lat, lng) && lat >= 14.0 && lat <= 15.0 && lng >= 120.5 && lng <= 121.6;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function fetchOsrmRouteMetrics(originLat, originLng, destLat, destLng, profile = 'driving') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const url = `https://router.project-osrm.org/route/v1/${profile}/${originLng},${originLat};${destLng},${destLat}?overview=false`;
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;
    const data = await resp.json();
    const route = data && Array.isArray(data.routes) && data.routes[0];
    if (!route || !Number.isFinite(route.distance)) return null;
    return {
      distanceMeters: Math.round(route.distance),
      durationSeconds: Number.isFinite(route.duration) ? Math.round(route.duration) : null,
      routeSource: 'osrm',
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getHospitals(req, res) {
  try {
    const verifiedOnly = String(req.query.verifiedOnly || '').toLowerCase() === 'true';
    const category = String(req.query.category || '').toLowerCase();

    const conditions = [`status <> 'Closed'`];
    const params = [];

    if (verifiedOnly) {
      conditions.push(`verification_status = 'Verified'`);
    }
    if (category === 'hospital') {
      conditions.push(`facility_type = 'Hospital'`);
    } else if (category === 'medical_facility') {
      conditions.push(`facility_type = 'Health Center'`);
    } else {
      conditions.push(`facility_type IN ('Hospital', 'Health Center')`);
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT id, name, latitude, longitude, address, emergency_contact, status,
              capacity, available_slots, facility_type, operating_hours,
              verification_status, coordinate_flag, last_verified_at, verified_by,
              emergency_capable, created_at, updated_at
       FROM hospitals
       ${whereSql}
       ORDER BY
         CASE verification_status WHEN 'Verified' THEN 0 WHEN 'Unverified' THEN 1 ELSE 2 END,
         name ASC`,
      params
    );
    return res.json({ hospitals: rows });
  } catch (err) {
    console.error('Error fetching hospitals:', err.message);
    return res.status(500).json({ error: 'Database error fetching hospitals' });
  }
}

async function getHospitalById(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, latitude, longitude, address, emergency_contact, status,
              capacity, available_slots, facility_type, operating_hours,
              verification_status, coordinate_flag, last_verified_at, verified_by,
              emergency_capable, created_at, updated_at
       FROM hospitals
       WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Hospital not found' });
    }
    return res.json({ hospital: rows[0] });
  } catch (err) {
    console.error('Error fetching hospital:', err.message);
    return res.status(500).json({ error: 'Database error fetching hospital' });
  }
}

async function getDestinationRecommendations(req, res) {
  try {
    const originLat = Number(req.query.lat);
    const originLng = Number(req.query.lng);
    const category = String(req.query.category || 'hospital').toLowerCase();
    const includeUnverified = String(req.query.includeUnverified || '').toLowerCase() === 'true';

    if (!isValidLatLng(originLat, originLng)) {
      return res.status(400).json({ error: 'Valid origin latitude and longitude are required for recommendations.' });
    }

    if (!['hospital', 'medical_facility', 'evacuation_center'].includes(category)) {
      return res.status(400).json({ error: 'Invalid destination category.' });
    }

    if (category === 'evacuation_center') {
      const [evacRows] = await pool.query(
        `SELECT id, name, address, barangay, latitude, longitude,
                status, contact_person, contact_phone, contact_number
         FROM evacuation_centers
         WHERE status IN ('Open for Accommodation', 'Open - Accommodating', 'OPEN-ACCOMMODATING')
         ORDER BY name ASC`
      );

      const eligible = [];
      const flagged = [];

      for (const ec of evacRows) {
        const dLat = Number(ec.latitude);
        const dLng = Number(ec.longitude);
        if (!isWithinMetroManilaBounds(dLat, dLng)) {
          flagged.push({
            id: ec.id,
            destinationCategory: 'evacuation_center',
            name: ec.name,
            facilityType: 'Evacuation Center',
            address: ec.address,
            latitude: dLat,
            longitude: dLng,
            verificationStatus: 'Flagged',
            coordinateFlag: 'Coordinates outside Barangay Bayanan / Metro Manila range.',
          });
          continue;
        }
        eligible.push({
          id: ec.id,
          destinationCategory: 'evacuation_center',
          name: ec.name,
          facilityType: 'Evacuation Center',
          address: ec.address,
          latitude: dLat,
          longitude: dLng,
          status: ec.status,
          operatingHours: 'Emergency Operations',
          verificationStatus: 'Verified',
          isVerified: true,
          emergencyCapable: false,
          straightLineMeters: haversineMeters(originLat, originLng, dLat, dLng),
        });
      }

      const routeResults = await Promise.allSettled(
        eligible.map((item) => fetchOsrmRouteMetrics(originLat, originLng, item.latitude, item.longitude, 'foot'))
      );

      const recommendations = eligible
        .map((item, idx) => {
          const osrm = routeResults[idx].status === 'fulfilled' ? routeResults[idx].value : null;
          return {
            ...item,
            routeDistanceMeters: osrm ? osrm.distanceMeters : item.straightLineMeters,
            routeDurationSeconds: osrm ? osrm.durationSeconds : null,
            routeSource: osrm ? 'osrm' : 'haversine_fallback',
          };
        })
        .sort((a, b) => a.routeDistanceMeters - b.routeDistanceMeters);

      return res.json({
        category,
        origin: { lat: originLat, lng: originLng },
        recommendations,
        unverifiedFacilities: [],
        flaggedFacilities: flagged,
      });
    }

    // Healthcare Facility Directory ('hospital' or 'medical_facility')
    const typeFilter =
      category === 'hospital'
        ? `facility_type = 'Hospital'`
        : `facility_type = 'Health Center'`;

    const [rows] = await pool.query(
      `SELECT id, name, address, latitude, longitude, emergency_contact, status,
              capacity, available_slots, facility_type, operating_hours,
              verification_status, coordinate_flag, last_verified_at, emergency_capable
       FROM hospitals
       WHERE ${typeFilter} AND status <> 'Closed'
       ORDER BY name ASC`
    );

    const eligible = [];
    const unverifiedList = [];
    const flaggedList = [];

    for (const row of rows) {
      const dLat = Number(row.latitude);
      const dLng = Number(row.longitude);
      const vStatus = String(row.verification_status || 'Unverified');
      const coordsValid = isWithinMetroManilaBounds(dLat, dLng);

      const baseItem = {
        id: row.id,
        destinationCategory: category,
        name: row.name,
        facilityType: row.facility_type || 'Hospital',
        address: row.address,
        latitude: dLat,
        longitude: dLng,
        status: row.status,
        operatingHours: row.operating_hours || 'Unverified',
        verificationStatus: !coordsValid ? 'Flagged' : vStatus,
        isVerified: coordsValid && vStatus === 'Verified',
        coordinateFlag:
          row.coordinate_flag ||
          (!coordsValid ? 'Coordinates outside Metro Manila range; manual verification required.' : null),
        lastVerifiedAt: row.last_verified_at || null,
        emergencyCapable: Boolean(row.emergency_capable),
        emergencyContact: row.emergency_contact || 'Unverified',
        // Never claim beds are available when capacity/slots are unverified (0)
        capacity: Number(row.capacity || 0) > 0 ? Number(row.capacity) : null,
        availableSlots: Number(row.capacity || 0) > 0 ? Number(row.available_slots || 0) : null,
      };

      if (!coordsValid || vStatus === 'Flagged') {
        flaggedList.push(baseItem);
        continue;
      }
      if (row.status === 'Closed') {
        continue;
      }

      const straightLineMeters = haversineMeters(originLat, originLng, dLat, dLng);
      const enriched = { ...baseItem, straightLineMeters };

      if (vStatus !== 'Verified') {
        unverifiedList.push(enriched);
        if (includeUnverified && category === 'medical_facility') {
          eligible.push(enriched);
        }
        continue;
      }

      eligible.push(enriched);
    }

    const routeResults = await Promise.allSettled(
      eligible.map((item) => fetchOsrmRouteMetrics(originLat, originLng, item.latitude, item.longitude, 'driving'))
    );

    const recommendations = eligible
      .map((item, idx) => {
        const osrm = routeResults[idx].status === 'fulfilled' ? routeResults[idx].value : null;
        return {
          ...item,
          routeDistanceMeters: osrm ? osrm.distanceMeters : item.straightLineMeters,
          routeDurationSeconds: osrm ? osrm.durationSeconds : null,
          routeSource: osrm ? 'osrm' : 'haversine_fallback',
        };
      })
      .sort((a, b) => {
        if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
        if (a.emergencyCapable !== b.emergencyCapable) return a.emergencyCapable ? -1 : 1;
        return a.routeDistanceMeters - b.routeDistanceMeters;
      });

    return res.json({
      category,
      origin: { lat: originLat, lng: originLng },
      recommendations,
      unverifiedFacilities: unverifiedList,
      flaggedFacilities: flaggedList,
    });
  } catch (err) {
    console.error('Error computing destination recommendations:', err.message);
    return res.status(500).json({ error: 'Database error computing destination recommendations' });
  }
}

module.exports = {
  getHospitals,
  getHospitalById,
  getDestinationRecommendations,
};
