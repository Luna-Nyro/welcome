// Welcome — sign-in transition for Cinnamon.
//
// On login (replacing Cinnamon's black startup fade) and on unlock, the wallpaper's own gradient
// comes alive: its colours swirl and drift through a GLSL flow field, a greeting rises in the
// middle, then the desktop opens up from the centre through an organic, glowing edge while the
// colours settle back to exactly the still wallpaper underneath.
//
// Unlock without a flash: while cinnamon-screensaver is active its override-redirect window lives
// in global.top_window_group. We park a plain copy of the wallpaper directly *under* that window,
// so when the screensaver unmaps there is never a frame of bare desktop; the animation then starts
// on the screensaver's ActiveChanged(false) signal.

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const St = imports.gi.St;
const Main = imports.ui.main;
const Settings = imports.ui.settings;
const ScreenSaver = imports.misc.screenSaver;

const UUID = 'welcome@luna-nyro.github.io';
const LOCK_DIM = 0.3;   // cinnamon-screensaver paints rgba(0,0,0,0.7) over the wallpaper

// ---------------------------------------------------------------------------------------------
// Shader
// ---------------------------------------------------------------------------------------------
const FRAG = `
uniform sampler2D tex;
uniform float t;       // seconds since start
uniform float amp;     // flow strength 0..1 (0 = untouched wallpaper)
uniform float reveal;  // 0 = covered, 1 = desktop fully revealed
uniform float fade;    // brightness from black (login) 0..1
uniform float aspect;  // width / height
// Per-run variation (picked at random each time; the end state is always the plain wallpaper)
uniform float ph1, ph2, ph3, ph4;   // phase offsets of the flow field
uniform float fq;                   // flow frequency scale
uniform float frot;                 // rotation of the flow field
uniform float swirl;                // signed swirl strength (direction + amount)
uniform float hueAmt;               // signed hue drift
uniform float sweepA;               // light-sweep direction (radians)
uniform float ox, oy;               // reveal origin offset from the centre
uniform float lobeA, lobeB, lobeC;  // reveal-edge wobble lobes
uniform float rimR, rimG, rimB;     // rim tint

// Fold out-of-range coords back in without a derivative jump (mod() causes mip seams).
vec2 mirror(vec2 u) { u = abs(u); return 1.0 - abs(1.0 - u); }

vec3 hueShift(vec3 c, float a) {
    // rotate chroma in YIQ space
    const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
    const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
    vec3 yiq = toYIQ * c;
    float ca = cos(a), sa = sin(a);
    yiq.yz = mat2(ca, sa, -sa, ca) * yiq.yz;
    return toRGB * yiq;
}

void main() {
    vec2 uv = cogl_tex_coord_in[0].st;
    vec2 p = uv - 0.5;
    p.x *= aspect;
    float r = length(p);

    // Swirl around the centre, strongest in the middle.
    float sw = amp * swirl * (1.0 - smoothstep(0.0, 0.95, r)) * sin(t * 1.25 + 0.6 + ph4 * 0.3);
    float cs = cos(sw), sn = sin(sw);
    vec2 q = mat2(cs, sn, -sn, cs) * p;

    // Two-octave flowing displacement in a randomly rotated frame: colour clouds drift past each other.
    float cr = cos(frot), sr = sin(frot);
    mat2 R = mat2(cr, sr, -sr, cr);
    vec2 f = (R * q) * fq;
    vec2 w1 = vec2(sin(f.y * 3.1 + t * 1.30 + ph1) + sin(f.x * 2.3 - t * 0.90 + ph2),
                   cos(f.x * 2.7 - t * 1.10 + ph3) + sin(f.y * 1.9 + t * 1.50 + ph4));
    vec2 w2 = vec2(sin((f.y + w1.y * 0.18) * 4.3 + t * 1.75 + ph2),
                   cos((f.x + w1.x * 0.18) * 3.7 - t * 1.40 + ph1));
    q += (R * (w1 * 0.065 + w2 * 0.035)) * amp;

    // Gentle breathing zoom that settles to 1.0.
    q *= 1.0 - 0.06 * amp;

    q.x /= aspect;
    vec4 c = texture2D(tex, clamp(mirror(q + 0.5), 0.004, 0.996));

    // Colour drift: hue wanders across the screen and a soft light sweeps through.
    float hue = amp * hueAmt * sin(t * 1.6 + uv.x * 3.2 - uv.y * 2.1 + ph3);
    c.rgb = hueShift(c.rgb, hue);
    vec2 sd = vec2(cos(sweepA), sin(sweepA));
    float sweep = exp(-pow(dot(uv - 0.5, sd) + 0.75 - (t * 0.55), 2.0) * 18.0);
    c.rgb += vec3(0.10, 0.12, 0.16) * sweep * amp;
    // A touch of extra saturation while alive.
    float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    c.rgb = mix(vec3(l), c.rgb, 1.0 + 0.35 * amp);

    // Reveal: an organic opening grows from the centre with a luminous rim.
    vec2 o = vec2(ox * aspect, oy);
    vec2 pr = p - o;
    r = length(pr);
    float ang = atan(pr.y, pr.x);
    float wob = 0.035 * sin(ang * lobeA + t * 2.3 + ph1) + 0.022 * sin(ang * lobeB - t * 3.1 + ph2) + 0.015 * sin(ang * lobeC + t * 1.2 + ph3);
    float maxR = 0.5 * sqrt(aspect * aspect + 1.0) + length(o) + 0.12;
    float feather = 0.16;
    float edge = reveal * (maxR + feather + 0.08);
    float d = r + wob * (0.4 + reveal) * smoothstep(0.02, 0.25, r);
    float a = smoothstep(edge - feather, edge, d);
    float rim = (1.0 - abs(d - (edge - feather * 0.45)) / (feather * 0.6));
    rim = clamp(rim, 0.0, 1.0) * smoothstep(0.0, 0.08, reveal) * (1.0 - reveal * 0.6);

    vec3 col = clamp(c.rgb, 0.0, 1.0) * fade + vec3(rimR, rimG, rimB) * rim * 0.32;
    float alpha = clamp(a + rim * 0.25, 0.0, 1.0);
    cogl_color_out = vec4(col * alpha, alpha);
}`;

