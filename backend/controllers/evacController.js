const pool = require('../models/db');

async function getEvacuationCenters(req, res) {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, latitude, longitude, address, status, capacity, available_slots, contact_number, created_at, updated_at FROM evacuation_centers ORDER BY name ASC'
    );
    return res.json({ evacuation_centers: rows });
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
    if (!rows.length) {
      return res.status(404).json({ error: 'Evacuation center not found' });
    }
    return res.json({ evacuation_center: rows[0] });
  } catch (err) {
    console.error('Error fetching evacuation center:', err.message);
    return res.status(500).json({ error: 'Database error fetching evacuation center' });
  }
}

async function updateEvacuationCenter(req, res) {
  const centerId = parseInt(req.params.id, 10);
  const { status, available_slots, capacity, contact_number, address } = req.body;

  try {
    const updates = [];
    const params = [];

    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }
    if (available_slots !== undefined) {
      updates.push('available_slots = ?');
      params.push(parseInt(available_slots, 10));
    }
    if (capacity !== undefined) {
      updates.push('capacity = ?');
      params.push(parseInt(capacity, 10));
    }
    if (contact_number !== undefined) {
      updates.push('contact_number = ?');
      params.push(contact_number);
    }
    if (address !== undefined) {
      updates.push('address = ?');
      params.push(address);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(centerId);

    const [result] = await pool.query(
      `UPDATE evacuation_centers SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Evacuation center not found' });
    }

    const [rows] = await pool.query('SELECT * FROM evacuation_centers WHERE id = ?', [centerId]);
    return res.json({ message: 'Evacuation center updated', evacuation_center: rows[0] });
  } catch (err) {
    console.error('Error updating evacuation center:', err.message);
    return res.status(500).json({ error: 'Database error updating evacuation center' });
  }
}

module.exports = {
  getEvacuationCenters,
  getEvacuationCenterById,
  updateEvacuationCenter
};

