import { CROP_IDS, CROPS, DAY_END, POIS, TOOLS, WATER_CAPACITY, calendar, weatherFor } from '../game/catalog';
import type { CropId, PoiId, Tool } from '../game/catalog';
import { plotDescription, shipmentValue } from '../game/simulation';
import type { GameState, MorningReport } from '../game/simulation';
import { icon } from './icons';

export type Panel = 'welcome' | 'market' | 'satchel' | 'seeds' | 'shipping' | 'sleep' | 'morning' | 'commons' | 'journal' | 'settings' | 'reset';
export type Command = { action: string; crop?: string; qty?: string; tool?: string; panel?: string; poi?: string; theme?: string; index?: string; setting?: string };
const weatherIcon = (day: number) => ({ sunny: 'sun', cloudy: 'cloud', rain: 'rain' })[weatherFor(day)];
const weatherName = (day: number) => ({ sunny: 'A little sunshine', cloudy: 'Soft skies', rain: 'A rainy little day' })[weatherFor(day)];
const disabled = (condition: boolean) => condition ? 'disabled' : '';

export class FarmInterface {
  readonly canvas: HTMLCanvasElement;
  readonly labels = new Map<PoiId, HTMLButtonElement>();
  panel: Panel | null = null;
  private hud: HTMLElement;
  private overlay: HTMLElement;
  private toastElement: HTMLElement;
  private toastTimer = 0;
  private previousFocus: HTMLElement | null = null;
  private questKey = '';
  private state: GameState;
  private morning?: MorningReport;
  private lastToast = '';
  private lastToastAt = 0;

