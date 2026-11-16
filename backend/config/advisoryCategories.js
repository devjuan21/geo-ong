const BADGE_COLOR_TO_ALERT_SEVERITY = {
  red: 'critical',
  orange: 'critical',
  amber: 'medium',
  indigo: 'critical',
  cyan: 'medium',
  blue: 'medium',
  green: 'low',
  purple: 'low',
  gray: 'low',
};

function alertSeverityForCategory(categoryRow) {
  if (!categoryRow) return 'medium';
  const priority = Number(categoryRow.priority || 5);
  if (priority <= 2) return 'critical';
  const color = String(categoryRow.badge_color || '').toLowerCase();
  return BADGE_COLOR_TO_ALERT_SEVERITY[color] || 'medium';
}

function broadcastSeverityForCategory(categoryRow) {
  if (!categoryRow) return 'Advisory';
  const priority = Number(categoryRow.priority || 5);
  const name = String(categoryRow.name || '').toLowerCase();
  if (name.includes('evacuation')) return 'Critical Evacuation';
  if (priority <= 2) return 'Warning';
  if (priority === 3) return 'Watch';
  return 'Advisory';
}

function defaultColorForName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (n.includes('weather')) return 'blue';
  if (n.includes('flood')) return 'cyan';
  if (n.includes('typhoon')) return 'indigo';
  if (n.includes('earthquake')) return 'amber';
  if (n.includes('fire') || n.includes('emergency')) return 'red';
  if (n.includes('evacuation')) return 'orange';
  if (n.includes('health')) return 'green';
  if (n.includes('water')) return 'purple';
  return 'gray';
}

module.exports = {
  alertSeverityForCategory,
  broadcastSeverityForCategory,
  severityForCategory: alertSeverityForCategory,
  defaultColorForName,
};
