# Moto Trips

Seguimiento GPS grupal para rutas en moto: una interfaz React/Vite con mapa satelital Esri/Leaflet, API Express, Socket.IO para ubicaciones efímeras y PostgreSQL opcional para conservar salas, integrantes y rutas.

## Requisitos

- Node.js 20 o posterior y npm.
- PostgreSQL 14 o posterior solo si se quiere persistencia entre reinicios.
- Geolocalización del navegador: requiere `localhost` o HTTPS y permiso del usuario.

## Instalación y ejecución

```bash
npm install
cp .env.example .env
npm run dev
```

La aplicación queda en <http://localhost:5173> y la API/Socket.IO en <http://localhost:3001>. Sin `DATABASE_URL`, las salas se conservan solo en memoria del servidor durante el desarrollo. Para habilitar PostgreSQL:

```bash
docker compose up -d postgres
```

Configura `DATABASE_URL` en `.env` con el valor del ejemplo y reinicia el servidor. El esquema se crea automáticamente al arrancar. Las ubicaciones no se escriben en la base de datos; se mantienen en memoria y se pierden al reiniciar el servidor.

## Despliegue de QA (Vercel + Render)

- Repositorio privado conectado para este despliegue: <https://github.com/DevWill0192/MotoTripV2>.
- Preview web ya publicado: <https://moto-trips-qa.vercel.app>. Permite validar la interfaz y el modo demo; el seguimiento real requiere que Render esté desplegado.
- `vercel.json` configura el sitio de Vite para Vercel desde la raíz del monorepo.
- `render.yaml` define la API Socket.IO y PostgreSQL. En Render, crea un Blueprint desde el repositorio/branch `main` y usa ese archivo; Render solicitará `CLIENT_ORIGIN` (`https://moto-trips-qa.vercel.app`) y `APP_CONTACT_EMAIL`, y generará `JWT_SECRET`.
- Después del primer deploy, copia la URL pública que Render asignó a la API. En el proyecto Vercel define `VITE_API_URL` con esa URL para **Preview** y **Production**, y vuelve a desplegar. La API solo acepta el origen configurado en `CLIENT_ORIGIN`.
- Los planes gratuitos son para QA: el servicio Render puede suspenderse tras 15 minutos inactivo y despertar lentamente; confirma límites y retención vigentes de PostgreSQL en el panel Render.

El despliegue necesita que este directorio esté publicado en un repositorio GitHub conectado a Render. La carpeta de trabajo creada localmente no incluye un remoto Git preconfigurado.

En despliegues reales, configura un `JWT_SECRET` aleatorio y largo, HTTPS, `CLIENT_ORIGIN` con el dominio exacto y una instancia de OSRM apropiada. `CLIENT_ORIGIN` acepta varios orígenes separados por comas. Para probar en teléfonos de la misma red, añade el origen LAN del frontend; la geolocalización del navegador exige HTTPS en dispositivos móviles (salvo `localhost`), así que usa un dominio HTTPS o un túnel de desarrollo. Si la web y API usan distintos orígenes, configura `VITE_API_URL` con la URL base de la API. La búsqueda de direcciones usa Nominatim/OpenStreetMap desde el backend; el endpoint público limita el uso a una solicitud por segundo y es adecuado para QA, no para geocodificación de alto volumen. Define `APP_CONTACT_EMAIL` para identificar la aplicación. La URL pública de OSRM indicada por defecto es solo para desarrollo, puede limitar solicitudes y no tiene garantía de disponibilidad. `ROUTING_URL` acepta un endpoint compatible con OSRM. `VITE_GPS_UPDATE_INTERVAL_MS` configura el intervalo de emisión (mínimo 500 ms, predeterminado 2000 ms). No se usa un token de Mapbox: el mapa usa teselas satelitales públicas de Esri con atribución visible.

## Cómo usar

1. Crea un grupo con tu nombre. En el mapa, abre **Grupo → Invitar** para compartir un enlace que contiene el código de la sala o copiar el código de seis caracteres.
2. Los compañeros abren el enlace, escriben su nombre y se unen directamente a esa sala. También pueden introducir el código desde la pantalla inicial.
3. Acepta el permiso de ubicación. Si el GPS detecta al menos 5 m de movimiento, el navegador transmite una posición con hora y precisión respetando el intervalo configurado (2 s por defecto). Si permanece quieto, solo envía un pulso de vigencia cada 15 s. El servidor omite cambios menores a 3 m y también limita la frecuencia para proteger la sala.
4. El líder expande el panel y busca una dirección, barrio o localidad para el origen y destino. Selecciona uno de los lugares encontrados; también puede usar **Usar mi ubicación actual** como origen o elegir un punto tocando el mapa. Al pulsar **Calcular y compartir ruta**, OSRM calcula la ruta real por carretera y todos los integrantes reciben el mismo trazado.
5. El panel del grupo muestra conexión, distancia entre integrantes, progreso sobre la ruta, ETA proporcional a la duración calculada y desviaciones superiores a 300 m. Las posiciones con más de un minuto se indican como antiguas y no se presentan como GPS actual.

## Demo

En la pantalla inicial, selecciona **Ver demo con Will, Juan y José**. El trazado de la demo sigue una ruta por carretera obtenida de OSRM y simplificada para la pantalla; las ubicaciones de los integrantes avanzan sobre ese trazado, pero son simuladas y no corresponden a motociclistas reales. La interfaz lo identifica como demo; no se envían ubicaciones simuladas al servidor. Para una salida real, crea una ruta y un grupo; no compartas ni uses la demo para navegar.

## Eventos Socket.IO

- Autenticación de conexión mediante el JWT de sala en `handshake.auth.accessToken`.
- `room-state`: estado y miembros de la propia sala al conectar.
- `location-update` (entrada): GPS validado, limitado al miembro autenticado.
- `users-location` (salida compatible): ubicaciones actuales conocidas de esa sala.
- `member-status`: conexión/desconexión.
- `POST /api/rooms/leave`: salida autenticada; al salir el líder, el integrante más antiguo que queda recibe el liderazgo.
- `update-route` (entrada) y `route-updated` (salida): ruta compartida; solo el líder puede cambiarla.

Los nombres visibles e identificadores se derivan de la membresía autenticada, no de datos confiados al evento de ubicación. La sala de Socket.IO se obtiene del JWT firmado; el cliente no puede escoger otra sala con un `roomId` arbitrario. El endpoint de rutas también requiere el token de miembro y permiso de líder. El código de invitación es la credencial para unirse; compártelo solo con el grupo.

## Limitaciones importantes

- Los navegadores y sistemas operativos pueden suspender geolocalización y Socket.IO en segundo plano, especialmente con la pantalla bloqueada. Para seguir compartiendo una ruta, mantén Moto Trips visible; esta aplicación web no garantiza seguimiento en segundo plano.
- El navegador no expone en todos los dispositivos un estado independiente y fiable de “GPS desactivado”; errores y permisos denegados se muestran en el panel.
- La ETA individual se estima como proporción de la duración de la ruta según el punto más cercano a la geometría. No sustituye a una ETA de tráfico en vivo ni a navegación giro a giro.
- Las coordenadas de la demo son sintéticas y quedan claramente etiquetadas. Fuera de la demo, solo se muestran posiciones recibidas desde geolocalización.
- El sistema no guarda historial GPS. PostgreSQL conserva los datos de sala, los nombres de sus miembros y la ruta para que sigan disponibles tras un reinicio.

## Pruebas y compilación

```bash
npm test
npm run build
```
