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

export function routeProgress(location, coordinates, measuredRouteDistance) {
  if (!location || !coordinates || coordinates.length < 2) return null;
  let distanceFromStart = 0;
  let nearestDistance = Infinity;
  let nearestProgress = 0;
  let totalDistance = 0;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const [lng1, lat1] = coordinates[index];
    const [lng2, lat2] = coordinates[index + 1];
    const segmentLength = distanceMeters({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
    const midpointLat = (lat1 + lat2) / 2;
    const scaleLng = Math.cos(midpointLat * Math.PI / 180);
    const x = (location.lng - lng1) * scaleLng;
    const y = location.lat - lat1;
    const dx = (lng2 - lng1) * scaleLng;
    const dy = lat2 - lat1;
    const denominator = dx * dx + dy * dy;
    const fraction = denominator === 0 ? 0 : Math.max(0, Math.min(1, (x * dx + y * dy) / denominator));
    const projected = { lat: lat1 + fraction * (lat2 - lat1), lng: lng1 + fraction * (lng2 - lng1) };
    const gap = distanceMeters(location, projected);
    if (gap < nearestDistance) {
      nearestDistance = gap;
      nearestProgress = distanceFromStart + segmentLength * fraction;
    }
    distanceFromStart += segmentLength;
    totalDistance += segmentLength;
  }

  const roadDistance = Number.isFinite(measuredRouteDistance) && measuredRouteDistance > 0
    ? measuredRouteDistance : totalDistance;
  const progressFraction = totalDistance ? nearestProgress / totalDistance : 0;
  return {
    distanceAlongRoute: nearestProgress,
    distanceRemaining: Math.max(0, roadDistance * (1 - progressFraction)),
    routeDistance: roadDistance,
    deviation: nearestDistance,
    fraction: progressFraction,
  };
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "—";
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const minutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}
