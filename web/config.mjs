export function serverConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const port = (name, fallback) => {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a valid port`);
    return value;
  };
  const webPort = port('QUAKE_WEB_PORT', 3000);
  const multiplayerPort = port('QUAKE_MULTIPLAYER_PORT', 4433);
  const publicOrigin = env.QUAKE_PUBLIC_ORIGIN || `http://127.0.0.1:${webPort}`;
  const page = new URL(publicOrigin);
  if (page.origin !== publicOrigin || page.username || page.password || !['http:', 'https:'].includes(page.protocol)) {
    throw new Error('QUAKE_PUBLIC_ORIGIN must be an exact HTTP(S) origin without a path');
  }
  if (production && page.protocol !== 'https:') throw new Error('Production requires an HTTPS QUAKE_PUBLIC_ORIGIN');
  const multiplayerUrl = env.QUAKE_MULTIPLAYER_URL || `https://127.0.0.1:${multiplayerPort}/quake`;
  const game = new URL(multiplayerUrl);
  if (game.protocol !== 'https:' || game.pathname !== '/quake' || game.search || game.hash || game.username || game.password) {
    throw new Error('QUAKE_MULTIPLAYER_URL must be an HTTPS URL ending in /quake');
  }
  if (production && !env.QUAKE_MULTIPLAYER_URL) throw new Error('Production requires a public QUAKE_MULTIPLAYER_URL');
  const origins = new Set([publicOrigin]);
  if (!production) origins.add(`http://localhost:${webPort}`);
  for (const origin of (env.QUAKE_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)) {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || (production && url.protocol !== 'https:')) {
      throw new Error('QUAKE_ALLOWED_ORIGINS must contain exact HTTPS origins in production');
    }
    origins.add(origin);
  }
  const tlsCert = env.QUAKE_TLS_CERT, tlsKey = env.QUAKE_TLS_KEY;
  if (Boolean(tlsCert) !== Boolean(tlsKey)) throw new Error('Set both QUAKE_TLS_CERT and QUAKE_TLS_KEY');
  return {
    production, webPort, multiplayerPort, publicOrigin, multiplayerUrl, origins,
    webHost: env.QUAKE_WEB_HOST || '127.0.0.1',
    multiplayerHost: env.QUAKE_MULTIPLAYER_HOST || '127.0.0.1',
    certificateHostname: game.hostname.replace(/^\[|\]$/g, ''), tlsCert, tlsKey,
    diagnostics: env.QUAKE_DIAGNOSTICS === '1' || (!production && env.QUAKE_DIAGNOSTICS !== '0'),
  };
}
