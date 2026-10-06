import test from 'node:test';
import assert from 'node:assert/strict';
import { serverConfig } from '../config.mjs';

test('local launch retains loopback addresses, origin checks and diagnostics', () => {
  const config = serverConfig({});
  assert.equal(config.webHost, '127.0.0.1');
  assert.equal(config.multiplayerUrl, 'https://127.0.0.1:4433/quake');
  assert.deepEqual([...config.origins], ['http://127.0.0.1:3000', 'http://localhost:3000']);
  assert.equal(config.diagnostics, true);
});
test('production advertises public URLs and disables diagnostic routes', () => {
  const config = serverConfig({ NODE_ENV: 'production', QUAKE_PUBLIC_ORIGIN: 'https://quake.example.com',
    QUAKE_MULTIPLAYER_URL: 'https://quake.example.com:4433/quake', QUAKE_WEB_HOST: '0.0.0.0', QUAKE_MULTIPLAYER_HOST: '0.0.0.0' });
  assert.equal(config.diagnostics, false);
  assert.equal(config.certificateHostname, 'quake.example.com');
  assert.equal(config.webHost, '0.0.0.0');
  assert.deepEqual([...config.origins], ['https://quake.example.com']);
});
test('production rejects insecure, ambiguous and missing endpoints', () => {
  assert.throws(() => serverConfig({ NODE_ENV: 'production' }), /HTTPS/);
  assert.throws(() => serverConfig({ QUAKE_PUBLIC_ORIGIN: 'https://quake.example.com/path' }), /exact/);
  for (const value of ['http://quake.example.com/quake', 'https://quake.example.com/other', 'https://quake.example.com/quake?token=x']) {
    assert.throws(() => serverConfig({ QUAKE_MULTIPLAYER_URL: value }), /HTTPS URL ending/);
  }
  assert.throws(() => serverConfig({ QUAKE_WEB_PORT: '-1' }), /port/);
  assert.throws(() => serverConfig({ QUAKE_TLS_CERT: 'cert.pem' }), /both/);
  assert.throws(() => serverConfig({ QUAKE_ALLOWED_ORIGINS: '*' }));
});
