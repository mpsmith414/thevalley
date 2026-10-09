/**
 * "Press any button or click to start", over the valley once it has loaded: browsers only let sound play after a press, so any
 * key, click, tap or gamepad button wakes the audio and lifts the screen. Skipped when the sound may already play. If the
 * browser still keeps the sound asleep (some do not count a gamepad button as a press), the screen stays and asks for a click
 * or a key instead.
 */
export function openStart(root: HTMLElement, ctx: AudioContext): Promise<void> {
  if (ctx.state === 'running') return Promise.resolve();
  return new Promise((done) => {
    const screen = document.createElement('div');
    screen.className = 'start';
    screen.setAttribute('role', 'button');
    screen.tabIndex = 0;
    screen.innerHTML = '<div class="start-card"><h1 class="start-title">Your valley is ready!</h1>'
      + '<p class="start-press">Press any button or click to start</p>'
      + '<p class="start-hint" aria-live="polite">Turn your sound on to hear it come alive.</p></div>';
    root.append(screen);
    screen.focus({ preventScroll: true });
    const hint = screen.querySelector<HTMLElement>('.start-hint')!;

    const pads = () => Array.from(navigator.getGamepads?.() ?? []).some((p) => p?.buttons.some((b) => b.pressed));
    let wasDown = pads(); // a button already held when the screen opens must be let go first
    const poll = setInterval(() => {
      const down = pads();
      if (down && !wasDown) void go();
      wasDown = down;
    }, 50); // a timer, not animation frames: it keeps working while the window is in the background
    // the press that starts is the screen's own: it must not also steer the camera or pick a viewpoint
    const key = (e: KeyboardEvent) => {
      // leave the browser's own shortcuts alone (reload, dev tools, full screen, switching tabs…)
      if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
      void go();
    };
    const press = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      void go();
    };
    window.addEventListener('keydown', key, true);
    screen.addEventListener('pointerdown', press);

    let finished = false;
    /**
     * Each press asks again (a later one may be the press the browser counts). A refused `resume` can stay pending rather than
     * fail, so it only gets a moment before the state is checked.
     */
    async function go() {
      try {
        await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 400))]); // within the press, so it should be allowed
      } catch (e) {
        console.warn('sound: the browser would not start the audio', e);
      }
      if (finished) return;
      if (ctx.state === 'closed') console.warn('sound: the audio context is closed; the valley goes on without sound');
      else if (ctx.state !== 'running') {
        // still asleep: stay armed and ask for a press the browser will count
        console.warn(`sound: the audio is still ${ctx.state} after a press`);
        hint.textContent = 'Click or press a key to start the sound.';
        screen.classList.add('nudge');
        return;
      }
      finished = true;
      clearInterval(poll);
      window.removeEventListener('keydown', key, true);
      screen.removeEventListener('pointerdown', press);
      screen.classList.add('closing');
      setTimeout(() => screen.remove(), 450);
      done();
    }
  });
}
