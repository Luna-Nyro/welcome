// Welcome — sign-in transition for Cinnamon.
//
// On login (replacing Cinnamon's black startup fade) and on unlock, the wallpaper's own gradient
// comes alive: its colours swirl and drift through a GLSL flow field, a greeting rises in the
// middle, then the desktop opens up from the centre through an organic, glowing edge while the
// colours settle back to exactly the still wallpaper underneath.
//
// Lock screen loop: while the password prompt is up, the wallpaper behind the lock screen flows
// in a seamless loop. cinnamon-screensaver is a separate process, so this happens in the
// compositor: a shader on the screensaver's window compares each pixel with a reference copy of
// the dimmed wallpaper. Pixels that are just (shaded) wallpaper are replaced by the animated
// wallpaper at the same shading; everything else (clock, dialog, text, avatar) is left untouched.
// The shader only ever reads the lock window and the wallpaper, never the desktop.
//
// Unlock: a copy of the wallpaper is parked under the lock window (top of uiGroup; the lock window
// lives in global.top_window_group, a later stage child). When the lock window goes away the
// parked copy takes over the loop in the same frame, then on ActiveChanged(false) the same motion
// carries on, faster and stronger, into the reveal.

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Meta = imports.gi.Meta;
const St = imports.gi.St;
const Main = imports.ui.main;
const Settings = imports.ui.settings;
const ScreenSaver = imports.misc.screenSaver;

const UUID = 'welcome@luna-nyro.github.io';
const LOCK_DIM = 0.3;          // cinnamon-screensaver paints rgba(0,0,0,0.7) over the wallpaper
const PROMPT_TIMEOUT = 30000;  // cinnamon-screensaver hides its unlock dialog after 30 s idle
const LOOP_SECONDS = 24;       // one full cycle of the flow field at loop speed 1
const MAX_MONITORS = 4;

// ---------------------------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------------------------
// Every time-dependent term runs at a whole multiple of W = 2π / LOOP_SECONDS, so the flow is
// exactly periodic: a loop never jumps, and speeding up only advances the same clock faster.
const FLOW_COMMON = `
uniform sampler2D tex;
uniform float t;       // flow clock (seconds at speed 1)
uniform float amp;     // flow strength (0 = untouched wallpaper)
// Per-run variation (the end state is always the plain wallpaper)
uniform float ph1, ph2, ph3, ph4;   // phase offsets of the flow field
uniform float fq;                   // flow frequency scale
uniform float frot;                 // rotation of the flow field
uniform float swirl;                // signed swirl strength (direction + amount)
uniform float hueAmt;               // signed hue drift
uniform float sweepA;               // light-sweep direction (radians)
uniform float pattern, hueStrength, sweepStrength;

#define W ${(2 * Math.PI / LOOP_SECONDS).toFixed(7)}

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

// The animated wallpaper at monitor-local uv (0..1). rect = where this monitor's wallpaper sits
// inside FLOW_SRC (0,0,1,1 for a per-monitor texture).
vec3 flowColor(vec2 uv, float aspect, vec4 rect) {
    vec2 p = uv - 0.5;
    p.x *= aspect;
    float r = length(p);

    // Swirl around the centre, strongest in the middle.
    float sw = amp * swirl * (1.0 - step(0.5, pattern)) * (1.0 - smoothstep(0.0, 0.95, r)) * sin(t * 5.0 * W + 0.6 + ph4 * 0.3);
    float cs = cos(sw), sn = sin(sw);
    vec2 q = mat2(cs, sn, -sn, cs) * p;

    // Two-octave flowing displacement in a rotated frame: colour clouds drift past each other.
    float cr = cos(frot), sr = sin(frot);
    mat2 R = mat2(cr, sr, -sr, cr);
    vec2 f = (R * q) * fq;
    vec2 w1 = vec2(sin(f.y * 3.1 + t * 5.0 * W + ph1) + sin(f.x * 2.3 - t * 3.0 * W + ph2),
                   cos(f.x * 2.7 - t * 4.0 * W + ph3) + sin(f.y * 1.9 + t * 6.0 * W + ph4));
    vec2 w2 = vec2(sin((f.y + w1.y * 0.18) * 4.3 + t * 7.0 * W + ph2),
                   cos((f.x + w1.x * 0.18) * 3.7 - t * 5.0 * W + ph1));
    vec2 flow = R * (w1 * 0.065 + w2 * 0.035);
    if (pattern > 0.5 && pattern < 1.5)
        flow = vec2(sin(f.y * 8.0 + t * 9.0 * W + ph1), cos(f.x * 6.0 - t * 7.0 * W + ph2)) * 0.075;
    else if (pattern > 1.5 && pattern < 2.5)
        flow = vec2(sin(f.y * 5.0 + t * 3.0 * W + sin(f.x * 3.0)), cos(f.x * 2.5 + t * 4.0 * W + ph2)) * 0.10;
    else if (pattern > 2.5)
        flow = normalize(q + vec2(0.001)) * sin(length(q) * 22.0 - t * 15.0 * W + ph1) * 0.07;
    q += flow * amp;

    // Gentle breathing zoom that settles to 1.0.
    q *= 1.0 - 0.06 * amp;

    q.x /= aspect;
    vec2 s = clamp(mirror(q + 0.5), 0.004, 0.996);
    vec3 c = texture2D(FLOW_SRC, rect.xy + s * rect.zw).rgb;

    // Colour drift: hue wanders across the screen and a soft light sweeps back and forth.
    float hue = amp * hueStrength * hueAmt * sin(t * 6.0 * W + uv.x * 3.2 - uv.y * 2.1 + ph3);
    c = hueShift(c, hue);
    vec2 sd = vec2(cos(sweepA), sin(sweepA));
    float sweep = exp(-pow(dot(uv - 0.5, sd) + 0.8 * cos(t * 3.0 * W), 2.0) * 18.0);
    c += vec3(0.10, 0.12, 0.16) * sweep * amp * sweepStrength;
    // A touch of extra saturation while alive.
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    return mix(vec3(l), c, 1.0 + 0.35 * amp);
}
`;

