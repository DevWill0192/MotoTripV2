import test from "node:test";
import assert from "node:assert/strict";
import { distanceMeters, isValidCoordinate, snapRouteEndpoints, validateLocation } from "../src/geo.js";
import { normalizeGeocodingResults, normalizeSearchQuery } from "../src/geocoding.js";

test("validates coordinate boundaries and rejects malformed GPS locations", () => {
  assert.equal(isValidCoordinate({ lat: 90, lng: 180 }), true);
  assert.equal(isValidCoordinate({ lat: 91, lng: 0 }), false);
  assert.notEqual(validateLocation({ lat: 0, lng: 0, accuracy: -1, timestamp: Date.now() }), null);
  assert.notEqual(validateLocation({ lat: 0, lng: 0, accuracy: 10, timestamp: 0 }), null);
});

test("calculates geographic distances in meters", () => {
  const meters = distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
  assert.ok(meters > 111_000 && meters < 112_000);
});

test("uses road-snapped routing waypoints as route endpoints", () => {
  const origin = { lat: 40, lng: 44 };
  const destination = { lat: 41, lng: 45 };
  assert.deepEqual(snapRouteEndpoints([
    { location: [44.001, 40.001] },
    { location: [45.002, 41.002] },
  ], origin, destination), {
    origin: { lat: 40.001, lng: 44.001 },
    destination: { lat: 41.002, lng: 45.002 },
  });
  assert.deepEqual(snapRouteEndpoints([], origin, destination), { origin, destination });
});

test("validates place searches and filters invalid geocoder coordinates", () => {
  assert.equal(normalizeSearchQuery("  Armenia  "), "Armenia");
  assert.equal(normalizeSearchQuery("ab"), null);
  const results = normalizeGeocodingResults([
    { place_id: 1, lat: "40.2", lon: "44.5", name: "Centro", display_name: "Centro, Armenia", address: { suburb: "Kentron" } },
    { place_id: 2, lat: "95", lon: "44", name: "Bad" },
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].neighborhood, "Kentron");
  assert.equal(results[0].lat, 40.2);
});
