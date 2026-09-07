import { COMMAND_LIMIT, type Army, type ArmyStore } from '../game/armies';
import { TEMPLATES } from '../game/scenario';
import type { Division } from '../game/types';

/**
 * The command bar along the bottom: one card per army.
 *
 * Left click selects everything in the army, right click assigns whatever is
 * currently selected to it.
 */
export class ArmyBar {
  readonly el: HTMLElement;

  constructor(
    private store: ArmyStore,
    private playerId: () => number,
    private hooks: {
      select: (divisions: Division[]) => void;
      assign: (army: Army) => void;
      created: (army: Army) => void;
    },
  ) {
    this.el = document.createElement('div');
    this.el.id = 'armybar';
    this.render();
  }

  render() {
    const owner = this.playerId();
    this.store.prune();
    const armies = this.store.forOwner(owner);

    this.el.innerHTML = armies.map((a) => {
      const divisions = this.store.divisionsOf(a);
      const org = divisions.length
        ? divisions.reduce((s, d) => s + d.org, 0) / divisions.length : 0;
      const strength = divisions.length
        ? divisions.reduce((s, d) => s + d.strength, 0) / divisions.length : 0;
      const fighting = divisions.some((d) => d.attacking !== null);
      const moving = divisions.some((d) => d.route);
      const kinds = new Set(divisions.map((d) => TEMPLATES[d.template].name.split(' ')[0]));
      return `
        <div class="army ${fighting ? 'fighting' : moving ? 'moving' : ''}" data-army="${a.id}">
          <div class="badge">${a.general.split(' ').pop()!.slice(0, 2).toUpperCase()}</div>
          <div class="body">
            <div class="an">${a.name}</div>
            <div class="ag">${a.general}</div>
            <div class="bars">
              <div class="bar"><i style="width:${org * 100}%;background:#d9b74a"></i></div>
              <div class="bar"><i style="width:${strength * 100}%;background:#6fa860"></i></div>
            </div>
            <div class="am">${[...kinds].slice(0, 3).join(' · ') || 'no formations'}</div>
          </div>
          <div class="count">${a.divisions.length}<span>/${COMMAND_LIMIT}</span></div>
          <button class="x" data-disband="${a.id}" title="disband">×</button>
        </div>`;
    }).join('') + `
      <button class="newarmy" title="create a new army">
        <span class="plus">+</span><span class="lbl">NEW<br>ARMY</span>
      </button>
      <div class="tip">left click an army to select it · right click to assign selected units</div>`;

    this.el.querySelector<HTMLButtonElement>('.newarmy')!.onclick = () => {
      const army = this.store.create(this.playerId());
      this.hooks.created(army);
      this.render();
    };

    this.el.querySelectorAll<HTMLElement>('.army').forEach((card) => {
      const army = this.store.byId(Number(card.dataset.army))!;
      card.onclick = (e) => {
        if ((e.target as HTMLElement).dataset.disband) return;
        this.hooks.select(this.store.divisionsOf(army));
      };
      card.oncontextmenu = (e) => {
        e.preventDefault();
        this.hooks.assign(army);
        this.render();
      };
    });

    this.el.querySelectorAll<HTMLElement>('[data-disband]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        this.store.disband(Number(b.dataset.disband));
        this.render();
      };
    });
  }
}
