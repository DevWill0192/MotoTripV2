import cors from "cors";
import express from "express";
import http from "node:http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { initializeDatabase } from "./database.js";
import { distanceMeters, isValidCoordinate, snapRouteEndpoints, validateLocation } from "./geo.js";
import { normalizeGeocodingResults, normalizeSearchQuery } from "./geocoding.js";
import { createRoom, hydrateRooms, joinRoom, publicRoom, removeMember, rooms } from "./rooms.js";
import { saveRoom } from "./database.js";

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const JWT_SECRET = process.env.JWT_SECRET || "local-development-secret-change-before-deploying";
const ROUTING_URL = (process.env.ROUTING_URL || "https://router.project-osrm.org").replace(/\/$/, "");

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production.");
}

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGINS, methods: ["GET", "POST"] },
});
const activeSockets = new Map();
const joinAttempts = new Map();
const geocodeAttempts = new Map();
const geocodeCache = new Map();
let lastGeocodeStartedAt = 0;
let geocodeQueue = Promise.resolve();

app.use(cors({ origin: CLIENT_ORIGINS }));
app.use(express.json({ limit: "64kb" }));

function limitJoinAttempts(req, res, next) {
  const now = Date.now();
  for (const [ip, attempt] of joinAttempts) {
    if (now - attempt.startedAt > 60_000) joinAttempts.delete(ip);
  }
  const ip = req.ip || "unknown";
  const attempt = joinAttempts.get(ip);
  if (attempt && now - attempt.startedAt < 60_000 && attempt.count >= 10) {
    return res.status(429).json({ error: "Demasiados intentos. Espera un minuto antes de volver a probar." });
  }
  if (!attempt || now - attempt.startedAt >= 60_000) joinAttempts.set(ip, { startedAt: now, count: 1 });
  else attempt.count += 1;
  next();
}

function issueToken(roomId, memberId) {
  return jwt.sign({ roomId, memberId }, JWT_SECRET, { expiresIn: "30d" });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function bearerMember(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Se requiere un token de sala." });
  try {
    const identity = verifyToken(token);
    const room = rooms.get(identity.roomId);
    const member = room?.members.get(identity.memberId);
    if (!room || !member) return res.status(401).json({ error: "El acceso a esta sala ya no es válido." });
    req.identity = identity;
    req.room = room;
    req.member = member;
    next();
  } catch {
    return res.status(401).json({ error: "El token de sala no es válido o ha caducado." });
  }
}

function roomSnapshot(room) {
  return publicRoom(room);
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/rooms/create", async (req, res, next) => {
  try {
    const { room, member } = await createRoom(req.body?.name);
    res.status(201).json({
      room: roomSnapshot(room),
      memberId: member.id,
      accessToken: issueToken(room.id, member.id),
    });
  } catch (error) {
    if (error.message.startsWith("El nombre")) return res.status(400).json({ error: error.message });
    next(error);
  }
});

