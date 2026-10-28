// world-map.js
//
// The traffic globe. Geography on the left (SVG, orthographic projection the
// operator can rotate by dragging or with the arrow keys), schematic routing
// on the right. Each region's requests fly a great-circle arc to the ESP32,
// pinned at Chennai; a single uplink runs from there into the routing panel,
// where the backends live. Arcs hide where they pass behind the globe.
//
// Every animation is a consequence of a telemetry event:
//   PING     -> pulse from the region to the gateway
//   REQUEST  -> pulse from the gateway to the backend named in the request
//   PONG/... -> return pulse, coloured by what actually came back
// A leg with no event behind it is never drawn. The gateway's position is a
// placement, not a measured location.

import { REGIONS, UNASSIGNED, GATEWAY_SITE, regionInfo } from './region-config.js';
import { on, state, regionRate, generatorForRegion } from './telemetry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_PULSES = 260;
const LEG_MS = { region: 1200, bus: 360 };
const COLORS = { ok: '#E8EDF2', non200: '#D9A441', fail: '#E36D70' };
const LABEL_SIDE = { na: 'left', sa: 'right', eu: 'up', af: 'left', me: 'up', sas: 'left', ap: 'right', unassigned: 'right' };
// Centred on the mean of the seven regions, so all of them start on the near side.
const HOME_ROTATION = [-17.6, -17];
const KEY_STEP = 10;            // degrees per arrow key press
const DRAG_THRESHOLD = 4;       // px before a press becomes a drag, not a click

const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
};

