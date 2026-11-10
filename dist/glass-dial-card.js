/*
 * glass-dial-card — a layered-PNG thermostat dial for Home Assistant.
 *
 * Layers (bottom → top): dial face, coloured notch ring (ring style only),
 * SVG ticks, pointer marker(s), tinted glass, text, clear lens, metallic bezel.
 *
 * type: custom:glass-dial-card
 * entity: climate.hall            (required)
 * name: Hall                      (optional; defaults to friendly_name)
 * style: face | ring              (face = whole face turns orange/blue; ring = black face, coloured arc)
 * color_by: action | mode         (action = colour only while actually heating/cooling)
 * image_path: /local/glass-dial-card/img
 * show_modes: true                (hvac mode buttons under the dial)
 * show_name: true
 * eco_heat: 18                    (leaf shows at/below this heat setpoint)
 * eco_cool: 24                    (leaf shows at/above this cool setpoint)
 * glass_opacity: 0.18            (glass reflection over the whole face up to the bezel; 0 = none)
 * bezel_inner: 82.0              (inner edge of the bezel ring kept, % of dial radius; higher = trims more from the inside)
 * bezel_outer: 90.3              (outer edge kept; lower = trims more from the outside, also removes its drop shadow)
 * dial_zoom: 1.11                (scales the whole dial so a thinner bezel still fills the card)
 * show_modes: false              (separate mode buttons under the dial; the in-dial button is always there)
 * flatten: 0.55                  (0..1, mutes the glare baked into the face images)
 * lens: false                    (extra clear-lens reflection layer)
 * pointer_style: line | image    (line = crisp marker, image = the PNG pointer)
 * fisheye: 0.30                  (dome-glass distortion of the display: centre magnified, edges bend; 0 = off)
 * schedule_next: sensor.living_room_next_setpoint      (enables the schedule view; the zone's "next setpoint" sensor)
 * schedule_time: sensor.living_room_time_to_next_setpoint  (the zone's "time to next setpoint" sensor, in minutes)
 * tap_action: auto | schedule | more-info | none (auto = schedule if the two sensors above are set, else more-info; hold always opens more-info)
 * schedule_idle: 25               (seconds before the schedule view closes itself)
 * warning_entity: binary_sensor.heating_not_warming   (shows the heating warning)
 * window_entity: sensor.living_room_open_window  (shows "Window open")
 * valve_entity: sensor.living_room_valve               (radiator valve %, shown as a warm glow)
 * boost_timer: timer.boost_hall    (hold the mode icon to boost; shows the boost on the ticker)
 * boost_script: script.glass_dial_boost   boost_delta: 2   (degrees added during a boost)
 * manual_revert_hours: 3           (hours until a manual zone returns to timed; 0 = no manual message)
 * ticker: true   badges: true   haptics: true
 * (drag up/down on the big number to scroll the setpoint like a drum; wheel and arrow keys also work)
 * reflection: 1.2                (strength of the drawn glass highlights; 1 = soft, 2 = clear, 3 = strong; 0 = off)
 * reflection_blur: 4             (px of blur applied to the reflections)
 * number_weight: 600            (weight of the big temperature: 200 thin ... 700 bold)
 * display_scale: 0.78             (size of the coloured display inside the black body; smaller = wider black gap)
 * debounce: 1200                  (ms after the last change before calling the service)
 * max_width: 380px
 * step: 0.5                       (override the entity's target_temp_step)
 */

const VERSION = "2.0.1";
// where the layer images live: next to this file (works under /local/ and under HACS)
const SELF_IMG = (() => {
  try { return new URL("img", import.meta.url).pathname; } catch (e) { return "/local/glass-dial-card/img"; }
})();
const SWEEP = 270; // degrees of travel; gap at the bottom
const START = -SWEEP / 2;
const TICKS = 90;

const IMG = {
  face: { off: "01_dial_black.png", heat: "02_dial_heating_orange.png", cool: "03_dial_cooling_blue.png" },
  bezel: "04_metallic_bezel.png",
  lens: "05_clear_glass_lens.png",
  ring: { off: "06_radial_notches_white.png", heat: "07_radial_notches_orange.png", cool: "08_radial_notches_blue.png" },
  pointer: "09_pointer_marker_vertical.png",
  glass: { off: "11_glass_overlay_black.png", heat: "12_glass_overlay_orange.png", cool: "13_glass_overlay_blue.png" },
};

const MODE_ICONS = {
  off: "mdi:power",
  heat: "mdi:fire",
  cool: "mdi:snowflake",
  heat_cool: "mdi:sun-snowflake-variant",
  auto: "mdi:calendar-sync",
  dry: "mdi:water-percent",
  fan_only: "mdi:fan",
};

const LEAF_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.5 3.5c-7.6-.4-13.9 2.3-15.6 8.3-.7 2.4-.3 4.7.8 6.5L3 21l1.2 1.2 2.8-2.8c1.6 1 3.7 1.3 5.8.7 6.1-1.7 8.4-8.4 7.7-16.6zM9.2 17.6l-1-1c2.6-3.6 5.6-6.4 9.1-8.6-3.1 2.6-5.8 5.8-8.1 9.6z"/></svg>`;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const norm180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

class GlassDialCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("glass-dial-card-editor");
  }

  static getStubConfig(hass) {
    const e = Object.keys(hass?.states || {}).find((k) => k.startsWith("climate."));
    return { entity: e || "climate.example" };
  }

  setConfig(config) {
    if (!config || !config.entity || !config.entity.startsWith("climate.")) {
      throw new Error("glass-dial-card: 'entity' must be a climate entity");
    }
    this._config = {
      style: "face",
      color_by: "action",
      image_path: SELF_IMG,
      show_modes: false,
      show_name: true,
      eco_heat: 18,
      eco_cool: 24,
      glass_opacity: 0.18,
      bezel_inner: 82.0,
      bezel_outer: 90.3,
      dial_zoom: 1.11,
      number_weight: 600,
      reflection: 1.2,
      reflection_blur: 4,
      fisheye: 0.30,
      schedule_next: null,
      schedule_time: null,
      tap_action: "auto",
      schedule_idle: 25,
      warning_entity: null,
      window_entity: null,
      valve_entity: null,
      boost_timer: null,
      boost_script: "script.glass_dial_boost",
      boost_delta: 2,
      manual_revert_hours: 3,
      ticker: true,
      badges: true,
      haptics: true,
      display_scale: 0.78,
      flatten: 0.55,
      lens: false,
      pointer_style: "line",
      debounce: 1200,
      max_width: "380px",
      ...config,
    };
    this._built = false;
    this._schedInit = false;
    this._sched = null;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
    if (this._hass) this._update();
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    const c = this._config;
    const id = c && c.entity;
    const watch = c ? [id, c.schedule_next, c.schedule_time, c.warning_entity, c.window_entity, c.valve_entity, c.boost_timer] : [];
    if (!old || !id || !this._built || watch.some((e) => e && old.states[e] !== hass.states[e])) this._update();
  }

  getCardSize() {
    return this._config?.show_modes ? 7 : 6;
  }

  // ---------- state helpers ----------
  get _stateObj() {
    return this._hass?.states[this._config.entity];
  }

  _limits(s) {
    const a = s.attributes;
    const unit = this._hass?.config?.unit_system?.temperature || "°C";
    const f = unit.includes("F");
    const min = Number(a.min_temp ?? (f ? 45 : 5));
    const max = Number(a.max_temp ?? (f ? 95 : 35));
    const step = Number(this._config.step ?? a.target_temp_step ?? (f ? 1 : 0.5));
    return { min, max: max > min ? max : min + 1, step, unit };
  }

  _targets(s) {
    const a = s.attributes;
    if (this._pending) return this._pending;
    if (a.target_temp_low != null && a.target_temp_high != null && a.temperature == null) {
      return { low: Number(a.target_temp_low), high: Number(a.target_temp_high) };
    }
    if (a.temperature != null) return { single: Number(a.temperature) };
    return {};
  }

  _tone(s, t) {
    const mode = s.state;
    const action = s.attributes.hvac_action;
    if (mode === "off" || mode === "unavailable") return "off";
    if (this._config.color_by === "mode") {
      if (mode === "heat") return "heat";
      if (mode === "cool") return "cool";
    }
    if (action === "heating" || action === "preheating") return "heat";
    if (action === "cooling") return "cool";
    if (this._config.color_by === "mode" && mode === "heat_cool") {
      const cur = Number(s.attributes.current_temperature);
      if (t.low != null && cur < t.low) return "heat";
      if (t.high != null && cur > t.high) return "cool";
    }
    return "off";
  }

  _angle(v, lim) {
    return START + (SWEEP * (clamp(v, lim.min, lim.max) - lim.min)) / (lim.max - lim.min);
  }

  // ---------- DOM ----------
  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const c = this._config;
    const p = c.image_path.replace(/\/$/, "");
    const img = (f, cls, extra = "") => `<img class="layer ${cls}" src="${p}/${f}" alt="" draggable="false" ${extra}>`;

    this._ro?.disconnect();
    clearInterval(this._clock);
    clearTimeout(this._idle);
    cancelAnimationFrame(this._nraf);
    cancelAnimationFrame(this._dloop);
    this._dloop = 0;
    this._dshow = 0;
    this._dtarget = 0;
    this._drumOn = false;
    this._nv = null;
    this._tkKey = null;
    this._bdgKey = null;
    this._schedOpen = false;
    this._fid = "ndl-" + Math.random().toString(36).slice(2, 8);
    const lensDefs = c.fisheye > 0
      ? `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="${this._fid}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feImage href="${this._lensMap()}" preserveAspectRatio="none" result="map"/><feDisplacementMap class="disp" in="SourceGraphic" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter></svg>`
      : "";
    let ticks = "";
    for (let i = 0; i < TICKS; i++) {
      ticks += `<line class="tick" data-i="${i}" x1="256" y1="${256 - 150}" x2="256" y2="${256 - 172}" transform="rotate(${START + (SWEEP * i) / (TICKS - 1)} 256 256)"/>`;
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        ha-card { padding: 16px 16px 12px; box-sizing:border-box; overflow:hidden; }
        .name { text-align:center; font-size:1.1em; font-weight:500; margin:0 0 8px; color:var(--primary-text-color); letter-spacing:.02em; }
        .wrap { width:100%; max-width:${c.max_width}; margin:0 auto; }
        .dial { position:relative; width:100%; aspect-ratio:1/1; transform: scale(${c.dial_zoom}); user-select:none; -webkit-user-select:none; border-radius:50%; outline:none; }
        .dial:focus-visible { box-shadow:0 0 0 3px var(--primary-color); }
        .layer { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
        .fade { transition: opacity .7s ease; }
        .face, .glass, .ring { opacity:0; }
        .body { position:absolute; inset:${50 - (+c.bezel_inner + +c.bezel_outer) / 4}%; border-radius:50%; pointer-events:none;
                background: radial-gradient(circle at 50% 38%, #26272a 0%, #101113 55%, #000 100%);
                box-shadow: inset 0 3px 10px rgba(255,255,255,.07), inset 0 -6px 14px rgba(0,0,0,.8); }
        .inner { position:absolute; inset:0; transform: scale(${c.display_scale}); transform-origin:50% 50%; ${c.fisheye > 0 ? `filter:url(#${this._fid});` : ""} }
        .face, .glass, .lens { transform: scale(.8); }
        .glass.on { opacity:${c.glass_opacity}; }
        .face.on, .ring.on { opacity:1; }
        .ring { transition: opacity .7s ease; -webkit-mask-image: var(--arc); mask-image: var(--arc); }
        .track { opacity:.18; -webkit-mask-image: var(--track); mask-image: var(--track); }
        .lens { opacity:.45; mix-blend-mode: screen; }
        svg.ticks { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; overflow:visible; }
        .tick { stroke: rgba(255,255,255,.62); stroke-width:2.6; stroke-linecap:round; transition: stroke .25s; }
        .tick.lit { stroke:#fff; stroke-width:3.8; }
        .bezel { -webkit-mask-image: radial-gradient(closest-side, transparent ${c.bezel_inner}%, #000 ${+c.bezel_inner + 0.4}%, #000 ${c.bezel_outer - 0.4}%, transparent ${c.bezel_outer}%);
                 mask-image: radial-gradient(closest-side, transparent ${c.bezel_inner}%, #000 ${+c.bezel_inner + 0.4}%, #000 ${c.bezel_outer - 0.4}%, transparent ${c.bezel_outer}%); }
        .glass { transform: scale(${(+c.bezel_inner + +c.bezel_outer) / 187.5}) !important; }
        .modebtn { position:absolute; left:50%; top:78%; transform:translate(-50%,-50%); display:flex; align-items:center; justify-content:center;
                   width: 15cqw; height: 15cqw; border:0; background:none; cursor:pointer; color:#fff; padding:0; opacity:.92;
                   filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
        .modebtn:hover { opacity:1; }
        .modebtn ha-icon { --mdc-icon-size: 10.5cqw; }
        .ptr { stroke:#fff; stroke-width:6.5; stroke-linecap:round; }
        .ptr.hidden { display:none; }
        .flat { position:absolute; inset:11.5%; border-radius:50%; pointer-events:none; background:var(--flat,#18181a); opacity:${c.flatten}; transition: background .7s; }
        .curtick { stroke:#fff; stroke-width:3.4; stroke-linecap:round; }
        .pointer { transition: transform .15s ease-out; filter: drop-shadow(0 0 3px rgba(255,255,255,.55)); }
        .pointer.hidden { display:none; }
        .ringhit { position:absolute; inset:9%; border-radius:50%; touch-action:none; cursor:grab; }
        .ringhit.drag { cursor:grabbing; }
        .center { position:absolute; left:50%; top:50%; width:50%; height:50%; transform:translate(-50%,-50%); border-radius:50%;
                  display:flex; flex-direction:column; align-items:center; justify-content:center; color:#fff; touch-action:auto;
                  text-shadow:0 1px 3px rgba(0,0,0,.35); font-family: var(--ha-font-family-body, Roboto, "Helvetica Neue", sans-serif); }
        .label { font-size: max(3.1cqw, 6.5px); letter-spacing:.14em; font-weight:500; opacity:.85; text-transform:uppercase; height:1.3em; }
        .big { font-size: 22cqw; font-weight:${c.number_weight}; line-height:1; display:flex; align-items:flex-start; letter-spacing:-.02em; }
        .big .frac { font-size:.38em; margin-top:.12em; font-weight:${c.number_weight}; }
        .label:empty { display:none; }
        .center { touch-action:none; cursor:ns-resize; }
        .center > .big { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); }
        .center > .label { position:absolute; left:50%; bottom:calc(50% + 12cqw); transform:translateX(-50%); height:auto; white-space:nowrap; }
        .center > .sub { position:absolute; left:50%; top:calc(50% + 15cqw); transform:translateX(-50%); margin-top:0; }
        .drow > span:first-child { position:relative; }
        .drow .frac { position:absolute; left:100%; top:.12em; margin:0 0 0 .04em; }
        .valve { position:absolute; inset:11.5%; border-radius:50%; pointer-events:none;
                 box-shadow: inset 0 0 7cqw 1cqw rgba(255,160,70,var(--vg,0)); transition: box-shadow 1s; }
        .ticker { position:absolute; left:50%; top:calc(50% + 15cqw); width:28cqw; height:4.4cqw; transform:translateX(-50%); overflow:hidden; pointer-events:none; display:none;
                  -webkit-mask-image: linear-gradient(to right, transparent 0, #000 12%, #000 88%, transparent 100%);
                  mask-image: linear-gradient(to right, transparent 0, #000 12%, #000 88%, transparent 100%);
                  font-size:max(3.1cqw, 6.5px); line-height:4.4cqw; white-space:nowrap; color:#fff; font-weight:500; text-shadow:0 1px 2px rgba(0,0,0,.35); }
        .center.tkon .ticker { display:block; }
        .center.tkon.lfon .ticker { left:calc(50% + 4cqw); width:21cqw; }
        .center.tkon.lfon > .sub { left:calc(50% - 13.5cqw); }
        .tk { display:inline-block; white-space:nowrap; will-change:transform; }
        .tki { display:inline-block; }
        .tkgap { display:inline-block; }
        .tks { font-style:normal; opacity:.6; padding:0 1.2cqw; }
        .tkw { background:rgba(0,0,0,.4); border-radius:1.2cqw; padding:0 1.2cqw; font-weight:700; }
        @keyframes tkscroll { from { transform: translateX(0); } to { transform: translateX(calc(var(--tkw) * -1)); } }
        .bdg { position:absolute; top:78%; transform:translateY(-50%); display:flex; gap:1.2cqw; pointer-events:none; transition: opacity .3s; }
        .bdgL { right:calc(50% + 11cqw); }
        .bdgR { left:calc(50% + 11cqw); }
        .bdg ha-icon { --mdc-icon-size:5.2cqw; color:#fff; filter: drop-shadow(0 1px 2px rgba(0,0,0,.55)); }
        .bdg ha-icon.warn { color:#ffe082; }
        .bdg ha-icon.bad { color:#ff9e9e; }
        .bdg ha-icon.info { color:#b3e5fc; }
        .dial.so .bdg { opacity:0; }
        .sroom { fill:none; stroke:#8fd3ff; stroke-width:2.4; stroke-linejoin:round; stroke-linecap:round; opacity:.9; }
        .sheat { font-size:15px; opacity:.78; }
        .drum { position:relative; width:3.1em; height:1.5em;
                -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%);
                mask-image: linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%); }
        .drow { position:absolute; left:50%; top:50%; display:flex; align-items:flex-start; justify-content:center; line-height:1; white-space:nowrap; will-change:transform,opacity; }
        .ticks, .center, .modebtn { transition: opacity .3s; }
        .cur { transition: left .3s, top .3s, opacity .3s; }
        .sched { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; opacity:0; transition: opacity .35s;
                 font-family: var(--ha-font-family-body, Roboto, "Helvetica Neue", sans-serif); }
        .dial.so .sched { opacity:1; }
        .dial.so .ticks, .dial.so .center, .dial.so .cur, .dial.so .modebtn, .dial.so .p1, .dial.so .p2 { opacity:0; pointer-events:none; }
        .sched text { fill:#fff; text-anchor:middle; }
        .stitle { font-size:27px; font-weight:600; letter-spacing:.08em; }
        .saxis { font-size:16px; opacity:.75; }
        .stime { font-size:30px; font-weight:500; }
        .slab { font-size:15px; font-weight:700; }
        .smsg { font-size:20px; opacity:.85; }
        .sdot { fill:#f2620f; stroke:rgba(255,255,255,.9); stroke-width:1.5; }
        .sstep { fill:none; stroke:rgba(255,255,255,.32); stroke-width:2.2; }
        .sgrid { stroke:rgba(255,255,255,.2); stroke-width:1.5; }
        .snow { stroke:#35d0ff; stroke-width:3; stroke-linecap:round; }
        .smid { stroke:rgba(255,255,255,.45); }
        .reflection { position:absolute; inset:${50 - c.bezel_inner / 2}%; border-radius:50%; overflow:hidden; pointer-events:none; opacity:1; --rk:${c.reflection}; mix-blend-mode:screen; filter: blur(${c.reflection_blur}px);
                      box-shadow: inset 0 0 0 1px rgba(255,255,255,calc(.05*var(--rk))),
                                  inset 14px 16px 32px -20px rgba(255,255,255,calc(.34*var(--rk))),
                                  inset -12px -14px 30px -20px rgba(255,255,255,calc(.18*var(--rk)));
                      background:
                        radial-gradient(ellipse 22% 10% at 27% 15%, rgba(255,255,255,calc(.20*var(--rk))) 0%, rgba(255,255,255,calc(.07*var(--rk))) 50%, rgba(255,255,255,0) 100%),
                        radial-gradient(ellipse 12% 5% at 73% 85%, rgba(255,255,255,calc(.10*var(--rk))) 0%, rgba(255,255,255,calc(.03*var(--rk))) 50%, rgba(255,255,255,0) 100%),
                        linear-gradient(116deg, rgba(255,255,255,0) 38%, rgba(255,255,255,calc(.04*var(--rk))) 45%, rgba(255,255,255,calc(.012*var(--rk))) 54%, rgba(255,255,255,0) 60%),
                        linear-gradient(135deg, rgba(255,255,255,calc(.06*var(--rk))) 0%, rgba(255,255,255,0) 40%); }
        .reflection::before { content:""; position:absolute; left:-6%; top:-48%; width:112%; height:84%; border-radius:50%; transform: rotate(-16deg); filter: blur(10px);
                              background: linear-gradient(to bottom, rgba(255,255,255,calc(.16*var(--rk))) 0%, rgba(255,255,255,calc(.05*var(--rk))) 55%, rgba(255,255,255,0) 100%); }
        .reflection::after { content:""; position:absolute; left:28%; top:80%; width:62%; height:34%; border-radius:50%; transform: rotate(-22deg); filter: blur(10px);
                             background: radial-gradient(ellipse at 50% 100%, rgba(255,255,255,calc(.12*var(--rk))), rgba(255,255,255,0) 70%); }
        .big.dual { font-size: 13cqw; }
        .big .sep { font-size:.5em; opacity:.7; margin:0 .18em; align-self:center; }
        .sub { display:flex; align-items:center; gap:4px; font-size: 3.4cqw; opacity:.85; height:1.6em; margin-top:-.4em; }
        .leaf { width:1.35em; height:1.35em; color:#3ad46a; display:none; filter: drop-shadow(0 0 2px rgba(0,0,0,.4)); }
        .leaf.on { display:block; }
        .cur { position:absolute; transform:translate(-50%,-50%); color:#fff; font-size: max(2.9cqw, 6.5px); font-weight:500; pointer-events:none;
               text-shadow:0 1px 2px rgba(0,0,0,.6); transition: left .3s, top .3s; }
        .stage { container-type:inline-size; }
        .modes { display:flex; justify-content:center; gap:6px; margin-top:12px; flex-wrap:wrap; }
        .modes button { display:flex; align-items:center; justify-content:center; width:40px; height:40px; border-radius:50%;
                        border:0; cursor:pointer; background:var(--secondary-background-color, rgba(127,127,127,.15)); color:var(--secondary-text-color); }
        .modes button.active { color:#fff; background:var(--mode-color, var(--primary-color)); }
        .modes ha-icon { --mdc-icon-size:22px; }
        .unavail { opacity:.45; filter:grayscale(1); }
      </style>
      <ha-card>
        ${c.show_name ? `<div class="name"></div>` : ""}
        <div class="wrap stage">
          ${lensDefs}
          <div class="dial" tabindex="0" role="slider">
            <div class="body"></div>
            <div class="inner">
            ${img(IMG.face.off, "face fade", 'data-tone="off"')}
            ${img(IMG.face.heat, "face fade", 'data-tone="heat"')}
            ${img(IMG.face.cool, "face fade", 'data-tone="cool"')}
            <div class="flat"></div>
            <div class="valve"></div>
            ${c.style === "ring" ? img(IMG.ring.off, "track") : ""}
            ${c.style === "ring" ? img(IMG.ring.heat, "ring", 'data-tone="heat"') + img(IMG.ring.cool, "ring", 'data-tone="cool"') : ""}
            <svg class="ticks" viewBox="0 0 512 512">${ticks}
              <line class="curtick" x1="256" y1="${256 - 142}" x2="256" y2="${256 - 176}"/>
              ${c.pointer_style === "image" ? "" : `<line class="ptr p1 hidden" x1="256" y1="${256 - 140}" x2="256" y2="${256 - 180}"/><line class="ptr p2 hidden" x1="256" y1="${256 - 140}" x2="256" y2="${256 - 180}"/>`}
            </svg>
            ${c.pointer_style === "image" ? img(IMG.pointer, "pointer p1") + img(IMG.pointer, "pointer p2 hidden") : ""}
            <div class="ringhit"></div>
            <div class="cur"></div>
            <svg class="sched" viewBox="0 0 512 512" aria-hidden="true"></svg>
            <button class="modebtn" aria-label="Change mode"><ha-icon></ha-icon></button>
            <div class="bdg bdgL"></div><div class="bdg bdgR"></div>
            <div class="center">
              <div class="label"></div>
              <div class="big"></div>
              <div class="sub"><span class="leaf">${LEAF_SVG}</span><span class="subtxt"></span></div>
              <div class="ticker"><div class="tk"></div></div>
            </div>
            ${c.lens ? img(IMG.lens, "lens") : ""}
            </div>
            ${img(IMG.glass.off, "glass fade", 'data-tone="off"')}
            ${img(IMG.glass.heat, "glass fade", 'data-tone="heat"')}
            ${img(IMG.glass.cool, "glass fade", 'data-tone="cool"')}
            ${c.reflection > 0 ? '<div class="reflection"></div>' : ""}
            ${img(IMG.bezel, "bezel")}
          </div>
        </div>
        ${c.show_modes ? `<div class="modes"></div>` : ""}
      </ha-card>`;

    const $ = (s) => this.shadowRoot.querySelector(s);
    this._el = {
      card: $("ha-card"),
      name: $(".name"),
      dial: $(".dial"),
      ticks: [...this.shadowRoot.querySelectorAll(".tick")],
      curtick: $(".curtick"),
      p1: $(".p1"),
      p2: $(".p2"),
      cur: $(".cur"),
      label: $(".label"),
      big: $(".big"),
      leaf: $(".leaf"),
      subtxt: $(".subtxt"),
      sub: $(".sub"),
      modes: $(".modes"),
      hit: $(".ringhit"),
      center: $(".center"),
      sched: $(".sched"),
      modebtn: $(".modebtn"),
      ticker: $(".ticker"),
      tk: $(".tk"),
      valve: $(".valve"),
      bdgL: $(".bdgL"),
      bdgR: $(".bdgR"),
      modeicon: $(".modebtn ha-icon"),
    };
    if (c.fisheye > 0) {
      const disp = this.shadowRoot.querySelector(".disp");
      const setScale = () => disp.setAttribute("scale", String(c.fisheye * this._el.dial.clientWidth));
      this._ro = new ResizeObserver(setScale);
      this._ro.observe(this._el.dial);
      setScale();
    }
    const mb = this._el.modebtn;
    mb.addEventListener("pointerdown", () => {
      this._bheld = false;
      clearTimeout(this._bT);
      if (!c.boost_timer) return;
      this._bT = setTimeout(() => { this._bheld = true; this._boost(); }, 700);
    });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) mb.addEventListener(ev, () => clearTimeout(this._bT));
    mb.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this._bheld) { this._bheld = false; return; }
      const st = this._stateObj;
      const m = st?.attributes.hvac_modes || [];
      if (m.length < 2) return;
      this._call("set_hvac_mode", { hvac_mode: m[(m.indexOf(st.state) + 1) % m.length] });
    });

    const ctr = this._el.center;
    ctr.addEventListener("pointerdown", (e) => {
      this._held = false;
      this._nmoved = false;
      clearTimeout(this._holdT);
      this._holdT = setTimeout(() => { if (!this._nd || !this._nd.moved) { this._held = true; this._moreInfo(); } }, 650);
      this._numStart(e);
    });
    ctr.addEventListener("pointermove", (e) => this._numMove(e));
    for (const ev of ["pointerup", "pointercancel"]) ctr.addEventListener(ev, (e) => this._numEnd(e));
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) ctr.addEventListener(ev, () => clearTimeout(this._holdT));
    ctr.addEventListener("click", (e) => {
      if (this._nmoved) { this._nmoved = false; return; }
      if (this._held) { this._held = false; return; }
      this._centerTap();
    });
    this._el.dial.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowRight") { this._nudge(1); e.preventDefault(); }
      if (e.key === "ArrowDown" || e.key === "ArrowLeft") { this._nudge(-1); e.preventDefault(); }
    });
    this._el.hit.addEventListener("wheel", (e) => {
      // only act once the dial has been clicked, so scrolling the page over a dial never changes a setpoint
      if (!this._el.dial.matches(":focus-within")) return;
      e.preventDefault();
      if (this._schedOpen) this._panBy(e.deltaY > 0 ? 360 : -360);
      else this._nudge(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    this._el.hit.addEventListener("pointerdown", (e) => this._dragStart(e));
    this._el.hit.addEventListener("pointermove", (e) => this._dragMove(e));
    this._el.hit.addEventListener("pointerup", (e) => this._dragEnd(e));
    this._el.hit.addEventListener("pointercancel", (e) => this._dragEnd(e));

    this._built = true;
  }

  // ---------- ticker, badges, valve glow ----------
  _dur(min) {
    min = Math.round(min);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  _estimate(s, t) {
    const a = s.attributes;
    const cur = Number(a.current_temperature);
    if (a.hvac_action !== "heating" || t.single == null || isNaN(cur)) return null;
    const diff = t.single - cur;
    if (diff < 0.15) return null;
    if (!this._hist && !this._histP && !(this._histFail && Date.now() - this._histFail < 300000)) this._loadHist();
    const rate = this._hist && this._hist.rate;
    if (!rate) return null;
    const min = (diff / rate) * 60;
    if (min > 720) return null;
    if (min < 3) return "a few min";
    return this._dur(min < 90 ? Math.max(5, Math.round(min / 5) * 5) : Math.round(min / 10) * 10);
  }

  _decorate(s, t, leaf, unavailable) {
    const c = this._config;
    const el = this._el;
    const H = this._hass;
    const a = s.attributes;
    const items = [];
    const L = [];
    const R = [];
    if (!unavailable) {
      const fmtT = (v) => String(+Number(v).toFixed(1));
      const hm = (d) => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
      const when = (d) => (d.toDateString() === new Date().toDateString() ? hm(d) : d.toLocaleDateString(undefined, { weekday: "short" }) + " " + hm(d));

      const w = c.warning_entity && H.states[c.warning_entity];
      if (w && w.state === "on") {
        const st = Array.isArray(w.attributes.stalled_rooms) ? w.attributes.stalled_rooms : [];
        const mine = st.includes(c.entity);
        items.push({ text: mine ? "This room isn't warming" : `Heating not warming${st.length ? ` (${st.length} room${st.length > 1 ? "s" : ""})` : ""}`, w: true });
        R.push({ icon: "mdi:alert", cls: "warn", title: "Heating not warming" });
      }
      const wi = c.window_entity && H.states[c.window_entity];
      if (wi && !["closed", "off", "unknown", "unavailable", "none"].includes(wi.state)) {
        items.push({ text: "Window open", w: true });
        R.push({ icon: "mdi:window-open-variant", cls: "info", title: "Window open" });
      }
      if (a.low_battery === true || a.low_battery === "true") {
        items.push({ text: "Low battery", w: true });
        R.push({ icon: "mdi:battery-alert", cls: "bad", title: "Low battery" });
      }
      const bt = c.boost_timer && H.states[c.boost_timer];
      const boosting = bt && bt.state === "active";
      if (boosting) {
        const fin = bt.attributes.finishes_at ? new Date(bt.attributes.finishes_at) : null;
        items.push({ text: `Boost${t.single != null ? " to " + fmtT(t.single) + "°" : ""}${fin ? " until " + hm(fin) : ""}` });
        L.push({ icon: "mdi:rocket-launch", cls: "", title: "Boost" });
      }
      if (s.state === "heat" && c.manual_revert_hours > 0 && !boosting) {
        const back = new Date(new Date(s.last_changed).getTime() + c.manual_revert_hours * 3600e3);
        items.push({ text: back > new Date() ? `Manual · back to timed ${when(back)}` : "Manual · back to timed shortly" });
        L.push({ icon: "mdi:hand-back-right", cls: "", title: "Manual" });
      }
      const est = this._estimate(s, t);
      if (est && t.single != null) items.push({ text: `Reaching ${fmtT(t.single)}° in ~${est}` });
      if (s.state === "auto" && c.schedule_next && c.schedule_time) {
        const nx = H.states[c.schedule_next];
        const tt = H.states[c.schedule_time];
        const nv = nx ? parseFloat(nx.state) : NaN;
        const mins = tt ? parseFloat(tt.state) : NaN;
        if (nv > 0 && mins > 0) {
          const at = new Date(new Date(tt.last_updated).getTime() + mins * 60000);
          const cur = Number(a.temperature);
          const verb = nv > cur ? "Warms to" : nv < cur ? "Drops to" : "Holds until";
          items.push({ text: verb === "Holds until" ? `Holds until ${when(at)}` : `${verb} ${fmtT(nv)}° at ${when(at)}` });
        }
      }
    }
    const shown = c.ticker ? items : [];
    el.center.classList.toggle("lfon", !!leaf);
    this._renderTicker(shown);
    // badges
    const bdg = c.badges ? { L, R } : { L: [], R: [] };
    const key = JSON.stringify(bdg);
    if (key !== this._bdgKey) {
      this._bdgKey = key;
      const html = (arr) => arr.map((b) => `<ha-icon class="${b.cls}" icon="${b.icon}" title="${b.title}"></ha-icon>`).join("");
      el.bdgL.innerHTML = html(bdg.L);
      el.bdgR.innerHTML = html(bdg.R);
    }
    // valve glow
    const ve = c.valve_entity && H.states[c.valve_entity];
    const v = ve ? parseFloat(ve.state) : NaN;
    el.valve.style.setProperty("--vg", isNaN(v) ? "0" : (0.55 * clamp(v, 0, 100) / 100).toFixed(2));
  }

  _renderTicker(items) {
    const el = this._el;
    const key = JSON.stringify(items);
    if (key === this._tkKey) return;
    this._tkKey = key;
    el.center.classList.toggle("tkon", items.length > 0);
    el.tk.style.animation = "none";
    el.tk.style.transform = "none";
    if (!items.length) { el.tk.innerHTML = ""; return; }
    const html = items.map((i) => `<span class="${i.w ? "tkw" : ""}">${i.text}</span>`).join('<i class="tks">•</i>');
    el.tk.style.display = "inline-block";
    el.tk.style.width = "auto";
    el.tk.innerHTML = `<span class="tki">${html}</span>`;
    requestAnimationFrame(() => {
      const box = el.ticker.clientWidth;
      const first = el.tk.firstChild;
      const w = first && first.offsetWidth;
      if (!box || !w) return;
      if (w <= box) {
        el.tk.style.display = "block";
        el.tk.style.width = "100%";
        el.tk.style.textAlign = "center";
      } else {
        const gap = Math.round(box * 0.3);
        el.tk.style.textAlign = "";
        el.tk.innerHTML = `<span class="tki">${html}</span><span class="tkgap" style="width:${gap}px"></span><span class="tki">${html}</span><span class="tkgap" style="width:${gap}px"></span>`;
        el.tk.style.setProperty("--tkw", w + gap + "px");
        el.tk.style.animation = `tkscroll ${((w + gap) / (this._el.dial.clientWidth * 0.09)).toFixed(1)}s linear infinite`;
      }
    });
  }

  _buzz(ms) {
    if (this._config.haptics && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) { /* not supported */ }
    }
  }

  _boost() {
    const c = this._config;
    if (!c.boost_timer || !this._hass) return;
    this._buzz(30);
    const [dom, svc] = c.boost_script.split(".");
    this._hass.callService(dom, svc, { entity_id: c.entity, timer: c.boost_timer, delta: c.boost_delta });
  }

  // ---------- recent history: warm-up rate, hours heated, room temperature line ----------
  _loadHist() {
    const c = this._config;
    if (!this._hass || typeof this._hass.callWS !== "function") return Promise.resolve(null);
    if (this._histP) return this._histP;
    if (this._hist && Date.now() - this._hist.ts < 15 * 60e3) return Promise.resolve(this._hist);
    const end = new Date();
    const start = new Date(end.getTime() - 36 * 3600e3);
    this._histP = this._hass.callWS({
      type: "history/history_during_period",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      entity_ids: [c.entity],
      include_start_time_state: true,
      significant_changes_only: false,
      minimal_response: false,
      no_attributes: false,
    }).then((res) => {
      this._hist = GlassDialCard._deriveHist(res[c.entity] || []);
      this._hist.ts = Date.now();
      this._rate = this._hist.rate;
      return this._hist;
    }).catch(() => { this._histFail = Date.now(); return null; }).finally(() => {
      this._histP = null;
      if (this._el) { this._update(); if (this._schedOpen) this._renderSched(); }
    });
    return this._histP;
  }

  static _deriveHist(entries) {
    const pts = entries
      .map((e) => ({ t: (e.lu != null ? e.lu : e.lc) * 1000, cur: e.a ? e.a.current_temperature : null, heat: !!(e.a && e.a.hvac_action === "heating") }))
      .filter((q) => isFinite(q.t) && q.t > 0)
      .sort((a, b) => a.t - b.t);
    const room = pts.filter((q) => typeof q.cur === "number").map((q) => [q.t, q.cur]);
    // warm-up rate: how fast the room rose in the first half hour of each heating run
    const rates = [];
    let i = 0;
    while (i < pts.length) {
      if (!pts[i].heat || typeof pts[i].cur !== "number") { i++; continue; }
      let j = i;
      while (j + 1 < pts.length && pts[j + 1].heat) j++;
      let k = i;
      while (k < j && pts[k].t - pts[i].t < 1800e3) k++;
      const dur = (pts[k].t - pts[i].t) / 3600e3;
      const rise = (typeof pts[k].cur === "number" ? pts[k].cur : pts[i].cur) - pts[i].cur;
      if (dur >= 0.15 && rise >= 0.2) rates.push(rise / dur);
      i = j + 1;
    }
    let rate = null;
    if (rates.length) {
      const r = rates.slice(-6).sort((a, b) => a - b);
      rate = clamp(r[Math.floor(r.length / 2)], 0.2, 6);
    }
    // time spent heating since midnight
    const now = Date.now();
    const mid = new Date();
    mid.setHours(0, 0, 0, 0);
    let heated = 0;
    for (let n = 0; n < pts.length; n++) {
      if (!pts[n].heat) continue;
      const a0 = Math.max(pts[n].t, mid.getTime());
      const b0 = Math.min(n + 1 < pts.length ? pts[n + 1].t : now, now);
      if (b0 > a0) heated += b0 - a0;
    }
    return { room, rate, heatedMs: heated };
  }

  // ---------- weekly schedule view ----------
  _hasSchedule() {
    return !!(this._config.schedule_next && this._config.schedule_time);
  }

  _centerTap() {
    const a = this._config.tap_action;
    if (a === "none") return;
    if (a === "more-info" || !this._hasSchedule()) return this._moreInfo();
    this._schedToggle(true);
  }

  _schedToggle(open) {
    this._schedOpen = open;
    this._el.dial.classList.toggle("so", open);
    cancelAnimationFrame(this._raf);
    clearInterval(this._clock);
    clearTimeout(this._idle);
    if (open) {
      this._c = null; // centre of the timeline; null = start at "now"
      this._loadHist();
      this._loadSchedule();
      this._renderSched();
      this._clock = setInterval(() => this._renderSched(), 20000);
      this._bump();
    }
  }

  _bump() {
    clearTimeout(this._idle);
    this._idle = setTimeout(() => this._schedToggle(false), this._config.schedule_idle * 1000);
  }

  _schedStep(d) {
    this._panBy(d * 360);
  }

  // screen pixels -> minutes on the timeline (the plot shows 24 h across 320 of the 512 display units)
  _mpp() {
    const u = (this._el.dial.getBoundingClientRect().width / 512) * this._config.display_scale;
    return 1440 / 320 / u;
  }

  _redraw() {
    if (this._rq) return;
    this._rq = requestAnimationFrame(() => { this._rq = 0; this._renderSched(); });
  }

  _fling(v) {
    cancelAnimationFrame(this._raf);
    v = Math.max(-6, Math.min(6, v));
    if (Math.abs(v) < 0.02) return;
    let last = performance.now();
    const step = (t) => {
      const dt = t - last;
      last = t;
      this._c += v * dt;
      v *= Math.pow(0.975, dt / 16);
      this._renderSched();
      this._bump();
      if (Math.abs(v) > 0.01) this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _panBy(min) {
    cancelAnimationFrame(this._raf);
    const from = this._c, t0 = performance.now(), dur = 280;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      this._c = from + min * (1 - Math.pow(1 - k, 3));
      this._renderSched();
      this._bump();
      if (k < 1) this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  // The weekly program as one list of points (minutes from Monday 00:00); a switch that repeats the
  // previous temperature changes nothing, so it is dropped.
  _weekPoints() {
    if (this._wkSrc === this._sched && this._wk) return this._wk;
    const raw = [];
    (this._sched || []).forEach((d, i) => d.forEach((q) => raw.push({ m: i * 1440 + q.t, temp: q.temp })));
    raw.sort((a, b) => a.m - b.m);
    let wk = raw.filter((q, i) => q.temp !== raw[(i + raw.length - 1) % raw.length].temp);
    if (!wk.length) wk = raw.slice(0, 1);
    this._wkSrc = this._sched;
    this._wk = wk;
    return wk;
  }

  // Learns the weekly program from the zone's "next setpoint" and "time to next setpoint" history:
  // every sample says "at <now + minutes> the setpoint becomes <next setpoint>".
  static _computeSchedule(ttn, vs) {
    const groups = new Map();
    let vi = 0;
    let cur = NaN;
    for (const [t, m] of ttn) {
      while (vi < vs.length && vs[vi][0] <= t) cur = vs[vi++][1];
      if (!(m > 0) || !(cur > 0)) continue;
      const key = Math.round((t + m * 60000) / 60000);
      const g = groups.get(key) || { n: 0, temps: {} };
      g.n++;
      g.temps[cur] = (g.temps[cur] || 0) + 1;
      groups.set(key, g);
    }
    const merged = [];
    for (const k of [...groups.keys()].sort((a, b) => a - b)) {
      const g = groups.get(k);
      const last = merged[merged.length - 1];
      if (last && k - last.key <= 2) {
        last.n += g.n;
        for (const [tp, c] of Object.entries(g.temps)) last.temps[tp] = (last.temps[tp] || 0) + c;
        if (g.n > last.best) { last.key = k; last.best = g.n; }
      } else merged.push({ key: k, n: g.n, best: g.n, temps: { ...g.temps } });
    }
    const byDow = {};
    for (const g of merged) {
      if (g.n < 3) continue;
      const temp = +Object.entries(g.temps).sort((a, b) => b[1] - a[1])[0][0];
      const d = new Date(g.key * 60000);
      const dow = (d.getDay() + 6) % 7;
      const dk = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
      byDow[dow] = byDow[dow] || {};
      byDow[dow][dk] = byDow[dow][dk] || [];
      byDow[dow][dk].push({ t: d.getHours() * 60 + d.getMinutes(), temp });
    }
    const days = [];
    for (let dow = 0; dow < 7; dow++) {
      const dates = Object.keys(byDow[dow] || {}).map(Number).sort((a, b) => b - a).slice(0, 2);
      let best = [];
      for (const dk of dates) if (byDow[dow][dk].length > best.length) best = byDow[dow][dk];
      days.push([...best].sort((a, b) => a.t - b.t));
    }
    return days;
  }

  async _loadSchedule(force) {
    const c = this._config;
    if (!this._hasSchedule() || !this._hass || this._schedLoading) return;
    const key = "glass-dial-sched:" + c.entity;
    if (!force) {
      try {
        const r = JSON.parse(localStorage.getItem(key));
        if (r && Date.now() - r.ts < 12 * 3600e3) { this._sched = r.days; this._renderSched(); return; }
      } catch (e) { /* no cache */ }
    }
    this._schedLoading = true;
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 10 * 86400e3);
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: [c.schedule_time, c.schedule_next],
        include_start_time_state: true,
        significant_changes_only: false,
        minimal_response: true,
        no_attributes: true,
      });
      const conv = (arr) => (arr || []).map((e) => [(e.lu ?? e.lc ?? 0) * 1000, parseFloat(e.s)]);
      this._sched = GlassDialCard._computeSchedule(conv(res[c.schedule_time]), conv(res[c.schedule_next]));
      try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), days: this._sched })); } catch (e) { /* ignore */ }
    } catch (err) {
      console.warn("glass-dial-card: could not load schedule history", err);
    } finally {
      this._schedLoading = false;
      this._renderSched();
    }
  }

  _renderSched() {
    const svg = this._el && this._el.sched;
    if (!svg) return;
    const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
    const WEEK = 10080;
    const now = new Date();
    const nowMin = ((now.getDay() + 6) % 7) * 1440 + now.getHours() * 60 + now.getMinutes();
    if (this._c == null) this._c = nowMin;
    const c = this._c;
    const start = c - 720;
    const end = c + 720;
    const X0 = 96, X1 = 416, Y0 = 194, Y1 = 330, PAD = 24;
    const wk = this._weekPoints();
    const hist = this._hist;
    const temps = wk.map((q) => q.temp).concat(hist ? hist.room.slice(-400).map((r) => r[1]) : []);
    const lo = temps.length ? Math.floor(Math.min(...temps)) - 1 : 0;
    let hi = temps.length ? Math.ceil(Math.max(...temps)) + 1 : 4;
    if (hi - lo < 4) hi = lo + 4;
    const px = (m) => X0 + ((m - start) * (X1 - X0)) / 1440;
    const py = (t) => Y1 - PAD - ((t - lo) / (hi - lo)) * (Y1 - Y0 - 2 * PAD);
    const fmt = (t) => String(+Number(t).toFixed(1));
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const dayIdx = ((Math.floor(c / 1440) % 7) + 7) % 7;
    const id = this._fid + "m";

    let out = `<defs><linearGradient id="${id}g" gradientUnits="userSpaceOnUse" x1="${X0 - 14}" x2="${X1 + 14}" y1="0" y2="0"><stop offset="0" stop-color="#000"/><stop offset=".11" stop-color="#fff"/><stop offset=".89" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><rect x="0" y="0" width="512" height="512" fill="url(#${id}g)"/></mask></defs>`;
    out += `<text class="stitle" x="256" y="146">${DAYS[dayIdx]}</text><g mask="url(#${id})">`;

    for (let m = Math.ceil(start / 360) * 360; m <= end; m += 360) {
      const x = px(m);
      const mid = m % 1440 === 0;
      out += `<line class="sgrid${mid ? " smid" : ""}" x1="${x}" y1="${Y0}" x2="${x}" y2="${Y1}"/>`;
      out += `<text class="saxis" x="${x}" y="184">${String(Math.round((m % 1440) / 60)).padStart(2, "0")}h</text>`;
    }
    out += `<line class="sgrid" x1="${X0 - 20}" y1="${Y1}" x2="${X1 + 20}" y2="${Y1}"/>`;

    const pts = [];
    if (wk.length) {
      const k0 = Math.floor((start - WEEK) / WEEK);
      const k1 = Math.floor(end / WEEK) + 1;
      for (let k = k0; k <= k1; k++) for (const q of wk) pts.push({ m: k * WEEK + q.m, temp: q.temp });
      let pi = -1;
      pts.forEach((q, i) => { if (q.m <= start) pi = i; });
      let y = py(pi >= 0 ? pts[pi].temp : pts[0].temp);
      let d = `M${X0 - 20},${y}`;
      for (const q of pts) {
        if (q.m <= start || q.m >= end + 60) continue;
        d += ` L${px(q.m)},${y}`;
        y = py(q.temp);
        d += ` L${px(q.m)},${y}`;
      }
      d += ` L${X1 + 20},${y}`;
      out += `<path class="sstep" d="${d}"/>`;
    }
    if (hist && hist.room.length) {
      const nowTs = Date.now();
      const live = this._stateObj && this._stateObj.attributes.current_temperature;
      const pts2 = hist.room.concat(typeof live === "number" ? [[nowTs, live]] : []);
      let d = "";
      for (const [t, cur] of pts2) {
        const m = nowMin - (nowTs - t) / 60000;
        if (m < start - 30 || m > end) continue;
        d += `${d ? " L" : "M"}${px(m).toFixed(1)},${py(cur).toFixed(1)}`;
      }
      if (d) out += `<path class="sroom" d="${d}"/>`;
    }
    for (let k = Math.floor((start - nowMin) / WEEK); k <= Math.ceil((end - nowMin) / WEEK); k++) {
      const n = nowMin + k * WEEK;
      if (n < start || n > end) continue;
      out += `<line class="snow" x1="${px(n)}" y1="${Y0 - 8}" x2="${px(n)}" y2="${Y1}"/>`;
    }
    for (const q of pts) {
      if (q.m < start - 60 || q.m > end + 60) continue;
      out += `<circle class="sdot" cx="${px(q.m)}" cy="${py(q.temp)}" r="17"/><text class="slab" x="${px(q.m)}" y="${py(q.temp) + 5.5}">${fmt(q.temp)}</text>`;
    }
    out += `</g>`;
    if (!wk.length) {
      out += `<text class="smsg" x="256" y="270">${this._schedLoading || !this._sched ? "Loading schedule…" : "No schedule data yet"}</text>`;
    }
    out += `<text class="stime" x="256" y="374">${hh}:${mm}</text>`;
    if (hist) out += `<text class="saxis sheat" x="256" y="402">${hist.heatedMs > 60000 ? "Heated " + this._dur(hist.heatedMs / 60000) + " today" : "Not heated today"}</text>`;
    svg.innerHTML = out;
  }

  disconnectedCallback() {
    this._ro?.disconnect();
    cancelAnimationFrame(this._nraf);
    cancelAnimationFrame(this._dloop);
    clearTimeout(this._hideT);
    clearInterval(this._clock);
    clearTimeout(this._idle);
    cancelAnimationFrame(this._raf);
    clearTimeout(this._timer);
  }

  // Displacement map for a domed lens: centre magnified, effect fading to nothing at the lens rim.
  _lensMap() {
    const N = 128;
    const L = this._config.bezel_inner / 100 / this._config.display_scale; // lens radius in display-box half-widths
    const cv = document.createElement("canvas");
    cv.width = cv.height = N;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = ((x + 0.5) / N) * 2 - 1;
        const v = ((y + 0.5) / N) * 2 - 1;
        const f = Math.max(0, 1 - (u * u + v * v) / (L * L));
        const i = (y * N + x) * 4;
        img.data[i] = Math.round((0.5 - 0.5 * f * u) * 255);
        img.data[i + 1] = Math.round((0.5 - 0.5 * f * v) * 255);
        img.data[i + 2] = 128;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL("image/png");
  }

  _update() {
    if (!this._config || !this._hass) return;
    if (!this._built) this._build();
    if (!this._schedInit && this._hasSchedule()) {
      this._schedInit = true;
      setTimeout(() => this._loadSchedule(), 400 + Math.random() * 2500);
    }
    const s = this._stateObj;
    const el = this._el;
    if (!s) {
      el.label.textContent = "";
      this._drumOn = false;
      el.big.textContent = "—";
      el.sub.style.display = "";
      el.subtxt.textContent = `${this._config.entity} not found`;
      return;
    }
    const lim = this._limits(s);
    const t = this._targets(s);
    const tone = this._tone(s, t);
    const a = s.attributes;
    const cur = a.current_temperature != null ? Number(a.current_temperature) : null;
    const unavailable = s.state === "unavailable" || s.state === "unknown";

    if (el.name) el.name.textContent = this._config.name ?? a.friendly_name ?? s.entity_id;
    el.dial.classList.toggle("unavail", unavailable);

    // faces / glass / rings
    const faceTone = this._config.style === "ring" ? "off" : tone;
    el.dial.style.setProperty("--flat", { heat: "#f4590b", cool: "#1b72e6", off: "#18181a" }[faceTone]);
    this.shadowRoot.querySelectorAll("[data-tone]").forEach((n) => {
      const want = n.classList.contains("glass") ? "off" : n.classList.contains("ring") ? tone : faceTone;
      n.classList.toggle("on", n.dataset.tone === want);
    });

    // pointers & lit ticks
    const dual = t.low != null;
    const tA = dual ? t.low : t.single;
    const tB = dual ? t.high : null;
    const hasTarget = tA != null && s.state !== "off";
    const angA = hasTarget ? this._angle(tA, lim) : null;
    const angB = dual && hasTarget ? this._angle(tB, lim) : null;
    const angC = cur != null ? this._angle(cur, lim) : null;
    const R = (157 / 512) * 100; // pointer radius as % of the dial

    el.p1.classList.toggle("hidden", !hasTarget);
    el.p2.classList.toggle("hidden", !(dual && hasTarget));
    const setPtr = (n, ang) => {
      if (this._config.pointer_style === "image") n.style.transform = `rotate(${ang}deg) translateY(-${R}%)`;
      else n.setAttribute("transform", `rotate(${ang} 256 256)`);
    };
    if (hasTarget) setPtr(el.p1, angA);
    if (dual && hasTarget) setPtr(el.p2, angB);

    let lo = null, hi = null;
    if (hasTarget && dual) { lo = angA; hi = angB; }
    else if (hasTarget && angC != null) { lo = Math.min(angA, angC); hi = Math.max(angA, angC); }
    el.ticks.forEach((ln, i) => {
      const ang = START + (SWEEP * i) / (TICKS - 1);
      ln.classList.toggle("lit", lo != null && ang >= lo - 0.01 && ang <= hi + 0.01);
    });

    // coloured arc (ring style) via conic mask
    if (this._config.style === "ring") {
      const dial = el.dial;
      const trackFrom = (START + 360) % 360;
      dial.style.setProperty("--track", `conic-gradient(from ${trackFrom}deg, #000 0deg ${SWEEP}deg, transparent ${SWEEP}deg)`);
      if (lo != null && hi > lo) {
        dial.style.setProperty("--arc", `conic-gradient(from ${(lo + 360) % 360}deg, #000 0deg ${hi - lo}deg, transparent ${hi - lo}deg)`);
      } else {
        dial.style.setProperty("--arc", "linear-gradient(transparent, transparent)");
      }
    }

    // current temperature marker
    el.curtick.style.display = angC != null ? "" : "none";
    el.cur.style.display = angC != null ? "" : "none";
    if (angC != null) {
      el.curtick.setAttribute("transform", `rotate(${angC} 256 256)`);
      // put the label on the far side of the tick from the target so they don't collide
      const off = hasTarget && !dual ? (angC >= angA ? 13 : -13) : 0;
      const la = ((angC + off) * Math.PI) / 180;
      const r = 24.5; // just inside the tick ring, on the display
      el.cur.style.left = `${50 + r * Math.sin(la)}%`;
      el.cur.style.top = `${50 - r * Math.cos(la)}%`;
      el.cur.textContent = this._fmt(cur, true);
    }

    // centre text
    const action = a.hvac_action;
    let label = "";
    if (unavailable) label = "Unavailable";
    else if (s.state === "off") label = "";
    else if (action === "heating" || action === "preheating") label = "";
    else if (action === "cooling") label = "";
    else if (s.state === "heat_cool") label = "Heat · Cool";
    else if (s.state === "auto") label = "Schedule";
    else if (s.state === "heat") label = "Set";
    else if (s.state === "cool") label = "Set";
    else label = s.state.replace(/_/g, " ");
    el.label.textContent = label;

    if (!hasTarget) {
      this._drumOn = false;
      el.big.innerHTML = s.state === "off" ? `<span>OFF</span>` : this._bigNum(cur);
    } else if (dual) {
      this._drumOn = false;
      el.big.innerHTML = `${this._bigNum(tA)}<span class="sep">•</span>${this._bigNum(tB)}`;
    } else {
      this._renderDrum(this._nv != null ? this._nv : tA, lim);
    }

    const leaf = this._leaf(s, t, tone);
    el.leaf.classList.toggle("on", leaf);
    el.big.classList.toggle("dual", dual && hasTarget);
    el.subtxt.textContent = "";
    el.sub.style.display = leaf ? "" : "none";
    this._decorate(s, t, leaf, unavailable);

    el.dial.setAttribute("aria-valuemin", lim.min);
    el.dial.setAttribute("aria-valuemax", lim.max);
    if (tA != null) el.dial.setAttribute("aria-valuenow", tA);
    el.dial.setAttribute("aria-label", `${a.friendly_name || s.entity_id} target temperature`);

    // in-dial mode toggle: shows the current mode, tap to switch to the next
    {
      const m = a.hvac_modes || [];
      el.modebtn.style.display = m.length > 1 && !unavailable ? "" : "none";
      el.modeicon.setAttribute("icon", MODE_ICONS[s.state] || "mdi:thermostat");
      const nxt = m[(m.indexOf(s.state) + 1) % (m.length || 1)];
      el.modebtn.title = `${s.state.replace(/_/g, " ")} — tap for ${(nxt || "").replace(/_/g, " ")}${this._config.boost_timer ? ", hold to boost" : ""}`;
    }
    // mode buttons
    if (el.modes) {
      const modes = a.hvac_modes || [];
      const key = modes.join(",") + "|" + s.state + "|" + tone;
      if (key !== this._modesKey) {
        this._modesKey = key;
        const color = tone === "heat" ? "#f2620f" : tone === "cool" ? "#1878e8" : "var(--primary-color)";
        el.modes.style.setProperty("--mode-color", color);
        el.modes.innerHTML = modes
          .map((m) => `<button data-mode="${m}" class="${m === s.state ? "active" : ""}" title="${m.replace(/_/g, " ")}"><ha-icon icon="${MODE_ICONS[m] || "mdi:thermostat"}"></ha-icon></button>`)
          .join("");
        el.modes.querySelectorAll("button").forEach((b) =>
          b.addEventListener("click", () => this._call("set_hvac_mode", { hvac_mode: b.dataset.mode }))
        );
      }
    }
  }

  // ---------- vertical number drum ----------
  _renderDrum(val, lim) {
    const el = this._el;
    this._dval = val;
    this._dlim = lim;
    if (!this._drumOn) {
      el.big.innerHTML = `<div class="drum">${'<div class="drow"></div>'.repeat(5)}</div>`;
      el.drum = el.big.firstChild;
      el.drows = [...el.drum.children];
      this._drumOn = true;
    }
    const step = lim.step;
    const idx = Math.round(val / step);
    const off = val / step - idx;
    el.drows.forEach((row, n) => {
      const j = n - 2;
      const v = Math.round((idx + j) * step * 1000) / 1000;
      if (v < lim.min - 1e-6 || v > lim.max + 1e-6) { row.style.display = "none"; return; }
      const d = j - off;
      const ad = Math.abs(d);
      row.style.display = "";
      // the neighbouring numbers only show while scrolling (this._dshow 0 -> 1)
      const rest = Math.max(0, 1 - 2 * ad);
      const live = Math.max(0, 1 - 0.62 * Math.min(1.7, ad));
      row.style.opacity = String(rest + (live - rest) * (this._dshow || 0));
      row.style.transform = `translate(-50%,-50%) translateY(${d * 0.66}em) scale(${1 - 0.28 * Math.min(1, ad)})`;
      const html = this._bigNum(v);
      if (row._h !== html) { row.innerHTML = html; row._h = html; }
    });
  }

  _drumReveal(on) {
    clearTimeout(this._hideT);
    this._dtarget = on ? 1 : 0;
    if (this._dloop) return;
    const tick = () => {
      const target = this._dtarget;
      let sh = (this._dshow || 0) + (target - (this._dshow || 0)) * 0.22;
      if (Math.abs(target - sh) < 0.02) sh = target;
      this._dshow = sh;
      if (this._drumOn && this._dval != null) this._renderDrum(this._dval, this._dlim);
      this._dloop = sh !== target ? requestAnimationFrame(tick) : 0;
    };
    this._dloop = requestAnimationFrame(tick);
  }

  _drumHideSoon() {
    clearTimeout(this._hideT);
    this._hideT = setTimeout(() => this._drumReveal(false), 700);
  }

  _numSet(val, lim) {
    if (this._dtarget !== 1) this._drumReveal(true);
    clearTimeout(this._hideT);
    val = clamp(val, lim.min, lim.max);
    this._nv = val;
    const snapped = Math.round((Math.round(val / lim.step) * lim.step) * 1000) / 1000;
    if (!this._pending || this._pending.single !== snapped) {
      this._buzz(6);
      this._pending = { single: snapped };
      this._update();
    } else {
      this._renderDrum(val, lim);
    }
  }

  _numStart(e) {
    if (this._schedOpen || !this._drumOn) return;
    const s = this._stateObj;
    if (!s || s.state === "off" || s.state === "unavailable") return;
    const t = this._targets(s);
    if (t.single == null) return;
    cancelAnimationFrame(this._nraf);
    this._nd = { id: e.pointerId, y0: e.clientY, y: e.clientY, moved: false, base: this._nv != null ? this._nv : t.single, v: 0, tl: performance.now() };
  }

  _numMove(e) {
    const d = this._nd;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved) {
      if (Math.abs(e.clientY - d.y0) < 6) return;
      d.moved = true;
      this._nmoved = true;
      clearTimeout(this._holdT);
      clearTimeout(this._timer);
      this._el.center.setPointerCapture(d.id);
      d.y0 = e.clientY;
      d.y = e.clientY;
      d.tl = performance.now();
    }
    const lim = this._limits(this._stateObj);
    const pps = this._el.dial.clientWidth * 0.05; // finger pixels per step
    const now = performance.now();
    d.v = 0.6 * d.v + 0.4 * ((-(e.clientY - d.y) / pps) / Math.max(1, now - d.tl));
    d.y = e.clientY;
    d.tl = now;
    this._numSet(d.base - ((e.clientY - d.y0) / pps) * lim.step, lim);
  }

  _numEnd(e) {
    const d = this._nd;
    if (!d || e.pointerId !== d.id) return;
    this._nd = null;
    if (!d.moved) return;
    this._numFling(performance.now() - d.tl < 80 ? d.v : 0);
  }

  _numFling(v) {
    const lim = this._limits(this._stateObj);
    v = clamp(v, -0.04, 0.04); // steps per millisecond
    cancelAnimationFrame(this._nraf);
    let last = performance.now();
    const tick = (t) => {
      const dt = t - last;
      last = t;
      if (Math.abs(v) > 0.0015) {
        v *= Math.pow(0.95, dt / 16);
        const next = this._nv + v * dt * lim.step;
        if (next <= lim.min || next >= lim.max) v = 0;
        this._numSet(next, lim);
        this._nraf = requestAnimationFrame(tick);
      } else {
        this._numSettle(lim);
      }
    };
    this._nraf = requestAnimationFrame(tick);
  }

  _numSettle(lim) {
    const from = this._nv;
    const to = Math.round(from / lim.step) * lim.step;
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 160);
      this._numSet(from + (to - from) * (1 - Math.pow(1 - k, 3)), lim);
      if (k < 1) this._nraf = requestAnimationFrame(tick);
      else { this._nv = null; this._numTo = null; this._update(); this._schedule(); this._drumHideSoon(); }
    };
    this._nraf = requestAnimationFrame(tick);
  }

  _numAnimateTo(to, lim) {
    const s = this._stateObj;
    const from = this._nv != null ? this._nv : this._targets(s).single;
    this._numTo = to;
    cancelAnimationFrame(this._nraf);
    clearTimeout(this._timer);
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 170);
      this._numSet(from + (to - from) * (1 - Math.pow(1 - k, 3)), lim);
      if (k < 1) this._nraf = requestAnimationFrame(tick);
      else { this._nv = null; this._numTo = null; this._update(); this._schedule(); this._drumHideSoon(); }
    };
    this._nraf = requestAnimationFrame(tick);
  }

  _bigNum(v) {
    if (v == null || isNaN(v)) return "<span>—</span>";
    const [i, f] = this._fmt(v).split(".");
    return `<span>${i}</span>${f && f !== "0" ? `<span class="frac">${f}</span>` : ""}`;
  }

  _fmt(v, oneDecimal) {
    if (v == null || isNaN(v)) return "—";
    const lim = this._stateObj ? this._limits(this._stateObj) : { step: 0.5 };
    const dec = oneDecimal ? (Number.isInteger(v) ? 0 : 1) : lim.step < 1 ? 1 : 0;
    return Number(v).toFixed(dec);
  }

  _leaf(s, t, tone) {
    if ((s.attributes.preset_mode || "").toLowerCase() === "eco") return true;
    if (s.state === "off") return false;
    const c = this._config;
    if (t.single != null) {
      if ((s.state === "heat" || s.state === "auto") && t.single <= c.eco_heat) return true;
      if (s.state === "cool" && t.single >= c.eco_cool) return true;
    }
    if (t.low != null && t.low <= c.eco_heat && t.high >= c.eco_cool) return true;
    return false;
  }

  // ---------- interaction ----------
  _pointerAngle(e) {
    const r = this._el.dial.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return (Math.atan2(dx, -dy) * 180) / Math.PI;
  }

  _dragStart(e) {
    if (this._schedOpen) {
      cancelAnimationFrame(this._raf);
      this._sdrag = { id: e.pointerId, x: e.clientX, x0: e.clientX, moved: false, v: 0, tl: performance.now() };
      this._el.hit.setPointerCapture(e.pointerId);
      this._held = false;
      clearTimeout(this._holdT);
      this._holdT = setTimeout(() => { if (this._sdrag && !this._sdrag.moved) { this._held = true; this._moreInfo(); } }, 650);
      this._bump();
      return;
    }
    const s = this._stateObj;
    if (!s || s.state === "off" || s.state === "unavailable") return;
    const t = this._targets(s);
    if (t.single == null && t.low == null) return;
    const ang = this._pointerAngle(e);
    let which = "single";
    if (t.low != null) {
      const lim = this._limits(s);
      which = Math.abs(norm180(ang - this._angle(t.low, lim))) <= Math.abs(norm180(ang - this._angle(t.high, lim))) ? "low" : "high";
    }
    this._drag = { id: e.pointerId, last: ang, acc: 0, which, base: { ...t } };
    this._el.hit.setPointerCapture(e.pointerId);
    this._el.hit.classList.add("drag");
    clearTimeout(this._timer);
  }

  _dragMove(e) {
    if (this._sdrag) {
      const sd = this._sdrag;
      if (e.pointerId !== sd.id) return;
      if (Math.abs(e.clientX - sd.x0) > 6) { sd.moved = true; clearTimeout(this._holdT); }
      if (sd.moved) {
        const now = performance.now();
        const dx = e.clientX - sd.x;
        const mpp = this._mpp();
        sd.v = 0.6 * sd.v + 0.4 * ((-dx * mpp) / Math.max(1, now - sd.tl));
        sd.x = e.clientX;
        sd.tl = now;
        this._c -= dx * mpp;
        this._redraw();
        this._bump();
      }
      return;
    }
    const d = this._drag;
    if (!d || e.pointerId !== d.id) return;
    const ang = this._pointerAngle(e);
    d.acc += norm180(ang - d.last);
    d.last = ang;
    const s = this._stateObj;
    const lim = this._limits(s);
    const delta = (d.acc / SWEEP) * (lim.max - lim.min);
    const next = { ...d.base };
    const k = d.which;
    let v = Math.round((d.base[k] + delta) / lim.step) * lim.step;
    v = clamp(v, lim.min, lim.max);
    if (k === "low") v = Math.min(v, next.high - lim.step);
    if (k === "high") v = Math.max(v, next.low + lim.step);
    next[k] = v;
    if (JSON.stringify(next) !== JSON.stringify(this._pending || this._targets(s))) {
      this._pending = next;
      this._update();
    }
  }

  _dragEnd(e) {
    if (this._sdrag) {
      const sd = this._sdrag;
      if (e.pointerId !== sd.id) return;
      this._sdrag = null;
      clearTimeout(this._holdT);
      if (sd.moved) this._fling(performance.now() - sd.tl < 80 ? sd.v : 0);
      else if (!this._held) this._schedToggle(false);
      this._held = false;
      return;
    }
    if (!this._drag || e.pointerId !== this._drag.id) return;
    this._drag = null;
    this._el.hit.classList.remove("drag");
    if (this._pending) this._schedule();
  }

  _nudge(dir) {
    if (this._schedOpen) { this._schedStep(dir); return; }
    const s = this._stateObj;
    if (!s || s.state === "off" || s.state === "unavailable") return;
    const lim = this._limits(s);
    const t = { ...this._targets(s) };
    if (t.single != null) t.single = clamp(Math.round(((this._numTo != null ? this._numTo : t.single) + dir * lim.step) / lim.step) * lim.step, lim.min, lim.max);
    else if (t.low != null) {
      // chevrons move the side the room is closest to
      const cur = Number(s.attributes.current_temperature);
      const k = !isNaN(cur) && Math.abs(cur - t.high) < Math.abs(cur - t.low) ? "high" : "low";
      t[k] = clamp(t[k] + dir * lim.step, lim.min, lim.max);
      if (t.low >= t.high) return;
    } else return;
    if (t.single != null && this._drumOn) { this._numAnimateTo(t.single, lim); return; }
    this._pending = t;
    this._update();
    this._schedule();
  }

  _schedule() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._commit(), this._config.debounce);
  }

  async _commit() {
    const t = this._pending;
    if (!t) return;
    const cur = this._stateObj;
    if (t.single != null && cur && Number(cur.attributes.temperature) === t.single) {
      this._pending = null;
      this._update();
      return;
    }
    const data = t.single != null ? { temperature: t.single } : { target_temp_low: t.low, target_temp_high: t.high };
    try {
      await this._call("set_temperature", data);
    } finally {
      // keep the optimistic value briefly so the dial doesn't flick back before the entity updates
      setTimeout(() => {
        if (this._pending === t) { this._pending = null; this._update(); }
      }, 2500);
    }
  }

  _call(service, data) {
    return this._hass.callService("climate", service, { entity_id: this._config.entity, ...data });
  }

  _moreInfo() {
    this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: this._config.entity } }));
  }
}

customElements.define("glass-dial-card", GlassDialCard);
// ---------- visual editor (shown in the dashboard card picker) ----------
const EDITOR_SCHEMA = [
  { name: "entity", required: true, selector: { entity: { domain: "climate" } } },
  { name: "name", selector: { text: {} } },
  { name: "show_name", selector: { boolean: {} } },
  { name: "tap_action", selector: { select: { options: ["auto", "schedule", "more-info", "none"] } } },
  {
    type: "expandable", title: "Schedule, ticker and boost", schema: [
      { name: "schedule_next", selector: { entity: { domain: "sensor" } } },
      { name: "schedule_time", selector: { entity: { domain: "sensor" } } },
      { name: "warning_entity", selector: { entity: { domain: "binary_sensor" } } },
      { name: "window_entity", selector: { entity: { domain: ["sensor", "binary_sensor"] } } },
      { name: "valve_entity", selector: { entity: { domain: "sensor" } } },
      { name: "boost_timer", selector: { entity: { domain: "timer" } } },
      { name: "boost_delta", selector: { number: { min: 0.5, max: 5, step: 0.5, mode: "box" } } },
      { name: "manual_revert_hours", selector: { number: { min: 0, max: 12, step: 1, mode: "box" } } },
      { name: "ticker", selector: { boolean: {} } },
      { name: "badges", selector: { boolean: {} } },
      { name: "haptics", selector: { boolean: {} } },
    ],
  },
  {
    type: "expandable", title: "Look", schema: [
      { name: "style", selector: { select: { options: ["face", "ring"] } } },
      { name: "display_scale", selector: { number: { min: 0.6, max: 0.92, step: 0.01, mode: "slider" } } },
      { name: "dial_zoom", selector: { number: { min: 1, max: 1.3, step: 0.01, mode: "slider" } } },
      { name: "fisheye", selector: { number: { min: 0, max: 0.5, step: 0.01, mode: "slider" } } },
      { name: "reflection", selector: { number: { min: 0, max: 3, step: 0.1, mode: "slider" } } },
      { name: "reflection_blur", selector: { number: { min: 0, max: 10, step: 1, mode: "slider" } } },
      { name: "glass_opacity", selector: { number: { min: 0, max: 0.5, step: 0.01, mode: "slider" } } },
      { name: "number_weight", selector: { number: { min: 200, max: 800, step: 100, mode: "slider" } } },
      { name: "max_width", selector: { text: {} } },
    ],
  },
];
const EDITOR_LABELS = {
  entity: "Thermostat", name: "Name", show_name: "Show the name above the dial", tap_action: "Tap the dial centre",
  schedule_next: "Next setpoint sensor", schedule_time: "Time-to-next-setpoint sensor", warning_entity: "Heating warning sensor",
  window_entity: "Open window sensor", valve_entity: "Valve position sensor", boost_timer: "Boost timer",
  boost_delta: "Boost: degrees to add", manual_revert_hours: "Manual returns to timed after (hours, 0 = never)",
  ticker: "Show the message ticker", badges: "Show status icons", haptics: "Vibrate while scrolling",
  style: "Style", display_scale: "Display size", dial_zoom: "Dial zoom", fisheye: "Dome distortion", reflection: "Reflection strength",
  reflection_blur: "Reflection blur (px)", glass_opacity: "Glass tint", number_weight: "Number weight", max_width: "Maximum width",
};

class GlassDialCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (sch) => EDITOR_LABELS[sch.name] || sch.name;
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._config = ev.detail.value;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = EDITOR_SCHEMA;
    this._form.data = this._config;
  }
}
customElements.define("glass-dial-card-editor", GlassDialCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "glass-dial-card",
  name: "Glass Dial Card",
  description: "Layered glass-and-metal thermostat dial with drag-to-set, heating/cooling colours and an eco leaf.",
  preview: true,
});
console.info(`%c GLASS-DIAL-CARD %c ${VERSION} `, "background:#f2620f;color:#fff;border-radius:3px 0 0 3px", "background:#222;color:#fff;border-radius:0 3px 3px 0");
