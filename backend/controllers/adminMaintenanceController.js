const pool = require('../models/db');
const {
  emitIncidentCategoriesUpdated,
  emitRescueCategoriesUpdated,
} = require('../services/socketService');

async function logMaintenanceAudit(conn, { userId, action, entityType, entityId, oldValues, newValues, req }) {
  try {
    await conn.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId || null,
        action,
        entityType,
        String(entityId || ''),
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        req ? String(req.ip || '0.0.0.0').slice(0, 45) : null,
        req && req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 255) : null,
      ]
    );
  } catch (err) {
    console.warn('[Admin Maintenance] Audit log write warning:', err.message);
  }
}

// ============================================================================
// 1. INCIDENT CATEGORIES (incident_categories)
// ============================================================================
async function getIncidentCategories(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT ic.id, ic.name, ic.description, ic.default_severity, ic.sort_order, ic.is_active, ic.created_at, ic.updated_at,
              (SELECT COUNT(DISTINCT r.id)::int FROM reports r WHERE r.category_id = ic.id OR LOWER(TRIM(r.incident_type)) = LOWER(ic.name)) AS usage_count
       FROM incident_categories ic
       ORDER BY ic.sort_order ASC, ic.id ASC`
    );
    return res.json({ categories: rows });
  } catch (err) {
    console.error('[Admin Maintenance] getIncidentCategories failed:', err.message);
    return res.status(503).json({ error: 'Unable to load incident categories.' });
  }
}

async function createIncidentCategory(req, res) {
  const { name, description = '', defaultSeverity = 'Medium', sortOrder = 0, isActive = true } = req.body || {};
  const cleanName = String(name || '').trim().slice(0, 100);
  if (!cleanName || cleanName.length < 2) {
    return res.status(400).json({ error: 'Incident category name (at least 2 characters) is required.' });
  }
  const validSeverities = ['Low', 'Medium', 'High', 'Critical'];
  const cleanSeverity = validSeverities.includes(defaultSeverity) ? defaultSeverity : 'Medium';
  const cleanOrder = Number.isFinite(Number(sortOrder)) ? Math.round(Number(sortOrder)) : 0;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [dups] = await conn.query('SELECT id FROM incident_categories WHERE LOWER(name) = LOWER(?) LIMIT 1', [cleanName]);
    if (dups.length > 0) {
      await conn.rollback();
      return res.status(409).json({ error: `Incident category "${cleanName}" already exists.` });
    }

    const [ins] = await conn.query(
      `INSERT INTO incident_categories (name, description, default_severity, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?)`,
      [cleanName, String(description || '').trim().slice(0, 500) || null, cleanSeverity, cleanOrder, Boolean(isActive)]
    );
    const [[created]] = await conn.query('SELECT * FROM incident_categories WHERE id = ?', [ins.insertId]);

    await logMaintenanceAudit(conn, {
      userId: req.user.id,
      action: 'CREATE_INCIDENT_CATEGORY',
      entityType: 'incident_categories',
      entityId: ins.insertId,
      oldValues: null,
      newValues: created,
      req,
    });
    await conn.commit();
    emitIncidentCategoriesUpdated({ action: 'created', categoryId: created.id });
    return res.status(201).json({ message: `Incident category "${cleanName}" created.`, category: created });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Admin Maintenance] createIncidentCategory failed:', err.message);
    return res.status(503).json({ error: 'Unable to create incident category.' });
  } finally {
    conn.release();
  }
}

async function updateIncidentCategory(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid category ID.' });

  const { name, description, defaultSeverity, sortOrder, isActive } = req.body || {};
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[existing]] = await conn.query('SELECT * FROM incident_categories WHERE id = ? FOR UPDATE', [id]);
    if (!existing) {
      await conn.rollback();
      return res.status(404).json({ error: 'Incident category not found.' });
    }

    const nextName = name !== undefined ? String(name || '').trim().slice(0, 100) : existing.name;
    if (!nextName || nextName.length < 2) {
      await conn.rollback();
      return res.status(400).json({ error: 'Incident category name must be at least 2 characters.' });
    }
    if (nextName.toLowerCase() !== String(existing.name || '').toLowerCase()) {
      const [dups] = await conn.query('SELECT id FROM incident_categories WHERE LOWER(name) = LOWER(?) AND id <> ? LIMIT 1', [nextName, id]);
      if (dups.length > 0) {
        await conn.rollback();
        return res.status(409).json({ error: `Incident category "${nextName}" already exists.` });
      }
    }

    const validSeverities = ['Low', 'Medium', 'High', 'Critical'];
    const nextSeverity = defaultSeverity !== undefined && validSeverities.includes(defaultSeverity)
      ? defaultSeverity
      : existing.default_severity;
    const nextDesc = description !== undefined ? (String(description || '').trim().slice(0, 500) || null) : existing.description;
    const nextOrder = sortOrder !== undefined && Number.isFinite(Number(sortOrder)) ? Math.round(Number(sortOrder)) : existing.sort_order;
    const nextActive = isActive !== undefined ? Boolean(isActive) : existing.is_active;

    await conn.query(
      `UPDATE incident_categories
       SET name = ?, description = ?, default_severity = ?, sort_order = ?, is_active = ?, updated_at = NOW()
       WHERE id = ?`,
      [nextName, nextDesc, nextSeverity, nextOrder, nextActive, id]
    );
    const [[updated]] = await conn.query('SELECT * FROM incident_categories WHERE id = ?', [id]);

    const action = isActive !== undefined && Boolean(isActive) !== Boolean(existing.is_active)
      ? (nextActive ? 'ACTIVATE_INCIDENT_CATEGORY' : 'DEACTIVATE_INCIDENT_CATEGORY')
      : 'UPDATE_INCIDENT_CATEGORY';

    await logMaintenanceAudit(conn, {
      userId: req.user.id,
      action,
      entityType: 'incident_categories',
      entityId: id,
      oldValues: existing,
      newValues: updated,
      req,
    });
    await conn.commit();
    emitIncidentCategoriesUpdated({
      action: isActive !== undefined && Boolean(isActive) !== Boolean(existing.is_active)
        ? (nextActive ? 'activated' : 'deactivated')
        : 'updated',
      categoryId: id,
    });
    return res.json({ message: `Incident category "${nextName}" updated.`, category: updated });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Admin Maintenance] updateIncidentCategory failed:', err.message);
    return res.status(503).json({ error: 'Unable to update incident category.' });
  } finally {
    conn.release();
  }
}

// ============================================================================
// 2. RESCUE REQUEST CATEGORIES (rescue_categories)
// ============================================================================
async function getRescueCategories(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT rc.id, rc.name, rc.display_label, rc.description, rc.sort_order, rc.is_active, rc.created_at, rc.updated_at,
              (SELECT COUNT(DISTINCT rq.id)::int FROM rescue_requests rq WHERE LOWER(TRIM(rq.emergency_type)) = LOWER(rc.name)) AS usage_count
       FROM rescue_categories rc
       ORDER BY rc.sort_order ASC, rc.id ASC`
    );
    return res.json({ categories: rows });
  } catch (err) {
    console.error('[Admin Maintenance] getRescueCategories failed:', err.message);
    return res.status(503).json({ error: 'Unable to load rescue categories.' });
  }
}

