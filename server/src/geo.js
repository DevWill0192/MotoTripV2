export function isValidCoordinate(point) {
  return point !== null
    && typeof point === "object"
    && Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    && point.lat >= -90
    && point.lat <= 90
    && point.lng >= -180
    && point.lng <= 180;
}

export function snapRouteEndpoints(waypoints, origin, destination) {
  const toCoordinate = (waypoint, fallback) => {
    const [lng, lat] = waypoint?.location ?? [];
    const snapped = { lat, lng };
    return isValidCoordinate(snapped) ? snapped : fallback;
  };
  return {
    origin: toCoordinate(waypoints?.[0], origin),
    destination: toCoordinate(waypoints?.[1], destination),
  };
}

export function validateLocation(payload) {
  if (!payload || !isValidCoordinate(payload)) return "Coordenadas GPS no válidas.";
  if (!Number.isFinite(payload.accuracy) || payload.accuracy < 0 || payload.accuracy > 10000) {
    return "La precisión GPS no es válida.";
  }
  if (!Number.isFinite(payload.timestamp)) return "La marca de tiempo GPS no es válida.";
  const age = Date.now() - payload.timestamp;
  if (age > 5 * 60 * 1000 || age < -30 * 1000) return "La ubicación recibida está obsoleta.";
  return null;
}

export function distanceMeters(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = radians(b.lng - a.lng);
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
