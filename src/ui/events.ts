export type EventKind = 'gain' | 'loss' | 'battle' | 'research' | 'build' | 'diplomacy' | 'air';

interface Entry { kind: EventKind; text: string; when: string; at?: [number, number] }

const ICON: Record<EventKind, string> = {
  gain: '▲', loss: '▼', battle: '✳', research: '◈', build: '⚒', diplomacy: '⚑', air: '✈',
};

/**
 * A running log of what the war just did.
 *
 * Without it the simulation is invisible: provinces change hands, research
 * lands and formations arrive with nothing to tell you. Clicking an entry
 * takes the camera to where it happened.
 */
export class EventLog {
  readonly el: HTMLElement;
  private entries: Entry[] = [];
  private limit = 7;

  constructor(private goTo: (at: [number, number]) => void) {
    this.el = document.createElement('div');
    this.el.id = 'eventlog';
    this.el.className = 'panel';
    this.el.hidden = true;
  }

  push(kind: EventKind, text: string, when: Date, at?: [number, number]) {
    const stamp = `${when.getUTCDate()}/${when.getUTCMonth() + 1}`;
    this.entries.unshift({ kind, text, when: stamp, at });
    if (this.entries.length > this.limit) this.entries.length = this.limit;
    this.render();
  }

  clear() { this.entries = []; this.render(); }

  private render() {
    this.el.hidden = this.entries.length === 0;
    this.el.innerHTML = this.entries.map((e, i) => `
      <div class="ev ${e.kind} ${e.at ? 'go' : ''}" data-i="${i}">
        <span class="ei">${ICON[e.kind]}</span>
        <span class="et">${e.text}</span>
        <span class="ed">${e.when}</span>
      </div>`).join('');
    this.el.querySelectorAll<HTMLElement>('.ev.go').forEach((row) => {
      row.onclick = () => {
        const entry = this.entries[Number(row.dataset.i)];
        if (entry?.at) this.goTo(entry.at);
      };
    });
  }
}