async function createRescueCategory(req, res) {
  const { name, displayLabel = '', description = '', sortOrder = 0, isActive = true } = req.body || {};
  const cleanName = String(name || '').trim().slice(0, 120);
  if (!cleanName || cleanName.length < 2) {
    return res.status(400).json({ error: 'Rescue category name (at least 2 characters) is required.' });
  }
  const cleanLabel = String(displayLabel || cleanName).trim().slice(0, 160);
  const cleanOrder = Number.isFinite(Number(sortOrder)) ? Math.round(Number(sortOrder)) : 0;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [dups] = await conn.query('SELECT id FROM rescue_categories WHERE LOWER(name) = LOWER(?) LIMIT 1', [cleanName]);
    if (dups.length > 0) {
      await conn.rollback();
      return res.status(409).json({ error: `Rescue category "${cleanName}" already exists.` });
    }

    const [ins] = await conn.query(
      `INSERT INTO rescue_categories (name, display_label, description, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?)`,
      [cleanName, cleanLabel, String(description || '').trim().slice(0, 500) || null, cleanOrder, Boolean(isActive)]
    );
    const [[created]] = await conn.query('SELECT * FROM rescue_categories WHERE id = ?', [ins.insertId]);

    await logMaintenanceAudit(conn, {
      userId: req.user.id,
      action: 'CREATE_RESCUE_CATEGORY',
      entityType: 'rescue_categories',
      entityId: ins.insertId,
      oldValues: null,
      newValues: created,
      req,
    });
    await conn.commit();
    emitRescueCategoriesUpdated({ action: 'created', categoryId: created.id });
    return res.status(201).json({ message: `Rescue category "${cleanName}" created.`, category: created });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Admin Maintenance] createRescueCategory failed:', err.message);
    return res.status(503).json({ error: 'Unable to create rescue category.' });
  } finally {
    conn.release();
  }
}

