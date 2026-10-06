// Live list of the players in each multiplayer room, refreshed every few
// seconds from /api/status.
const $ = id => document.getElementById(id);
const SKILLS = ['Easy', 'Normal', 'Hard', 'Nightmare'];
let updatedAt = 0;

function duration(total) {
  const hours = Math.floor(total / 3600), minutes = Math.floor(total / 60) % 60, seconds = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return minutes ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
}
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function element(tag, properties = {}, children = []) {
  const node = Object.assign(document.createElement(tag), properties);
  node.append(...children);
  return node;
}

function room(info) {
  const facts = info.available ? [
    `${info.players.length} of ${info.maxPlayers} players`,
    info.mode === 'coop' ? SKILLS[info.skill] : null,
    info.monsters ? `${info.monsters.killed} of ${info.monsters.total} monsters killed` : null,
    info.fragLimit ? `${info.fragLimit} frag limit` : null,
    info.timeLimit ? `${info.timeLimit} minute rounds` : null,
    info.timeLimit && info.players.length ? `${duration(Math.max(0, info.timeLimit * 60 - info.mapTime))} left in this round` : null,
  ] : ['Starting…'];
  const body = info.players.length
    ? element('table', {}, [
      element('thead', {}, [element('tr', {}, [
        element('th', { textContent: 'Player', scope: 'col' }),
        element('th', { textContent: 'Frags', scope: 'col', className: 'number' }),
        element('th', { textContent: 'Ping', scope: 'col', className: 'number' }),
        element('th', { textContent: 'Online', scope: 'col', className: 'number' }),
      ])]),
      element('tbody', {}, info.players.map(player => element('tr', {}, [
        element('td', { textContent: player.name || 'player' }),
        element('td', { textContent: player.frags, className: 'number' }),
        element('td', { textContent: `${player.ping} ms`, className: 'number' }),
        element('td', { textContent: duration(player.seconds), className: 'number' }),
      ]))),
    ])
    : element('p', { className: 'empty', textContent: 'Nobody is playing right now.' });
  return element('section', { className: 'room', ariaLabel: info.label }, [
    element('h2', { textContent: `${info.label} · ${info.map}` }),
    element('p', { className: 'facts', textContent: facts.filter(Boolean).join(' · ') }),
    body,
  ]);
}

function showUpdated() {
  $('updated').textContent = updatedAt ? `UPDATED ${duration(Math.round((Date.now() - updatedAt) / 1000)).toUpperCase()} AGO` : '';
}

async function refresh() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const status = await response.json();
    if (!status.available) {
      $('summary').textContent = 'The multiplayer server is not running.';
      $('rooms').replaceChildren();
    } else {
      $('summary').textContent = `${plural(status.players, 'player')} online · server up ${duration(status.uptime)}`;
      $('rooms').replaceChildren(...status.rooms.map(room));
    }
    updatedAt = Date.now();
  } catch {
    $('summary').textContent = "Can't reach the server. Trying again…";
  }
  showUpdated();
}

setInterval(() => { if (!document.hidden) refresh(); }, 5000);
setInterval(showUpdated, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
refresh();
