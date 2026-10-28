import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { io } from "socket.io-client";

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function waitForEvent(socket, event, predicate = () => true, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const listener = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(payload);
    };
    socket.on(event, listener);
  });
}

function connectSocket(url, token, beforeConnect = () => {}) {
  const socket = io(url, {
    auth: { accessToken: token },
    autoConnect: false,
    reconnection: false,
    timeout: 3000,
  });
  const connected = new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  beforeConnect(socket);
  socket.connect();
  return connected.then(() => socket);
}

test("authenticated sockets broadcast GPS and routes only to room members", async () => {
  const port = await unusedPort();
  const apiUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      CLIENT_ORIGIN: "http://localhost:5173",
      DATABASE_URL: "",
      JWT_SECRET: "integration-test-secret",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const sockets = [];
  let childOutput = "";
  child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });

  try {
    let healthy = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Server exited: ${childOutput}`);
      try {
        const response = await fetch(`${apiUrl}/api/health`);
        if (response.ok) { healthy = true; break; }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.equal(healthy, true, `Server did not start: ${childOutput}`);

    const request = async (path, body) => {
      const response = await fetch(`${apiUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    };
    const leader = await request("/api/rooms/create", { name: "Will" });
    const teammate = await request("/api/rooms/join", { name: "Juan", code: leader.data.room.code });
    const outsider = await request("/api/rooms/create", { name: "José" });
    assert.equal(leader.status, 201);
    assert.equal(teammate.data.room.id, leader.data.room.id);
    assert.notEqual(outsider.data.room.id, leader.data.room.id);
    assert.equal((await fetch(`${apiUrl}/api/rooms/current`)).status, 401);
    assert.equal((await fetch(`${apiUrl}/api/geocode?q=Armenia`)).status, 401);

    const [leaderSocket, teammateSocket, outsiderSocket] = await Promise.all([
      connectSocket(apiUrl, leader.data.accessToken),
      connectSocket(apiUrl, teammate.data.accessToken),
      connectSocket(apiUrl, outsider.data.accessToken),
    ]);
    sockets.push(leaderSocket, teammateSocket, outsiderSocket);
    const invalidSocket = io(apiUrl, { auth: { accessToken: "invalid-token" }, autoConnect: false, reconnection: false });
    const rejectedConnection = waitForEvent(invalidSocket, "connect_error");
    invalidSocket.connect();
    assert.match((await rejectedConnection).message, /Autenticación/);
    invalidSocket.disconnect();
    let leakedEvents = 0;
    outsiderSocket.on("users-location", () => { leakedEvents += 1; });
    outsiderSocket.on("route-updated", () => { leakedEvents += 1; });

    const gpsReceived = waitForEvent(
      teammateSocket,
      "users-location",
      (locations) => locations.some((location) => location.userId === leader.data.memberId),
    );
    const badLocation = await new Promise((resolve) => leaderSocket.emit(
      "location-update",
      { lat: 400, lng: 44, accuracy: 5, timestamp: Date.now() },
      resolve,
    ));
    assert.equal(badLocation.ok, false);
    const goodLocation = await new Promise((resolve) => leaderSocket.emit(
      "location-update",
      { lat: 40.1, lng: 44.5, accuracy: 5, timestamp: Date.now() },
      resolve,
    ));
    assert.equal(goodLocation.ok, true);
    await gpsReceived;

    const route = {
      origin: { lat: 40, lng: 44 },
      destination: { lat: 40.1, lng: 44.1 },
      originLabel: "Plaza de la República",
      destinationLabel: "Lago Seván",
      geometry: { type: "LineString", coordinates: [[44, 40], [44.1, 40.1]] },
      distance: 1000,
      duration: 100,
      source: "demo",
    };
    const forbiddenUpdate = await new Promise((resolve) => teammateSocket.emit("update-route", route, resolve));
    assert.equal(forbiddenUpdate.ok, false);
    assert.match(forbiddenUpdate.error, /Solo/);

    const sharedRoute = waitForEvent(
      teammateSocket,
      "route-updated",
      (received) => received.distance === route.distance && received.destinationLabel === route.destinationLabel,
    );
    const allowedUpdate = await new Promise((resolve) => leaderSocket.emit("update-route", route, resolve));
    assert.equal(allowedUpdate.ok, true);
    await sharedRoute;
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(leakedEvents, 0);

    const disconnectedStatus = waitForEvent(
      leaderSocket,
      "member-status",
      (statuses) => statuses.some((status) => status.userId === teammate.data.memberId && !status.connected),
    );
    teammateSocket.disconnect();
    await disconnectedStatus;

    let reconnectedState;
    const reconnectedSocket = await connectSocket(apiUrl, teammate.data.accessToken, (socket) => {
      reconnectedState = waitForEvent(socket, "room-state");
    });
    sockets.push(reconnectedSocket);
    const restoredRoom = await reconnectedState;
    assert.equal(restoredRoom.members.filter((member) => member.id === teammate.data.memberId).length, 1);

    const updatedRoom = waitForEvent(
      reconnectedSocket,
      "room-state",
      (state) => !state.members.some((member) => member.id === leader.data.memberId),
    );
    const leaveResponse = await fetch(`${apiUrl}/api/rooms/leave`, {
      method: "POST",
      headers: { Authorization: `Bearer ${leader.data.accessToken}` },
    });
    const leaveResult = await leaveResponse.json();
    assert.equal(leaveResponse.status, 200);
    assert.equal(leaveResult.newLeaderId, teammate.data.memberId);
    await updatedRoom;
  } finally {
    for (const socket of sockets) socket.disconnect();
    child.kill("SIGTERM");
    await once(child, "exit");
  }
});
