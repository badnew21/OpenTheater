import { BUILDABLE, COST, type Production } from '../game/production';
import { TEMPLATES } from '../game/scenario';
import type { World } from '../game/world';

/** The industry panel: what is being built, and what it is costing. */
export class ProductionPanel {
  readonly el: HTMLElement;
  private open = false;

  constructor(
    private production: Production,
    private world: World,
    private playerId: () => number,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'production';
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
    const nation = this.playerId();
    const ind = this.production.industry(nation);
    if (!ind) return;
    const rate = this.production.rate(nation);
    const deploy = this.world.province(ind.deploy);

    const options = BUILDABLE.map((kind) => {
      const tpl = TEMPLATES[kind];
      const days = rate > 0 ? Math.ceil(COST[kind] / rate) : Infinity;
      return `<button class="build" data-kind="${kind}">
          <span class="bn">${tpl.name}</span>
          <span class="bc">${COST[kind]}</span>
          <span class="bd">${isFinite(days) ? `${days}d` : '—'}</span>
        </button>`;
    }).join('');

    const queue = ind.queue.length
      ? ind.queue.map((o, i) => {
        const pct = Math.round((o.progress / o.cost) * 100);
        return `<div class="qrow ${i === 0 ? 'active' : ''}">
            <div class="qfill" style="width:${pct}%"></div>
            <span class="qn">${TEMPLATES[o.template].name}</span>
            <span class="qp">${pct}%</span>
            <button class="qx" data-cancel="${o.id}">×</button>
          </div>`;
      }).join('')
      : '<div class="empty">nothing under construction</div>';

    this.el.innerHTML = `
      <div class="head">
        <div class="title">INDUSTRY</div>
        <div class="sub">${rate.toFixed(1)} equipment/day · ${Math.floor(ind.stockpile)} in store</div>
      </div>
      <div class="builds">${options}</div>
      <div class="qhead">QUEUE · deploys to ${deploy.n}</div>
      <div class="queue">${queue}</div>`;

    this.el.querySelectorAll<HTMLElement>('.build').forEach((b) => {
      b.onclick = () => { this.production.queue(nation, b.dataset.kind as never); this.render(); };
    });
    this.el.querySelectorAll<HTMLElement>('[data-cancel]').forEach((b) => {
      b.onclick = () => { this.production.cancel(nation, Number(b.dataset.cancel)); this.render(); };
    });
  }
}
