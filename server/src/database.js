import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import pg from "pg";

dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const { Pool } = pg;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

export async function initializeDatabase() {
  if (!pool) {
    console.warn("DATABASE_URL is unset; room data will be stored in memory.");
    return [];
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id UUID PRIMARY KEY,
      code VARCHAR(8) NOT NULL UNIQUE,
      leader_id UUID NOT NULL,
      route JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS room_members (
      id UUID PRIMARY KEY,
      room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      name VARCHAR(40) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (room_id, id)
    );
  `);

  const { rows } = await pool.query(`
    SELECT r.id AS room_id, r.code, r.leader_id, r.route, r.created_at,
           m.id AS member_id, m.name AS member_name
    FROM rooms r
    LEFT JOIN room_members m ON m.room_id = r.id
    ORDER BY r.created_at
  `);
  return rows;
}

export async function saveRoom(room) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO rooms (id, code, leader_id, route, created_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET route = EXCLUDED.route`,
    [room.id, room.code, room.leaderId, room.route, room.createdAt],
  );
}

export async function saveMember(roomId, member) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO room_members (id, room_id, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [member.id, roomId, member.name],
  );
}

export async function removeMember(roomId, memberId, nextLeaderId) {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!nextLeaderId) {
      await client.query("DELETE FROM rooms WHERE id = $1", [roomId]);
    } else {
      await client.query("UPDATE rooms SET leader_id = $2 WHERE id = $1", [roomId, nextLeaderId]);
      await client.query("DELETE FROM room_members WHERE room_id = $1 AND id = $2", [roomId, memberId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