// Full-screen overlay (one per monitor): animated wallpaper + reveal.
const FRAG_OVERLAY = `
#define FLOW_SRC tex
${FLOW_COMMON}
uniform float reveal;  // 0 = covered, 1 = desktop fully revealed
uniform float fade;    // brightness 0..1 (login from black, unlock from the lock-screen dim)
uniform float aspect;  // width / height
uniform float ox, oy;               // reveal origin offset from the centre
uniform float lobeA, lobeB, lobeC;  // reveal-edge wobble lobes
uniform float rimR, rimG, rimB;     // rim tint
uniform float revealPattern, edgeSoftness, glowStrength;

void main() {
    vec2 uv = cogl_tex_coord_in[0].st;
    vec3 c = flowColor(uv, aspect, vec4(0.0, 0.0, 1.0, 1.0));

    // Reveal: an organic opening grows from the centre with a luminous rim.
    vec2 p = uv - 0.5;
    p.x *= aspect;
    vec2 o = vec2(ox * aspect, oy);
    vec2 pr = p - o;
    float r = length(pr);
    float ang = atan(pr.y, pr.x);
    float wob = 0.035 * sin(ang * lobeA + t * 9.0 * W + ph1) + 0.022 * sin(ang * lobeB - t * 12.0 * W + ph2) + 0.015 * sin(ang * lobeC + t * 5.0 * W + ph3);
    float maxR = 0.5 * sqrt(aspect * aspect + 1.0) + length(o) + 0.12;
    float feather = 0.16 * edgeSoftness;
    float edge = reveal * (maxR + feather + 0.08);
    float d = r + wob * (0.4 + reveal) * smoothstep(0.02, 0.25, r);
    if (revealPattern > 0.5 && revealPattern < 1.5) d = (pr.x + aspect * 0.5) * (maxR / aspect);
    else if (revealPattern > 1.5 && revealPattern < 2.5) d = (pr.y + 0.5) * maxR;
    else if (revealPattern > 2.5) d = maxR * (fract(sin(dot(floor(uv * 120.0), vec2(12.9898, 78.233))) * 43758.5453));
    float a = smoothstep(edge - feather, edge, d);
    float rim = (1.0 - abs(d - (edge - feather * 0.45)) / (feather * 0.6));
    rim = clamp(rim, 0.0, 1.0) * smoothstep(0.0, 0.08, reveal) * (1.0 - reveal * 0.6);

    vec3 col = clamp(c, 0.0, 1.0) * fade + vec3(rimR, rimG, rimB) * rim * 0.32 * glowStrength;
    float alpha = clamp(a + rim * 0.25 * glowStrength, 0.0, 1.0);
    cogl_color_out = vec4(col * alpha, alpha);
}`;

