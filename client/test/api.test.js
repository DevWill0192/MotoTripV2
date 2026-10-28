import test from "node:test";
import assert from "node:assert/strict";
import { readApiResponse, requestApi } from "../src/api.js";

test("reports a useful error when a deployment has no backend URL", async () => {
  await assert.rejects(
    requestApi("/api/rooms/create", {}, { isDevelopment: false, fetchImpl: async () => { throw new Error("must not fetch"); } }),
    /backend de QA todavía no está conectado/,
  );
});

test("does not mistake an HTML SPA fallback for a successful API response", async () => {
  const response = new Response("<!doctype html><html></html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  await assert.rejects(readApiResponse(response), /backend de QA todavía no está conectado/);
});

test("surfaces API JSON errors and parses successful JSON responses", async () => {
  const failure = new Response(JSON.stringify({ error: "Sala no encontrada." }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
  await assert.rejects(readApiResponse(failure), /Sala no encontrada/);

  const result = await requestApi("/api/health", {}, {
    baseUrl: "https://api.example.test",
    fetchImpl: async (url) => {
      assert.equal(url, "https://api.example.test/api/health");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.deepEqual(result, { ok: true });
});
