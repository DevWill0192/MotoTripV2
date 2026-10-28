import { randomInt, randomUUID } from "node:crypto";
import { removeMember as removePersistedMember, saveMember, saveRoom } from "./database.js";

export const rooms = new Map();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
  } while ([...rooms.values()].some((room) => room.code === code));
  return code;
}

function normalizeName(name) {
  if (typeof name !== "string") return null;
  const normalized = name.trim().replace(/\s+/g, " ").slice(0, 40);
  return normalized.length >= 2 ? normalized : null;
}

export async function createRoom(name) {
  const normalizedName = normalizeName(name);
  if (!normalizedName) throw new Error("El nombre debe tener entre 2 y 40 caracteres.");
  const member = { id: randomUUID(), name: normalizedName, location: null, connected: false };
  const room = {
    id: randomUUID(),
    code: createCode(),
    leaderId: member.id,
    route: null,
    createdAt: new Date().toISOString(),
    members: new Map([[member.id, member]]),
  };
  rooms.set(room.id, room);
  await saveRoom(room);
  await saveMember(room.id, member);
  return { room, member };
}

export async function joinRoom(code, name) {
  const normalizedCode = typeof code === "string" ? code.trim().toUpperCase() : "";
  const room = [...rooms.values()].find((candidate) => candidate.code === normalizedCode);
  if (!room) throw new Error("No encontramos una sala con ese código.");
  const normalizedName = normalizeName(name);
  if (!normalizedName) throw new Error("El nombre debe tener entre 2 y 40 caracteres.");
  const member = { id: randomUUID(), name: normalizedName, location: null, connected: false };
  room.members.set(member.id, member);
  await saveMember(room.id, member);
  return { room, member };
}

export function hydrateRooms(rows) {
  for (const row of rows) {
    let room = rooms.get(row.room_id);
    if (!room) {
      room = {
        id: row.room_id,
        code: row.code,
        leaderId: row.leader_id,
        route: row.route,
        createdAt: new Date(row.created_at).toISOString(),
        members: new Map(),
      };
      rooms.set(room.id, room);
    }
    if (row.member_id) {
      room.members.set(row.member_id, {
        id: row.member_id,
        name: row.member_name,
        location: null,
        connected: false,
      });
    }
  }
}

export function publicRoom(room) {
  return {
    id: room.id,
    code: room.code,
    leaderId: room.leaderId,
    route: room.route,
    createdAt: room.createdAt,
    members: [...room.members.values()].map(({ id, name, location, connected }) => ({
      id,
      name,
      location,
      connected,
    })),
  };
}

export async function removeMember(room, memberId) {
  if (!room.members.has(memberId)) return { room, newLeaderId: room.leaderId };
  const nextLeaderId = room.leaderId === memberId
    ? [...room.members.keys()].find((id) => id !== memberId) ?? null
    : room.leaderId;
  await removePersistedMember(room.id, memberId, nextLeaderId);
  room.members.delete(memberId);
  room.leaderId = nextLeaderId;
  if (!room.members.size) {
    rooms.delete(room.id);
    return { room: null, newLeaderId: null };
  }
  return { room, newLeaderId: room.leaderId };
}