function _float(v) {
    let g = new GObject.Value();
    g.init(GObject.TYPE_FLOAT);
    g.set_float(v);
    return g;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------
function _wallpaperUri() {
    try {
        let s = new Gio.Settings({ schema_id: 'org.cinnamon.desktop.background' });
        let uri = s.get_string('picture-uri');
        let opts = s.get_string('picture-options');
        if (uri && opts !== 'none') return uri;
    } catch (e) {}
    return null;
}

function _firstName() {
    let real = GLib.get_real_name() || '';
    // GECOS is sometimes junk (numbers, "Unknown"); fall back to the login name.
    let name = (/[A-Za-z]/.test(real) && real !== 'Unknown') ? real.split(/\s+/)[0] : GLib.get_user_name();
    return name.charAt(0).toUpperCase() + name.slice(1);
}

function _greeting(kind) {
    let h = new Date().getHours();
    let part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    return kind === 'unlock' ? `Welcome back, ${_firstName()}` : `${part}, ${_firstName()}`;
}

// A fresh look every time: random phases, flow orientation, swirl direction, sweep angle,
// reveal origin and edge shape. Integer lobe counts keep the reveal edge seamless around the circle.
function _variation() {
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const sign = () => (Math.random() < 0.5 ? -1 : 1);
    const lobes = [3, 4, 5, 6, 7, 8, 9, 11];
    let a = pick([3, 4, 5, 6]), b, c;   // the strongest wobble stays soft
    do { b = pick(lobes); } while (b === a);
    do { c = pick(lobes); } while (c === a || c === b);
    const rims = [[0.85, 0.93, 1.0], [0.80, 0.97, 0.98], [0.90, 0.88, 1.0], [0.95, 0.96, 0.92]];
    const rim = pick(rims);
    let originAng = rnd(0, Math.PI * 2), originDist = rnd(0, 0.09);
    return {
        ph1: rnd(0, 6.283), ph2: rnd(0, 6.283), ph3: rnd(0, 6.283), ph4: rnd(0, 6.283),
        fq: rnd(0.8, 1.25), frot: rnd(0, 6.283),
        swirl: sign() * rnd(0.8, 1.35),
        hueAmt: sign() * rnd(0.16, 0.3),
        sweepA: rnd(0, 6.283),
        ox: Math.cos(originAng) * originDist, oy: Math.sin(originAng) * originDist,
        lobeA: a, lobeB: b, lobeC: c,
        rimR: rim[0], rimG: rim[1], rimB: rim[2],
        tempo: rnd(0.93, 1.08),   // small timing jitter
    };
}

const ease = {
    outCubic: x => 1 - Math.pow(1 - x, 3),
    inOutSine: x => -(Math.cos(Math.PI * x) - 1) / 2,
    inOutCubic: x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
};
const clamp01 = x => Math.max(0, Math.min(1, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));

// ---------------------------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------------------------
class Overlay {
    constructor(opts) {
        this.opts = opts;
        this.kind = null;
        this.vary = _variation();
        this.timeline = null;
        this.effects = [];
        this.label = null;
        this.sub = null;

        this.actor = new Clutter.Actor({ name: 'welcome-overlay', reactive: false,
                                         x: 0, y: 0, width: global.screen_width, height: global.screen_height });
        let uri = _wallpaperUri();
        let primary = Main.layoutManager.primaryMonitor;
        for (let m of Main.layoutManager.monitors) {
            let style = 'background-color: #0b1a2a;';
            if (uri) style += ` background-image: url("${uri}"); background-size: cover; background-position: center;`;
            let bg = new St.Widget({ style, x: m.x, y: m.y, width: m.width, height: m.height });
            this.actor.add_child(bg);
            this.effects.push({ widget: bg, aspect: m.width / m.height, effect: null });
            if (m === primary) this.primaryRect = m;
        }
        if (!this.primaryRect) this.primaryRect = Main.layoutManager.monitors[0];
    }

    // Sits at the top of uiGroup: above windows, panels and Cinnamon's startup shroud, but below
    // global.top_window_group (a later stage child), which holds the screensaver's window. Never
    // put it inside top_window_group: Muffin restacks that group to X stacking order and would
    // push us above the lock screen.
    place() {
        let parent = Main.uiGroup;
        if (this.actor.get_parent() !== parent) {
            if (this.actor.get_parent()) this.actor.get_parent().remove_child(this.actor);
            parent.add_child(this.actor);
        }
        this.raise();
    }

    raise() {
        let parent = this.actor && this.actor.get_parent();
        if (parent && parent.get_last_child() !== this.actor) parent.set_child_above_sibling(this.actor, null);
    }

    // Attach shaders and show the still first frame (at `fade` brightness).
    prime(fade) {
        if (!this.primed) this._attachShaders();
        this.primed = true;
        this._setUniforms({ t: 0, amp: 0, reveal: 0, fade });
    }

    _attachShaders() {
        for (let e of this.effects) {
            let fx = new Clutter.ShaderEffect({ shader_type: Clutter.ShaderType.FRAGMENT_SHADER });
            fx.set_shader_source(FRAG);
            fx.set_uniform_value('tex', 0);
            fx.set_uniform_value('aspect', _float(e.aspect));
            for (let k in this.vary) if (k !== 'tempo') fx.set_uniform_value(k, _float(this.vary[k]));
            e.effect = fx;
            e.widget.add_effect_with_name('welcome-flow', fx);
        }
    }

    _setUniforms(u) {
        for (let e of this.effects) {
            if (!e.effect) continue;
            for (let k in u) e.effect.set_uniform_value(k, _float(u[k]));
        }
    }

    _buildText(kind) {
        let scale = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
        let m = this.primaryRect;
        this.textBox = new St.BoxLayout({ vertical: true, x_align: Clutter.ActorAlign.CENTER, reactive: false });
        this.label = new St.Label({ text: _greeting(kind),
            style: `font-family: Google Sans Flex, Ubuntu, sans-serif; font-size: ${Math.round(m.height / 28)}px;` +
                   ' font-weight: 400; color: rgba(255,255,255,0.97); text-align: center;' +
                   ' text-shadow: 0 2px 18px rgba(0,30,60,0.55);' });
        this.label.clutter_text.set_line_alignment(1 /* Pango.Alignment.CENTER */);
        let now = new Date();
        let time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        let date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
        this.sub = new St.Label({ text: `${date}  ·  ${time}`,
            style: `font-family: Google Sans Flex, Ubuntu, sans-serif; font-size: ${Math.round(m.height / 80)}px;` +
                   ' color: rgba(255,255,255,0.82); text-align: center; padding-top: 10px;' +
                   ' text-shadow: 0 1px 10px rgba(0,30,60,0.55);' });
        this.textBox.add_child(this.label);
        this.textBox.add_child(this.sub);
        this.textBox.opacity = 0;
        this.actor.add_child(this.textBox);
        // centre on the primary monitor once sized
        let [, nw] = this.textBox.get_preferred_width(-1);
        let [, nh] = this.textBox.get_preferred_height(nw);
        this.textBox.set_position(Math.round(m.x + (m.width - nw) / 2), Math.round(m.y + (m.height - nh) / 2));
        this.textBox.set_pivot_point(0.5, 0.5);
        this.textY = this.textBox.y;
    }

    // kind: 'login' | 'unlock'. onRevealStart fires when the desktop starts opening.
    run(kind, onRevealStart, onDone) {
        this.kind = kind;
        // The lock screen draws the wallpaper under 70% black: unlock starts exactly there.
        const fadeFrom = kind === 'login' ? 0 : LOCK_DIM;
        this.prime(fadeFrom);
        if (this.opts.greeting) this._buildText(kind);

        let speed = Math.max(0.5, Math.min(2, this.opts.speed || 1)) * this.vary.tempo;
        // Phase plan (seconds, before speed scaling)
        const P = kind === 'login'
            ? { fadeIn: [0, 0.75], textIn: [0.25, 1.0], textOut: [1.65, 2.25], reveal: [1.55, 2.85], total: 2.85 }
            : { fadeIn: [0, 0.9],  textIn: [0.05, 0.6], textOut: [1.0, 1.5],   reveal: [0.85, 2.0],  total: 2.0 };
        for (let k in P) P[k] = Array.isArray(P[k]) ? P[k].map(v => v / speed) : P[k] / speed;

        let revealStarted = false;
        let tick = (ms) => {
            let t = ms / 1000;
            this.raise();   // stay above chrome added mid-animation (e.g. panels re-showing)
            // Flow: surges in fast, holds, then calms to exactly zero by the end of the reveal.
            let rise = ease.outCubic(seg(t, 0, kind === 'login' ? 0.6 / speed : 0.35 / speed));
            let calm = 1 - ease.inOutSine(seg(t, P.reveal[0] - 0.4 / speed, P.total));
            let amp = rise * calm * this.opts.intensity;
            let reveal = ease.inOutCubic(seg(t, P.reveal[0], P.reveal[1]));
            let fade = fadeFrom + (1 - fadeFrom) * ease.outCubic(seg(t, P.fadeIn[0], P.fadeIn[1]));
            this._setUniforms({ t: t * speed + 0.0, amp, reveal, fade });

            if (this.textBox) {
                let tin = ease.outCubic(seg(t, P.textIn[0], P.textIn[1]));
                let tout = ease.inOutSine(seg(t, P.textOut[0], P.textOut[1]));
                this.textBox.opacity = Math.round(255 * tin * (1 - tout));
                this.textBox.translation_y = Math.round((1 - tin) * 26 - tout * 10);
                let s = 0.96 + 0.04 * tin + 0.05 * tout;
                this.textBox.set_scale(s, s);
            }
            if (!revealStarted && t >= P.reveal[0]) {
                revealStarted = true;
                if (onRevealStart) onRevealStart();
            }
        };

        tick(0);
        if (this.opts.freezeAt != null) {   // debug: hold one frame for inspection
            tick(this.opts.freezeAt * 1000);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => { this.destroy(); if (onDone) onDone(); return GLib.SOURCE_REMOVE; });
            return;
        }
        this.timeline = new Clutter.Timeline({ duration: Math.round(P.total * 1000) });
        this.timeline.connect('new-frame', (tl, ms) => tick(ms));
        this.timeline.connect('completed', () => {
            tick(P.total * 1000);
            if (!revealStarted && onRevealStart) onRevealStart();
            this.destroy();
            if (onDone) onDone();
        });
        this.timeline.start();
    }

    destroy() {
        if (this.timeline) { this.timeline.stop(); this.timeline = null; }
        if (this.actor) { this.actor.destroy(); this.actor = null; }
        this.effects = [];
    }
}