function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export class TrafficMap {
    constructor(stage) {
        this.stage = stage;
        this.pane = stage.querySelector('[data-map-pane]');
        this.geo = stage.querySelector('[data-geo]');
        this.routeLayer = stage.querySelector('[data-routes]');
        this.canvas = stage.querySelector('[data-pulses]');
        this.ctx = this.canvas.getContext('2d');
        this.labels = stage.querySelector('[data-labels]');
        this.tooltip = stage.querySelector('[data-tooltip]');
        this.legend = stage.querySelector('[data-legend]');

        this.paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        this.focus = null;
        this.highlightPort = null;
        this.rotation = [...HOME_ROTATION];
        this.points = {};       // region id -> {x, y, px, py, behind}
        this.routes = {};       // region id -> { path, lut }: arc to Chennai + uplink (reused so pulses follow a rotating globe)
        this.buses = {};        // port -> { path, lut }
        this.geoPaths = [];     // [svg path, GeoJSON] pairs redrawn on rotation
        this.tokens = new Map();
        this.pulses = [];
        this.marks = [];        // rings and failure crosses
        this.running = false;

        this.world = null;
        new ResizeObserver(() => this.relayout()).observe(stage);
        this.bindEvents();
    }

    async load(url) {
        try {
            this.world = await (await fetch(url)).json();
        } catch (e) {
            console.warn('Map geometry unavailable', e);
            this.pane.dataset.geoError = 'true';
        }
        this.relayout();
    }

    /* ------------------------------------------------------------ *
     *  Layout
     * ------------------------------------------------------------ */

    relayout() {
        const sr = this.stage.getBoundingClientRect();
        const pr = this.pane.getBoundingClientRect();
        if (!sr.width || !pr.width) return;
        this.sr = sr;
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.round(sr.width * this.dpr);
        this.canvas.height = Math.round(sr.height * this.dpr);
        this.routeLayer.setAttribute('viewBox', `0 0 ${sr.width} ${sr.height}`);

        const legendH = this.legend.offsetHeight;
        this.pane.style.setProperty('--legend-h', `${legendH}px`);
        const w = pr.width, h = pr.height - legendH;
        // Pane-relative to stage-relative
        this.size = { w, h, ox: pr.left - sr.left, oy: pr.top - sr.top };
        this.geo.setAttribute('viewBox', `0 0 ${w} ${h}`);
        this.geo.style.height = `${h}px`;

        this.drawGeography(w, h);
        this.drawMarkers();
        this.renderLabels();
        this.renderLegend();
        this.reproject();
        this.drawBuses();
    }

    // Everything that moves when the globe turns. Cheap enough to run per frame.
    reproject() {
        if (!this.size) return;
        const { w, h, ox, oy } = this.size;
        const P = this.projection;
        let cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
        if (P) {
            P.rotate(this.rotation);
            const path = d3.geoPath(P);
            for (const [node, datum] of this.geoPaths) node.setAttribute('d', path(datum) || '');
            [cx, cy] = P.translate();
            R = P.scale();
        }
        const centre = [-this.rotation[0], -this.rotation[1]];
        for (const r of REGIONS) this.points[r.id] = this.siteAt(r, centre, { w, h, ox, oy, cx, cy, R });
        this.points.unassigned = { x: ox + 28, y: oy + h - 28, px: 28, py: h - 28, behind: false };
        this.globe = { cx, cy, R };
        this.gw = this.siteAt(GATEWAY_SITE, centre, { w, h, ox, oy, cx, cy, R });

        this.placeMarkers();
        this.placeLabels();
        this.drawRoutes();
    }

    siteAt(site, centre, { w, h, ox, oy, cx, cy, R }) {
        const P = this.projection;
        let px, py, behind = false;
        if (P) {
            [px, py] = P([site.lon, site.lat]);
            behind = d3.geoDistance([site.lon, site.lat], centre) > Math.PI / 2;
            if (behind) {
                // Pin to the horizon, in the direction the site lies.
                const dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy) || 1;
                px = cx + (dx / d) * R;
                py = cy + (dy / d) * R;
            }
        } else {
            px = w * (site.lon + 180) / 360;
            py = h * (90 - site.lat) / 180;
        }
        return { x: px + ox, y: py + oy, px, py, behind, lon: site.lon, lat: site.lat };
    }

    // Great-circle arc lifted off the surface, as stage-relative points.
    // `vis` is false where the globe is in front of the arc.
    arcLut(from, to, n = 56) {
        const { cx, cy, R } = this.globe;
        const { ox, oy } = this.size;
        const interp = d3.geoInterpolate(from, to);
        const lift = Math.min(0.28, 0.06 + d3.geoDistance(from, to) * 0.16);
        const rot = d3.geoRotation(this.rotation);
        const rad = Math.PI / 180;
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            const [l, f] = rot(interp(t));
            const a = R * (1 + lift * Math.sin(Math.PI * t));
            const x = cx + a * Math.cos(f * rad) * Math.sin(l * rad);
            const y = cy - a * Math.sin(f * rad);
            const z = Math.cos(f * rad) * Math.cos(l * rad);
            pts.push({ x: x + ox, y: y + oy, vis: z > 0 || Math.hypot(x - cx, y - cy) > R });
        }
        return pts;
    }

    anchor(selector) {
        const a = this.stage.querySelector(selector);
        if (!a || !this.sr) return null;
        const r = a.getBoundingClientRect();
        if (!r.width && !r.height) return null;
        return { x: r.left + r.width / 2 - this.sr.left, y: r.top + r.height / 2 - this.sr.top };
    }

    drawGeography(w, h) {
        this.geo.innerHTML = '';
        this.geoPaths = [];
        this.markerLayer = null;
        if (!this.world || !window.d3 || !window.topojson) { this.projection = null; return; }
        const world = this.world;
        const geoms = world.objects.countries.geometries;
        const land = topojson.merge(world, geoms.filter(g => g.id !== '010'));   // drop Antarctica
        const borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
        const sphere = { type: 'Sphere' };
        const pad = 16;
        this.projection = d3.geoOrthographic().rotate(this.rotation).fitExtent([[pad, pad], [w - pad, h - pad]], sphere);

        const defs = el('defs', {}, this.geo);
        const shade = el('radialGradient', { id: 'geo-shade', cx: '38%', cy: '34%', r: '70%' }, defs);
        el('stop', { offset: '0%', 'stop-color': '#000', 'stop-opacity': 0 }, shade);
        el('stop', { offset: '70%', 'stop-color': '#000', 'stop-opacity': 0.12 }, shade);
        el('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': 0.45 }, shade);

        const add = (datum, cls) => this.geoPaths.push([el('path', { class: cls }, this.geo), datum]);
        add(sphere, 'geo-sphere');
        add(d3.geoGraticule10(), 'geo-graticule');
        add(land, 'geo-land');
        add(borders, 'geo-border');
        add(sphere, 'geo-shade');
        add(sphere, 'geo-limb');
        this.markerLayer = el('g', { class: 'geo-markers' }, this.geo);
    }

    drawMarkers() {
        if (!this.markerLayer) this.markerLayer = el('g', { class: 'geo-markers' }, this.geo);
        this.markerLayer.innerHTML = '';
        for (const r of [...REGIONS, UNASSIGNED]) {
            const g = el('g', { class: 'marker', 'data-region': r.id }, this.markerLayer);
            if (r.id === 'unassigned') {
                el('rect', { x: -3.5, y: -3.5, width: 7, height: 7, class: 'marker-dot', fill: r.color }, g);
            } else {
                el('circle', { r: 7, class: 'marker-halo', fill: r.color }, g);
                el('circle', { r: 3.5, class: 'marker-dot', fill: r.color }, g);
            }
            el('circle', { r: 14, class: 'marker-hit' }, g);
        }
        const gw = el('g', { class: 'gw-marker' }, this.markerLayer);
        el('title', {}, gw).textContent = `${GATEWAY_SITE.name}, drawn at ${GATEWAY_SITE.city}`;
        el('circle', { r: 11, class: 'gw-halo' }, gw);
        el('rect', { x: -4.5, y: -4.5, width: 9, height: 9, transform: 'rotate(45)', class: 'gw-dot' }, gw);
        this.syncMarkerState();
    }

    placeMarkers() {
        if (!this.markerLayer) return;
        this.markerLayer.querySelectorAll('.marker').forEach(m => {
            const p = this.points[m.dataset.region];
            if (!p) return;
            m.setAttribute('transform', `translate(${p.px},${p.py})`);
            m.classList.toggle('is-behind', p.behind);
        });
        const gw = this.markerLayer.querySelector('.gw-marker');
        if (gw && this.gw) {
            gw.setAttribute('transform', `translate(${this.gw.px},${this.gw.py})`);
            gw.classList.toggle('is-behind', this.gw.behind);
        }
    }

    drawRoutes() {
        const L = this.routeLayer;
        L.querySelectorAll('.route, .trunk').forEach(n => n.remove());
        const inlet = this.anchor('[data-anchor="gateway-in"]');
        const g = this.gw;
        this.gatewayPoint = g;
        if (!g) return;

        // Uplink: Chennai to the gateway panel. Side-by-side layout runs it
        // right; the stacked layout (narrow screens) runs it down.
        let trunk = [];
        if (inlet) {
            const stacked = inlet.y > this.pane.getBoundingClientRect().bottom - this.sr.top - 1;
            const c = stacked
                ? [g, { x: g.x, y: g.y + (inlet.y - g.y) * 0.6 }, { x: inlet.x, y: inlet.y - (inlet.y - g.y) * 0.4 }, inlet]
                : [g, { x: g.x + (inlet.x - g.x) * 0.5, y: g.y }, { x: inlet.x - (inlet.x - g.x) * 0.35, y: inlet.y }, inlet];
            trunk = cubicLut(c, 32);
            el('path', { d: lutPath(trunk), class: 'trunk' + (g.behind ? ' is-behind' : '') }, L);
        }

        const ids = [...REGIONS.map(r => r.id), 'unassigned'];
        for (const id of ids) {
            const p = this.points[id];
            const arc = id === 'unassigned' || !this.projection
                ? cubicLut([p, { x: p.x, y: g.y }, { x: g.x - 40, y: g.y }, g], 40)
                : this.arcLut([p.lon, p.lat], [g.lon, g.lat]);
            const path = el('path', { d: lutPath(arc), class: 'route', 'data-region': id, stroke: regionInfo(id).color }, L);
            const track = this.routes[id] || (this.routes[id] = {});
            track.path = path;
            track.lut = arc.concat(trunk.slice(1));
        }
        this.syncRouteState();
    }

    drawBuses() {
        const L = this.routeLayer;
        L.querySelectorAll('.bus').forEach(n => n.remove());
        const outlet = this.anchor('[data-anchor="gateway-out"]');
        if (!outlet) return;
        this.stage.querySelectorAll('[data-anchor="backend"]').forEach(a => {
            const port = Number(a.dataset.port);
            const b = this.anchor(`[data-anchor="backend"][data-port="${port}"]`);
            if (!b) return;
            const r = Math.min(8, Math.abs(b.y - outlet.y) / 2);
            const d = `M${outlet.x},${outlet.y} L${outlet.x},${b.y - r} Q${outlet.x},${b.y} ${outlet.x + r},${b.y} L${b.x},${b.y}`;
            const path = el('path', { d, class: 'bus', 'data-port': port }, L);
            const track = this.buses[port] || (this.buses[port] = {});
            track.path = path;
            track.lut = sample(path);
        });
        this.syncRouteState();
    }

    /* ------------------------------------------------------------ *
     *  Rotation
     * ------------------------------------------------------------ */

    rotateTo(rotation) {
        this.rotation = [((rotation[0] + 540) % 360) - 180, Math.max(-80, Math.min(80, rotation[1]))];
        if (this.rotateQueued) return;
        this.rotateQueued = true;
        requestAnimationFrame(() => {
            this.rotateQueued = false;
            this.reproject();
            if (this.tooltipFor) this.showTooltip(this.tooltipFor);
        });
    }

    rotateBy(dLon, dLat) {
        this.rotateTo([this.rotation[0] + dLon, this.rotation[1] + dLat]);
    }

    resetView() {
        this.rotateTo([...HOME_ROTATION]);
    }

    /* ------------------------------------------------------------ *
     *  Labels, legend, tooltip, state classes
     * ------------------------------------------------------------ */

    visibleRegions() {
        const hasUnassigned = state.clients.some(c => !state.regionOf[c.id]) || (state.regions.unassigned?.sent > 0);
        return hasUnassigned ? [...REGIONS, UNASSIGNED] : REGIONS;
    }

    regionStatus(id) {
        if (id === 'unassigned') {
            const n = state.clients.filter(c => !state.regionOf[c.id]).length;
            return n ? { active: true, text: `${n} generator${n > 1 ? 's' : ''}` } : { active: false, text: 'None' };
        }
        const g = generatorForRegion(id);
        return g ? { active: true, text: 'Generator running', gid: g.id } : { active: false, text: 'No generator' };
    }

    renderLabels() {
        this.labels.innerHTML = '';
        for (const r of this.visibleRegions()) {
            const d = document.createElement('div');
            d.className = 'map-label';
            d.dataset.region = r.id;
            d.innerHTML = `<span class="ml-name">${r.name}</span><span class="ml-stat" data-stat></span>`;
            this.labels.appendChild(d);
        }
        const gl = document.createElement('div');
        gl.className = 'map-label gw-label';
        gl.innerHTML = `<span class="ml-name">${GATEWAY_SITE.name}</span><span class="ml-stat">${GATEWAY_SITE.city}</span>`;
        this.labels.prepend(gl);
        this.labels.style.width = `${this.size ? this.size.w : this.pane.getBoundingClientRect().width}px`;
        this.placeLabels();
        this.updateStats();
    }

    // Labels are placed gateway first, then front-facing regions, then the
    // far side. Each tries its preferred side, then the others, and takes the
    // first that stays in the pane and clear of markers and earlier labels.
    // A far-side label with nowhere to go is hidden (its marker stays).
    placeLabels() {
        if (!this.size || !this.globe) return;
        const items = [];
        const gl = this.labels.querySelector('.gw-label');
        if (gl && this.gw) items.push({ d: gl, p: this.gw, prefs: ['right', 'down', 'left', 'up'] });
        const regionNodes = [...this.labels.querySelectorAll('.map-label[data-region]')]
            .filter(d => this.points[d.dataset.region])
            .sort((a, b) => this.points[a.dataset.region].behind - this.points[b.dataset.region].behind);
        for (const d of regionNodes) {
            const id = d.dataset.region;
            const p = this.points[id];
            const pref = p.behind ? (p.px < this.globe.cx ? 'left' : 'right') : LABEL_SIDE[id];
            items.push({ d, p, id, prefs: [pref, ...['right', 'left', 'up', 'down'].filter(s => s !== pref)] });
        }

        // Write classes, then read every size in one layout pass.
        for (const it of items) {
            const { d, p, id } = it;
            d.className = `map-label${id ? '' : ' gw-label'}`;
            d.classList.toggle('is-behind', p.behind);
            if (id) {
                d.classList.toggle('is-idle', !this.regionStatus(id).active);
                d.classList.toggle('is-dim', !!this.focus && this.focus !== id);
            }
            d.style.visibility = '';
        }
        for (const it of items) { it.w = it.d.offsetWidth; it.h = it.d.offsetHeight; }

        const { w: W, h: H } = this.size;
        const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
        const taken = [...Object.values(this.points), this.gw].filter(Boolean)
            .map(q => ({ l: q.px - 6, r: q.px + 6, t: q.py - 6, b: q.py + 6, at: q }));
        const boxFor = (side, { p, w, h }) => {
            const x = side === 'right' ? p.px + 12 : side === 'left' ? p.px - w - 12 : p.px - w / 2;
            const y = side === 'up' ? p.py - h - 10 : side === 'down' ? p.py + 10 : p.py - h / 2;
            return { l: x, r: x + w, t: y, b: y + h };
        };
        for (const it of items) {
            let side = null;
            for (const s of it.prefs) {
                const b = boxFor(s, it);
                if (b.l < 4 || b.r > W - 4 || b.t < 4 || b.b > H - 4) continue;
                if (taken.some(o => o.at !== it.p && hit(b, o))) continue;
                side = s;
                break;
            }
            if (!side && it.p.behind) { it.d.style.visibility = 'hidden'; continue; }
            side = side || it.prefs[0];
            taken.push(boxFor(side, it));
            it.d.classList.add(`side-${side}`);
            it.d.style.left = `${it.p.px}px`;
            it.d.style.top = `${it.p.py}px`;
        }
    }

    renderLegend() {
        const regions = this.visibleRegions();
        this.legend.innerHTML = regions.map(r => `
            <button type="button" class="legend-item" data-region="${r.id}" aria-pressed="${this.focus === r.id}">
                <span class="swatch" style="--c:${r.color}"></span>
                <span class="li-name">${r.name}</span>
                <span class="li-state" data-legend-state></span>
            </button>`).join('');
        this.updateStats();
    }

    updateStats() {
        for (const r of this.visibleRegions()) {
            const R = state.regions[r.id];
            const st = this.regionStatus(r.id);
            const label = this.labels.querySelector(`.map-label[data-region="${r.id}"]`);
            if (label) {
                const stat = label.querySelector('[data-stat]');
                if (!R || !R.sent) {
                    stat.textContent = st.active ? 'Awaiting traffic' : 'No generator';
                } else {
                    const avg = R.latN ? `${Math.round(R.latSum / R.latN)} ms` : 'no 200s';
                    stat.innerHTML = `<span class="num">${R.sent.toLocaleString()}</span> req <span class="sep"></span><span class="num">${avg}</span>`;
                }
                label.classList.toggle('is-idle', !st.active);
            }
            const li = this.legend.querySelector(`.legend-item[data-region="${r.id}"] [data-legend-state]`);
            if (li) li.textContent = st.active ? `${regionRate(r.id).toFixed(1)}/s` : 'Idle';
        }
        this.placeLabels();     // stat text changes label widths
        this.syncMarkerState();
    }

    syncMarkerState() {
        if (!this.markerLayer) return;
        this.markerLayer.querySelectorAll('.marker').forEach(m => {
            const id = m.dataset.region;
            const st = this.regionStatus(id);
            m.classList.toggle('is-active', st.active);
            m.classList.toggle('is-dim', !!this.focus && this.focus !== id);
            m.style.display = id === 'unassigned' && !this.visibleRegions().includes(UNASSIGNED) ? 'none' : '';
        });
        this.labels.querySelectorAll('.map-label').forEach(l => l.classList.toggle('is-dim', !!this.focus && this.focus !== l.dataset.region));
    }

    syncRouteState() {
        this.routeLayer.querySelectorAll('.route').forEach(p => {
            const id = p.dataset.region;
            const st = this.regionStatus(id);
            p.classList.toggle('is-active', st.active);
            p.classList.toggle('is-dim', !!this.focus && this.focus !== id);
            p.classList.toggle('is-focus', this.focus === id);
            p.style.display = id === 'unassigned' && !this.visibleRegions().includes(UNASSIGNED) ? 'none' : '';
        });
        this.routeLayer.querySelectorAll('.bus').forEach(p => {
            p.classList.toggle('is-highlight', this.highlightPort === Number(p.dataset.port));
        });
        this.stage.dataset.focus = this.focus || '';
    }

    setFocus(id) {
        this.focus = this.focus === id ? null : id;
        this.legend.querySelectorAll('.legend-item').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.region === this.focus)));
        this.syncMarkerState();
        this.syncRouteState();
        this.stage.dispatchEvent(new CustomEvent('focuschange', { detail: this.focus }));
    }

    setHighlightPort(port) {
        this.highlightPort = port;
        this.syncRouteState();
    }

    setPaused(paused) {
        this.paused = paused;
        if (paused) { this.tokens.clear(); this.pulses = []; this.marks = []; this.clearCanvas(); }
    }

    showTooltip(id) {
        const p = this.points[id];
        if (!p) return;
        this.tooltipFor = id;
        const r = regionInfo(id);
        const R = state.regions[id] || {};
        const st = this.regionStatus(id);
        const fails = (R.non200 || 0) + (R.timeouts || 0) + (R.errors || 0);
        const last = R.lastAt ? `${Math.max(0, Math.round((Date.now() - R.lastAt) / 1000))} s ago` : 'None yet';
        const where = id === 'unassigned'
            ? 'Generators with no region recorded in this browser.'
            : `Simulated region. Its generator runs on this laptop; ${r.city} only places the marker.${p.behind ? ' Currently on the far side of the globe.' : ''}`;
        this.tooltip.innerHTML = `
            <div class="tt-head"><span class="swatch" style="--c:${r.color}"></span><b>${r.name}</b></div>
            <p class="tt-note">${where}</p>
            <dl>
                <div><dt>Generator</dt><dd class="mono">${st.gid || st.text}</dd></div>
                <div><dt>Requests sent</dt><dd class="num">${(R.sent || 0).toLocaleString()}</dd></div>
                <div><dt>HTTP 200</dt><dd class="num">${(R.ok || 0).toLocaleString()}</dd></div>
                <div><dt>Not served</dt><dd class="num">${fails.toLocaleString()}</dd></div>
                <div><dt>Avg response</dt><dd class="num">${R.latN ? `${Math.round(R.latSum / R.latN)} ms` : 'Not measured'}</dd></div>
                <div><dt>Last request</dt><dd>${last}</dd></div>
            </dl>
            <p class="tt-hint">${this.focus === id ? 'Click to clear focus' : 'Click to focus this region'}</p>`;
        this.tooltip.hidden = false;
        const pr = this.pane.getBoundingClientRect();
        const tw = this.tooltip.offsetWidth, th = this.tooltip.offsetHeight;
        let left = p.px + 16, top = p.py - th / 2;
        if (left + tw > pr.width - 8) left = p.px - tw - 16;
        top = Math.max(8, Math.min(pr.height - th - 8, top));
        this.tooltip.style.left = `${left}px`;
        this.tooltip.style.top = `${top}px`;
    }

    hideTooltip() {
        this.tooltip.hidden = true;
        this.tooltipFor = null;
    }

    bindEvents() {
        const regionFrom = e => e.target.closest('[data-region]')?.dataset.region;
        const onChrome = e => e.target.closest('.legend, .map-controls, .map-toolbar, .map-tooltip');

        // Drag to rotate. A press that barely moves is still a click.
        let drag = null;
        this.pane.addEventListener('pointerdown', e => {
            if (e.button !== 0 || onChrome(e) || !this.projection) return;
            drag = { x: e.clientX, y: e.clientY, rot: [...this.rotation], moved: false, id: e.pointerId };
        });
        this.pane.addEventListener('pointermove', e => {
            if (drag && drag.id === e.pointerId) {
                const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
                if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
                if (!drag.moved) {
                    drag.moved = true;
                    this.pane.setPointerCapture(e.pointerId);
                    this.pane.classList.add('is-dragging');
                    this.hideTooltip();
                }
                const k = 75 / (this.globe?.R || 250);
                this.rotateTo([drag.rot[0] + dx * k, drag.rot[1] - dy * k]);
                return;
            }
            const id = regionFrom(e);
            if (!id || e.target.closest('.legend-item')) { this.hideTooltip(); return; }
            this.showTooltip(id);
        });
        const endDrag = e => {
            if (!drag || drag.id !== e.pointerId) return;
            if (drag.moved) {
                this.pane.classList.remove('is-dragging');
                if (this.pane.hasPointerCapture(e.pointerId)) this.pane.releasePointerCapture(e.pointerId);
                this.suppressClick = true;
                setTimeout(() => { this.suppressClick = false; }, 0);
            }
            drag = null;
        };
        this.pane.addEventListener('pointerup', endDrag);
        this.pane.addEventListener('pointercancel', endDrag);
        this.pane.addEventListener('mouseleave', () => { if (!drag) this.hideTooltip(); });
        this.pane.addEventListener('click', e => {
            if (this.suppressClick) return;
            const id = regionFrom(e);
            if (id) this.setFocus(id);
        });

        this.geo.addEventListener('keydown', e => {
            const step = { ArrowLeft: [KEY_STEP, 0], ArrowRight: [-KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] }[e.key];
            if (step) { e.preventDefault(); this.rotateBy(...step); }
            else if (e.key === 'Home') { e.preventDefault(); this.resetView(); }
        });
        this.stage.querySelector('[data-globe-reset]')?.addEventListener('click', () => this.resetView());
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.focus) this.setFocus(this.focus); });

        on('request:sent', ({ cid, region, direct }) => this.onSent(cid, region, direct));
        on('request:forwarded', ({ cid, port }) => this.onForwarded(cid, port));
        on('request:done', ({ cid, region, outcome }) => this.onDone(cid, region, outcome));
        on('state', () => { this.renderLegendIfChanged(); this.updateStats(); this.syncRouteState(); });
        on('tick', () => this.updateStats());
    }

    renderLegendIfChanged() {
        const key = this.visibleRegions().map(r => r.id).join();
        if (key !== this.legendKey) {
            this.legendKey = key;
            this.renderLabels();
            this.renderLegend();
            this.drawMarkers();
            this.placeMarkers();
        }
    }

    /* ------------------------------------------------------------ *
     *  Request lifecycle -> legs
     * ------------------------------------------------------------ */

    onSent(cid, region, direct) {
        this.pingMarker(region);
        if (this.paused || !this.routes[region]) return;
        if (this.tokens.size > MAX_PULSES) return;
        const tok = { cid, region, direct, stage: 'toGateway', port: null, outcome: null, born: performance.now() };
        this.tokens.set(cid, tok);
        this.leg(this.routes[region], 1, regionInfo(region).color, LEG_MS.region, region, null, () => this.atGateway(tok));
    }

    onForwarded(cid, port) {
        this.flashBackend(port);
        const tok = cid && this.tokens.get(cid);
        if (!tok || tok.port != null) return;
        tok.port = port;
        if (tok.stage === 'atGateway') this.toBackend(tok);
    }

    onDone(cid, region, outcome) {
        const tok = this.tokens.get(cid);
        if (!tok) {
            if (outcome !== 'ok' && !this.paused) this.markAt(this.points[region], outcome);
            return;
        }
        tok.outcome = outcome;
        if (tok.stage === 'atGateway') this.back(tok, false);
        else if (tok.stage === 'atBackend') this.back(tok, true);
    }

    atGateway(tok) {
        if (!this.tokens.has(tok.cid)) return;
        tok.stage = 'atGateway';
        if (!tok.direct) this.flashGateway();
        if (tok.port != null) this.toBackend(tok);
        else if (tok.outcome) this.back(tok, false);
    }

    toBackend(tok) {
        const bus = this.buses[tok.port];
        if (!bus) { tok.stage = 'atBackend'; if (tok.outcome) this.back(tok, false); return; }
        tok.stage = 'toBackend';
        this.leg(bus, 1, regionInfo(tok.region).color, LEG_MS.bus, tok.region, tok.port, () => {
            if (!this.tokens.has(tok.cid)) return;
            tok.stage = 'atBackend';
            if (tok.outcome) this.back(tok, true);
        });
    }

    back(tok, fromBackend) {
        tok.stage = 'returning';
        const color = tok.outcome === 'ok' ? COLORS.ok : tok.outcome === 'non200' ? COLORS.non200 : COLORS.fail;
        const route = this.routes[tok.region];
        const bus = fromBackend && this.buses[tok.port];
        if (tok.outcome === 'timeout' || tok.outcome === 'error') {
            const at = bus ? this.anchor(`[data-anchor="backend"][data-port="${tok.port}"]`) : this.gatewayPoint;
            this.markAt(at, tok.outcome);
        }
        const home = () => {
            if (!route) { this.tokens.delete(tok.cid); return; }
            this.leg(route, -1, color, LEG_MS.region, tok.region, null, () => {
                const home = this.points[tok.region];
                if (home && !home.behind) this.ring(home, color);
                this.tokens.delete(tok.cid);
            }, 0.75);
        };
        if (bus) this.leg(bus, -1, color, LEG_MS.bus, tok.region, tok.port, home, 0.75);
        else home();
    }

    /* ------------------------------------------------------------ *
     *  DOM flashes (these run even when animations are paused:
     *  they are state, not decoration)
     * ------------------------------------------------------------ */

    flashGateway() {
        const m = this.markerLayer?.querySelector('.gw-marker');
        if (m) { m.classList.remove('is-hit'); void m.getBoundingClientRect(); m.classList.add('is-hit'); }
        const g = this.stage.querySelector('[data-gateway]');
        if (!g) return;
        g.classList.remove('is-hit');
        void g.offsetWidth;
        g.classList.add('is-hit');
    }

    flashBackend(port) {
        const row = this.stage.querySelector(`[data-backend-row="${port}"]`);
        if (!row) return;
        row.classList.remove('is-hit');
        void row.offsetWidth;
        row.classList.add('is-hit');
    }

    pingMarker(region) {
        const m = this.markerLayer?.querySelector(`.marker[data-region="${region}"]`);
        if (!m) return;
        m.classList.remove('is-hit');
        void m.getBoundingClientRect();
        m.classList.add('is-hit');
    }

    /* ------------------------------------------------------------ *
     *  Canvas primitives
     * ------------------------------------------------------------ */

    // `track` is a route or bus object; its lut is read every frame, so a
    // pulse in flight follows the route while the globe is being turned.
    leg(track, dir, color, dur, region, port, done, alpha = 1) {
        if (this.pulses.length >= MAX_PULSES) { done && done(); return; }
        this.pulses.push({ track, dir, color, dur, region, port, done, alpha, t: 0 });
        this.start();
    }

    ring(p, color) {
        if (!p || this.paused) return;
        this.marks.push({ kind: 'ring', x: p.x, y: p.y, color, life: 0, dur: 700 });
        this.start();
    }

    markAt(p, outcome) {
        if (!p || this.paused) return;
        this.marks.push({ kind: 'cross', x: p.x, y: p.y, color: outcome === 'non200' ? COLORS.non200 : COLORS.fail, life: 0, dur: 1400 });
        this.start();
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.last = performance.now();
        requestAnimationFrame(t => this.frame(t));
    }

    clearCanvas() {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    frame(now) {
        const dt = Math.min(64, now - this.last);
        this.last = now;

        const finished = [];
        this.pulses = this.pulses.filter(p => {
            p.t += dt / p.dur;
            if (p.t >= 1) { finished.push(p); return false; }
            return true;
        });
        finished.forEach(p => p.done && p.done());
        this.marks = this.marks.filter(m => (m.life += dt) < m.dur);
        for (const [cid, tok] of this.tokens) if (now - tok.born > 12000) this.tokens.delete(cid);

        this.draw();
        if (this.pulses.length || this.marks.length) {
            requestAnimationFrame(t => this.frame(t));
        } else {
            this.running = false;
            this.clearCanvas();
        }
    }

    draw() {
        const { ctx } = this;
        this.clearCanvas();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.lineCap = 'round';

        for (const p of this.pulses) {
            if (this.focus && p.region !== this.focus) continue;
            if (this.highlightPort != null && p.port != null && p.port !== this.highlightPort) continue;
            const lut = p.track.lut;
            if (!lut) continue;
            const t = ease(p.t);
            const head = p.dir > 0 ? t : 1 - t;
            const tail = 0.09;
            const from = p.dir > 0 ? Math.max(0, head - tail) : Math.min(1, head + tail);
            const SEG = 6;
            let prev = at(lut, from);
            ctx.lineWidth = 1.5;
            for (let i = 1; i <= SEG; i++) {
                const q = at(lut, from + (head - from) * (i / SEG));
                if (prev.vis && q.vis) {
                    ctx.strokeStyle = rgba(p.color, p.alpha * (i / SEG));
                    ctx.beginPath();
                    ctx.moveTo(prev.x, prev.y);
                    ctx.lineTo(q.x, q.y);
                    ctx.stroke();
                }
                prev = q;
            }
            if (!prev.vis) continue;
            ctx.fillStyle = rgba(p.color, p.alpha);
            ctx.beginPath();
            ctx.arc(prev.x, prev.y, 2, 0, Math.PI * 2);
            ctx.fill();
        }

        for (const m of this.marks) {
            const k = m.life / m.dur;
            ctx.strokeStyle = rgba(m.color, 1 - k);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            if (m.kind === 'ring') {
                ctx.arc(m.x, m.y, 4 + k * 10, 0, Math.PI * 2);
            } else {
                const s = 5;
                ctx.moveTo(m.x - s, m.y - s); ctx.lineTo(m.x + s, m.y + s);
                ctx.moveTo(m.x + s, m.y - s); ctx.lineTo(m.x - s, m.y + s);
            }
            ctx.stroke();
        }
    }
}

/* ---------------- path sampling ---------------- */

function sample(path, n = 72) {
    const len = path.getTotalLength();
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const p = path.getPointAtLength((len * i) / n);
        pts.push({ x: p.x, y: p.y });
    }
    return pts;
}

// Points along a cubic Bezier, computed directly so routes can be rebuilt
// on every rotation frame without asking the DOM for path lengths.
function cubicLut([p0, p1, p2, p3], n = 72) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        pts.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y });
    }
    return pts;
}

function at(lut, t) {
    const f = Math.max(0, Math.min(1, t)) * (lut.length - 1);
    const i = Math.floor(f), k = f - i;
    const a = lut[i], b = lut[Math.min(lut.length - 1, i + 1)];
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, vis: a.vis !== false && b.vis !== false };
}

// SVG path through the visible runs of a lut.
function lutPath(lut) {
    let d = '', open = false;
    for (const q of lut) {
        if (q.vis === false) { open = false; continue; }
        d += `${open ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
        open = true;
    }
    return d;
}

const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
