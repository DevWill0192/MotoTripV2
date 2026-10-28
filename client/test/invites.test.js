import test from "node:test";
import assert from "node:assert/strict";
import { createInviteUrl, readInviteCode } from "../src/invites.js";

test("invite links keep the app URL and provide a prefilled room code", () => {
  const inviteUrl = createInviteUrl(
    { href: "https://moto.example/trips?campaign=summer#map" },
    "A7K2MN",
  );
  const parsed = new URL(inviteUrl);
  assert.equal(parsed.pathname, "/trips");
  assert.equal(parsed.searchParams.get("campaign"), "summer");
  assert.equal(parsed.searchParams.get("join"), "A7K2MN");
  assert.equal(parsed.hash, "");
  assert.equal(readInviteCode(parsed.search), "A7K2MN");
});

test("invite code parser handles absent and lowercase codes", () => {
  assert.equal(readInviteCode(""), "");
  assert.equal(readInviteCode("?join=a7k2mn"), "A7K2MN");
});