// ---------------------------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------------------------
class Welcome {
    constructor(meta) {
        this.meta = meta;
        this.opts = { onLogin: true, onUnlock: true, greeting: true, speed: 1.0, intensity: 1.0 };
        this.overlay = null;
        this.parked = null;      // overlay parked under the screensaver window
        this.ssActor = null;
        this.signals = [];
        this.proxy = null;
        this.origRun = null;
    }

    _loadSettings() {
        try {
            this.settings = new Settings.ExtensionSettings(this.opts, UUID);
            this.settings.bind('on-login', 'onLogin');
            this.settings.bind('on-unlock', 'onUnlock');
            this.settings.bind('greeting', 'greeting');
            this.settings.bind('speed', 'speed');
            this.settings.bind('intensity', 'intensity');
            this.opts.preview = () => this.preview('unlock');
            this.opts.previewLogin = () => this.preview('login');
        } catch (e) {
            global.logError(`${UUID}: settings unavailable: ${e}`);
        }
    }

    enable() {
        this._loadSettings();
        this._hookStartup();
        this._watchScreensaver();
    }

    disable() {
        if (this.origRun && Main.layoutManager.startupAnimation) Main.layoutManager.startupAnimation.run = this.origRun;
        this.origRun = null;
        for (let [obj, id] of this.signals) { try { obj.disconnect(id); } catch (e) {} }
        this.signals = [];
        if (this.proxyId && this.proxy) { this.proxy.disconnectSignal(this.proxyId); }
        this.proxy = null;
        this._unpark();
        if (this.overlay) { this.overlay.destroy(); this.overlay = null; }
        if (this.settings) { try { this.settings.finalize(); } catch (e) {} this.settings = null; }
    }

