// What the public status page may show: each room's settings and, for every
// player, the name, frags, ping and time online. Addresses, positions and
// diagnostic state stay private.
export function publicStatus(rooms, startedAt, now = Date.now()) {
  const list = rooms.map(({ id, label, maxPlayers, state }) => {
    const coop = Boolean(state.coop && !state.deathmatch);
    return {
      id, label, maxPlayers,
      available: Boolean(state.serverActive),
      mode: coop ? 'coop' : 'deathmatch',
      map: state.map,
      skill: state.skill,
      mapTime: Math.floor(state.serverTime || 0),
      fragLimit: coop ? 0 : state.fragLimit,
      timeLimit: coop ? 0 : Math.round(state.timeLimit),
      monsters: coop ? { killed: state.killedMonsters, total: state.totalMonsters } : null,
      players: (state.players || [])
        .map(({ name, frags, ping, seconds }) => ({ name, frags, ping, seconds }))
        .sort((a, b) => b.frags - a.frags || b.seconds - a.seconds),
    };
  });
  return {
    available: true,
    updated: new Date(now).toISOString(),
    uptime: Math.floor((now - startedAt) / 1000),
    players: list.reduce((total, room) => total + room.players.length, 0),
    rooms: list,
  };
}
