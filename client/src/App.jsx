import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleUserRound, LocateFixed, MapPin, MapPinned, Menu, Minus, Navigation, Plus, Radio, Route, Search, Users, X } from "lucide-react";
import { Circle, MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import demoRoadGeometry from "./demo-route.json";
import { distanceMeters, formatDistance, formatDuration, routeProgress } from "./geo.js";
import { geolocationErrorMessage, shouldPublishLocation } from "./gps.js";
import { createInviteUrl, readInviteCode } from "./invites.js";

const API_URL = import.meta.env.VITE_API_URL || "";
const demoOrigin = { lat: 40.17918, lng: 44.499357 };
const demoDestination = { lat: 40.562717, lng: 45.010458 };
const defaultCenter = [demoOrigin.lat, demoOrigin.lng];
const demoRoute = {
  origin: demoOrigin,
  destination: demoDestination,
  geometry: demoRoadGeometry,
  distance: 69_468,
  duration: 3_960,
  source: "demo",
  updatedAt: new Date().toISOString(),
};

const demoMembers = [
  { id: "demo-will", name: "Will", connected: true, location: { lat: 40.201224, lng: 44.55406, accuracy: 6, timestamp: Date.now() } },
  { id: "demo-juan", name: "Juan", connected: true, location: { lat: 40.326466, lng: 44.637032, accuracy: 8, timestamp: Date.now() } },
  { id: "demo-jose", name: "José", connected: true, location: { lat: 40.500689, lng: 44.789972, accuracy: 5, timestamp: Date.now() } },
];

const palette = ["#55a8ff", "#38d996", "#ff826d", "#b698ff", "#ffc655", "#5bd0df"];
const markerIcon = (name, color, isMe = false) => L.divIcon({
  className: "person-marker-shell",
  html: `<div class="person-marker ${isMe ? "person-marker-me" : ""}" style="--marker-color:${color}">
    <span class="marker-dot">${isMe ? "●" : ""}</span><span class="marker-name">${isMe ? "Yo" : escapeHtml(name)}</span>
  </div>`,
  iconSize: [92, 40],
  iconAnchor: [13, 36],
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function pointIcon(kind) {
  return L.divIcon({
    className: "route-point-shell",
    html: `<div class="route-point-marker"><span class="route-point-dot route-point-${kind}"></span><span class="route-point-label">${kind === "start" ? "Inicio" : "Destino"}</span></div>`,
    iconSize: [90, 30],
    iconAnchor: [11, 15],
  });
}

function MapController({ action, pickMode, onPick, route, ownLocation }) {
  const map = useMap();
  const centeredOnGps = useRef(false);
  useEffect(() => {
    if (!action) return;
    if (action.type === "center" && action.point) map.flyTo([action.point.lat, action.point.lng], Math.max(map.getZoom(), 14));
    if (action.type === "fit" && action.points.length) {
      const bounds = L.latLngBounds(action.points.map(({ lat, lng }) => [lat, lng]));
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
    }
    if (action.type === "zoom-in") map.zoomIn();
    if (action.type === "zoom-out") map.zoomOut();
  }, [action, map]);
  useEffect(() => {
    const coordinates = route?.geometry?.coordinates;
    if (!coordinates || coordinates.length < 2) return;
    const bounds = L.latLngBounds(coordinates.map(([lng, lat]) => [lat, lng]));
    map.fitBounds(bounds, { padding: [72, 72], maxZoom: 13 });
  }, [map, route?.updatedAt, route?.geometry]);
  useEffect(() => {
    if (route || !ownLocation || centeredOnGps.current) return;
    centeredOnGps.current = true;
    map.flyTo([ownLocation.lat, ownLocation.lng], 15);
  }, [map, ownLocation, route]);
  useMapEvents({
    click(event) {
      if (pickMode) onPick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

function SessionMap({ session, members, route, gps, mapAction, pickMode, onPick, onGroup, draftOrigin, draftDestination }) {
  const ownMember = members.find((member) => member.id === session?.memberId);
  const visibleMembers = members.filter((member) => member.location);
  const routeCoords = route?.geometry?.coordinates?.map(([lng, lat]) => [lat, lng]) ?? [];
  const initialCenter = ownMember?.location ? [ownMember.location.lat, ownMember.location.lng] : defaultCenter;
  const routeOrigin = draftOrigin || route?.origin;
  const routeDestination = draftDestination || route?.destination;

  return (
    <MapContainer center={initialCenter} zoom={12} zoomControl={false} className="map-view">
      <TileLayer
        attribution='Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community'
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      />
      <TileLayer
        attribution="Labels &copy; Esri"
        url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
      />
      {routeCoords.length > 1 && <Polyline positions={routeCoords} pathOptions={{ color: "#3289ff", weight: 6, opacity: 0.9 }} />}
      {routeOrigin && <Marker position={[routeOrigin.lat, routeOrigin.lng]} icon={pointIcon("start")} />}
      {routeDestination && <Marker position={[routeDestination.lat, routeDestination.lng]} icon={pointIcon("finish")} />}
      {visibleMembers.map((member, index) => {
        const isMe = member.id === session?.memberId;
        const fresh = Date.now() - member.location.timestamp < 60_000
          && (isMe ? gps === "active" || gps === "demo" : member.connected);
        return (
          <span key={member.id}>
            <Marker
              position={[member.location.lat, member.location.lng]}
              icon={markerIcon(member.name, palette[index % palette.length], isMe)}
              opacity={fresh ? 1 : 0.55}
              eventHandlers={{ click: () => onGroup(member.id) }}
            />
            {isMe && Number.isFinite(member.location.accuracy) && member.location.accuracy > 0 && (
              <Circle
                center={[member.location.lat, member.location.lng]}
                radius={member.location.accuracy}
                pathOptions={{ color: "#55a8ff", fillColor: "#55a8ff", fillOpacity: 0.08, weight: 1 }}
              />
            )}
          </span>
        );
      })}
      <MapController
        action={mapAction}
        pickMode={pickMode}
        onPick={onPick}
        route={route}
        ownLocation={ownMember?.location}
      />
      <div className={`map-pick-hint ${pickMode ? "visible" : ""}`}>
        Toca el mapa para {pickMode === "origin" ? "definir el origen" : "definir el destino"}
      </div>
      {gps === "active" && ownMember?.location && (
        <div className="map-self-pulse" aria-label="Tu ubicación GPS está activa"><span /></div>
      )}
    </MapContainer>
  );
}

function EntryScreen({ onSession, onDemo }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(() => readInviteCode(window.location.search));
  const [joining, setJoining] = useState(() => Boolean(readInviteCode(window.location.search)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const endpoint = joining ? "/api/rooms/join" : "/api/rooms/create";
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(joining ? { name, code } : { name }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo acceder a la sala.");
      const nextSession = { ...result, demo: false };
      localStorage.setItem("moto-trips-session", JSON.stringify(nextSession));
      window.history.replaceState({}, "", window.location.pathname);
      onSession(nextSession);
    } catch (requestError) {
      setError(requestError.message || "No se pudo conectar con el servidor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="entry-screen">
      <div className="entry-backdrop" />
      <section className="entry-card">
        <div className="brand-mark"><Navigation size={24} strokeWidth={2.5} /></div>
        <p className="eyebrow">RUTAS · AMIGOS · AVENTURAS</p>
        <h1>Moto <span>Trips</span></h1>
        <p className="entry-copy">Una buena ruta se disfruta mejor en compañía.</p>
        <form onSubmit={submit} className="entry-form">
          <label htmlFor="rider-name">Tu nombre</label>
          <input id="rider-name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={40} placeholder="¿Cómo te llamamos?" required />
          {joining && (
            <>
              <label htmlFor="room-code">Código de grupo</label>
              <input id="room-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={8} placeholder="Ej. A7K2MN" required />
            </>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary" disabled={busy}>{busy ? "Conectando…" : joining ? "Unirme a la ruta" : "Crear ruta y grupo"}</button>
        </form>
        <button className="text-button" onClick={() => { setJoining(!joining); setError(""); }}>
          {joining ? "Crear un grupo nuevo" : "Tengo un código para unirme"}
        </button>
        <div className="entry-divider"><span>o explora</span></div>
        <button className="button button-demo" onClick={onDemo}><MapPinned size={18} /> Ver demo con Will, Juan y José</button>
        <p className="privacy-note">La ubicación solo se comparte con las personas de tu sala.</p>
      </section>
    </main>
  );
}

function App() {
  const [session, setSession] = useState(() => {
    if (readInviteCode(window.location.search)) return null;
    try {
      return JSON.parse(localStorage.getItem("moto-trips-session") || "null");
    } catch {
      return null;
    }
  });
  const [room, setRoom] = useState(session?.room || null);
  const [members, setMembers] = useState(session?.demo ? demoMembers : session?.room?.members || []);
  const [route, setRoute] = useState(session?.demo ? demoRoute : session?.room?.route || null);
  const [gps, setGps] = useState("idle");
  const [gpsError, setGpsError] = useState("");
  const [socketStatus, setSocketStatus] = useState(session?.demo ? "connected" : "connecting");
  const [mapAction, setMapAction] = useState(null);
  const [pickMode, setPickMode] = useState(null);
  const [origin, setOrigin] = useState(session?.demo ? demoRoute.origin : session?.room?.route?.origin || null);
  const [destination, setDestination] = useState(session?.demo ? demoRoute.destination : session?.room?.route?.destination || null);
  const [originLabel, setOriginLabel] = useState(session?.demo ? "Armenia" : session?.room?.route?.originLabel || "");
  const [destinationLabel, setDestinationLabel] = useState(session?.demo ? "Lago Sevan" : session?.room?.route?.destinationLabel || "");
  const [originQuery, setOriginQuery] = useState(session?.room?.route?.originLabel || "");
  const [destinationQuery, setDestinationQuery] = useState(session?.room?.route?.destinationLabel || "");
  const [searchResults, setSearchResults] = useState({ origin: [], destination: [] });
  const [searchBusy, setSearchBusy] = useState("");
  const [searchError, setSearchError] = useState("");
  const [routeError, setRouteError] = useState("");
  const [routeLoading, setRouteLoading] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [inviteStatus, setInviteStatus] = useState("");
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const socketRef = useRef(null);
  const lastSentRef = useRef(null);
  const demoInterval = useRef(null);

  const ownMember = members.find((member) => member.id === session?.memberId);
  const isLeader = session?.demo || ownMember?.id === room?.leaderId || ownMember?.id === session?.room?.leaderId;
  const routeCoordinates = route?.geometry?.coordinates ?? [];
  const progressById = useMemo(() => new Map(members.map((member) => [
    member.id,
    routeProgress(member.location, routeCoordinates, route?.distance),
  ])), [members, routeCoordinates, route?.distance]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!session || session.demo) return undefined;
    let active = true;

    function attachSocket(client) {
      client.auth = { accessToken: session.accessToken };
      client.on("connect", () => {
        lastSentRef.current = null;
        setSocketStatus("connected");
      });
      client.on("disconnect", () => setSocketStatus("disconnected"));
      client.on("connect_error", () => setSocketStatus("disconnected"));
      client.on("room-state", (nextRoom) => {
        setRoom(nextRoom);
        setRoute(nextRoom.route);
        if (nextRoom.route) {
          setOrigin(nextRoom.route.origin);
          setDestination(nextRoom.route.destination);
          setOriginLabel(nextRoom.route.originLabel || "");
          setDestinationLabel(nextRoom.route.destinationLabel || "");
          setOriginQuery(nextRoom.route.originLabel || "");
          setDestinationQuery(nextRoom.route.destinationLabel || "");
        }
        setMembers((previous) => mergeMembers(nextRoom.members, previous));
      });
      client.on("users-location", (locations) => {
        setMembers((previous) => previous.map((member) => {
          const location = locations.find((item) => item.userId === member.id);
          return location ? { ...member, location } : member;
        }));
      });
      client.on("member-status", (statuses) => {
        setMembers((previous) => previous.map((member) => {
          const status = statuses.find((item) => item.userId === member.id);
          return status ? { ...member, connected: status.connected } : member;
        }));
      });
      client.on("route-updated", (nextRoute) => setRoute(nextRoute));
    }

    import("socket.io-client").then(({ io }) => {
      if (!active) return;
      if (socketRef.current) return;
      const client = io(API_URL || window.location.origin, {
        auth: { accessToken: session.accessToken },
        reconnection: true,
        reconnectionAttempts: Infinity,
      });
      attachSocket(client);
      socketRef.current = client;
    });
    return () => {
      active = false;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [session]);

  useEffect(() => {
    if (!route) return;
    setOrigin(route.origin);
    setDestination(route.destination);
    setOriginLabel(route.originLabel || "");
    setDestinationLabel(route.destinationLabel || "");
    setOriginQuery(route.originLabel || "");
    setDestinationQuery(route.destinationLabel || "");
  }, [route]);

  useEffect(() => {
    if (!session || session.demo) return undefined;
    if (!navigator.geolocation) {
      setGps("unavailable");
      setGpsError("Este dispositivo no ofrece geolocalización.");
      return undefined;
    }
    setGps("searching");
    setGpsError("");
    let active = true;
    const watchId = navigator.geolocation.watchPosition((position) => {
      if (!active || document.visibilityState !== "visible") return;
      const location = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
      };
      setGps("active");
      setGpsError("");
      setMembers((previous) => previous.map((member) => member.id === session.memberId ? { ...member, location } : member));
      const previous = lastSentRef.current;
      if (!shouldPublishLocation(previous, location)) return;
      if (socketRef.current?.connected) {
        socketRef.current.emit("location-update", location, (acknowledgement) => {
          if (acknowledgement?.ok) lastSentRef.current = { location, sentAt: Date.now() };
        });
      }
    }, (error) => {
      if (!active) return;
      const gpsErrorState = geolocationErrorMessage(error.code);
      setGps(gpsErrorState.status);
      setGpsError(gpsErrorState.message);
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15_000 });
    return () => {
      active = false;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [session]);

  useEffect(() => {
    if (!session?.demo) return undefined;
    const routePoints = demoRoute.geometry.coordinates;
    let tick = 0;
    demoInterval.current = window.setInterval(() => {
      tick += 1;
      setMembers((previous) => previous.map((member, index) => {
          const offsets = [0, 0.12, 0.34, 0.72];
          const progress = (offsets[index] + tick * 0.00015) % 0.88;
        const point = routePoints[Math.round(progress * (routePoints.length - 1))];
        return {
          ...member,
          location: { lat: point[1], lng: point[0], accuracy: 5 + index, timestamp: Date.now() },
        };
      }));
    }, 2500);
    return () => window.clearInterval(demoInterval.current);
  }, [session]);

  const enterDemo = useCallback(() => {
    const demoSession = {
      demo: true,
      memberId: "demo-rider",
      room: { id: "demo-room", code: "DEMO24", leaderId: "demo-rider", route: demoRoute },
    };
    setSession(demoSession);
    setRoom(demoSession.room);
    setMembers([
      { id: "demo-rider", name: "Tú", connected: true, location: { ...demoOrigin, accuracy: 5, timestamp: Date.now() } },
      ...demoMembers,
    ]);
    setRoute(demoRoute);
    setSocketStatus("connected");
    setGps("demo");
    setOrigin(demoRoute.origin);
    setDestination(demoRoute.destination);
  }, []);

  async function exitRoom() {
    if (!session.demo) {
      setLeaving(true);
      try {
        const response = await fetch(`${API_URL}/api/rooms/leave`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "No se pudo salir del grupo.");
      } catch (error) {
        setGpsError(error.message || "No se pudo confirmar la salida del grupo.");
        setLeaving(false);
        return;
      }
    }
    socketRef.current?.disconnect();
    socketRef.current = null;
    lastSentRef.current = null;
    localStorage.removeItem("moto-trips-session");
    setSession(null);
    setRoom(null);
    setMembers([]);
    setRoute(null);
    setGps("idle");
    setGpsError("");
    setSocketStatus("connecting");
    setPanelExpanded(false);
    setGroupOpen(false);
    setLeaving(false);
  }

  function centerOnMe() {
    if (ownMember?.location) setMapAction({ type: "center", point: ownMember.location, key: now });
    else setGpsError("Esperando una ubicación GPS actual para centrar el mapa.");
  }

  function viewGroup(memberId) {
    const points = members.filter((member) => member.location).map((member) => member.location);
    if (points.length) setMapAction({ type: "fit", points, key: `${memberId}-${now}` });
  }

  function chooseMapPoint(point) {
    if (pickMode === "origin") {
      setOrigin(point);
      setOriginLabel("Punto elegido en el mapa");
      setOriginQuery("");
    } else {
      setDestination(point);
      setDestinationLabel("Punto elegido en el mapa");
      setDestinationQuery("");
    }
    setPickMode(null);
  }

  async function searchPlace(field) {
    const query = field === "origin" ? originQuery : destinationQuery;
    if (query.trim().length < 3) {
      setSearchError("Escribe al menos 3 caracteres: una dirección, barrio o localidad.");
      return;
    }
    if (!socketRef.current?.connected) {
      setSearchError("Conéctate a la sala para buscar una dirección.");
      return;
    }
    setSearchBusy(field);
    setSearchError("");
    setSearchResults((previous) => ({ ...previous, [field]: [] }));
    try {
      const response = await fetch(`${API_URL}/api/geocode?q=${encodeURIComponent(query.trim())}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo buscar el lugar.");
      if (field === "origin") setSearchResults((previous) => ({ ...previous, origin: result.results }));
      else setSearchResults((previous) => ({ ...previous, destination: result.results }));
      if (!result.results.length) setSearchError("No encontramos ese lugar. Prueba con otra dirección o barrio.");
    } catch (error) {
      setSearchError(error.message || "No se pudo buscar la dirección.");
    } finally {
      setSearchBusy("");
    }
  }

  function choosePlace(field, place) {
    const point = { lat: place.lat, lng: place.lng };
    const label = place.displayName;
    if (field === "origin") {
      setOrigin(point);
      setOriginLabel(label);
      setOriginQuery(label);
    } else {
      setDestination(point);
      setDestinationLabel(label);
      setDestinationQuery(label);
    }
    setSearchResults((previous) => ({ ...previous, [field]: [] }));
    setSearchError("");
    setMapAction({ type: "center", point, key: `${field}-${place.id}-${Date.now()}` });
  }

  function useCurrentLocationAsOrigin() {
    if (!gpsFresh || !ownMember?.location) {
      setSearchError("Esperando una ubicación GPS actual; acepta el permiso y comprueba la señal.");
      return;
    }
    setOrigin({ lat: ownMember.location.lat, lng: ownMember.location.lng });
    setOriginLabel("Mi ubicación actual");
    setOriginQuery("Mi ubicación actual");
    setSearchResults((previous) => ({ ...previous, origin: [] }));
    setSearchError("");
    setMapAction({ type: "center", point: ownMember.location, key: `gps-origin-${now}` });
  }

  async function calculateRoute() {
    if (!origin || !destination) {
      setRouteError("Busca y selecciona una dirección, barrio o punto GPS para el origen y el destino.");
      return;
    }
    if (session?.demo) {
      setRouteError("El cálculo de rutas está desactivado en el modo de demostración.");
      return;
    }
    setRouteLoading(true);
    setRouteError("");
    try {
      const response = await fetch(`${API_URL}/api/routes/calculate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ origin, destination, originLabel, destinationLabel }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo calcular la ruta.");
      const acknowledgement = await new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) return resolve({ ok: false, error: "Reconecta con la sala antes de compartir la ruta." });
        socket.emit("update-route", result.route, resolve);
      });
      if (!acknowledgement?.ok) throw new Error(acknowledgement?.error || "No se pudo compartir la ruta.");
      setRoute(result.route);
      setMapAction({ type: "fit", points: [origin, destination], key: now });
      setPanelExpanded(true);
    } catch (error) {
      setRouteError(error.message);
    } finally {
      setRouteLoading(false);
    }
  }

  async function shareInvitation() {
    const code = room?.code || session.room?.code;
    if (!code) {
      setInviteStatus("No se encontró el código de invitación.");
      return;
    }
    const url = createInviteUrl(window.location, code);
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Únete a mi ruta en Moto Trips",
          text: `Acompáñame en esta ruta. Código del grupo: ${code}`,
          url,
        });
        setInviteStatus("Invitación lista para compartir.");
      } else {
        await navigator.clipboard.writeText(url);
        setInviteStatus("Enlace de invitación copiado.");
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        setInviteStatus("Enlace de invitación copiado.");
      } catch {
        setInviteStatus("No se pudo compartir automáticamente. Comparte el código: " + code);
      }
    }
  }

  if (!session) return <EntryScreen onSession={(nextSession) => {
    setSession(nextSession);
    setRoom(nextSession.room);
    setMembers(nextSession.room.members || []);
    setRoute(nextSession.room.route || null);
    setPanelExpanded(!nextSession.room.route);
  }} onDemo={enterDemo} />;

  const connectedCount = members.filter((member) => member.connected).length;
  const onlineSocket = session.demo || socketStatus === "connected";
  const ownProgress = progressById.get(session.memberId);
  const myLocationAge = ownMember?.location ? now - ownMember.location.timestamp : Infinity;
  const gpsFresh = gps === "active" && myLocationAge < 30_000;
  const staleLocationCount = members.filter((member) => member.location
    && (now - member.location.timestamp > 60_000 || !member.connected)).length;
  const visibleOrigin = origin || route?.origin;
  const visibleDestination = destination || route?.destination;

  return (
    <main className="app-shell">
      <SessionMap
        session={session}
        members={members}
        route={route}
        gps={gps}
        mapAction={mapAction}
        pickMode={pickMode}
        onPick={chooseMapPoint}
        onGroup={viewGroup}
        draftOrigin={origin}
        draftDestination={destination}
      />
      <header className="top-bar">
        <button className="icon-button brand-button" aria-label="Moto Trips"><Navigation size={20} /></button>
        <div className="top-room">
          <strong>{session.demo ? "Demo de grupo" : "Ruta en grupo"}</strong>
          <span>{room?.code || session.room?.code || "Sala"} · {connectedCount} en línea</span>
        </div>
        <span className={`connection-pill ${onlineSocket ? "is-connected" : ""}`}><span />{onlineSocket ? "En ruta" : "Reconectando"}</span>
        <button className="icon-button group-button" onClick={() => setGroupOpen(true)} aria-label="Ver grupo"><Users size={20} /><span>{members.length}</span></button>
      </header>

      <div className="map-tools">
        <button className="map-tool" onClick={centerOnMe} aria-label="Centrar en mi ubicación"><LocateFixed size={21} /></button>
        <button className="map-tool" onClick={() => viewGroup("all")} aria-label="Ver todos los integrantes"><Users size={19} /></button>
        <button className="map-tool" onClick={() => setMapAction({ type: "zoom-in", key: now })} aria-label="Acercar mapa"><Plus size={19} /></button>
        <button className="map-tool" onClick={() => setMapAction({ type: "zoom-out", key: now })} aria-label="Alejar mapa"><Minus size={19} /></button>
      </div>
      <div className="gps-chip">
        <span className={`gps-led gps-${gps}`} />
        <span>{session.demo ? "GPS simulado" : gpsFresh ? "GPS activo" : gps === "denied" ? "Permiso GPS" : gps === "error" || gps === "unavailable" ? "GPS sin señal" : "Buscando GPS"}</span>
        <span className={`socket-led ${onlineSocket ? "online" : ""}`} />
      </div>

      <section className={`route-sheet ${panelExpanded ? "route-sheet-expanded" : ""}`}>
        <button className="sheet-handle" onClick={() => setPanelExpanded(!panelExpanded)} aria-label={panelExpanded ? "Contraer información" : "Ampliar información"}>
          <span />
        </button>
        <div className="route-summary">
          <div className="route-summary-icon"><Route size={19} /></div>
          <div className="route-summary-main">
            <div className="route-title-row"><strong>{route ? `${formatDistance(ownProgress?.distanceRemaining ?? route.distance)} por recorrer` : "Tu ruta en grupo"}</strong><span className={`route-status ${session.demo ? "route-status-demo" : ""}`}>{session.demo ? "DEMO" : route ? "COMPARTIDA" : "LISTOS"}</span></div>
            <div className="route-subtitle">{session.demo ? "Posiciones y recorrido simulados" : route ? `Origen → Destino · ${formatDuration(ownProgress ? route.duration * (ownProgress.distanceRemaining / Math.max(route.distance, 1)) : route.duration)} aprox.` : "Comparte tu ubicación en tiempo real"}</div>
          </div>
        </div>
        <div className="route-waypoints">
          <div><span className="waypoint-dot waypoint-start" /><span><b>Origen</b><small>{visibleOrigin ? originLabel || route?.originLabel || `${visibleOrigin.lat.toFixed(4)}, ${visibleOrigin.lng.toFixed(4)}` : "Sin definir"}</small></span></div>
          <div className="waypoint-connector" />
          <div><span className="waypoint-dot waypoint-finish" /><span><b>Destino</b><small>{visibleDestination ? destinationLabel || route?.destinationLabel || `${visibleDestination.lat.toFixed(4)}, ${visibleDestination.lng.toFixed(4)}` : "Sin definir"}</small></span></div>
        </div>
        {gpsError && <p className="notice notice-warning">{gpsError}</p>}
        {!onlineSocket && !session.demo && <p className="notice notice-warning">Sin conexión con la sala. Reconectando automáticamente; no se envía la ubicación mientras estás desconectado.</p>}
        <div className="route-metrics">
          <div><span>Distancia total</span><strong>{route ? formatDistance(route.distance) : "—"}</strong></div>
          <div><span>Tiempo estimado</span><strong>{route ? formatDuration(route.duration) : "—"}</strong></div>
          <div><span>Grupo en línea</span><strong>{connectedCount} / {members.length}</strong></div>
        </div>
        {route?.source === "demo" && <div className="demo-disclaimer">Modo demo: posiciones y trazado ilustrativos; no son ubicaciones reales ni una ruta navegable.</div>}
        {route?.source === "osrm" && <div className="route-source">Ruta calculada por carretera · OSRM</div>}
        {panelExpanded && (
          <>
            <div className="panel-section-heading"><span>Tu grupo</span><button className="text-button small-text-button" onClick={() => setGroupOpen(true)}>Ver lista</button></div>
            {members.length === 0 && <p className="empty-group">Todavía no hay integrantes conectados.</p>}
            <div className="mini-members">
              {members.map((member, index) => {
                const progress = progressById.get(member.id);
                const fresh = member.location && now - member.location.timestamp < 60_000
                  && (member.id === session.memberId ? gps === "active" : member.connected);
                const gap = member.id !== session.memberId && ownMember?.location && member.location
                  ? distanceMeters(ownMember.location, member.location) : null;
                const eta = progress && route ? route.duration * (progress.distanceRemaining / Math.max(route.distance, 1)) : null;
                return (
                  <div className="mini-member" key={member.id}>
                    <span className="member-color" style={{ "--member-color": palette[index % palette.length] }}>{member.name.slice(0, 1).toUpperCase()}</span>
                    <div className="mini-member-info"><strong>{member.id === session.memberId ? `${member.name} (Yo)` : member.name}</strong><small>{progress ? `${formatDistance(progress.distanceRemaining)} restantes · ETA ${formatDuration(eta)}` : member.location ? "Progreso sin ruta" : "Sin ubicación GPS"}</small></div>
                    <div className="mini-member-right"><i className={member.connected ? "presence-online" : ""} />{gap === null ? (fresh ? "GPS" : member.connected ? "—" : "Fuera") : formatDistance(gap)}</div>
                    {progress?.deviation > 300 && <span className="deviation-tag">Desvío</span>}
                    {member.location && !fresh && <span className="stale-tag">Última posición {formatAge(now - member.location.timestamp)}{member.connected ? "" : " · desconectado"}</span>}
                  </div>
                );
              })}
            </div>
            {staleLocationCount > 0 && <p className="stale-note">Las ubicaciones antiguas se muestran atenuadas y no representan la posición actual.</p>}
            {isLeader && (
              <div className="route-editor">
                <div className="panel-section-heading"><span>{route ? "Editar ruta compartida" : "1 · Define tu ruta"}</span><span className="leader-tag">LÍDER</span></div>
                <p>Busca una dirección, barrio o localidad, o usa tu GPS como origen. Selecciona un resultado para cada punto y comparte la ruta por carretera con el grupo.</p>
                <div className="place-search">
                  <label htmlFor="origin-search">Origen</label>
                  <div className="place-search-row">
                    <MapPin size={16} />
                    <input
                      id="origin-search"
                      value={originQuery}
                      onChange={(event) => {
                        setOriginQuery(event.target.value);
                        setOrigin(null);
                        setOriginLabel("");
                        setSearchResults((previous) => ({ ...previous, origin: [] }));
                      }}
                      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); searchPlace("origin"); } }}
                      placeholder="Dirección, barrio o ciudad"
                      aria-label="Buscar dirección de origen"
                    />
                    <button className="place-search-button" disabled={searchBusy === "origin"} onClick={() => searchPlace("origin")} aria-label="Buscar origen">
                      <Search size={16} />
                    </button>
                  </div>
                  {searchResults.origin.length > 0 && (
                    <div className="place-results" role="listbox" aria-label="Resultados de origen">
                      {searchResults.origin.map((place) => (
                        <button key={place.id} role="option" aria-selected={false} onClick={() => choosePlace("origin", place)}>
                          <strong>{place.name}</strong><small>{place.displayName}</small>
                        </button>
                      ))}
                    </div>
                  )}
                  <button className="button button-quiet location-origin-button" onClick={useCurrentLocationAsOrigin} disabled={!gpsFresh}>
                    <LocateFixed size={15} /> Usar mi ubicación actual
                  </button>
                  {!gpsFresh && <small className="location-help">Permite el GPS del navegador para usar tu posición actual.</small>}
                  {originLabel && origin && <span className="selected-place">Origen elegido: {originLabel}</span>}
                </div>
                <div className="place-search">
                  <label htmlFor="destination-search">Destino</label>
                  <div className="place-search-row">
                    <MapPin size={16} />
                    <input
                      id="destination-search"
                      value={destinationQuery}
                      onChange={(event) => {
                        setDestinationQuery(event.target.value);
                        setDestination(null);
                        setDestinationLabel("");
                        setSearchResults((previous) => ({ ...previous, destination: [] }));
                      }}
                      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); searchPlace("destination"); } }}
                      placeholder="Dirección, barrio o ciudad"
                      aria-label="Buscar dirección de destino"
                    />
                    <button className="place-search-button" disabled={searchBusy === "destination"} onClick={() => searchPlace("destination")} aria-label="Buscar destino">
                      <Search size={16} />
                    </button>
                  </div>
                  {searchResults.destination.length > 0 && (
                    <div className="place-results" role="listbox" aria-label="Resultados de destino">
                      {searchResults.destination.map((place) => (
                        <button key={place.id} role="option" aria-selected={false} onClick={() => choosePlace("destination", place)}>
                          <strong>{place.name}</strong><small>{place.displayName}</small>
                        </button>
                      ))}
                    </div>
                  )}
                  {destinationLabel && destination && <span className="selected-place">Destino elegido: {destinationLabel}</span>}
                </div>
                {searchError && <p className="form-error" role="alert">{searchBusy ? "Buscando lugares…" : searchError}</p>}
                <div className="route-editor-buttons">
                  <button className={`button button-secondary ${pickMode === "origin" ? "is-selecting" : ""}`} onClick={() => setPickMode(pickMode === "origin" ? null : "origin")}>Elegir origen en mapa</button>
                  <button className={`button button-secondary ${pickMode === "destination" ? "is-selecting" : ""}`} onClick={() => setPickMode(pickMode === "destination" ? null : "destination")}>Elegir destino en mapa</button>
                </div>
                {routeError && <p className="form-error" role="alert">{routeError}</p>}
                <button className="button button-primary route-calculate" onClick={calculateRoute} disabled={routeLoading || session.demo}>
                  {routeLoading ? "Calculando ruta…" : session.demo ? "Ruta de demostración" : "Calcular y compartir ruta"}
                </button>
              </div>
            )}
            <div className="sheet-footer"><span>Actualización GPS cada 2 s mientras la app está activa</span><button className="text-button small-text-button" disabled={leaving} onClick={exitRoom}>{leaving ? "Saliendo…" : "Salir del grupo"}</button></div>
          </>
        )}
      </section>

      {groupOpen && (
        <div className="drawer-backdrop" onClick={() => setGroupOpen(false)}>
          <aside className="group-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-heading"><div><span className="drawer-eyebrow">MOTO TRIPS</span><h2>Mi grupo</h2></div><button className="icon-button" onClick={() => setGroupOpen(false)} aria-label="Cerrar"><X size={20} /></button></div>
            <div className="share-card"><div className="share-icon"><Users size={20} /></div><div><small>CÓDIGO PARA COMPARTIR</small><strong>{room?.code || session.room?.code}</strong></div><button onClick={shareInvitation} className="copy-button">Invitar</button></div>
            <p className="invite-instructions">Comparte el enlace o el código. Tus compañeros ingresan su nombre y se unen a esta sala; la ruta que publiques aparecerá en su mapa.</p>
            {inviteStatus && <p className="invite-status" role="status">{inviteStatus}</p>}
            <p className="drawer-section-title">INTEGRANTES · {connectedCount} EN LÍNEA</p>
            <div className="drawer-members">
              {members.map((member, index) => {
                const progress = progressById.get(member.id);
                const gap = member.id !== session.memberId && ownMember?.location && member.location
                  ? distanceMeters(ownMember.location, member.location) : null;
                return <button className="drawer-member" onClick={() => { viewGroup(member.id); setGroupOpen(false); }} key={member.id}>
                  <span className="member-color" style={{ "--member-color": palette[index % palette.length] }}>{member.name.slice(0, 1).toUpperCase()}</span>
                  <span className="drawer-member-detail"><strong>{member.name}{member.id === room?.leaderId ? " · Líder" : ""}{member.id === session.memberId ? " · Yo" : ""}</strong><small>{progress ? `${formatDistance(progress.distanceRemaining)} restantes` : member.location ? "Ubicación recibida" : "Esperando GPS"}</small></span>
                  <span className={`drawer-presence ${member.connected ? "presence-online" : ""}`} title={member.connected ? "En línea" : "Desconectado"} />
                  <span className="drawer-presence-label">{member.connected ? "En línea" : "Desconectado"}</span>
                  {gap !== null && <small className="drawer-gap">{formatDistance(gap)}</small>}
                </button>;
              })}
              {members.length === 0 && <p className="empty-group"><CircleUserRound size={20} /> Aún no hay integrantes.</p>}
            </div>
            <div className="drawer-gps"><Radio size={17} /><span>{session.demo ? "Ubicaciones simuladas para la demo" : gpsFresh ? `GPS activo · última lectura ${formatAge(myLocationAge)}` : gpsError || "Esperando señal GPS"}</span></div>
            <p className="drawer-safety">Por seguridad, configura la ruta y consulta el mapa antes de conducir. La app puede dejar de actualizar en segundo plano.</p>
            <button className="button button-secondary drawer-exit" disabled={leaving} onClick={exitRoom}>{leaving ? "Saliendo…" : "Salir del grupo"}</button>
          </aside>
        </div>
      )}

      <nav className="bottom-nav" aria-label="Navegación principal">
        <button className="bottom-nav-item is-active" onClick={() => setPanelExpanded(false)}><MapPinned size={18} /><span>Mapa</span></button>
        <button className="bottom-nav-item" onClick={() => setGroupOpen(true)}><Users size={18} /><span>Grupo</span><i>{members.length}</i></button>
        <button className="bottom-nav-item" onClick={() => setPanelExpanded(true)}><Route size={18} /><span>Ruta</span></button>
      </nav>
      <button className="floating-menu" onClick={() => setGroupOpen(true)} aria-label="Abrir grupo"><Menu size={21} /><span>{members.length}</span></button>
    </main>
  );
}

function mergeMembers(incoming, previous) {
  return incoming.map((member) => {
    const existing = previous.find((item) => item.id === member.id);
    if (!existing?.location) return member;
    if (!member.location || existing.location.timestamp > member.location.timestamp) {
      return { ...member, location: existing.location };
    }
    return member;
  });
}

function formatAge(age) {
  if (!Number.isFinite(age) || age < 0) return "ahora";
  const seconds = Math.floor(age / 1000);
  if (seconds < 5) return "ahora";
  if (seconds < 60) return `hace ${seconds} s`;
  return `hace ${Math.floor(seconds / 60)} min`;
}

export default App;