// Lock window: replace only the shaded-wallpaper pixels. Layer 1 (`wall`) is a stage-sized copy of
// the undimmed wallpaper, laid out exactly like the screensaver's monitors. Positions come from
// gl_FragCoord (stage pixels): the lock window's own texture can be scaled and padded, so its
// texture coordinates don't line up with the stage.
const FRAG_LOCK = `
#define FLOW_SRC wall
uniform sampler2D wall;
${FLOW_COMMON}
uniform float stageW, stageH;       // stage size in pixels
uniform float refX, refY, refW, refH; // where the reference texture sits on the stage (px)
uniform float nmon, lockDim, debugMask;
uniform float m0x, m0y, m0w, m0h, m1x, m1y, m1w, m1h, m2x, m2y, m2w, m2h, m3x, m3y, m3w, m3h;

bool inside(vec2 P, vec4 r) { return P.x >= r.x && P.y >= r.y && P.x < r.x + r.z && P.y < r.y + r.w; }

void main() {
    vec4 S = texture2D(tex, cogl_tex_coord_in[0].st);
    if (amp < 0.0005 && debugMask < 0.5) { cogl_color_out = S; return; }

    vec2 P = vec2(gl_FragCoord.x, stageH - gl_FragCoord.y);
    vec4 R = vec4(-1.0);
    vec4 r0 = vec4(m0x, m0y, m0w, m0h), r1 = vec4(m1x, m1y, m1w, m1h);
    vec4 r2 = vec4(m2x, m2y, m2w, m2h), r3 = vec4(m3x, m3y, m3w, m3h);
    if (nmon > 0.5 && inside(P, r0)) R = r0;
    else if (nmon > 1.5 && inside(P, r1)) R = r1;
    else if (nmon > 2.5 && inside(P, r2)) R = r2;
    else if (nmon > 3.5 && inside(P, r3)) R = r3;
    if (R.z < 0.0) { cogl_color_out = S; return; }

    vec2 refO = vec2(refX, refY), refS = vec2(refW, refH);
    // Is this pixel plain wallpaper under a uniform dark shade (k)? Text, icons, the entry and
    // the avatar don't fit that model and are kept as they are.
    vec3 B = texture2D(wall, (P - refO) / refS).rgb * lockDim;
    float k = dot(S.rgb, vec3(1.0)) / max(dot(B, vec3(1.0)), 0.004);
    float e = length(S.rgb - B * k);
    float w = (1.0 - smoothstep(0.010, 0.032, e)) * (1.0 - smoothstep(1.04, 1.12, k));

    vec2 luv = (P - R.xy) / R.zw;
    vec4 wallRect = vec4((R.xy - refO) / refS, R.zw / refS);
    vec3 A = clamp(flowColor(luv, R.z / R.w, wallRect), 0.0, 1.0) * lockDim * min(k, 1.0);
    vec3 col = mix(S.rgb, A, w);
    if (debugMask > 0.5 && debugMask < 1.5) col = vec3(w);
    else if (debugMask > 1.5 && debugMask < 2.5) col = B;
    else if (debugMask > 2.5) col = vec3(abs(S.rgb - B) * 20.0);
    cogl_color_out = vec4(col, S.a);
}`;

const PASS = 'uniform sampler2D tex; void main() { cogl_color_out = texture2D(tex, cogl_tex_coord_in[0].st); }';

function _float(v) {
    let g = new GObject.Value();
    g.init(GObject.TYPE_FLOAT);
    g.set_float(v);
    return g;
}

function _freeTypeName(base) {
    let i = 0;
    while (GObject.type_from_name(i ? `${base}${i}` : base)) i++;
    return i ? `${base}${i}` : base;
}

// A ShaderEffect with a second texture on layer 1. The layer must be on the pipeline before
// the program's first compile (Cogl sizes cogl_tex_coord_in by layer count), so it is bound
// here, inside paint_target, on every paint.
// GTypes can't be registered twice in one shell, and re-enabling the extension re-imports this
// file, so the class is kept on `global`. It only touches its own instance state.
const DualShaderEffect = global.__WelcomeDualShaderEffect || (global.__WelcomeDualShaderEffect =
GObject.registerClass({ GTypeName: _freeTypeName('WelcomeDualShaderEffect') },
class DualShaderEffect extends Clutter.ShaderEffect {
    _init(params) {
        super._init(params);
        this.secondTexture = null;   // () => CoglTexture | null
    }

    vfunc_paint_target(...args) {
        let pipeline = this.get_pipeline();
        let texture = this.secondTexture ? this.secondTexture() : null;
        if (pipeline && texture) pipeline.set_layer_texture(1, texture);
        return super.vfunc_paint_target(...args);
    }
}));

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
    return kind === 'login' ? `${part}, ${_firstName()}` : `Welcome back, ${_firstName()}`;
}

