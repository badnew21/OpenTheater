/**
 * The ground mode on its own, without the campaign behind it.
 *
 * The 3D side of OpenTheater needs no map data at all - terrain, props and
 * formations are generated from a seed - so it can be lifted out of the game
 * and shipped as a single page that anyone can open and walk around in. This
 * module is that page's driver: it stands in for the campaign by letting you
 * choose the ground and who is standing on it.
 */
import { GroundScene, type Deployment, type SquadSpec } from './scene';
import { Input } from './input';
import { TERRAIN, type Terrain } from '../game/types';

interface Power { tag: string; name: string; colour: string }

const POWERS: Power[] = [
  { tag: 'GER', name: 'Germany', colour: '#6f7d8c' },
  { tag: 'USA', name: 'United States', colour: '#4a7fa8' },
  { tag: 'RUS', name: 'Russia', colour: '#9e4a4a' },
  { tag: 'CHN', name: 'China', colour: '#c2a054' },
  { tag: 'JPN', name: 'Japan', colour: '#a86f6a' },
  { tag: 'IND', name: 'India', colour: '#5f9c72' },
];

const KINDS: Terrain[] = ['plains', 'forest', 'hills', 'mountain', 'taiga',
  'desert', 'jungle', 'marsh', 'tundra', 'arctic', 'urban'];

const BRANCHES = ['Mechanised', 'Armoured', 'Motor Rifle', 'Air Assault',
  'Marine', 'Guards Tank', 'Rifle', 'Grenadier'];

/** Ground gets named the way an operations order names it. */
const FEATURE: Partial<Record<Terrain, string>> = {
  plains: 'Sector', forest: 'Wood', hills: 'Hill', mountain: 'Ridge',
  taiga: 'Forest', desert: 'Waypoint', jungle: 'Track', marsh: 'Crossing',
  tundra: 'Sector', arctic: 'Station', urban: 'Objective',
};

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

/** Turns the form into the description the scene wants. */
function buildDeployment(seed: number): Deployment {
  const kind = $<HTMLSelectElement>('#f-terrain').value as Terrain;
  const coastal = $<HTMLInputElement>('#f-coast').checked;
  const mine = POWERS.find((p) => p.tag === $<HTMLSelectElement>('#f-you').value)!;
  const theirs = POWERS.find((p) => p.tag === $<HTMLSelectElement>('#f-them').value)!;
  const ours = Number($<HTMLSelectElement>('#f-ours').value);
  const enemy = Number($<HTMLSelectElement>('#f-enemy').value);

  const squads: SquadSpec[] = [];
  const add = (power: Power, n: number, hostile: boolean) => {
    for (let i = 0; i < n; i++) {
      squads.push({
        name: `${i + 1} ${BRANCHES[(seed + i * 3 + (hostile ? 4 : 0)) % BRANCHES.length]} Bde`,
        nation: power.name,
        colour: power.colour,
        hostile,
        // the far end of a line is usually the end that has been in contact
        strength: 1 - (i % 4) * 0.16,
      });
    }
  };
  add(mine, ours, false);
  add(theirs, enemy, true);

  return {
    province: seed,
    place: `${FEATURE[kind] ?? 'Sector'} ${100 + (seed % 800)}`,
    region: `${mine.name} · ${theirs.name}`,
    kind,
    coastal,
    playerColour: mine.colour,
    squads,
  };
}

/** The colour flying over one side of the field, as the form currently reads. */
const mineColour = (hostile: boolean): string => {
  const tag = $<HTMLSelectElement>(hostile ? '#f-them' : '#f-you').value;
  return POWERS.find((p) => p.tag === tag)?.colour ?? '#d8b46a';
};

const canvas = $<HTMLCanvasElement>('#view');
let scene: GroundScene | null = null;
let input: Input | null = null;
let seed = 1 + Math.floor(Math.random() * 9000);

function deploy() {
  scene?.dispose();
  scene = null;
  const deployment = buildDeployment(seed);
  try {
    scene = new GroundScene(canvas, deployment);
  } catch (err) {
    $('#fatal').textContent = `This browser could not start WebGL2: ${(err as Error).message}`;
    $('#fatal').classList.add('on');
    return;
  }
  if (!input) {
    input = new Input(canvas);
    input.attach();
  }
  // the swatches stand for the two sides, so they have to follow the choice
  $('#sw-you').style.background = mineColour(false);
  $('#sw-them').style.background = mineColour(true);
  $('#place').textContent = deployment.place;
  $('#sub').textContent =
    `${TERRAIN[deployment.kind]?.label ?? deployment.kind}${deployment.coastal ? ' · coastal' : ''} · seed ${seed}`;
  $('#card').classList.remove('show');
  // restart the title card by letting the class land on a fresh frame
  requestAnimationFrame(() => $('#card').classList.add('show'));
}

// --- the readout ------------------------------------------------------------

const row = (k: string, v: string) =>
  `<div class="kv"><span>${k}</span><span>${v}</span></div>`;

function updateReadout() {
  if (!scene) return;
  const s = scene.status;
  const near = isFinite(s.nearest) ? `${Math.round(s.nearest)} m` : 'none';
  $('#contact').innerHTML = [
    row('friendly', String(s.friendlies)),
    row('hostile', String(s.hostiles)),
    row('nearest', near),
    row('pace', `${s.speed.toFixed(1)} m/s`),
    row('elevation', `${Math.round(s.height)} m`),
    row('cover', s.wading ? 'wading' : `${s.props} features`),
  ].join('');
  $('#panel-contact').classList.toggle('danger', s.hostiles > 0 && s.nearest < 30);
  $('#grab').classList.toggle('on', !input?.steering);
}

// --- controls ---------------------------------------------------------------

$('#f-terrain').innerHTML = KINDS
  .map((k) => `<option value="${k}">${TERRAIN[k]?.label ?? k}</option>`).join('');
for (const id of ['#f-you', '#f-them']) {
  $(id).innerHTML = POWERS.map((p) => `<option value="${p.tag}">${p.name}</option>`).join('');
}
$<HTMLSelectElement>('#f-terrain').value = 'plains';
$<HTMLSelectElement>('#f-you').value = 'GER';
$<HTMLSelectElement>('#f-them').value = 'RUS';

$('#deploy').addEventListener('click', () => deploy());
$('#reroll').addEventListener('click', () => {
  seed = 1 + Math.floor(Math.random() * 9000);
  deploy();
});
// changing the order should not need a second click to mean anything
for (const id of ['#f-terrain', '#f-coast', '#f-you', '#f-them', '#f-ours', '#f-enemy']) {
  $(id).addEventListener('change', () => deploy());
}

// --- the loop ---------------------------------------------------------------

let last = performance.now();
let sinceReadout = 0;
const frame = (now: number) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (scene && input) {
    scene.update(dt, input);
    scene.render();
    sinceReadout += dt;
    if (sinceReadout > 0.2) { updateReadout(); sinceReadout = 0; }
  }
  requestAnimationFrame(frame);
};

deploy();
requestAnimationFrame(frame);
