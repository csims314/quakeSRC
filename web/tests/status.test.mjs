import test from 'node:test';
import assert from 'node:assert/strict';
import { publicStatus } from '../status.mjs';

const player = (name, frags, seconds) => ({ slot: 1, name, frags, ping: 40, seconds, origin: [1, 2, 3] });
const coop = { serverActive: 1, coop: 1, deathmatch: 0, map: 'e1m2', skill: 2, serverTime: 75.6, fragLimit: 0, timeLimit: 0,
  killedMonsters: 4, totalMonsters: 30, keyDest: 'game', players: [player('Ranger', 2, 30), player('Grunt', 5, 10)] };
const deathmatch = { serverActive: 1, coop: 0, deathmatch: 1, map: 'e1m1', skill: 1, serverTime: 12, fragLimit: 20, timeLimit: 10.000,
  killedMonsters: 0, totalMonsters: 0, players: [] };

test('public status lists players without addresses, positions or diagnostics', () => {
  const status = publicStatus([
    { id: 'coop', label: 'Co-op', maxPlayers: 8, state: coop },
    { id: 'deathmatch', label: 'Deathmatch', maxPlayers: 8, state: deathmatch },
  ], 0, 90_500);
  assert.equal(status.players, 2);
  assert.equal(status.uptime, 90);
  const [first, second] = status.rooms;
  assert.deepEqual(first.players, [
    { name: 'Grunt', frags: 5, ping: 40, seconds: 10 },
    { name: 'Ranger', frags: 2, ping: 40, seconds: 30 },
  ]);
  assert.deepEqual({ ...first, players: undefined }, { id: 'coop', label: 'Co-op', maxPlayers: 8, available: true, mode: 'coop',
    map: 'e1m2', skill: 2, mapTime: 75, fragLimit: 0, timeLimit: 0, monsters: { killed: 4, total: 30 }, players: undefined });
  assert.equal(second.mode, 'deathmatch'); assert.equal(second.monsters, null);
  assert.equal(second.fragLimit, 20); assert.equal(second.timeLimit, 10);
  assert.doesNotMatch(JSON.stringify(status), /origin|keyDest|slot/);
});