// A fresh look every time: random phases, flow orientation, swirl direction, sweep angle,
// reveal origin and edge shape. Integer lobe counts keep the reveal edge seamless around the circle.
function _variation(randomness) {
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
    const v = {
        ph1: rnd(0, 6.283), ph2: rnd(0, 6.283), ph3: rnd(0, 6.283), ph4: rnd(0, 6.283),
        fq: rnd(0.8, 1.25), frot: rnd(0, 6.283),
        swirl: sign() * rnd(0.8, 1.35),
        hueAmt: sign() * rnd(0.16, 0.3),
        sweepA: rnd(0, 6.283),
        ox: Math.cos(originAng) * originDist, oy: Math.sin(originAng) * originDist,
        lobeA: a, lobeB: b, lobeC: c,
        rimR: rim[0], rimG: rim[1], rimB: rim[2],
    };
    // At zero variation the same default seed is used on every run.
    const fixed = { ph1: 0, ph2: 1.7, ph3: 0, ph4: 0.6, fq: 1, frot: 0,
        swirl: 1.15, hueAmt: 0.24, sweepA: 0, ox: 0, oy: 0,
        lobeA: 5, lobeB: 9, lobeC: 3, rimR: 0.85, rimG: 0.93, rimB: 1 };
    let amount = Math.max(0, Math.min(1, randomness));
    for (let key in v) {
        if (key.startsWith('lobe')) v[key] = Math.random() < amount ? v[key] : fixed[key];
        else v[key] = fixed[key] + (v[key] - fixed[key]) * amount;
    }
    return v;
}

// Uniforms shared by the flow function in both shaders.
const FLOW_KEYS = ['ph1', 'ph2', 'ph3', 'ph4', 'fq', 'frot', 'swirl', 'hueAmt', 'sweepA'];

