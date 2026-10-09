/**
 * "Press any button or click to start", over the valley once it has loaded: browsers only let sound play after a press, so any
 * key, click, tap or gamepad button wakes the audio and lifts the screen. Skipped when the sound may already play.
 */
export function openStart(root: HTMLElement, ctx: AudioContext): Promise<void> {
  if (ctx.state === 'running') return Promise.resolve();
  return new Promise((done) => {
    const screen = document.createElement('div');
    screen.className = 'start';
    screen.setAttribute('role', 'button');
    screen.tabIndex = 0;
    screen.innerHTML = '<div class="start-card"><h1 class="start-title">Your valley is ready!</h1>'
      + '<p class="start-press">Press any button or click to start</p><p class="start-hint">Turn your sound on to hear it come alive.</p></div>';
    root.append(screen);
    screen.focus({ preventScroll: true });

    const pads = () => Array.from(navigator.getGamepads?.() ?? []).some((p) => p?.buttons.some((b) => b.pressed));
    let wasDown = pads(); // a button already held when the screen opens must be let go first
    const poll = setInterval(() => {
      const down = pads();
      if (down && !wasDown) go();
      wasDown = down;
    }, 50); // a timer, not animation frames: it keeps working while the window is in the background
    // the press that starts is the screen's own: it must not also steer the camera or pick a viewpoint
    const key = (e: KeyboardEvent) => {
      if (e.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      go();
    };
    const press = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      go();
    };
    window.addEventListener('keydown', key, true);
    screen.addEventListener('pointerdown', press);

    function go() {
      clearInterval(poll);
      window.removeEventListener('keydown', key, true);
      screen.removeEventListener('pointerdown', press);
      ctx.resume().catch(() => {}); // within the press, so the browser allows it
      screen.classList.add('closing');
      setTimeout(() => screen.remove(), 450);
      done();
    }
  });
}
