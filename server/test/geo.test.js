import test from "node:test";
import assert from "node:assert/strict";
import { distanceMeters, isValidCoordinate, validateLocation } from "../src/geo.js";
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
