// The engine owns key_dest and pauses local single player while this HTML
// menu is open. Buttons queue the original commands for its next frame.
const titles = { main: 'Game menu', singleplayer: 'New game', multiplayer: 'Multiplayer', saves: 'Save & load', settings: 'Settings', help: 'Controls & console', exit: 'Return to launcher' };
const defaults = 'bind w +forward\nbind s +back\nbind a +moveleft\nbind d +moveright\nbind SPACE +jump\nbind MOUSE1 +attack\nbind TAB +showscores\n+mlook\n';
const settingFields = { sensitivity: 'sensitivity', volume: 'volume', bgmvolume: 'musicVolume', fov: 'fov', gamma: 'gamma', scr_sbarscale: 'hudScale' };
const $ = id => document.getElementById(id);

export function createGameMenu(game) {
  const dialog = $('game-menu');
  let page = 'main', saving = false, returnFocus;
  const state = () => game.state();
  const close = () => game.command('web_menu_close');

  function showPage(next) {
    page = Object.hasOwn(titles, next) ? next : 'main';
    for (const panel of dialog.querySelectorAll('[data-menu-panel]')) panel.hidden = panel.dataset.menuPanel !== page;
    $('menu-title').textContent = titles[page];
    $('menu-back').hidden = page === 'main';
    dialog.querySelector('.menu-body').scrollTop = 0;
    const current = state();
    $('menu-context').textContent = current.serverActive ? 'Single player' : current.connected ? 'Multiplayer · the world keeps running' : 'Disconnected';
    $('menu-hint').textContent = current.serverActive ? 'Single player pauses in this menu.' : 'Multiplayer keeps running while you use the menu.';
    if (page === 'saves') renderSaves();
    if (page === 'settings') {
      for (const input of dialog.querySelectorAll('[data-setting]')) {
        const value = current.settings?.[settingFields[input.dataset.setting]] ?? current[input.dataset.setting];
        if (Number.isFinite(value)) input.value = value;
        updateOutput(input);
      }
      $('always-run').checked = Boolean(current.settings?.alwaysRun);
      $('invert-look').checked = Boolean(current.settings?.invertLook);
      $('player-name').value = current.settings?.name || '';
    }
    if (page === 'singleplayer') {
      $('difficulty').value = Math.max(0, Math.min(3, current.skill));
      const maps = current.settings?.fullCampaign
        ? [['e2m1', 'Episode 2: The Realm of Black Magic'], ['e3m1', 'Episode 3: The Netherworld'], ['e4m1', 'Episode 4: The Elder World']] : [];
      const select = $('newgame-map'), chosen = select.value;
      select.replaceChildren(...[['start', 'Difficulty & episode selector'], ['e1m1', 'Episode 1: Dimension of the Doomed'], ...maps].map(([id, name]) => new Option(name, id)));
      if ([...select.options].some(option => option.value === chosen)) select.value = chosen;
    }
    if (dialog.open) (page === 'main' ? dialog.querySelector('[data-page]') : $('menu-back')).focus({ preventScroll: true });
  }
  function change(next) {
    if (next === null) {
      if (dialog.open) dialog.close();
      document.body.classList.remove('menu-open');
      game.changed(false);
      returnFocus?.focus?.({ preventScroll: true });
      return;
    }
    if (!dialog.open) {
      returnFocus = document.activeElement;
      dialog.showModal();
      document.body.classList.add('menu-open');
    }
    game.release();
    showPage(next);
    game.changed(true);
  }
  const open = next => game.command(next === 'multiplayer' ? 'menu_multiplayer' : next === 'settings' ? 'menu_options' : 'menu_main');
  for (const button of dialog.querySelectorAll('[data-page]')) button.addEventListener('click', () => showPage(button.dataset.page));
  $('menu-back').addEventListener('click', () => showPage('main'));
  $('menu-toggle').addEventListener('click', () => game.command('togglemenu'));
  for (const id of ['menu-close', 'menu-resume']) $(id).addEventListener('click', async () => { close(); await game.resume(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  // Keep input and tab navigation in the DOM, out of SDL's keyboard handler.
  window.addEventListener('keydown', event => {
    if (!dialog.open) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); page === 'main' ? close() : showPage('main'); }
  }, true);
  window.addEventListener('keyup', event => { if (dialog.open) event.stopImmediatePropagation(); }, true);

  function updateOutput(input) {
    const output = dialog.querySelector('output[for="' + input.id + '"]');
    output.value = ['volume', 'bgmvolume'].includes(input.dataset.setting) ? Math.round(Number(input.value) * 100) + '%' : input.value;
  }
  for (const input of dialog.querySelectorAll('[data-setting]')) input.addEventListener('input', () => {
    updateOutput(input);
    game.command(input.dataset.setting + ' ' + Number(input.value));
  });
  $('always-run').addEventListener('change', () => game.command('cl_forwardspeed ' + ($('always-run').checked ? 400 : 200) + '\ncl_backspeed ' + ($('always-run').checked ? 400 : 200)));
  $('invert-look').addEventListener('change', () => game.command('m_pitch ' + ($('invert-look').checked ? -0.022 : 0.022)));
  $('name-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('player-name').value.replace(/["\\;\r\n]/g, '').trim().slice(0, 15);
    if (name) game.command('name "' + name + '"');
  });
  $('newgame').addEventListener('click', () => {
    const difficulty = Number($('difficulty').value), map = $('newgame-map').value;
    if (![0, 1, 2, 3].includes(difficulty) || ![...$('newgame-map').options].some(option => option.value === map)) return;
    game.localGame();
    game.command('web_menu_close\ndisconnect\nmaxplayers 1\ncoop 0\ndeathmatch 0\nnomonsters 0\nskill ' + difficulty + '\nmap ' + map);
  });
  $('reset-controls').addEventListener('click', () => { game.command(defaults); $('binding-result').textContent = 'Restored WASD, Space, mouse fire, and Tab.'; });
  $('binding-form').addEventListener('submit', event => {
    event.preventDefault();
    const key = $('binding-key').value, action = $('binding-action').value;
    game.command('bind "' + key + '" "' + action + '"');
    $('binding-result').textContent = 'Assigned ' + $('binding-key').selectedOptions[0].text + ' to ' + $('binding-action').selectedOptions[0].text.toLowerCase() + '.';
  });
  $('exit-game').addEventListener('click', async () => {
    $('exit-game').disabled = true;
    try { game.command('web_writeconfig'); await new Promise(resolve => setTimeout(resolve, 100)); await game.sync(); location.reload(); }
    catch (error) { $('exit-game').disabled = false; $('save-status').textContent = 'Could not sync saves: ' + error.message; }
  });
  $('chat-form').addEventListener('submit', event => {
    event.preventDefault();
    const message = $('chat').value.replace(/["\\;\r\n]/g, '').trim();
    if (message && state().connected && !state().serverActive) {
      game.command('say "' + message + '"'); $('chat').value = ''; $('chat-status').textContent = 'Chat sent.';
    }
  });

  function saveAllowed() {
    const current = state();
    return current.serverActive && current.signon === 4 && !current.coop && !current.deathmatch && !current.nomonsters && !current.intermission && current.health > 0;
  }
  function renderSaves() {
    const fs = game.fs(), available = saveAllowed();
    $('saves-note').textContent = available ? 'Save this single-player game, or load earlier progress.' : 'Saving requires a living player in a local single-player level. Load a save to leave multiplayer.';
    const names = fs.readdir('/user/id1').filter(name => /^[a-zA-Z0-9_-]+\.sav$/.test(name));
    const slots = [...new Set([...Array.from({ length: 5 }, (_, i) => 's' + i + '.sav'), ...names])];
    $('save-slots').replaceChildren(...slots.map(filename => {
      const exists = names.includes(filename), name = filename.slice(0, -4);
      const row = Object.assign(document.createElement('div'), { className: 'save-slot' });
      const text = document.createElement('span'), title = document.createElement('strong'), detail = document.createElement('small');
      title.textContent = /^s[0-4]$/.test(name) ? 'Slot ' + (Number(name.slice(1)) + 1) : name;
      let description = 'Empty';
      if (exists) {
        try { description = fs.readFile('/user/id1/' + filename, { encoding: 'utf8' }).split('\n')[1].replaceAll('_', ' ').trim(); } catch { description = 'Saved game'; }
      }
      detail.textContent = description; text.append(title, detail);
      const save = Object.assign(document.createElement('button'), { textContent: exists ? 'Overwrite' : 'Save', disabled: !available || saving });
      save.dataset.save = name; save.setAttribute('aria-label', (exists ? 'Overwrite ' : 'Save ') + title.textContent.toLowerCase());
      save.addEventListener('click', async () => {
        if (!saveAllowed() || saving) return;
        saving = true; renderSaves(); $('save-result').textContent = 'Saving…';
        let unwatch, timer;
        const completion = new Promise((resolve, reject) => {
          let began = false;
          unwatch = game.onLog(line => {
            if (line.includes('Saving game to')) began = true;
            if (began && /done\./i.test(line)) resolve();
          });
          timer = setTimeout(() => reject(new Error('Quake could not save this game.')), 5000);
        });
        try {
          game.command('save ' + name);
          await completion;
          if (!fs.analyzePath('/user/id1/' + filename).exists) throw new Error('Quake could not save this game.');
          await game.sync(); $('save-result').textContent = title.textContent + ' saved.';
        } catch (error) { $('save-result').textContent = error.message; }
        finally { unwatch?.(); clearTimeout(timer); saving = false; renderSaves(); }
      });
      const load = Object.assign(document.createElement('button'), { textContent: 'Load', disabled: !exists || saving });
      load.dataset.load = name; load.setAttribute('aria-label', 'Load ' + title.textContent.toLowerCase());
      load.addEventListener('click', () => { game.localGame(); game.command('web_menu_close\nload ' + name); });
      row.append(text, save, load); return row;
    }));
  }
  return { change, open, close, refreshSaves: renderSaves, get openNow() { return dialog.open; }, get page() { return page; } };
}
