import type { Map as MapLibreMap } from 'maplibre-gl';
import type { Scenario } from '../game/scenario';
import type { World } from '../game/world';
import { TERRAIN } from '../game/types';
import { commandLabel, formatDistance, metersPerPixel } from '../map/scale';

const el = (html: string): HTMLElement => {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild as HTMLElement;
};

/** Scale readout and the province inspector. */
export function mountHud(map: MapLibreMap, world: World, scn: Scenario) {
  const hud = document.getElementById('hud')!;

  const inspect = el(`
    <div class="panel" id="inspect">
      <div class="title">PROVINCE</div>
      <div class="body"><span class="empty">hover the map</span></div>
    </div>`);
  const scalebar = el(`<div id="scalebar"><div class="len">-</div><div class="bar"></div></div>`);
  const hint = el(`
    <div id="hint">
      <b>click</b> select · <b>right click</b> order · <b>shift+drag</b> box select · <b>drag</b> pan<br>
      <b>F</b> front · <b>I</b> invasion · <b>B</b> fallback · <b>G</b> globe<br>
      <b>space</b> pause · <b>1-5</b> speed · <b>T</b> research · <b>C</b> follow · <b>P</b> political · <b>U</b> units<br>
      <b>E</b> take the field on foot
    </div>`);
  const status = el(`<div id="status"></div>`);
  hud.append(inspect, scalebar, hint, status);

  function updateScale() {
    const z = map.getZoom();
    const lat = map.getCenter().lat;
    const mpp = metersPerPixel(z, lat);
    const target = 120 * mpp;
    const pow = 10 ** Math.floor(Math.log10(target));
    const nice = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= target * 0.55) ?? pow;
    // the scale bar keeps the echelon readout, now that the panel is gone
    scalebar.querySelector('.len')!.textContent = `${formatDistance(nice)} · ${commandLabel(z)}`;
    (scalebar.querySelector('.bar') as HTMLElement).style.width = `${nice / mpp}px`;
  }

  map.on('move', updateScale);
  map.on('zoom', updateScale);
  updateScale();

  return {
    setBand: updateScale,
    setStatus(text: string) {
      status.textContent = text;
      status.classList.toggle('on', !!text);
    },
    setProvince(id: number | null) {
      const body = inspect.querySelector('.body')!;
      if (id == null) { body.innerHTML = '<span class="empty">hover the map</span>'; return; }
      const p = world.province(id);
      const owner = scn.nations.get(scn.controller[id]);
      const core = scn.nations.get(scn.owner[id]);
      const units = scn.divisions.filter((d) => d.province === id).length;
      const vp = scn.victoryPoints.get(id);
      body.innerHTML = [
        ['name', p.n],
        ['controller', owner?.name ?? '-'],
        ...(core && core.id !== owner?.id ? [['owner', core.name] as [string, string]] : []),
        ['terrain', TERRAIN[p.t].label],
        ['coast', p.o ? 'yes' : 'no'],
        ['units', String(units)],
        ...(vp ? [['victory pts', String(vp)] as [string, string]] : []),
      ].map(([k, v]) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`).join('');
    },
  };
}
