import { distanceMeters } from "./geo.js";

const configuredInterval = Number(import.meta.env?.VITE_GPS_UPDATE_INTERVAL_MS);
export const GPS_UPDATE_INTERVAL_MS = Number.isFinite(configuredInterval) && configuredInterval >= 500
  ? configuredInterval : 2000;
const LOCATION_HEARTBEAT_MS = 15_000;
const MINIMUM_MOVEMENT_METERS = 5;

export function shouldPublishLocation(previous, next, now = Date.now()) {
  if (!previous) return true;
  const elapsed = now - previous.sentAt;
  if (elapsed < GPS_UPDATE_INTERVAL_MS) return false;
  return distanceMeters(previous.location, next) >= MINIMUM_MOVEMENT_METERS
    || elapsed >= LOCATION_HEARTBEAT_MS;
}

export function geolocationErrorMessage(code) {
  if (code === 1) return { status: "denied", message: "Permiso de ubicación denegado. Actívalo en los ajustes del navegador." };
  if (code === 2) return { status: "error", message: "No se pudo obtener señal GPS. Comprueba los ajustes de ubicación." };
  if (code === 3) return { status: "error", message: "Se agotó el tiempo de espera del GPS. Buscando señal…" };
  return { status: "error", message: "No se pudo acceder al GPS." };
}
