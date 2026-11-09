const pool = require('../models/db');

async function getHospitals(req, res) {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, latitude, longitude, address, emergency_contact, status, capacity, available_slots, created_at, updated_at FROM hospitals ORDER BY name ASC'
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
      'SELECT * FROM hospitals WHERE id = ?',
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

module.exports = {
  getHospitals,
  getHospitalById
};