    _animationsOk() {
        return Main.animations_enabled !== false;
    }

    // --- login ---------------------------------------------------------------------------------
    _hookStartup() {
        let anim = Main.layoutManager.startupAnimation;
        if (Main.runState === Main.RunState.RUNNING || !anim || anim.failed) return;
        this.origRun = anim.run;
        let self = this;
        anim.run = function () {
            if (!self.opts.onLogin) return self.origRun.call(this);
            try {
                if (this.logo) this.logo.hide();
                let ov = new Overlay(self.opts);
                self.overlay = ov;
                ov.place();
                ov.run('login', () => {
                    // Desktop starts opening: drop Cinnamon's black shroud (it's under us) and
                    // hand the session back (cursor, input, struts) while we finish the reveal.
                    this._finished();
                }, () => { self.overlay = null; });
            } catch (e) {
                global.logError(`${UUID}: login animation failed: ${e}`);
                if (self.overlay) { self.overlay.destroy(); self.overlay = null; }
                self.origRun.call(this);
            }
        };
    }

    // --- unlock --------------------------------------------------------------------------------
    _watchScreensaver() {
        this.signals.push([global.display, global.display.connect('window-created', (d, w) => {
            if (!this._isScreensaver(w)) return;
            // The actor appears a moment later.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { this._parkUnder(w); return GLib.SOURCE_REMOVE; });
        })]);

        this.proxy = new ScreenSaver.ScreenSaverProxy();
        this.proxyId = this.proxy.connectSignal('ActiveChanged', (proxy, sender, [active]) => {
            if (active) { this._parkExisting(); return; }
            this._onUnlocked();
        });
    }

