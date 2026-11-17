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
  defaultColorForName,
};
