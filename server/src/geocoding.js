export function normalizeSearchQuery(value) {
  if (typeof value !== "string") return null;
  const query = value.trim().replace(/\s+/g, " ");
  return query.length >= 3 && query.length <= 120 ? query : null;
}

export function normalizeGeocodingResults(results) {
  if (!Array.isArray(results)) return [];
  return results.flatMap((result) => {
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return [];
    }
    const address = result.address ?? {};
    const neighborhood = address.neighbourhood || address.suburb || address.city_district || address.village;
    const name = result.name || neighborhood || result.display_name?.split(",")[0] || "Lugar";
    return [{
      id: String(result.place_id),
      name: String(name).slice(0, 100),
      displayName: String(result.display_name || name).slice(0, 240),
      neighborhood: neighborhood ? String(neighborhood).slice(0, 100) : "",
      lat,
      lng,
    }];
  });
}