app.post("/api/rooms/join", limitJoinAttempts, async (req, res, next) => {
  try {
    const { room, member } = await joinRoom(req.body?.code, req.body?.name);
    res.status(200).json({
      room: roomSnapshot(room),
      memberId: member.id,
      accessToken: issueToken(room.id, member.id),
    });
  } catch (error) {
    if (error.message.startsWith("El nombre") || error.message.startsWith("No encontramos")) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

app.get("/api/rooms/current", bearerMember, (req, res) => {
  res.json({ room: roomSnapshot(req.room), memberId: req.member.id });
});

app.get("/api/geocode", bearerMember, async (req, res) => {
  const query = normalizeSearchQuery(req.query.q);
  if (!query) return res.status(400).json({ error: "Escribe al menos 3 caracteres y hasta 120 para buscar un lugar." });

  const now = Date.now();
  const lastAttempt = geocodeAttempts.get(req.member.id) || 0;
  if (now - lastAttempt < 1000) {
    return res.status(429).json({ error: "Espera un momento antes de buscar otra dirección." });
  }
  geocodeAttempts.set(req.member.id, now);

  const cacheKey = query.toLocaleLowerCase("es");
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return res.json({ results: cached.results });

  try {
    const queuedRequest = geocodeQueue.then(async () => {
      const delay = Math.max(0, 1000 - (Date.now() - lastGeocodeStartedAt));
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      lastGeocodeStartedAt = Date.now();
    });
    geocodeQueue = queuedRequest.catch(() => {});
    await queuedRequest;

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "5");
    url.searchParams.set("accept-language", "es");
    const response = await fetch(url, {
      headers: {
        "User-Agent": `MotoTrips/1.0 (${process.env.APP_CONTACT_EMAIL || "geocoding contact configured by deployment"})`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 429) {
      return res.status(503).json({ error: "El servicio de búsqueda está ocupado. Prueba de nuevo en unos segundos." });
    }
    if (!response.ok) throw new Error(`Nominatim responded with ${response.status}`);
    const results = normalizeGeocodingResults(await response.json());
    geocodeCache.set(cacheKey, { results, expiresAt: Date.now() + 5 * 60_000 });
    res.json({ results });
  } catch (error) {
    console.error("Geocoding request failed:", error);
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return res.status(504).json({ error: "La búsqueda tardó demasiado. Inténtalo de nuevo." });
    }
    res.status(502).json({ error: "No se pudo buscar la dirección. Comprueba tu conexión e inténtalo de nuevo." });
  }
});

app.post("/api/rooms/leave", bearerMember, async (req, res, next) => {
  const { room, member } = req;
  const roomId = room.id;
  const memberId = member.id;
  const connectedSocketIds = activeSockets.get(memberId) || new Set();
  try {
    const result = await removeMember(room, memberId);
    activeSockets.delete(memberId);
    for (const socketId of connectedSocketIds) io.sockets.sockets.get(socketId)?.disconnect(true);
    if (result.room) {
      io.to(roomId).emit("room-state", roomSnapshot(result.room));
      emitMemberStatuses(result.room);
    }
    res.json({ ok: true, newLeaderId: result.newLeaderId });
  } catch (error) {
    next(error);
  }
});

app.post("/api/routes/calculate", bearerMember, async (req, res, next) => {
  const { origin, destination } = req.body ?? {};
  if (!isValidCoordinate(origin) || !isValidCoordinate(destination)) {
    return res.status(400).json({ error: "El origen y el destino deben ser coordenadas válidas." });
  }
  if (req.member.id !== req.room.leaderId) {
    return res.status(403).json({ error: "Solo quien creó la sala puede actualizar la ruta compartida." });
  }
  try {
    const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const url = `${ROUTING_URL}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`;
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`El servicio de rutas respondió ${response.status}.`);
    const result = await response.json();
    const route = result.routes?.[0];
    if (!route?.geometry?.coordinates?.length) throw new Error("No se encontró una ruta por carretera.");
    const endpoints = snapRouteEndpoints(result.waypoints, origin, destination);
    res.json({
      route: {
        ...endpoints,
        originLabel: typeof req.body.originLabel === "string" ? req.body.originLabel.slice(0, 240) : "",
        destinationLabel: typeof req.body.destinationLabel === "string" ? req.body.destinationLabel.slice(0, 240) : "",
        geometry: route.geometry,
        distance: route.distance,
        duration: route.duration,
        source: "osrm",
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return res.status(504).json({ error: "El servicio de rutas tardó demasiado. Inténtalo de nuevo." });
    }
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Error interno del servidor." });
});

io.use((socket, next) => {
  try {
    const identity = verifyToken(socket.handshake.auth?.accessToken);
    const room = rooms.get(identity.roomId);
    const member = room?.members.get(identity.memberId);
    if (!room || !member) return next(new Error("Acceso a sala no válido."));
    socket.data.identity = identity;
    socket.data.room = room;
    socket.data.member = member;
    next();
  } catch {
    next(new Error("Autenticación de sala no válida."));
  }
});

function roomLocations(room) {
  return [...room.members.values()]
    .filter((member) => member.location)
    .map((member) => ({ ...member.location, userId: member.id, name: member.name }));
}

function emitMemberStatuses(room) {
  io.to(room.id).emit("member-status", publicRoom(room).members.map(({ id, name, connected }) => ({
    userId: id,
    name,
    connected,
  })));
}

io.on("connection", (socket) => {
  const { room, member } = socket.data;
  socket.join(room.id);
  let sockets = activeSockets.get(member.id);
  if (!sockets) activeSockets.set(member.id, sockets = new Set());
  sockets.add(socket.id);
  member.connected = true;
  let lastLocationEventAt = 0;
  socket.emit("room-state", roomSnapshot(room));
  socket.emit("users-location", roomLocations(room));
  emitMemberStatuses(room);

  socket.on("location-update", (payload, acknowledge = () => {}) => {
    const error = validateLocation(payload);
    if (error) return acknowledge({ ok: false, error });
    if (Date.now() - lastLocationEventAt < 500) {
      return acknowledge({ ok: false, error: "Las actualizaciones GPS llegan demasiado rápido." });
    }
    lastLocationEventAt = Date.now();

    const nextLocation = {
      lat: payload.lat,
      lng: payload.lng,
      accuracy: payload.accuracy,
      timestamp: payload.timestamp,
    };
    const previous = member.location;
    if (previous && payload.timestamp <= previous.timestamp) {
      return acknowledge({ ok: true, ignored: true });
    }
    const movementMeters = previous ? distanceMeters(previous, nextLocation) : Infinity;
    if (previous && movementMeters < 3) {
      member.location = nextLocation;
      if (Date.now() - previous.timestamp < 15_000) {
        return acknowledge({ ok: true, ignored: true });
      }
    }
    member.location = nextLocation;
    io.to(room.id).emit("users-location", roomLocations(room));
    acknowledge({ ok: true });
  });

  socket.on("update-route", async (route, acknowledge = () => {}) => {
    if (member.id !== room.leaderId) {
      return acknowledge({ ok: false, error: "Solo quien creó la sala puede actualizar la ruta." });
    }
    if (
      !route
      || !isValidCoordinate(route.origin)
      || !isValidCoordinate(route.destination)
      || !route.geometry
      || route.geometry.type !== "LineString"
      || !Array.isArray(route.geometry.coordinates)
      || route.geometry.coordinates.length < 2
      || route.geometry.coordinates.length > 100_000
      || !route.geometry.coordinates.every((point) =>
        Array.isArray(point)
        && point.length === 2
        && Number.isFinite(point[0])
        && Number.isFinite(point[1])
        && Math.abs(point[0]) <= 180
        && Math.abs(point[1]) <= 90)
      || !Number.isFinite(route.distance)
      || route.distance <= 0
      || !Number.isFinite(route.duration)
      || route.duration <= 0
    ) {
      return acknowledge({ ok: false, error: "La ruta recibida no es válida." });
    }
    room.route = {
      origin: route.origin,
      destination: route.destination,
      originLabel: typeof route.originLabel === "string" ? route.originLabel.slice(0, 240) : "",
      destinationLabel: typeof route.destinationLabel === "string" ? route.destinationLabel.slice(0, 240) : "",
      geometry: route.geometry,
      distance: route.distance,
      duration: route.duration,
      source: route.source === "osrm" ? "osrm" : "unknown",
      updatedAt: new Date().toISOString(),
    };
    try {
      await saveRoom(room);
      io.to(room.id).emit("route-updated", room.route);
      acknowledge({ ok: true });
    } catch (error) {
      console.error("Could not save route:", error);
      acknowledge({ ok: false, error: "No se pudo guardar la ruta compartida." });
    }
  });

  socket.on("disconnect", () => {
    const currentSockets = activeSockets.get(member.id);
    currentSockets?.delete(socket.id);
    if (currentSockets?.size) return;
    activeSockets.delete(member.id);
    member.connected = false;
    emitMemberStatuses(room);
  });
});

const storedRows = await initializeDatabase();
hydrateRooms(storedRows);
httpServer.listen(PORT, () => {
  console.log(`Moto Trips API and Socket.IO listening on http://localhost:${PORT}`);
});
