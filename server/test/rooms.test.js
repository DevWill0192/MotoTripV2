import test from "node:test";
import assert from "node:assert/strict";
import { createRoom, joinRoom, removeMember, rooms } from "../src/rooms.js";

test("creates uniquely coded rooms and joins only by the shared code", async () => {
  const created = await createRoom("Will");
  assert.equal(created.room.members.size, 1);
  assert.equal(created.room.leaderId, created.member.id);
  const joined = await joinRoom(created.room.code.toLowerCase(), "Juan");
  assert.equal(joined.room.id, created.room.id);
  assert.equal(joined.room.members.size, 2);
  await assert.rejects(joinRoom("NOTREAL", "José"), /No encontramos/);
});

test("rejects empty or overlong names without creating members", async () => {
  await assert.rejects(createRoom(" "), /nombre/);
  await assert.rejects(joinRoom("INVALID", "x"), /No encontramos/);
});

test("removes an empty room when its last member leaves", async () => {
  const { room, member } = await createRoom("José");
  const result = await removeMember(room, member.id);
  assert.equal(result.room, null);
  assert.equal(result.newLeaderId, null);
  assert.equal(rooms.has(room.id), false);
});
