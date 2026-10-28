export async function readApiResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("La API no está disponible en esta dirección. El servicio de backend de QA todavía no está conectado.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("El servidor devolvió una respuesta JSON incompleta. Inténtalo de nuevo.");
  }

  if (!response.ok) {
    throw new Error(payload?.error || `La solicitud falló (HTTP ${response.status}).`);
  }
  return payload;
}

export async function requestApi(path, options = {}, {
  baseUrl = "",
  isDevelopment = false,
  fetchImpl = fetch,
} = {}) {
  if (!baseUrl && !isDevelopment) {
    throw new Error("El backend de QA todavía no está conectado. La pantalla de demostración sí está disponible.");
  }
  const response = await fetchImpl(`${baseUrl}${path}`, options);
  return readApiResponse(response);
}
