// On-screen controls for phones and tablets. A stick appears wherever the
// left thumb lands, dragging on the right side (or on Fire) turns the view,
// and buttons fire, jump and switch weapons. While a menu or the console is
// open, arrow and Enter keys replace them. Input goes through the engine's
// own movement and key handling, so bindings and game rules are unchanged.

const KEY = { enter: 13, escape: 27, up: 128, down: 129, left: 130, right: 131 };
const STICK_RADIUS = 56, DEAD_ZONE = 0.15;

const LAYOUT = `
  <div class="touch-move"><div class="touch-stick" hidden><div class="touch-knob"></div></div></div>
  <div class="touch-look"></div>
  <div class="touch-top">
    <button type="button" data-key="escape" aria-label="Menu">Menu</button>
    <button type="button" data-hold="+showscores" aria-label="Scores">Scores</button>
  </div>
  <div class="touch-actions">
    <button type="button" class="touch-fire" data-hold="+attack" data-look aria-label="Fire">Fire</button>
    <button type="button" data-hold="+jump" aria-label="Jump">Jump</button>
    <button type="button" data-tap="impulse 10" aria-label="Next weapon">Weapon</button>
  </div>
  <div class="touch-menu">
    <button type="button" data-key="up" aria-label="Up">▲</button>
    <button type="button" data-key="left" aria-label="Left">◀</button>
    <button type="button" data-key="enter" aria-label="Select">OK</button>
    <button type="button" data-key="right" aria-label="Right">▶</button>
    <button type="button" data-key="down" aria-label="Down">▼</button>
    <button type="button" data-key="escape" aria-label="Back">Back</button>
  </div>
  <p class="touch-rotate">Turn your device sideways for more room.</p>`;

// game: { ready(), move(forward, side), look(yaw, pitch), command(text), key(code, down), state() }
export function createTouchControls(stage, game) {
  const root = document.createElement('div');
  root.className = 'touch';
  root.hidden = true;
  root.innerHTML = LAYOUT;
  stage.append(root);
  const stick = root.querySelector('.touch-stick'), knob = root.querySelector('.touch-knob');
  const pointers = new Map();
  let enabled = false, mode = 'game', poll;

  const lookScale = () => {
    try { return 0.1 * (game.state().sensitivity || 3); } catch { return 0.3; }
  };

  function release(id) {
    const pointer = pointers.get(id);
    if (!pointer) return;
    pointers.delete(id);
    if (pointer.kind === 'move') { game.move(0, 0); stick.hidden = true; }
    if (pointer.hold) game.command(pointer.hold.replace('+', '-'));
    if (pointer.key) game.key(pointer.key, false);
    pointer.button?.classList.remove('active');
  }
  function releaseAll() { for (const id of [...pointers.keys()]) release(id); }

  function moveStick(pointer, event) {
    let x = (event.clientX - pointer.x) / STICK_RADIUS, y = (event.clientY - pointer.y) / STICK_RADIUS;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    knob.style.transform = `translate(${x * STICK_RADIUS}px, ${y * STICK_RADIUS}px)`;
    const strength = Math.min(1, length);
    const scale = strength < DEAD_ZONE ? 0 : (strength - DEAD_ZONE) / (1 - DEAD_ZONE) / (strength || 1);
    game.move(-y * scale, x * scale);
  }

  root.addEventListener('pointerdown', event => {
    if (!game.ready()) return;
    event.preventDefault();
    const target = event.target.closest('button, .touch-move, .touch-look');
    if (!target) return;
    try { root.setPointerCapture(event.pointerId); } catch {}
    const pointer = { x: event.clientX, y: event.clientY, scale: lookScale() };
    if (target.matches('.touch-move')) {
      pointer.kind = 'move';
      const box = stage.getBoundingClientRect();
      stick.style.left = `${event.clientX - box.left}px`;
      stick.style.top = `${event.clientY - box.top}px`;
      knob.style.transform = '';
      stick.hidden = false;
    } else if (target.matches('.touch-look')) {
      pointer.kind = 'look';
    } else {
      pointer.button = target;
      target.classList.add('active');
      if (target.dataset.look !== undefined) pointer.kind = 'look';
      if (target.dataset.hold) { pointer.hold = target.dataset.hold; game.command(pointer.hold); }
      if (target.dataset.tap) game.command(target.dataset.tap);
      if (target.dataset.key) { pointer.key = KEY[target.dataset.key]; game.key(pointer.key, true); }
    }
    pointers.set(event.pointerId, pointer);
  });
  root.addEventListener('pointermove', event => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    event.preventDefault();
    if (pointer.kind === 'move') moveStick(pointer, event);
    else if (pointer.kind === 'look') {
      game.look((event.clientX - pointer.x) * pointer.scale, (event.clientY - pointer.y) * pointer.scale);
      pointer.x = event.clientX; pointer.y = event.clientY;
    }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    root.addEventListener(type, event => release(event.pointerId));
  }
  root.addEventListener('contextmenu', event => event.preventDefault());
  window.addEventListener('blur', releaseAll);
  window.addEventListener('resize', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  // Menus and the console take arrow keys; gameplay takes the stick.
  function refresh() {
    let next = 'game';
    try { next = game.state().keyDest || 'game'; } catch {}
    if (next === 'message') next = 'game';
    if (next !== mode) { releaseAll(); mode = next; root.dataset.mode = mode; }
    root.hidden = !enabled || !game.ready() || Boolean(game.menuOpen?.());
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    releaseAll();
    clearInterval(poll);
    if (enabled) poll = setInterval(refresh, 200);
    root.dataset.mode = mode;
    refresh();
  }

  return { setEnabled, refresh, releaseAll, get enabled() { return enabled; } };
}

export function prefersTouch() {
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
}