async function updateRescueCategory(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid category ID.' });

  const { name, displayLabel, description, sortOrder, isActive } = req.body || {};
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[existing]] = await conn.query('SELECT * FROM rescue_categories WHERE id = ? FOR UPDATE', [id]);
    if (!existing) {
      await conn.rollback();
      return res.status(404).json({ error: 'Rescue category not found.' });
    }

    const nextName = name !== undefined ? String(name || '').trim().slice(0, 120) : existing.name;
    if (!nextName || nextName.length < 2) {
      await conn.rollback();
      return res.status(400).json({ error: 'Rescue category name must be at least 2 characters.' });
    }
    if (nextName.toLowerCase() !== String(existing.name || '').toLowerCase()) {
      const [dups] = await conn.query('SELECT id FROM rescue_categories WHERE LOWER(name) = LOWER(?) AND id <> ? LIMIT 1', [nextName, id]);
      if (dups.length > 0) {
        await conn.rollback();
        return res.status(409).json({ error: `Rescue category "${nextName}" already exists.` });
      }
    }

    const nextLabel = displayLabel !== undefined ? (String(displayLabel || '').trim().slice(0, 160) || nextName) : existing.display_label;
    const nextDesc = description !== undefined ? (String(description || '').trim().slice(0, 500) || null) : existing.description;
    const nextOrder = sortOrder !== undefined && Number.isFinite(Number(sortOrder)) ? Math.round(Number(sortOrder)) : existing.sort_order;
    const nextActive = isActive !== undefined ? Boolean(isActive) : existing.is_active;

    await conn.query(
      `UPDATE rescue_categories
       SET name = ?, display_label = ?, description = ?, sort_order = ?, is_active = ?, updated_at = NOW()
       WHERE id = ?`,
      [nextName, nextLabel, nextDesc, nextOrder, nextActive, id]
    );
    const [[updated]] = await conn.query('SELECT * FROM rescue_categories WHERE id = ?', [id]);

    const action = isActive !== undefined && Boolean(isActive) !== Boolean(existing.is_active)
      ? (nextActive ? 'ACTIVATE_RESCUE_CATEGORY' : 'DEACTIVATE_RESCUE_CATEGORY')
      : 'UPDATE_RESCUE_CATEGORY';

    await logMaintenanceAudit(conn, {
      userId: req.user.id,
      action,
      entityType: 'rescue_categories',
      entityId: id,
      oldValues: existing,
      newValues: updated,
      req,
    });
    await conn.commit();
    emitRescueCategoriesUpdated({
      action: isActive !== undefined && Boolean(isActive) !== Boolean(existing.is_active)
        ? (nextActive ? 'activated' : 'deactivated')
        : 'updated',
      categoryId: id,
    });
    return res.json({ message: `Rescue category "${nextName}" updated.`, category: updated });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Admin Maintenance] updateRescueCategory failed:', err.message);
    return res.status(503).json({ error: 'Unable to update rescue category.' });
  } finally {
    conn.release();
  }
}

// ============================================================================
// 3. BROADCAST ALERT CATEGORIES (broadcast_categories update / toggle)
// ============================================================================
async function updateBroadcastCategory(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid category ID.' });

  const { name, badgeColor, priority, description, isActive } = req.body || {};
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[existing]] = await conn.query('SELECT * FROM broadcast_categories WHERE id = ? FOR UPDATE', [id]);
    if (!existing) {
      await conn.rollback();
      return res.status(404).json({ error: 'Broadcast category not found.' });
    }

    const nextName = name !== undefined ? String(name || '').trim().slice(0, 100) : existing.name;
    if (!nextName || nextName.length < 2) {
      await conn.rollback();
      return res.status(400).json({ error: 'Broadcast category name must be at least 2 characters.' });
    }
    if (nextName.toLowerCase() !== String(existing.name || '').toLowerCase()) {
      const [dups] = await conn.query('SELECT id FROM broadcast_categories WHERE LOWER(name) = LOWER(?) AND id <> ? LIMIT 1', [nextName, id]);
      if (dups.length > 0) {
        await conn.rollback();
        return res.status(409).json({ error: `Broadcast category "${nextName}" already exists.` });
      }
    }

    const allowedColors = ['blue', 'red', 'amber', 'emerald', 'slate'];
    const nextColor = badgeColor !== undefined && allowedColors.includes(String(badgeColor).toLowerCase())
      ? String(badgeColor).toLowerCase()
      : existing.badge_color;
    const nextPriority = priority !== undefined && Number.isFinite(Number(priority)) ? Math.round(Number(priority)) : existing.priority;
    const nextDesc = description !== undefined ? (String(description || '').trim().slice(0, 500) || null) : existing.description;
    const nextActive = isActive !== undefined ? Boolean(isActive) : existing.is_active;

    await conn.query(
      `UPDATE broadcast_categories
       SET name = ?, badge_color = ?, priority = ?, description = ?, is_active = ?, updated_at = NOW()
       WHERE id = ?`,
      [nextName, nextColor, nextPriority, nextDesc, nextActive, id]
    );
    const [[updated]] = await conn.query('SELECT * FROM broadcast_categories WHERE id = ?', [id]);

    const action = isActive !== undefined && Boolean(isActive) !== Boolean(existing.is_active)
      ? (nextActive ? 'ACTIVATE_BROADCAST_CATEGORY' : 'DEACTIVATE_BROADCAST_CATEGORY')
      : 'UPDATE_BROADCAST_CATEGORY';

    await logMaintenanceAudit(conn, {
      userId: req.user.id,
      action,
      entityType: 'broadcast_categories',
      entityId: id,
      oldValues: existing,
      newValues: updated,
      req,
    });
    await conn.commit();
    return res.json({ message: `Broadcast category "${nextName}" updated.`, category: updated });
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error('[Admin Maintenance] updateBroadcastCategory failed:', err.message);
    return res.status(503).json({ error: 'Unable to update broadcast category.' });
  } finally {
    conn.release();
  }
}

module.exports = {
  getIncidentCategories,
  createIncidentCategory,
  updateIncidentCategory,
  getRescueCategories,
  createRescueCategory,
  updateRescueCategory,
  updateBroadcastCategory,
};