  constructor(root: HTMLElement, state: GameState, private command: (command: Command) => void) {
    this.state = state;
    root.innerHTML = `
      <canvas id="farm" tabindex="0" aria-label="Your farm. Click a patch to care for it, or use WASD and E. The farm notebook also provides a keyboard-accessible list of patches."></canvas>
      <div class="vignette" aria-hidden="true"></div>
      <div id="hud">
        <header class="topbar">
          <div class="brand"><span class="brand-mark">${icon('leaf')}</span><div><strong>patchwork</strong><span>COMMONS</span></div></div>
          <div class="day-pill"><span id="weather-icon"></span><div><strong id="date"></strong><span id="time"></span></div><span class="day-divider"></span><span id="weather-copy"></span></div>
          <div class="top-actions"><div class="coin-pill">${icon('coin')}<strong id="coins">160</strong><span>coins</span></div><button class="icon-button" data-action="panel" data-panel="satchel" title="Satchel (I)" aria-label="Open satchel">${icon('bag')}</button><button class="icon-button" data-action="panel" data-panel="journal" title="Farm notebook (J)" aria-label="Open farm notebook">${icon('book')}</button><button class="icon-button settings-button" data-action="panel" data-panel="settings" title="Settings" aria-label="Open settings">${icon('settings')}</button></div>
        </header>
        <aside class="quest-card"><div class="eyebrow">MAKE YOURSELF AT HOME</div><div id="quest-content"></div></aside>
        <div id="world-labels">${Object.entries(POIS).map(([id, poi]) => `<button class="world-label" data-action="visit" data-poi="${id}" title="${poi.hint}">${icon(id)}<span>${poi.name}</span></button>`).join('')}</div>
        <aside id="inspector" class="inspector hidden"><span class="eyebrow">IN YOUR LITTLE PATCH</span><strong id="inspect-title"></strong><span id="inspect-detail"></span></aside>
        <div class="tool-dock"><div class="tool-accessories"><button class="seed-picker" data-action="panel" data-panel="seeds" aria-label="Choose seeds"><span id="seed-icon"></span><span id="seed-label"></span>${icon('chevron')}</button><span class="water-status">${icon('water')}<span id="water-count"></span></span></div><nav class="toolbelt" aria-label="Farming tools">${TOOLS.map(tool => `<button class="tool-button" data-action="tool" data-tool="${tool.id}" aria-pressed="false" title="${tool.help}"><kbd>${tool.key}</kbd>${icon(tool.id)}<span>${tool.name}</span></button>`).join('')}</nav></div>
        <div class="bottom-left"><span class="controls-hint"><kbd>WASD</kbd> move <i>·</i> click to care <i>·</i> <kbd>E</kbd> interact</span><span class="save-status" id="save-status">${icon('check')} Local save · prototype 0.1</span></div>
        <button class="end-day" data-action="panel" data-panel="sleep">${icon('moon')}<span>End the day<small>Whenever you’re ready</small></span><kbd>N</kbd></button>
      </div>
      <div id="toast" class="toast" role="status" aria-live="polite"></div>
      <div id="modal-layer" class="modal-layer hidden"></div>
      <div id="day-transition" class="day-transition" aria-hidden="true"><span>${icon('sun')}</span><h2>A fresh page.</h2><p>Good things grow in their own time.</p></div>
      <input id="save-import" type="file" accept="application/json,.json" hidden />`;
    this.canvas = root.querySelector<HTMLCanvasElement>('#farm')!;
    this.hud = root.querySelector('#hud')!;
    this.overlay = root.querySelector('#modal-layer')!;
    this.toastElement = root.querySelector('#toast')!;
    root.querySelectorAll<HTMLButtonElement>('.world-label').forEach(element => this.labels.set(element.dataset.poi as PoiId, element));
    root.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
      if (target && !target.disabled) this.command({ ...target.dataset } as Command);
    });
    this.overlay.addEventListener('click', event => { if (event.target === this.overlay && this.panel !== 'welcome') this.command({ action: 'close' }); });
    document.addEventListener('keydown', event => {
      if (!this.panel) return;
      if (event.code === 'Escape') { event.preventDefault(); this.command({ action: 'close' }); }
      if (event.code === 'Tab') {
        const buttons = this.focusable();
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? (current <= 0 ? buttons.length - 1 : current - 1) : (current + 1) % buttons.length;
        event.preventDefault(); buttons[next].focus();
      }
    });
    this.render(state, 'care', 'dewturnip', true);
  }

  focusable(): HTMLElement[] { return Array.from(this.overlay.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([type="file"])')); }
  moveFocus(direction: number) {
    const elements = this.focusable();
    if (!elements.length) return;
    const current = elements.indexOf(document.activeElement as HTMLElement);
    elements[(current + direction + elements.length) % elements.length].focus();
  }

  render(state: GameState, tool: Tool, seed: CropId, saved: boolean) {
    this.state = state;
    const date = calendar(state.day);
    document.getElementById('date')!.textContent = `${date.season}, day ${String(date.day).padStart(2, '0')}`;
    const hours = Math.floor(state.minutes / 60), minutes = Math.floor(state.minutes % 60 / 10) * 10;
    document.getElementById('time')!.textContent = state.minutes >= DAY_END ? 'Quiet time · no hurry' : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}  ·  Year ${date.year}`;
    const weather = document.getElementById('weather-icon')!;
    const weatherKey = state.minutes >= DAY_END ? 'moon' : weatherIcon(state.day);
    if (weather.dataset.icon !== weatherKey) { weather.innerHTML = icon(weatherKey); weather.dataset.icon = weatherKey; }
    document.getElementById('weather-copy')!.textContent = weatherName(state.day);
    document.getElementById('coins')!.textContent = state.coins.toLocaleString();
    document.getElementById('seed-label')!.textContent = `${CROPS[seed].name} · ${state.seeds[seed]}`;
    const seedIcon = document.getElementById('seed-icon')!;
    if (seedIcon.dataset.crop !== seed) { seedIcon.innerHTML = icon(seed); seedIcon.dataset.crop = seed; }
    document.getElementById('water-count')!.textContent = `${state.water}/${WATER_CAPACITY}`;
    document.querySelectorAll<HTMLButtonElement>('.tool-button').forEach(button => { const selected = button.dataset.tool === tool; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
    const saveText = saved ? 'Local save · prototype 0.1' : 'Session only · export a save in Settings';
    const saveElement = document.getElementById('save-status')!;
    if (saveElement.dataset.status !== saveText) { saveElement.innerHTML = `${icon(saved ? 'check' : 'save')}${saveText}`; saveElement.dataset.status = saveText; }
    document.documentElement.classList.toggle('reduce-motion', state.settings.reducedMotion);
    const steps = [
      { complete: state.stats.harvested >= 2, title: 'A harvest to say hello', detail: 'Two plump Dewturnips are waiting in your field. Click them to pick your first harvest.', current: Math.min(state.stats.harvested, 2), total: 2 },
      { complete: state.stats.planted >= 4, title: 'Plant a little possibility', detail: 'Click four empty, prepared patches to sow. Your seed bag is already tucked into the toolbelt.', current: Math.min(state.stats.planted, 4), total: 4 },
      { complete: state.stats.watered >= 6, title: 'A little care goes a long way', detail: 'Give six patches a drink. Refill at the well whenever you need.', current: Math.min(state.stats.watered, 6), total: 6 },
      { complete: state.stats.shipped >= 2 || Object.values(state.shipping).reduce((a, b) => a + b, 0) >= 2, title: 'Something worth sharing', detail: 'Visit the shipping box and send two crops. Your coins arrive at the next dawn.', current: Math.min(state.stats.shipped + Object.values(state.shipping).reduce((a, b) => a + b, 0), 2), total: 2 },
      { complete: state.stats.slept >= 1, title: 'Tomorrow has room to grow', detail: 'End the day whenever you’re ready. Watered crops grow overnight; dry crops simply wait.', current: Math.min(state.stats.slept, 1), total: 1 },
    ];
    const next = steps.find(step => !step.complete);
    const key = JSON.stringify([next, state.commons, state.produce.dewturnip, state.produce.ribbonbean]);
    if (key !== this.questKey) {
      this.questKey = key;
      document.getElementById('quest-content')!.innerHTML = next
        ? `<h2>${next.title}</h2><p>${next.detail}</p><div class="quest-progress"><span>${steps.filter(step => step.complete).length + 1} / 5 little beginnings</span><strong>${next.current}/${next.total}</strong></div><div class="progress-track"><span style="width:${next.current / next.total * 100}%"></span></div>`
        : state.commons
          ? `<h2>It’s starting to feel like home.</h2><p>Your Welcome Nook is open. What will your next little harvest become?</p><button class="text-button" data-action="panel" data-panel="journal">Your farm notebook ${icon('arrow')}</button>`
          : `<h2>A place at the table</h2><p>Neri has an idea for the Welcome Nook. A few good things from your farm could bring it to life.</p><button class="text-button" data-action="panel" data-panel="commons">Make something together ${icon('arrow')}</button>`;
    }
  }

  inspect(state: GameState, index: number | null) {
    const element = document.getElementById('inspector')!;
    element.classList.toggle('hidden', index === null || !!this.panel);
    if (index !== null) {
      const info = plotDescription(state, index);
      document.getElementById('inspect-title')!.textContent = info.title;
      document.getElementById('inspect-detail')!.textContent = info.detail;
    }
  }

  toast(message: string, success = true) {
    if (this.lastToast === message && performance.now() - this.lastToastAt < 850) return;
    this.lastToast = message; this.lastToastAt = performance.now();
    clearTimeout(this.toastTimer);
    this.toastElement.textContent = message;
    this.toastElement.classList.toggle('notice', !success);
    this.toastElement.classList.add('visible');
    this.toastTimer = window.setTimeout(() => this.toastElement.classList.remove('visible'), 4200);
  }

  open(panel: Panel, morning?: MorningReport) {
    if (!this.panel) this.previousFocus = document.activeElement as HTMLElement;
    this.panel = panel; this.morning = morning;
    this.hud.inert = true; this.canvas.inert = true;
    this.overlay.classList.remove('hidden');
    this.refreshPanel();
  }

  close() {
    this.panel = null; this.overlay.classList.add('hidden');
    this.hud.inert = false; this.canvas.inert = false;
    if (this.previousFocus?.isConnected && !this.previousFocus.closest('#modal-layer')) this.previousFocus.focus();
    else this.canvas.focus({ preventScroll: true });
  }

  refreshPanel() {
    if (!this.panel) return;
    const state = this.state;
    const date = calendar(state.day);
    const lastFocus = (document.activeElement as HTMLElement)?.id;
    const cropBadge = (kind: CropId) => `<span class="crop-badge" style="--crop-color:${CROPS[kind].color}">${icon(kind)}</span>`;
    let eyebrow = 'YOUR LITTLE PATCH', title = '', body = '', footer = '';
    let wide = false;
    if (this.panel === 'welcome') {
      eyebrow = 'A NOTE FROM NERI'; title = 'There’s room for you here.';
      body = `<div class="letter-intro"><div class="portrait" aria-hidden="true"><span>☺</span></div><p>Welcome to Bellwether Hollow. We’ve left a few seeds, a full watering can, and two ripe turnips to get you started.</p></div><p>This patch is yours. Grow something good, find your own rhythm, and we’ll make a little place for everyone.</p><div class="gentle-note">${icon('leaf')}<span>No rush. Crops wait for you, and your farm rests while you’re away.</span></div><div class="welcome-controls"><span><kbd>WASD</kbd> Move around</span><span>${icon('care')} Click a patch to care for it</span><span><kbd>N</kbd> Begin a new day</span></div>`;
      footer = `<button class="primary" data-action="begin">Make yourself at home ${icon('arrow')}</button>`;
    } else if (this.panel === 'market') {
      title = 'Small seeds. Good beginnings.'; eyebrow = 'THE VILLAGE SEED STALL'; wide = true;
      body = `<p>Choose what you’d like to grow. Every seed has its season.</p><div class="seed-grid">${CROP_IDS.map(kind => {
        const crop = CROPS[kind]; const inSeason = crop.seasons.includes(date.season);
        return `<article class="seed-card">${cropBadge(kind)}<div class="seed-card-heading"><h3>${crop.name}</h3><span class="season-tag ${inSeason ? '' : 'off-season'}">${inSeason ? 'In season' : crop.seasons.join(' / ')}</span></div><p>${crop.grow} growing nights${crop.regrow ? ` · regrows in ${crop.regrow}` : ''}<br>${crop.sell} coins per harvest · ${state.seeds[kind]} seeds owned</p><div class="button-row"><button id="buy-${kind}-1" class="secondary" data-action="buy" data-crop="${kind}" data-qty="1" ${disabled(state.coins < crop.buy)}>Buy 1 · ${crop.buy} ${icon('coin')}</button><button id="buy-${kind}-5" class="quiet" data-action="buy" data-crop="${kind}" data-qty="5" ${disabled(state.coins < crop.buy * 5)}>Buy 5 · ${crop.buy * 5}</button></div></article>`;
      }).join('')}</div><h3 class="section-label">Sell a harvest today</h3>${this.produceRows('sell')}<div class="upgrade-card"><div>${icon('hoe')}<strong>Row attachments</strong><p>Hold Shift to tend up to three patches with one click.</p></div><button class="secondary" data-action="upgrade" ${disabled(state.rowTools || state.coins < 600)}>${state.rowTools ? 'Already fitted' : 'Fit tools · 600 coins'}</button></div><button class="text-button" data-action="seed-help">Need a fresh start? Visit the seed library</button>`;
    } else if (this.panel === 'seeds') {
      title = 'What would you like to grow?'; eyebrow = 'YOUR SEED BAG';
      body = `<div class="seed-list">${CROP_IDS.map(kind => `<button class="seed-choice" data-action="select-seed" data-crop="${kind}">${cropBadge(kind)}<span><strong>${CROPS[kind].name}</strong><small>${CROPS[kind].seasons.join(' / ')} · ${CROPS[kind].grow} growing nights</small></span><b>${state.seeds[kind]}</b>${icon('arrow')}</button>`).join('')}</div><p class="muted">Choosing a seed also equips your sowing tool. The stall has more whenever you need them.</p>`;
    } else if (this.panel === 'satchel') {
      title = 'Good things, tucked away.'; eyebrow = 'YOUR SATCHEL';
      body = `<p>Seeds for tomorrow. A harvest for whatever you have in mind.</p><div class="satchel-grid">${CROP_IDS.map(kind => `<article class="satchel-item">${cropBadge(kind)}<strong>${CROPS[kind].name}</strong><span>${state.seeds[kind]} seeds · ${state.produce[kind]} harvested</span></article>`).join('')}</div><div class="gentle-note">${icon('shipping')}<span>${shipmentValue(state) ? `${shipmentValue(state)} coins’ worth is waiting in the shipping box.` : 'Visit the shipping box to send a harvest, or sell at the seed stall for coins today.'}</span></div>`;
      footer = `<button class="secondary" data-action="panel" data-panel="seeds">Choose seeds ${icon('seed')}</button>`;
    } else if (this.panel === 'shipping') {
      title = 'A harvest on its way.'; eyebrow = 'YOUR SHIPPING BOX';
      body = `<p>Pack what you’d like to sell. The village courier pays at the next dawn.</p>${this.produceRows('ship')}<div class="shipment-total"><span>Ready for tomorrow</span><strong>${icon('coin')} ${shipmentValue(state)} coins</strong></div>${shipmentValue(state) ? `<p class="muted">${CROP_IDS.filter(kind => state.shipping[kind]).map(kind => `${state.shipping[kind]} ${CROPS[kind].plural}`).join(' · ')}</p><button class="text-button" data-action="unship">Changed your mind? Unpack this shipment</button>` : '<p class="muted">Keep a few crops aside if you’d like to help Neri with the Welcome Nook.</p>'}`;
    } else if (this.panel === 'sleep') {
      title = 'Call it a lovely day?'; eyebrow = 'YOUR COTTAGE';
      const thirsty = state.plots.filter(plot => plot.crop && plot.crop.remaining > 0 && !plot.wet).length;
      body = `<p>There’s no need to do everything. Your farm will be here tomorrow.</p><div class="sleep-summary"><div>${icon('shipping')}<strong>${shipmentValue(state)} coins</strong><span>Arriving at dawn</span></div><div>${icon(weatherIcon(state.day + 1))}<strong>${weatherName(state.day + 1)}</strong><span>Tomorrow’s forecast</span></div></div><div class="gentle-note">${icon('water')}<span>${thirsty ? `${thirsty} growing ${thirsty === 1 ? 'crop is' : 'crops are'} still dry. They’ll simply wait for water.` : 'Your watered crops will grow a little overnight.'} Nothing withers.</span></div>`;
      footer = `<button class="quiet" data-action="close">A little longer</button><button class="primary" id="sleep-confirm" data-action="sleep">Rest until morning ${icon('moon')}</button>`;
    } else if (this.panel === 'morning') {
      title = 'A fresh page.'; eyebrow = `${date.season.toUpperCase()} · DAY ${date.day}`;
      const report = this.morning!;
      body = `<p>${weatherFor(state.day) === 'rain' ? 'Rain has already given every patch a drink. A little more time for something you love.' : 'The kettle is warm, the world is waking, and your little patch is waiting.'}</p><div class="morning-stats"><div>${icon('coin')}<strong>+${report.earned}</strong><span>Coins earned</span></div><div>${icon('harvest')}<strong>${report.ready}</strong><span>Ready to pick</span></div><div>${icon('seed')}<strong>${report.grew}</strong><span>Crops grew</span></div></div>${report.paused ? `<p class="muted">${report.paused} ${report.paused === 1 ? 'crop took' : 'crops took'} a little rest. Check water and season to help them grow.</p>` : ''}`;
      footer = `<button class="primary" data-action="close">Let’s see what’s growing ${icon('arrow')}</button>`;
    } else if (this.panel === 'commons') {
      title = state.commons ? 'A place to belong.' : 'A place at the table.'; eyebrow = 'NERI’S WELCOME NOOK';
      body = `<div class="letter-intro"><div class="portrait" aria-hidden="true"><span>☺</span></div><p>${state.commons ? '“Look at that. A little spot to sit, share a bite, and watch things grow. It feels like us.”' : '“What if we made this little corner a place to stop and share something good? Your harvest could be the beginning.”'}</p></div>`;
      if (state.commons) {
        body += `<div class="project-complete">${icon('check')} Built together · ${state.commons === 'garden' ? 'Kitchen garden' : 'Ribbon gathering'}</div><p>Choose the look that feels like home. Your contribution is remembered either way.</p><div class="button-row"><button class="secondary" data-action="restyle" data-theme="garden">Garden colors</button><button class="secondary" data-action="restyle" data-theme="ribbons">Ribbon colors</button></div>`;
      } else {
        body += `<p>Contribute one basket. Neri will bring the bench, flowers, and finishing touches.</p><div class="project-options"><article>${cropBadge('dewturnip')}<h3>A kitchen-garden welcome</h3><p>Six sweet Dewturnips for the first shared meal. Sage seating and pink garden flowers.</p><strong>${state.produce.dewturnip} / 6 Dewturnips</strong><button class="primary" data-action="donate" data-theme="garden" ${disabled(state.produce.dewturnip < 6)}>Share 6 Dewturnips</button></article><article>${cropBadge('ribbonbean')}<h3>A ribbon gathering</h3><p>Nine Ribbon Beans for the neighbors. Rose seating and warm, golden blooms.</p><strong>${state.produce.ribbonbean} / 9 Ribbon Beans</strong><button class="primary" data-action="donate" data-theme="ribbons" ${disabled(state.produce.ribbonbean < 9)}>Share 9 Ribbon Beans</button></article></div><p class="muted">A contribution is a gift to the village. These crops are used for the project rather than sold.</p>`;
      }
    } else if (this.panel === 'journal') {
      title = 'Your farm notebook.'; eyebrow = 'LITTLE THINGS, GROWING'; wide = true;
      body = `<div class="notebook-stats"><span>${icon('harvest')} ${state.stats.harvested} crops picked</span><span>${icon('coin')} ${state.stats.earned} coins earned</span><span>${icon('sun')} ${state.stats.slept} peaceful nights</span></div><h3 class="section-label">A look at the week ahead</h3><div class="forecast">${[1, 2, 3].map(offset => { const day = calendar(state.day + offset); return `<div>${icon(weatherIcon(state.day + offset))}<strong>${day.season} ${day.day}</strong><span>${weatherName(state.day + offset)}</span></div>`; }).join('')}</div><h3 class="section-label">Every little patch</h3><p class="muted">Choose a patch to walk over and use your selected tool. Keyboard and controller friendly.</p><div class="patch-list">${state.plots.map((plot, index) => { const info = plotDescription(state, index); return `<button data-action="tend" data-index="${index}" class="patch-button"><span class="patch-number">${index + 1}</span>${icon(plot.crop?.kind ?? (plot.tilled ? 'seed' : 'hoe'))}<span><strong>${plot.crop ? CROPS[plot.crop.kind].name : plot.tilled ? 'Prepared soil' : 'Open ground'}</strong><small>${info.detail}</small></span></button>`; }).join('')}</div><div class="gentle-note">${icon('leaf')}<span>WASD / arrows to move. E or Space to interact. 1–6 to choose tools. I for your satchel, J for this notebook, N to end the day. Right-click to walk. Mouse wheel to zoom.</span></div><p class="muted">Controller: left stick moves, A interacts, bumpers change tools, Y opens the satchel, Start opens this notebook. In panels, use the D-pad and A; B closes.</p>`;
    } else if (this.panel === 'settings') {
      title = 'At your own pace.'; eyebrow = 'COMFORT & SAVES';
      body = `<div class="settings-list">${[
        ['sound', 'Gentle sound effects', 'Small notes for planting, picking, and little victories.'],
        ['relaxed', 'Longer days', 'Thirty-minute days instead of eighteen. Quiet Time always gives you room to finish.'],
        ['reducedMotion', 'Reduced ambient motion', 'Still butterflies, calm animals, and simpler transitions.'],
      ].map(([key, name, description]) => `<button class="setting-row" id="setting-${key}" data-action="setting" data-setting="${key}" role="switch" aria-checked="${state.settings[key as keyof typeof state.settings]}"><span><strong>${name}</strong><small>${description}</small></span><span class="toggle ${state.settings[key as keyof typeof state.settings] ? 'on' : ''}"></span></button>`).join('')}</div><h3 class="section-label">Take your farm with you</h3><p class="muted">Your browser saves this farm after actions and while you play. Export a copy to keep a backup or move browsers.</p><div class="button-row"><button class="secondary" data-action="export">${icon('download')} Export save</button><button class="secondary" data-action="import">${icon('save')} Import save</button></div><button class="text-button subtle-danger" data-action="panel" data-panel="reset">Start a new farm</button>`;
    } else if (this.panel === 'reset') {
      title = 'A new little beginning?'; eyebrow = 'START A NEW FARM';
      body = `<p>This replaces the farm saved in this browser. Export your current farm first if you’d like to visit it again.</p><button class="secondary" data-action="export">${icon('download')} Export this farm</button>`;
      footer = `<button class="quiet" data-action="panel" data-panel="settings">Keep this farm</button><button class="primary" data-action="reset">Start a new farm</button>`;
    }
    this.overlay.innerHTML = `<section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-eyebrow"><button class="modal-close icon-button" data-action="close" aria-label="Close panel">${icon('close')}</button><div class="eyebrow" id="modal-eyebrow">${eyebrow}</div><h2 id="modal-title">${title}</h2><div class="modal-body">${body}</div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}</section>`;
    const remembered = lastFocus ? document.getElementById(lastFocus) : null;
    if (remembered && this.overlay.contains(remembered) && !(remembered as HTMLButtonElement).disabled) remembered.focus({ preventScroll: true });
    else (this.overlay.querySelector<HTMLElement>('.modal-footer .primary, .modal-close') ?? this.overlay).focus({ preventScroll: true });
  }

  private produceRows(action: 'ship' | 'sell') {
    const goods = CROP_IDS.filter(kind => this.state.produce[kind] > 0);
    if (!goods.length) return `<div class="empty-state">${icon('harvest')}<strong>A little room for your next harvest.</strong><span>Ripe crops have a small golden sparkle. Pick a few and come back.</span></div>`;
    return `<div class="produce-list">${goods.map(kind => `<div class="produce-row"><span class="small-crop" style="color:${CROPS[kind].color}">${icon(kind)}</span><span><strong>${CROPS[kind].name}</strong><small>${this.state.produce[kind]} in your satchel · ${CROPS[kind].sell} coins each</small></span><div><button class="secondary" data-action="${action}" data-crop="${kind}" data-qty="1">${action === 'ship' ? 'Ship' : 'Sell'} 1</button><button class="quiet" data-action="${action}" data-crop="${kind}" data-qty="${this.state.produce[kind]}">All · ${this.state.produce[kind] * CROPS[kind].sell}</button></div></div>`).join('')}</div>`;
  }

  transition(show: boolean) { document.getElementById('day-transition')!.classList.toggle('visible', show); }
}
