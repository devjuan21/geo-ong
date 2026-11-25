const pool = require('../models/db');
const { isPointInsideBayanan, isExcludedEvacuationCenter } = require('../utils/bayananBoundary');

function normalizeEvacStatus(status) {
  if (!status) return 'Open - Accommodating';
  const s = String(status).trim();
  const valid = ['Open - Accommodating', 'Full / Closed', 'Standby'];
  if (valid.includes(s)) return s;
  const lower = s.toLowerCase();
  if (lower.includes('open') || lower.includes('accommodat')) return 'Open - Accommodating';
  if (lower.includes('full') || lower.includes('close')) return 'Full / Closed';
  if (lower.includes('standby')) return 'Standby';
  return 'Open - Accommodating';
}

function enrichEvacRow(row, facilities = []) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    barangay: row.barangay,
    latitude: row.latitude,
    longitude: row.longitude,
    status: normalizeEvacStatus(row.status),
    contact_person: row.contact_person || '',
    contact_number: row.contact_number || row.contact_phone || '',
    contact_phone: row.contact_phone || row.contact_number || '',
    coordinates: {
      lat: Number(row.latitude),
      lng: Number(row.longitude),
    },
    facilities,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getEvacuationCenters(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, latitude, longitude, address, barangay, status,
              contact_person, contact_phone, contact_number, created_at, updated_at
       FROM evacuation_centers
       ORDER BY name ASC`
    );

    const facByCenter = new Map();
    try {
      const [facRows] = await pool.query(
        'SELECT center_id, facility_name FROM evacuation_center_facilities WHERE is_available = 1'
      );
      for (const f of facRows) {
        if (!facByCenter.has(f.center_id)) facByCenter.set(f.center_id, []);
        facByCenter.get(f.center_id).push(f.facility_name);
      }
    } catch {
      // Optional facilities table
    }

    const centers = rows
      .filter((r) => !isExcludedEvacuationCenter(r) && (String(r.barangay || '').toLowerCase().includes('bayanan') || isPointInsideBayanan(r.latitude, r.longitude)))
      .map((r) => enrichEvacRow(r, facByCenter.get(r.id) || []));
    return res.json({ evacuation_centers: centers });
  } catch (err) {
    console.error('Error fetching evacuation centers:', err.message);
    return res.status(500).json({ error: 'Database error fetching evacuation centers' });
  }
}

async function getEvacuationCenterById(req, res) {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM evacuation_centers WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length || isExcludedEvacuationCenter(rows[0])) {
      return res.status(404).json({ error: 'Evacuation center not found' });
    }
    let facilities = [];
    try {
      const [facRows] = await pool.query(
        'SELECT facility_name FROM evacuation_center_facilities WHERE center_id = ? AND is_available = 1',
        [rows[0].id]
      );
      facilities = facRows.map((f) => f.facility_name);
    } catch {
      facilities = [];
    }
    return res.json({ evacuation_center: enrichEvacRow(rows[0], facilities) });
  } catch (err) {
    console.error('Error fetching evacuation center:', err.message);
    return res.status(500).json({ error: 'Database error fetching evacuation center' });
  }
}

async function createEvacuationCenter(req, res) {
  const {
    name,
    address,
    barangay,
    latitude,
    longitude,
    coordinates,
    status,
    contact_person,
    contactPerson,
    contact_phone,
    contact_number,
    contactNumber,
    facilities,
  } = req.body || {};

  const trimmedName = String(name || '').trim();
  const trimmedAddress = String(address || 'Barangay Bayanan, Muntinlupa City').trim();
  if (!trimmedName) {
    return res.status(400).json({ error: 'Evacuation center name is required' });
  }

  const lat = Number(
    latitude !== undefined ? latitude : coordinates && coordinates.lat !== undefined ? coordinates.lat : 14.4081
  );
  const lng = Number(
    longitude !== undefined ? longitude : coordinates && coordinates.lng !== undefined ? coordinates.lng : 121.0415
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Valid latitude and longitude coordinates are required' });
  }

  const normalizedStatus = normalizeEvacStatus(status);
  const contactPersonVal = String(contact_person || contactPerson || 'Barangay DRRM Officer').trim().slice(0, 120);
  const contactPhoneVal = String(contact_phone || contact_number || contactNumber || '').trim().slice(0, 40) || null;
  const brgy = String(barangay || 'Barangay Bayanan').trim().slice(0, 100);

  try {
    const [result] = await pool.query(
      `INSERT INTO evacuation_centers
         (name, address, barangay, latitude, longitude, capacity, available_slots, total_capacity, current_occupancy, status, contact_person, contact_phone, contact_number)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?)`,
      [
        trimmedName.slice(0, 150),
        trimmedAddress.slice(0, 255),
        brgy,
        lat,
        lng,
        normalizedStatus,
        contactPersonVal,
        contactPhoneVal,
        contactPhoneVal,
      ]
    );

    if (Array.isArray(facilities) && facilities.length > 0) {
      for (const fac of facilities) {
        const facName = String(fac || '').trim().slice(0, 80);
        if (facName) {
          await pool
            .query(
              'INSERT IGNORE INTO evacuation_center_facilities (center_id, facility_name, is_available) VALUES (?, ?, 1)',
              [result.insertId, facName]
            )
            .catch(() => {});
        }
      }
    }

    const [rows] = await pool.query('SELECT * FROM evacuation_centers WHERE id = ?', [result.insertId]);
    return res.status(201).json({
      message: 'Evacuation center created',
      evacuation_center: enrichEvacRow(rows[0], Array.isArray(facilities) ? facilities : []),
    });
  } catch (err) {
    console.error('Error creating evacuation center:', err.message);
    return res.status(500).json({ error: 'Database error creating evacuation center' });
  }
}

async function updateEvacuationCenter(req, res) {
  const centerId = parseInt(req.params.id, 10);
  if (!Number.isFinite(centerId)) {
    return res.status(400).json({ error: 'Invalid evacuation center ID' });
  }

  const {
    name,
    address,
    barangay,
    latitude,
    longitude,
    coordinates,
    status,
    contact_person,
    contactPerson,
    contact_phone,
    contact_number,
    contactNumber,
  } = req.body || {};

  try {
    const [existingRows] = await pool.query('SELECT * FROM evacuation_centers WHERE id = ?', [centerId]);
    if (!existingRows.length) {
      return res.status(404).json({ error: 'Evacuation center not found' });
    }
    const existing = existingRows[0];

    const updates = [];
    const params = [];

    if (name !== undefined && String(name).trim()) {
      updates.push('name = ?');
      params.push(String(name).trim().slice(0, 150));
    }
    if (address !== undefined) {
      updates.push('address = ?');
      params.push(String(address).trim().slice(0, 255));
    }
    if (barangay !== undefined && String(barangay).trim()) {
      updates.push('barangay = ?');
      params.push(String(barangay).trim().slice(0, 100));
    }

    const lat = latitude !== undefined ? latitude : coordinates && coordinates.lat;
    const lng = longitude !== undefined ? longitude : coordinates && coordinates.lng;
    if (lat !== undefined && Number.isFinite(Number(lat))) {
      updates.push('latitude = ?');
      params.push(Number(lat));
    }
    if (lng !== undefined && Number.isFinite(Number(lng))) {
      updates.push('longitude = ?');
      params.push(Number(lng));
    }

    if (status !== undefined) {
      updates.push('status = ?');
      params.push(normalizeEvacStatus(status));
    }

    const cp = contact_person !== undefined ? contact_person : contactPerson;
    if (cp !== undefined) {
      updates.push('contact_person = ?');
      params.push(String(cp).trim().slice(0, 120));
    }

    const phone =
      contact_number !== undefined
        ? contact_number
        : contact_phone !== undefined
        ? contact_phone
        : contactNumber;
    if (phone !== undefined) {
      const phoneStr = String(phone).trim().slice(0, 40);
      updates.push('contact_number = ?', 'contact_phone = ?');
      params.push(phoneStr, phoneStr);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(centerId);

    await pool.query(
      `UPDATE evacuation_centers SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    const [rows] = await pool.query('SELECT * FROM evacuation_centers WHERE id = ?', [centerId]);
    return res.json({ message: 'Evacuation center updated', evacuation_center: enrichEvacRow(rows[0]) });
  } catch (err) {
    console.error('Error updating evacuation center:', err.message);
    return res.status(500).json({ error: 'Database error updating evacuation center' });
  }
}

module.exports = {
  getEvacuationCenters,
  getEvacuationCenterById,
  createEvacuationCenter,
  updateEvacuationCenter,
};
