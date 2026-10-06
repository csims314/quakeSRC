export function multiplayerRules(env = process.env) {
  const defaultMode = env.QUAKE_MULTIPLAYER_MODE || 'coop';
  if (!['coop', 'deathmatch'].includes(defaultMode)) throw new Error('QUAKE_MULTIPLAYER_MODE must be coop or deathmatch');
  const map = (value, name) => {
    if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error(`Invalid ${name} map name`);
    return value;
  };
  const number = (name, fallback, max) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`${name} must be an integer from 0 to ${max}`);
    return value;
  };
  const skill = number('QUAKE_MULTIPLAYER_SKILL', 1, 3);
  return { defaultMode, rooms: [
    { id: 'coop', path: '/quake', label: 'Co-op', skill,
      map: map(env.QUAKE_COOP_MAP || env.QUAKE_MULTIPLAYER_MAP || 'e1m1', 'co-op'), fragLimit: 0, timeLimit: 0 },
    { id: 'deathmatch', path: '/deathmatch', label: 'Deathmatch', skill,
      map: map(env.QUAKE_DEATHMATCH_MAP || 'e1m1', 'deathmatch'),
      fragLimit: number('QUAKE_DEATHMATCH_FRAGLIMIT', 20, 1000), timeLimit: number('QUAKE_DEATHMATCH_TIMELIMIT', 10, 1440) },
  ] };
}

export function roomStartup(room) {
  const deathmatch = room.id === 'deathmatch';
  return `hostname "Quake ${room.label}"\ncoop ${deathmatch ? 0 : 1}\ndeathmatch ${deathmatch ? 1 : 0}\nnomonsters ${deathmatch ? 1 : 0}\nskill ${room.skill}\nfraglimit ${room.fragLimit}\ntimelimit ${room.timeLimit}\nsamelevel ${deathmatch ? 1 : 0}\nnoexit ${deathmatch ? 1 : 0}\npausable ${deathmatch ? 0 : 1}\nmap ${room.map}\n`;
}
