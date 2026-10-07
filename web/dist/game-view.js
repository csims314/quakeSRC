export function createGameView({ stage, canvas, ready, engine, capture, log }) {
  const $ = id => document.getElementById(id);
  const standalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
  const nativeFullscreen = () => typeof stage.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
  let wasExpandedForInstall = false;

  function resize() {
    if (!ready()) return;
    const box = stage.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 1.5, 1600 / Math.max(box.width, box.height));
    const width = Math.max(64, Math.round(box.width * ratio)), height = Math.max(64, Math.round(box.height * ratio));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width; canvas.height = height;
    engine().ccall('Web_Viewport', null, ['number', 'number'], [width, height]);
  }
  function update() {
    const expanded = stage.classList.contains('expanded') || document.fullscreenElement === stage;
    $('view-exit').hidden = !expanded;
    $('fullscreen').setAttribute('aria-pressed', String(expanded));
    $('fullscreen').textContent = expanded ? 'Exit view' : nativeFullscreen() ? 'Fullscreen' : 'Expand game';
    $('install').hidden = standalone();
    document.body.classList.toggle('standalone', standalone());
    resize();
  }
  function expand(value) {
    stage.classList.toggle('expanded', value);
    document.body.classList.toggle('expanded-game', value);
    update();
  }
  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen?.();
      else if (stage.classList.contains('expanded')) expand(false);
      else {
        if (nativeFullscreen()) {
          try { await stage.requestFullscreen(); } catch { expand(true); }
        } else expand(true);
        if (ready() && navigator.maxTouchPoints) await screen.orientation?.lock?.('landscape').catch(() => {});
      }
      update();
      if (ready()) await capture();
    } catch (error) { log('Fullscreen: ' + error.message); }
  }
  $('fullscreen').addEventListener('click', toggle);
  $('view-exit').addEventListener('click', async () => {
    if (document.fullscreenElement) await document.exitFullscreen?.();
    expand(false);
  });
  document.addEventListener('fullscreenchange', update);
  new ResizeObserver(resize).observe(stage);
  window.addEventListener('resize', resize);
  visualViewport?.addEventListener('resize', resize);
  matchMedia('(display-mode: standalone)').addEventListener('change', update);
  let installPrompt;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event; $('install-prompt').hidden = false;
  });
  const installDialog = $('install-dialog');
  function showInstall() {
    // An install dialog outside the fullscreen element is unreachable there.
    // For CSS expansion, restore the page while the instructions are shown.
    wasExpandedForInstall = stage.classList.contains('expanded');
    if (wasExpandedForInstall) expand(false);
    if (!installDialog.open) installDialog.showModal();
  }
  $('install').addEventListener('click', showInstall);
  $('install-close').addEventListener('click', () => installDialog.close());
  installDialog.addEventListener('close', () => { if (wasExpandedForInstall) expand(true); wasExpandedForInstall = false; });
  $('install-prompt').addEventListener('click', async () => {
    if (!installPrompt) return;
    await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; installDialog.close();
  });
  window.addEventListener('appinstalled', update);
  if (!/iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    $('install-instructions').textContent = 'Use Install Quake below if offered, or choose Install app / Add to Home Screen in your browser menu. Launch the new Quake icon for a window without the browser address bar.';
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(error => log('Install support: ' + error.message));
  update();
  return { resize, showInstall, launched() { if (standalone()) expand(true); else resize(); }, expand };
}
