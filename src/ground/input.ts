/**
 * Keyboard and mouse for the ground mode.
 *
 * Listeners go on the canvas and on window rather than on document, and they
 * are all removed on `detach` - the strategy map has its own key handling and
 * the two must never both be live.
 */
export class Input {
  readonly keys = new Set<string>();
  /** mouse movement since the last `takeLook`, in raw pointer units */
  private dx = 0;
  private dy = 0;
  private wheel = 0;
  locked = false;
  /** set while the pointer is locked, so the mode can show the right hint */
  onLockChange: ((locked: boolean) => void) | null = null;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    this.keys.add(e.code);
    // the browser scrolls on space and quick-finds on slash; neither is wanted
    if (e.code === 'Space' || e.code === 'Slash') e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };

  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.dx += e.movementX;
    this.dy += e.movementY;
  };

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.wheel += e.deltaY;
  };

  private readonly onPointerLockChange = () => {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) this.keys.clear();
    this.onLockChange?.(this.locked);
  };

  // a click anywhere on the view takes the pointer back
  private readonly onMouseDown = () => { if (!this.locked) this.requestLock(); };

  // holding a key while the tab loses focus otherwise leaves it held forever
  private readonly onBlur = () => this.keys.clear();

  constructor(private canvas: HTMLCanvasElement) {}

  attach() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.keys.clear();
    this.releaseLock();
  }

  requestLock() {
    // Chrome rejects a lock requested too soon after the last one was dropped
    // and logs a console error; there is no state to ask, so just let it fail.
    void Promise.resolve(this.canvas.requestPointerLock()).catch(() => {});
  }

  releaseLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  down(...codes: string[]): boolean {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** Mouse delta since the last call, and it resets. */
  takeLook(): [number, number] {
    const d: [number, number] = [this.dx, this.dy];
    this.dx = 0; this.dy = 0;
    return d;
  }

  takeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }
}