    _isScreensaver(w) {
        try { return w.is_override_redirect() && w.get_title() === 'cinnamon-screensaver-window'; } catch (e) { return false; }
    }

    _parkExisting() {
        for (let a of global.get_window_actors())
            if (this._isScreensaver(a.meta_window)) this._parkUnder(a.meta_window);
    }

    _parkUnder(win) {
        if (!this.opts.onUnlock || !this._animationsOk()) return;
        let actor = win.get_compositor_private();
        if (!actor || actor === this.ssActor) return;
        if (!this.parked) { this.parked = new Overlay(this.opts); this.parked.prime(LOCK_DIM); }
        this.parked.place();
        this.ssActor = actor;
        // Safety net: if the lock window goes away and no ActiveChanged(false) follows (crash,
        // restart), never leave the overlay covering the desktop.
        actor.connect('destroy', () => {
            if (this.ssActor === actor) this.ssActor = null;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
                if (this.parked && !this.ssActor && !this._screensaverMapped()) this._onUnlocked();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _screensaverMapped() {
        return global.get_window_actors().some(a => this._isScreensaver(a.meta_window));
    }

    _unpark() {
        if (this.parked) { this.parked.destroy(); this.parked = null; }
        this.ssActor = null;
    }

    _onUnlocked() {
        let ov = this.parked;
        this.parked = null;
        this.ssActor = null;
        if (!ov) return;
        if (!this.opts.onUnlock || !this._animationsOk()) { ov.destroy(); return; }
        if (this.overlay) this.overlay.destroy();
        this.overlay = ov;
        ov.place();
        ov.run('unlock', null, () => { if (this.overlay === ov) this.overlay = null; });
    }

    preview(kind) {
        if (this.overlay) { this.overlay.destroy(); this.overlay = null; }
        let ov = new Overlay(this.opts);
        this.overlay = ov;
        ov.place();
        ov.run(kind, null, () => { if (this.overlay === ov) this.overlay = null; });
    }
}

let _welcome = null;

function init(meta) {}

function enable() {
    _welcome = new Welcome();
    _welcome.enable();
    global.__welcomeTransition = _welcome;   // for previews: global.__welcomeTransition.preview('login')
}

function disable() {
    if (_welcome) { _welcome.disable(); _welcome = null; }
    global.__welcomeTransition = null;
}
