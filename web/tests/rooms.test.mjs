import test from 'node:test';
import assert from 'node:assert/strict';
import { multiplayerRules, roomStartup } from '../rooms.mjs';

test('co-op and deathmatch have independent routes, maps and rules', () => {
  const { defaultMode, rooms: [coop, deathmatch] } = multiplayerRules({});
  assert.equal(defaultMode, 'coop');
  assert.equal(coop.path, '/quake'); assert.equal(deathmatch.path, '/deathmatch');
  assert.equal(deathmatch.fragLimit, 20); assert.equal(deathmatch.timeLimit, 10);
  assert.match(roomStartup(coop), /coop 1\ndeathmatch 0\nnomonsters 0/);
  assert.match(roomStartup(deathmatch), /coop 0\ndeathmatch 1\nnomonsters 1/);
  assert.match(roomStartup(deathmatch), /samelevel 1\nnoexit 1\npausable 0/);
});
test('room settings are configurable without modifying another room', () => {
  const { defaultMode, rooms: [coop, deathmatch] } = multiplayerRules({ QUAKE_MULTIPLAYER_MODE: 'deathmatch',
    QUAKE_COOP_MAP: 'e1m2', QUAKE_DEATHMATCH_MAP: 'e1m3', QUAKE_DEATHMATCH_FRAGLIMIT: '5', QUAKE_DEATHMATCH_TIMELIMIT: '0' });
  assert.equal(defaultMode, 'deathmatch'); assert.equal(coop.map, 'e1m2'); assert.equal(coop.fragLimit, 0);
  assert.equal(deathmatch.map, 'e1m3'); assert.equal(deathmatch.fragLimit, 5); assert.equal(deathmatch.timeLimit, 0);
});
test('unsafe map names and invalid deathmatch limits are rejected', () => {
  assert.throws(() => multiplayerRules({ QUAKE_MULTIPLAYER_MODE: 'other' }));
  assert.throws(() => multiplayerRules({ QUAKE_DEATHMATCH_MAP: 'e1m1\nquit' }));
  for (const value of ['-1', '1.5', 'nan', '1001']) assert.throws(() => multiplayerRules({ QUAKE_DEATHMATCH_FRAGLIMIT: value }));
  assert.throws(() => multiplayerRules({ QUAKE_MULTIPLAYER_SKILL: '4' }));
});