const ease = {
    outCubic: x => 1 - Math.pow(1 - x, 3),
    inOutSine: x => -(Math.cos(Math.PI * x) - 1) / 2,
    inOutCubic: x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
};
const clamp01 = x => Math.max(0, Math.min(1, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, x) => a + (b - a) * x;
const now = () => GLib.get_monotonic_time() / 1e6;

// ---------------------------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------------------------
class Overlay {
    constructor(opts) {
        this.opts = opts;
        this.kind = null;
        this.vary = _variation(opts.randomness);
        this.shaderOptions = {
            pattern: Math.max(0, ['swirl', 'waves', 'aurora', 'ripple'].indexOf(opts.motionPattern)),
            revealPattern: Math.max(0, ['bloom', 'horizontal', 'vertical', 'dissolve'].indexOf(opts.revealPattern)),
            hueStrength: opts.hueStrength, sweepStrength: opts.sweepStrength,
            edgeSoftness: opts.edgeSoftness, glowStrength: opts.glowStrength,
        };
        this.timeline = null;
        this.effects = [];
        this.refActor = null;
        this.refEffect = null;
        this.textBox = null;

        this.actor = new Clutter.Actor({ name: 'welcome-overlay', reactive: false,
                                         x: 0, y: 0, width: global.screen_width, height: global.screen_height });
        let primary = Main.layoutManager.primaryMonitor;
        let widgets = this._wallpaperWidgets();
        Main.layoutManager.monitors.forEach((m, i) => {
            this.actor.add_child(widgets[i]);
            this.effects.push({ widget: widgets[i], aspect: m.width / m.height, effect: null });
            if (m === primary) this.primaryRect = m;
        });
        if (!this.primaryRect) this.primaryRect = Main.layoutManager.monitors[0];
    }

    // One wallpaper widget per monitor, scaled like Cinnamon's 'zoom' (cover).
    _wallpaperWidgets() {
        let uri = _wallpaperUri();
        return Main.layoutManager.monitors.map(m => {
            let style = 'background-color: #0b1a2a;';
            if (uri) style += ` background-image: url("${uri}"); background-size: cover; background-position: center;`;
            return new St.Widget({ style, x: m.x, y: m.y, width: m.width, height: m.height });
        });
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

    // Attach shaders and show a still frame.
    prime(fade, t = 0, amp = 0) {
        if (!this.primed) this._attachShaders();
        this.primed = true;
        this.setFlow({ t, amp, reveal: 0, fade });
    }

    _attachShaders() {
        for (let e of this.effects) {
            let fx = new Clutter.ShaderEffect({ shader_type: Clutter.ShaderType.FRAGMENT_SHADER });
            fx.set_shader_source(FRAG_OVERLAY);
            fx.set_uniform_value('tex', 0);
            fx.set_uniform_value('aspect', _float(e.aspect));
            for (let k in this.vary) fx.set_uniform_value(k, _float(this.vary[k]));
            for (let k in this.shaderOptions) fx.set_uniform_value(k, _float(this.shaderOptions[k]));
            e.effect = fx;
            e.widget.add_effect_with_name('welcome-flow', fx);
        }
    }

    setFlow(u) {
        for (let e of this.effects) {
            if (!e.effect) continue;
            for (let k in u) e.effect.set_uniform_value(k, _float(u[k]));
        }
    }

    // While parked under the lock screen the overlay also carries the lock shader's reference: a
    // stage-sized copy of the plain wallpaper (laid out like the screensaver's monitors) with a
    // pass-through effect, giving one texture to sample. It sits under the flow widgets, so it is
    // never visible. It must not be nested inside another offscreen effect (the inner pass would
    // render with the wrong projection).
    addReference() {
        if (this.refActor || !this.actor) return;
        this.refActor = new Clutter.Actor({ name: 'welcome-reference', reactive: false, x: 0, y: 0,
                                            width: global.screen_width, height: global.screen_height });
        for (let w of this._wallpaperWidgets()) this.refActor.add_child(w);
        this.refEffect = new Clutter.ShaderEffect({ shader_type: Clutter.ShaderType.FRAGMENT_SHADER });
        this.refEffect.set_shader_source(PASS);
        this.refEffect.set_uniform_value('tex', 0);
        this.refActor.add_effect_with_name('welcome-ref', this.refEffect);
        this.actor.insert_child_below(this.refActor, null);
    }

    referenceTexture() {
        if (!this.refEffect) return null;
        let pipeline = this.refEffect.get_pipeline();
        return pipeline ? pipeline.get_layer_texture(0) : null;
    }

    // Stage position and size (incl. padding) of the reference texture.
    referenceRect() {
        let fallback = { refX: 0, refY: 0, refW: global.screen_width, refH: global.screen_height };
        if (!this.refEffect) return fallback;
        try {
            let [ok, r] = this.refEffect.get_target_rect();
            if (ok && r.get_width() > 0) return { refX: r.get_x(), refY: r.get_y(), refW: r.get_width(), refH: r.get_height() };
        } catch (e) {}
        return fallback;
    }

    removeReference() {
        if (this.refActor) this.refActor.destroy();
        this.refActor = null;
        this.refEffect = null;
    }

    _buildText(kind) {
        let m = this.primaryRect;
        this.textBox = new St.BoxLayout({ vertical: true, x_align: Clutter.ActorAlign.CENTER, reactive: false });
        let label = new St.Label({ text: (this.opts.customGreeting || '').trim() || _greeting(kind),
            style: `font-family: Google Sans Flex, Ubuntu, sans-serif; font-size: ${Math.round(m.height / 28)}px;` +
                   ' font-weight: 400; color: rgba(255,255,255,0.97); text-align: center;' +
                   ' text-shadow: 0 2px 18px rgba(0,30,60,0.55);' });
        label.clutter_text.set_line_alignment(1 /* Pango.Alignment.CENTER */);
        let d = new Date();
        let time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        let date = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
        let sub = new St.Label({ text: `${date}  ·  ${time}`,
            style: `font-family: Google Sans Flex, Ubuntu, sans-serif; font-size: ${Math.round(m.height / 80)}px;` +
                   ' color: rgba(255,255,255,0.82); text-align: center; padding-top: 10px;' +
                   ' text-shadow: 0 1px 10px rgba(0,30,60,0.55);' });
        this.textBox.add_child(label);
        if (this.opts.showDate) this.textBox.add_child(sub);
        this.textBox.opacity = 0;
        this.actor.add_child(this.textBox);
        let [, nw] = this.textBox.get_preferred_width(-1);
        let [, nh] = this.textBox.get_preferred_height(nw);
        this.textBox.set_position(Math.round(m.x + (m.width - nw) / 2), Math.round(m.y + (m.height - nh) / 2));
        this.textBox.set_pivot_point(0.5, 0.5);
    }

    // kind: 'login' | 'unlock'. `from` continues a running loop: { t, rate, amp }.
    // onRevealStart fires when the desktop starts opening.
    run(kind, onRevealStart, onDone, from = null) {
        this.kind = kind;
        this.removeReference();
        // The lock screen draws the wallpaper under 70% black: unlock starts exactly there.
        const fadeFrom = kind === 'login' ? 0 : LOCK_DIM;
        if (this.opts.greeting) this._buildText(kind);

        let range = kind === 'login' ? [this.opts.loginMin, this.opts.loginMax] : [this.opts.unlockMin, this.opts.unlockMax];
        let low = Math.min(...range), high = Math.max(...range);
        let duration = (low + high) / 2 + (Math.random() - 0.5) * (high - low) * this.opts.randomness;
        duration = Math.max(0.8, Math.min(8, duration)) / Math.max(0.5, Math.min(2, this.opts.speed || 1));
        let speed = (kind === 'login' ? 2.85 : 2.0) / duration;
        // Phase plan (seconds, before speed scaling)
        const P = kind === 'login'
            ? { fadeIn: [0, 0.75], textIn: [0.25, 1.0], textOut: [1.65, 2.25], reveal: [1.55, 2.85], total: 2.85 }
            : { fadeIn: [0, 0.9],  textIn: [0.05, 0.6], textOut: [1.0, 1.5],   reveal: [0.85, 2.0],  total: 2.0 };
        for (let k in P) P[k] = Array.isArray(P[k]) ? P[k].map(v => v / speed) : P[k] / speed;

        // Flow clock. A continuation keeps the loop's clock and ramps it up to `boost`× and to a
        // stronger `surge`, so the same motion visibly accelerates into the desktop.
        let start = from || { t: 0, rate: speed, amp: 0 };
        let boost = from ? Math.max(1, this.opts.unlockBoost) : 1;
        let surge = from ? Math.max(0.3, this.opts.unlockSurge) : 1;
        let flowT = start.t;
        let lastT = 0;
        this.prime(fadeFrom, start.t, start.amp);

        let revealStarted = false;
        let tick = (ms) => {
            let t = ms / 1000;
            this.raise();   // stay above chrome added mid-animation (e.g. panels re-showing)
            // Rate eases from the loop's pace up to the fast pace.
            let rampIn = from ? ease.inOutSine(seg(t, 0, 0.55 / speed)) : 1;
            let rate = lerp(start.rate, speed * boost, rampIn);
            flowT += Math.max(0, t - lastT) * rate;
            lastT = t;
            // Flow strength: surges from where it was, holds, then calms to exactly zero.
            let rise = ease.outCubic(seg(t, 0, kind === 'login' ? 0.6 / speed : 0.4 / speed));
            let calm = 1 - ease.inOutSine(seg(t, P.reveal[0] - 0.4 / speed, P.total));
            let amp = lerp(start.amp, this.opts.intensity * surge, rise) * calm;
            let reveal = ease.inOutCubic(seg(t, P.reveal[0], P.reveal[1]));
            let fade = fadeFrom + (1 - fadeFrom) * ease.outCubic(seg(t, P.fadeIn[0], P.fadeIn[1]));
            this.setFlow({ t: flowT, amp, reveal, fade });

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
        this.refActor = null;
        this.refEffect = null;
        if (this.actor) { this.actor.destroy(); this.actor = null; }
        this.effects = [];
    }
}

// ---------------------------------------------------------------------------------------------
// Lock-screen loop
// ---------------------------------------------------------------------------------------------
// Owns the flow clock while the screen is locked. Drives the shader on the screensaver window, and
// (after the lock window has gone) the parked overlay, until the unlock run takes over the clock.
class LockLoop {
    constructor(opts, overlay) {
        this.opts = opts;
        this.overlay = overlay;
        this.t = Math.random() * LOOP_SECONDS;   // start somewhere new in the loop
        this.env = 0;              // 0..1 fade of the loop's strength (prompt shown or not)
        this.actor = null;
        this.fx = null;
        this.timeline = null;
        this.pollId = 0;
        this.attachId = 0;
        this.handedOff = false;    // the lock window has gone; the parked overlay shows the loop
        this.last = now();
        this.unredirectOff = false;
    }

    get rate() { return Math.max(0.05, this.opts.lockSpeed); }
    get amp() { return this.opts.lockIntensity * this.env; }
    state() { return { t: this.t, rate: this.rate, amp: this.amp }; }

    _wanted() {
        let mode = this.opts.lockLoop;
        if (mode === 'off' || !this.opts.onUnlock) return false;
        if (mode === 'always') return true;
        try { return Meta.IdleMonitor.get_core().get_idletime() < PROMPT_TIMEOUT; } catch (e) { return true; }
    }

    attach(actor) {
        if (this.actor === actor) return;
        this.detach();
        this.actor = actor;
        this.handedOff = false;
        this.overlay.addReference();   // removed again at hand-off; the window may be a rebuilt one
        if (!this.unredirectOff) {
            // A fullscreen override-redirect window may be unredirected, which would bypass effects.
            try { Meta.disable_unredirect_for_display(global.display); this.unredirectOff = true; } catch (e) {}
        }
        this._tryAttachEffect();
        this._startClock();
    }

    // The reference wallpaper has to have painted once so layer 1 exists from the shader's first
    // compile; until then try again every frame.
    _tryAttachEffect() {
        if (this.attachId) { GLib.source_remove(this.attachId); this.attachId = 0; }
        if (!this.actor) return;
        if (!this.overlay.referenceTexture()) {
            this.attachId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
                this.attachId = 0;
                this._tryAttachEffect();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        let fx = new DualShaderEffect({ shader_type: Clutter.ShaderType.FRAGMENT_SHADER });
        fx.secondTexture = () => this.overlay.referenceTexture();
        fx.set_shader_source(FRAG_LOCK);
        fx.set_uniform_value('tex', 0);
        fx.set_uniform_value('wall', 1);
        let mons = Main.layoutManager.monitors.slice(0, MAX_MONITORS);
        let u = { stageW: global.screen_width, stageH: global.screen_height, nmon: mons.length,
                  lockDim: LOCK_DIM, debugMask: Number(this.opts.debugMask) || 0, t: this.t, amp: this.amp,
                  ...this.overlay.referenceRect() };
        mons.forEach((m, i) => Object.assign(u, { [`m${i}x`]: m.x, [`m${i}y`]: m.y,
                                                  [`m${i}w`]: m.width, [`m${i}h`]: m.height }));
        for (let k of FLOW_KEYS) u[k] = this.overlay.vary[k];
        for (let k of ['pattern', 'hueStrength', 'sweepStrength']) u[k] = this.overlay.shaderOptions[k];
        for (let k in u) fx.set_uniform_value(k, _float(u[k]));
        fx.set_enabled(this.env > 0.0005 || !!this.opts.debugMask);
        this.fx = fx;
        this.actor.add_effect_with_name('welcome-lock', fx);
    }

    detach() {
        if (this.attachId) { GLib.source_remove(this.attachId); this.attachId = 0; }
        if (this.fx && this.actor) { try { this.actor.remove_effect(this.fx); } catch (e) {} }
        this.fx = null;
        this.actor = null;
    }

    // The lock window disappeared (unlock, or the screensaver restarting its stage). Keep the loop
    // going on the parked overlay so nothing changes on screen.
    handOff() {
        this.detach();
        this.handedOff = true;
        this.overlay.removeReference();
        this._apply();
        this._startClock();
    }

    _startClock() {
        if (!this.pollId) {
            this.pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                if (this._wanted() && !this.timeline) this._startClock();
                return GLib.SOURCE_CONTINUE;
            });
        }
        if (this.timeline) return;
        this.last = now();
        this.timeline = new Clutter.Timeline({ duration: 1000, repeat_count: -1 });
        this.timeline.connect('new-frame', () => this._tick());
        this.timeline.start();
    }

    _tick() {
        let n = now(), dt = Math.min(0.1, n - this.last);
        this.last = n;
        let target = this._wanted() || this.handedOff ? 1 : 0;
        // ~1 s fades in and out, so the loop settles into the still wallpaper when the prompt hides.
        this.env = target > this.env ? Math.min(1, this.env + dt * 1.2) : Math.max(0, this.env - dt * 0.6);
        this.t += dt * this.rate;
        if (this.t > LOOP_SECONDS * 1000) this.t -= LOOP_SECONDS * 1000;   // stays exact: whole loops
        this._apply();
        if (this.env <= 0 && target === 0 && !this.handedOff && this.timeline) {
            // Idle and invisible: stop drawing until the prompt comes back.
            this.timeline.stop();
            this.timeline = null;
        }
    }

    _apply() {
        if (this.fx) {
            this.fx.set_enabled(this.env > 0.0005 || !!this.opts.debugMask);
            this.fx.set_uniform_value('t', _float(this.t));
            this.fx.set_uniform_value('amp', _float(this.amp));
            let r = this.overlay.referenceRect();
            for (let k in r) this.fx.set_uniform_value(k, _float(r[k]));
        }
        if (this.handedOff && this.overlay.actor)
            this.overlay.setFlow({ t: this.t, amp: this.amp, reveal: 0, fade: LOCK_DIM });
    }

    stop() {
        this.detach();
        if (this.timeline) { this.timeline.stop(); this.timeline = null; }
        if (this.pollId) { GLib.source_remove(this.pollId); this.pollId = 0; }
        if (this.unredirectOff) {
            try { Meta.enable_unredirect_for_display(global.display); } catch (e) {}
            this.unredirectOff = false;
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------------------------
class Welcome {
    constructor(meta) {
        this.meta = meta;
        this.opts = { onLogin: true, onUnlock: true, greeting: true, showDate: true,
            customGreeting: '', speed: 1.0, intensity: 1.0, randomness: 1,
            motionPattern: 'swirl', revealPattern: 'bloom', loginMin: 2.7, loginMax: 3.1,
            unlockMin: 1.9, unlockMax: 2.2, hueStrength: 1, sweepStrength: 1,
            edgeSoftness: 1, glowStrength: 1,
            lockLoop: 'prompt', lockSpeed: 0.6, lockIntensity: 0.55,
            unlockBoost: 2.5, unlockSurge: 1.3, debugMask: false };
        this.overlay = null;
        this.parked = null;      // overlay parked under the screensaver window
        this.loop = null;        // lock-screen loop driving the parked overlay's clock
        this.ssActor = null;
        this.signals = [];
        this.proxy = null;
        this.origRun = null;
    }

    _loadSettings() {
        try {
            this.settings = new Settings.ExtensionSettings(this.opts, UUID);
            for (let [key, prop] of [
                ['on-login', 'onLogin'], ['on-unlock', 'onUnlock'], ['greeting', 'greeting'],
                ['speed', 'speed'], ['intensity', 'intensity'],
                ['show-date','showDate'], ['custom-greeting','customGreeting'],
                ['randomness','randomness'], ['motion-pattern','motionPattern'],
                ['reveal-pattern','revealPattern'], ['login-min','loginMin'],
                ['login-max','loginMax'], ['unlock-min','unlockMin'], ['unlock-max','unlockMax'],
                ['hue-strength','hueStrength'], ['sweep-strength','sweepStrength'],
                ['edge-softness','edgeSoftness'], ['glow-strength','glowStrength'],
                ['lock-loop', 'lockLoop'], ['lock-speed', 'lockSpeed'],
                ['lock-intensity', 'lockIntensity'], ['unlock-boost', 'unlockBoost'],
                ['unlock-surge', 'unlockSurge']])
                this.settings.bind(key, prop);
            this.opts.preview = () => this.preview('unlock');
            this.opts.previewLogin = () => this.preview('login');
            this.opts.previewLock = () => this.preview('lock');
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
        if (this.previewLoopId) { GLib.source_remove(this.previewLoopId); this.previewLoopId = 0; }
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

    // --- lock and unlock -----------------------------------------------------------------------
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
        // Enabled while already locked (e.g. the extension was reloaded).
        this._parkExisting();
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
        if (!this.parked) {
            this.parked = new Overlay(this.opts);
            this.parked.prime(LOCK_DIM);
        }
        this.parked.place();
        this.ssActor = actor;
        if (!this.loop) this.loop = new LockLoop(this.opts, this.parked);
        this.loop.attach(actor);
        actor.connect('destroy', () => {
            if (this.ssActor !== actor) return;
            this.ssActor = null;
            // Same main-loop pass as the unmap, before the next frame is drawn: the parked overlay
            // takes over the loop so there is no visible change at all.
            if (this.loop) this.loop.handOff();
            if (this.unlockPending) { this.unlockPending = false; this._onUnlocked(); return; }
            // Safety net: if no ActiveChanged(false) follows (crash, restart) and no new lock
            // window appears, never leave the overlay covering the desktop.
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
        this.unlockPending = false;
        if (this.loop) { this.loop.stop(); this.loop = null; }
        if (this.parked) { this.parked.destroy(); this.parked = null; }
        this.ssActor = null;
    }

    _onUnlocked() {
        // ActiveChanged(false) can arrive while the lock window is still on screen: wait for it to
        // go (its destroy handler hands the loop to the parked overlay first), at most 400 ms.
        if (this.ssActor && this.loop && !this.unlockPending) {
            this.unlockPending = true;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                if (this.unlockPending) { this.unlockPending = false; if (this.loop) this.loop.handOff(); this._onUnlocked(); }
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        if (this.unlockPending) return;
        let ov = this.parked, loop = this.loop;
        this.parked = null;
        this.loop = null;
        this.ssActor = null;
        let from = loop ? loop.state() : null;
        if (loop) loop.stop();
        if (!ov) return;
        if (!this.opts.onUnlock || !this._animationsOk()) { ov.destroy(); return; }
        if (this.overlay) this.overlay.destroy();
        this.overlay = ov;
        ov.place();
        ov.run('unlock', null, () => { if (this.overlay === ov) this.overlay = null; }, from);
    }

    // kind: 'login' | 'unlock' | 'lock' (a few seconds of the lock-screen loop, then the unlock).
    preview(kind) {
        if (this.overlay) { this.overlay.destroy(); this.overlay = null; }
        if (this.previewLoopId) { GLib.source_remove(this.previewLoopId); this.previewLoopId = 0; }
        let ov = new Overlay(this.opts);
        this.overlay = ov;
        ov.place();
        if (kind !== 'lock') {
            ov.run(kind, null, () => { if (this.overlay === ov) this.overlay = null; });
            return;
        }
        let t = Math.random() * LOOP_SECONDS, env = 0, last = now(), started = last;
        ov.prime(LOCK_DIM, t, 0);
        this.previewLoopId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            if (this.overlay !== ov || !ov.actor) { this.previewLoopId = 0; return GLib.SOURCE_REMOVE; }
            let n = now(), dt = Math.min(0.1, n - last);
            last = n;
            env = Math.min(1, env + dt * 1.2);
            t += dt * Math.max(0.05, this.opts.lockSpeed);
            let amp = this.opts.lockIntensity * env;
            ov.raise();
            if (n - started < 5) { ov.setFlow({ t, amp, reveal: 0, fade: LOCK_DIM }); return GLib.SOURCE_CONTINUE; }
            this.previewLoopId = 0;
            ov.run('unlock', null, () => { if (this.overlay === ov) this.overlay = null; },
                   { t, rate: Math.max(0.05, this.opts.lockSpeed), amp });
            return GLib.SOURCE_REMOVE;
        });
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
