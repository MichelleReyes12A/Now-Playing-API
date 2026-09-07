// api/now-playing.js
//
// Función serverless para Vercel. Guarda el refresh token y el client secret
// de Spotify de forma segura (variables de entorno) y expone un endpoint
// público y "limpio" que tu página estática puede consultar sin exponer nada.
//
// Variables de entorno que debes configurar en Vercel (Project Settings > Environment Variables):
//   SPOTIFY_CLIENT_ID
//   SPOTIFY_CLIENT_SECRET
//   SPOTIFY_REFRESH_TOKEN
//   ALLOWED_ORIGIN   (opcional, por defecto usa el de GitHub Pages de Michelle)

const DEFAULT_ORIGIN = "https://michellereyes12a.github.io";

async function getAccessToken() {
  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } = process.env;

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REFRESH_TOKEN) {
    throw new Error("Faltan variables de entorno de Spotify en Vercel.");
  }

  const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: SPOTIFY_REFRESH_TOKEN,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`No se pudo refrescar el token (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function getCurrentlyPlaying(accessToken) {
  const res = await fetch(
    "https://api.spotify.com/v1/me/player/currently-playing?additional_types=track",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (res.status === 204) return null; // no está sonando nada
  if (!res.ok) throw new Error(`Error consultando currently-playing (${res.status})`);

  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function getLastPlayed(accessToken) {
  const res = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=1", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) throw new Error(`Error consultando recently-played (${res.status})`);

  const data = await res.json();
  return data.items && data.items[0] ? data.items[0] : null;
}

function normalizeTrack(track) {
  if (!track) return null;
  const images = (track.album && track.album.images) || [];
  return {
    title: track.name,
    artist: (track.artists || []).map((a) => a.name).join(", "),
    album: track.album ? track.album.name : null,
    albumArt: images[0] ? images[0].url : null,
    url: track.external_urls ? track.external_urls.spotify : null,
    durationMs: track.duration_ms,
  };
}

module.exports = async (req, res) => {
  const origin = process.env.ALLOWED_ORIGIN || DEFAULT_ORIGIN;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    const accessToken = await getAccessToken();
    const current = await getCurrentlyPlaying(accessToken);

    if (current && current.item) {
      res.status(200).json({
        state: current.is_playing ? "playing" : "paused",
        track: normalizeTrack(current.item),
        progressMs: current.progress_ms || 0,
        fetchedAt: Date.now(),
      });
      return;
    }

    // Nada sonando en este momento -> mostramos lo último que escuchó.
    const last = await getLastPlayed(accessToken);
    if (last && last.track) {
      res.status(200).json({
        state: "idle",
        track: normalizeTrack(last.track),
        playedAt: last.played_at,
        fetchedAt: Date.now(),
      });
      return;
    }

    res.status(200).json({ state: "empty", fetchedAt: Date.now() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ state: "error", message: "No se pudo obtener el estado de Spotify." });
  }
};