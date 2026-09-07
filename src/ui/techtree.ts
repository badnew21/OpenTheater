import type { Nation } from '../game/types';
import { BRANCHES, TECHS, available, techById } from '../game/tech';

/** Research panel: five branches, click a node to start it. */
export class TechTree {
  readonly el: HTMLElement;
  private open = false;

  constructor(private nation: () => Nation | undefined, private onResearch: (id: string) => void) {
    this.el = document.createElement('div');
    this.el.id = 'techtree';
    this.el.className = 'panel';
    this.el.hidden = true;
  }

  toggle(force?: boolean) {
    this.open = force ?? !this.open;
    this.el.hidden = !this.open;
    if (this.open) this.render();
  }

  render() {
    if (!this.open) return;
    const n = this.nation();
    if (!n) return;
    const cols = BRANCHES.map((branch) => {
      const nodes = TECHS.filter((t) => t.branch === branch).sort((a, b) => a.tier - b.tier);
      const cells = nodes.map((t) => {
        const done = n.techs.has(t.id);
        const can = available(n.techs, t.id);
        const active = n.researching?.id === t.id;
        const progress = active ? Math.min(1, n.researching!.progress / t.days) : 0;
        const cls = done ? 'done' : active ? 'active' : can ? 'can' : 'locked';
        return `<div class="tech ${cls}" data-tech="${t.id}">
            <div class="fill" style="width:${progress * 100}%"></div>
            <div class="tname">${t.name}</div>
            <div class="teff">${t.effect}</div>
            <div class="tdays">${done ? 'researched' : `${t.days}d`}</div>
          </div>`;
      }).join('');
      return `<div class="branch"><div class="bname">${branch}</div>${cells}</div>`;
    }).join('');

    this.el.innerHTML = `
      <div class="head"><div class="title">RESEARCH — ${n.name}</div>
        <div class="sub">${n.research.toFixed(1)} points/day${n.researching ? ` · working on ${techById.get(n.researching.id)?.name}` : ' · nothing queued'}</div>
      </div>
      <div class="branches">${cols}</div>`;

    this.el.querySelectorAll<HTMLElement>('.tech.can').forEach((cell) => {
      cell.onclick = () => this.onResearch(cell.dataset.tech!);
    });
  }
}
