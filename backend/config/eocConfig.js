const DEFAULT_EOC_LOCATION = {
  name: 'GeoSafe Emergency Operations Center (Bayanan Barangay Hall)',
  address: 'Bayanan Barangay Hall, Bayanan Baywalk Ilaya, Muntinlupa, Metro Manila, Philippines',
  latitude: 14.41141,
  longitude: 121.05130,
};

async function getEocLocation(pool) {
  try {
    const [rows] = await pool.query(
      `SELECT setting_key, setting_value
       FROM system_settings
       WHERE setting_key IN ('eoc_location_name', 'eoc_address', 'eoc_latitude', 'eoc_longitude')`
    );
    const map = {};
    rows.forEach((r) => {
      map[r.setting_key] = r.setting_value;
    });

    const parsedLat = Number(map.eoc_latitude);
    const parsedLng = Number(map.eoc_longitude);
    const latitude = Number.isFinite(parsedLat) && parsedLat >= -90 && parsedLat <= 90
      ? parsedLat
      : DEFAULT_EOC_LOCATION.latitude;
    const longitude = Number.isFinite(parsedLng) && parsedLng >= -180 && parsedLng <= 180
      ? parsedLng
      : DEFAULT_EOC_LOCATION.longitude;
    const name = String(map.eoc_location_name || '').trim() || DEFAULT_EOC_LOCATION.name;
    const address = String(map.eoc_address || '').trim() || DEFAULT_EOC_LOCATION.address;

    return {
      name,
      address,
      latitude,
      longitude,
      coordinates: { lat: latitude, lng: longitude },
    };
  } catch (err) {
    return {
      ...DEFAULT_EOC_LOCATION,
      coordinates: {
        lat: DEFAULT_EOC_LOCATION.latitude,
        lng: DEFAULT_EOC_LOCATION.longitude,
      },
    };
  }
}

module.exports = {
  DEFAULT_EOC_LOCATION,
  getEocLocation,
};
