import { GroundScene, type Deployment, type SquadSpec } from './scene';
import { Input } from './input';
import { biomeFor } from './palette';
import { atWar, type Scenario } from '../game/scenario';
import { TERRAIN } from '../game/types';
import type { World } from '../game/world';

const el = (html: string): HTMLElement => {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild as HTMLElement;
};

export interface GroundHooks {
  /** called when the mode closes, however it closes */
  onExit?: () => void;
  status?: (msg: string) => void;
}

/**
 * The ground mode: leaving the operational map to stand in one province.
 *
 * It owns its own canvas and HUD and puts them away completely on exit, so the
 * map underneath is never left with a dead WebGL context sitting over it.
 */
export class GroundMode {
  active = false;
  private canvas: HTMLCanvasElement | null = null;
  private scene: GroundScene | null = null;
  private input: Input | null = null;
  private hud: HTMLElement | null = null;
  private since = 0;

  constructor(
    private world: World,
    private scn: Scenario,
    private getPlayer: () => number,
    private hooks: GroundHooks = {},
  ) {}

  /** Which formations are standing on this ground, and whose side they are on. */
  private squadsIn(province: number, player: number): SquadSpec[] {
    const here = this.scn.divisions.filter((d) => d.province === province);
    const squads: SquadSpec[] = here.slice(0, 14).map((d) => {
      const nation = this.scn.nations.get(d.owner);
      return {
        name: d.name,
        nation: nation?.name ?? 'Unknown',
        colour: nation?.color ?? '#9aa0a6',
        hostile: d.owner !== player && atWar(this.scn, player, d.owner),
        strength: Math.max(0.15, Math.min(1, d.strength)),
      };
    });

    // Standing alone in an empty field is a poor first impression of the mode,
    // so an escort turns out with you wherever nothing friendly already has.
    if (!squads.some((s) => !s.hostile)) {
      const nation = this.scn.nations.get(player);
      squads.push({
        name: 'Command Escort',
        nation: nation?.name ?? 'Command',
        colour: nation?.color ?? '#d8b46a',
        hostile: false,
        strength: 0.7,
      });
    }
    return squads;
  }

  private deploymentFor(province: number): Deployment {
    const p = this.world.province(province);
    const player = this.getPlayer();
    const nation = this.scn.nations.get(player);
    return {
      province,
      place: p.n,
      region: this.world.countries[p.c]?.name ?? '',
      kind: p.t,
      coastal: p.o === 1,
      playerColour: nation?.color ?? '#d8b46a',
      squads: this.squadsIn(province, player),
    };
  }

  /**
   * Drop into a province.
   *
   * Building the ground takes a beat - a hundred thousand triangles get
   * assembled on the CPU - so the card goes up first and the work happens on
   * the frame after it, otherwise the screen simply freezes with the map still
   * on it and nothing explains why.
   */
  enter(province: number) {
    if (this.active) return;
    this.active = true;
    this.since = 0;

    const deployment = this.deploymentFor(province);
    const biome = biomeFor(deployment.kind);
    const sky = `rgb(${biome.horizon.map((c) => Math.round(c * 255)).join(',')})`;

    const canvas = document.createElement('canvas');
    canvas.id = 'ground';
    canvas.style.background = sky;
    document.body.append(canvas);
    this.canvas = canvas;

    document.getElementById('hud')!.classList.add('ground');
    this.mountHud(deployment);

    requestAnimationFrame(() => {
      if (!this.active || !this.canvas) return;
      try {
        this.scene = new GroundScene(this.canvas, deployment);
      } catch (err) {
        console.error('[ground]', err);
        this.hooks.status?.(`could not enter the ground: ${(err as Error).message}`);
        this.exit();
        return;
      }
      this.input = new Input(this.canvas);
      this.input.onLockChange = (locked) => this.hud?.classList.toggle('locked', locked);
      this.input.attach();
      this.input.requestLock();
      this.hud?.classList.add('ready');
    });
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.input?.detach();
    this.input = null;
    this.scene?.dispose();
    this.scene = null;
    this.canvas?.remove();
    this.canvas = null;
    this.hud?.remove();
    this.hud = null;
    document.getElementById('hud')!.classList.remove('ground');
    this.hooks.onExit?.();
  }

  /** Driven from the app's single animation loop. */
  frame(dt: number) {
    if (!this.active || !this.scene || !this.input) return;
    this.since += dt;
    this.scene.update(dt, this.input);
    this.scene.render();
    if (this.since > 0.2) { this.updateHud(); this.since = 0; }
    // Escape releases the pointer first; a second one leaves the ground
    if (!this.input.locked && this.input.down('Escape')) this.exit();
  }

  // --- the overlay ----------------------------------------------------------

  private mountHud(d: Deployment) {
    const hud = el(`
      <div id="groundhud">
        <div class="card">
          <div class="place"></div>
          <div class="sub"></div>
        </div>
        <div class="panel gpanel" id="groundwhere">
          <div class="title">GROUND</div>
          <div class="body"></div>
        </div>
        <div class="panel gpanel" id="groundforce">
          <div class="title">CONTACT</div>
          <div class="body"></div>
          <button class="leave">LEAVE THE FIELD</button>
        </div>
        <div class="ghint">
          <b>WASD</b> move · <b>mouse</b> look · <b>shift</b> sprint · <b>space</b> jump ·
          <b>ctrl</b> crouch · <b>wheel</b> camera · <b>esc</b> release, again to leave
        </div>
        <div class="grab">click to take the field</div>
      </div>`);

    hud.querySelector('.place')!.textContent = d.place;
    hud.querySelector('.sub')!.textContent =
      [d.region, TERRAIN[d.kind]?.label ?? d.kind, d.coastal ? 'coastal' : '']
        .filter(Boolean).join(' · ');
    hud.querySelector('.leave')!.addEventListener('click', () => this.exit());
    hud.querySelector('#groundwhere .body')!.innerHTML = [
      ['province', d.place],
      ['country', d.region || '-'],
      ['terrain', TERRAIN[d.kind]?.label ?? d.kind],
      ['coast', d.coastal ? 'yes' : 'no'],
    ].map(([k, v]) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`).join('');

    document.getElementById('hud')!.append(hud);
    this.hud = hud;
  }

  private updateHud() {
    if (!this.hud || !this.scene) return;
    const s = this.scene.status;
    const near = isFinite(s.nearest) ? `${Math.round(s.nearest)} m` : '-';
    const rows: [string, string][] = [
      ['friendly', String(s.friendlies)],
      ['hostile', String(s.hostiles)],
      ['nearest', near],
      ['pace', `${s.speed.toFixed(1)} m/s`],
      ['elevation', `${Math.round(s.height)} m`],
    ];
    this.hud.querySelector('#groundforce .body')!.innerHTML = rows
      .map(([k, v]) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`).join('');
    this.hud.classList.toggle('danger', s.hostiles > 0 && s.nearest < 30);
  }
}
