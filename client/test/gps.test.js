import test from "node:test";
import assert from "node:assert/strict";
import { geolocationErrorMessage, GPS_UPDATE_INTERVAL_MS, shouldPublishLocation } from "../src/gps.js";
import { routeProgress } from "../src/geo.js";
import demoRoadGeometry from "../src/demo-route.json" with { type: "json" };

test("GPS publishing is throttled unless the rider moved enough", () => {
  const previous = { location: { lat: 40, lng: 44 }, sentAt: 10_000 };
  assert.equal(shouldPublishLocation(previous, { lat: 40, lng: 44.00001 }, 11_000), false);
  assert.equal(shouldPublishLocation(previous, { lat: 40, lng: 44.0001 }, 11_000), false);
  assert.equal(shouldPublishLocation(previous, { lat: 40, lng: 44.0001 }, 12_000), true);
  assert.equal(shouldPublishLocation(previous, { lat: 40, lng: 44 }, 10_000 + GPS_UPDATE_INTERVAL_MS), false);
  assert.equal(shouldPublishLocation(previous, { lat: 40, lng: 44 }, 26_000), true);
  assert.equal(shouldPublishLocation(null, { lat: 40, lng: 44 }, 0), true);
});

test("geolocation permission and device errors have distinct user-facing states", () => {
  assert.equal(geolocationErrorMessage(1).status, "denied");
  assert.match(geolocationErrorMessage(1).message, /Permiso/);
  assert.equal(geolocationErrorMessage(2).status, "error");
  assert.equal(geolocationErrorMessage(3).status, "error");
});

test("route progress uses the measured route distance and detects off-route riders", () => {
  const coordinates = [[44, 40], [44.1, 40]];
  const progress = routeProgress({ lat: 40, lng: 44.05 }, coordinates, 10_000);
  assert.ok(progress);
  assert.ok(Math.abs(progress.distanceRemaining - 5_000) < 10);
  assert.ok(progress.deviation < 1);
  const offRoute = routeProgress({ lat: 41, lng: 44.05 }, coordinates, 10_000);
  assert.ok(offRoute.deviation > 100_000);
});

test("demo route has detailed road-following geometry and starts/ends at the snapped road points", () => {
  const coordinates = demoRoadGeometry.coordinates;
  assert.ok(coordinates.length > 100);
  assert.deepEqual(coordinates[0], [44.499357, 40.17918]);
  assert.deepEqual(coordinates.at(-1), [45.010458, 40.562717]);
  assert.ok(routeProgress({ lat: 40.201224, lng: 44.55406 }, coordinates)?.deviation < 25);
});
