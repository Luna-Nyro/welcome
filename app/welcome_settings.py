#!/usr/bin/env python3
"""Welcome preferences: a small Libadwaita front end to Cinnamon extension settings."""
import json
import os
import subprocess
import sys
from pathlib import Path

import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
from gi.repository import Adw, Gdk, Gio, GLib, Gtk

UUID = 'welcome@luna-nyro.github.io'
ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / UUID / 'settings-schema.json').read_text())
CONFIG = Path(GLib.get_user_config_dir()) / 'cinnamon' / 'spices' / UUID / f'{UUID}.json'


def load_values():
    data = (json.loads(CONFIG.read_text()) if CONFIG.exists() else
            {k: {**spec, 'value': spec['default']} for k, spec in SCHEMA.items()
             if 'default' in spec})
    return {key: data.get(key, {}).get('value', spec['default'])
            for key, spec in SCHEMA.items() if 'default' in spec}


def save_value(key, value):
    """Preserve Cinnamon's schema metadata and other keys; replace atomically."""
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(CONFIG.read_text()) if CONFIG.exists() else {}
    if key not in data:
        data[key] = dict(SCHEMA[key])
    data[key]['value'] = value
    temporary = CONFIG.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, indent=4) + '\n')
    os.replace(temporary, CONFIG)
    # Cinnamon's settings manager receives a remote update through the shell.
    # The JS is fixed here; key/value never enter the expression.
    try:
        subprocess.run(['gdbus', 'call', '--session', '--dest', 'org.Cinnamon',
                        '--object-path', '/org/Cinnamon', '--method', 'org.Cinnamon.Eval',
                        "global.__welcomeTransition && global.__welcomeTransition.settings"
                        " ? (global.__welcomeTransition.settings._checkSettings(), 'updated') : 'offline'"],
                       capture_output=True, timeout=2, check=False)
    except (OSError, subprocess.TimeoutExpired):
        pass  # Values are saved; Cinnamon will load them when it starts.


def preview(kind):
    expression = ("global.__welcomeTransition ? "
                  + "(global.__welcomeTransition.preview('" + kind + "'), 'preview') : 'offline'")
    return subprocess.run(['gdbus', 'call', '--session', '--dest', 'org.Cinnamon',
                           '--object-path', '/org/Cinnamon', '--method', 'org.Cinnamon.Eval',
                           expression], capture_output=True, text=True, timeout=4, check=False)


class Window(Adw.PreferencesWindow):
    def __init__(self, app):
        super().__init__(application=app, title='Welcome', default_width=740, default_height=710,
                         search_enabled=True)
        self.values = load_values()
        self.loading = False
        self.pages = []
        self.pending = {}
        self._build()
        self.connect('close-request', self._flush)
        self.connect('notify::visible-page', self._page_changed)
        self._page_changed()
        keys = Gtk.EventControllerKey()
        keys.connect('key-pressed', self._key_pressed)
        self.add_controller(keys)

    def _page_changed(self, *_):
        page = self.get_visible_page()
        if page:
            self.set_title(f'Welcome – {page.get_title()}')

    def _key_pressed(self, _controller, keyval, _keycode, state):
        if state & Gdk.ModifierType.MOD1_MASK and Gdk.KEY_1 <= keyval <= Gdk.KEY_5:
            self.set_visible_page(self.pages[keyval - Gdk.KEY_1])
            return True
        return False

    def page(self, title, icon, description):
        page = Adw.PreferencesPage(title=title, icon_name=icon, description=description)
        self.add(page)
        self.pages.append(page)
        return page

    def group(self, page, title, description=None):
        group = Adw.PreferencesGroup(title=title, description=description or '')
        page.add(group)
        return group

    def _flush(self, *_):
        for key, (value, source) in list(self.pending.items()):
            GLib.source_remove(source)
            save_value(key, value)
        self.pending.clear()
        return False

    def write(self, key, value, delayed=False):
        if self.loading:
            return
        self.values[key] = value
        if key in self.pending:
            GLib.source_remove(self.pending.pop(key)[1])
        if delayed:
            def commit():
                self.pending.pop(key, None)
                save_value(key, value)
                return GLib.SOURCE_REMOVE
            self.pending[key] = (value, GLib.timeout_add(180, commit))
        else:
            save_value(key, value)

    def switch(self, group, key, title, subtitle):
        row = Adw.SwitchRow(title=title, subtitle=subtitle, active=bool(self.values[key]))
        row.connect('notify::active', lambda r, _: self.write(key, r.get_active()))
        group.add(row)
        return row

    def combo(self, group, key, title, subtitle, choices):
        labels, values = zip(*choices)
        row = Adw.ComboRow(title=title, subtitle=subtitle, model=Gtk.StringList.new(labels))
        row.set_selected(values.index(self.values[key]) if self.values[key] in values else 0)
        row.connect('notify::selected', lambda r, _: self.write(key, values[r.get_selected()]))
        group.add(row)

    def slider(self, group, key, title, subtitle, low, high, step=0.1, unit=''):
        row = Adw.ActionRow(title=title, subtitle=subtitle)
        row.set_activatable(False)
        adjustment = Gtk.Adjustment(value=float(self.values[key]), lower=low, upper=high,
                                    step_increment=step, page_increment=step * 5)
        scale = Gtk.Scale(orientation=Gtk.Orientation.HORIZONTAL, adjustment=adjustment,
                          draw_value=False, hexpand=True, width_request=190)
        scale.set_valign(Gtk.Align.CENTER)
        scale.set_size_request(215, -1)
        label = Gtk.Label(width_chars=7, xalign=1)
        def changed(adj):
            val = round(adj.get_value(), 2)
            label.set_text(f'{val:g}{unit}')
            self.write(key, val, delayed=True)
        label.set_text(f'{float(self.values[key]):g}{unit}')
        adjustment.connect('value-changed', changed)
        row.add_suffix(scale)
        row.add_suffix(label)
        group.add(row)
        return adjustment

    def button(self, group, title, subtitle, icon, callback):
        row = Adw.ActionRow(title=title, subtitle=subtitle, activatable=True)
        btn = Gtk.Button(icon_name=icon, valign=Gtk.Align.CENTER)
        btn.add_css_class('flat')
        btn.set_tooltip_text(title)
        btn.connect('clicked', lambda *_: callback())
        row.connect('activated', lambda *_: callback())
        row.add_suffix(btn)
        group.add(row)

    def duration(self, group, kind):
        low_key, high_key = f'{kind}-min', f'{kind}-max'
        low = self.slider(group, low_key, 'Shortest', 'Minimum animation time', 0.8, 8, unit=' s')
        high = self.slider(group, high_key, 'Longest', 'Maximum animation time', 0.8, 8, unit=' s')
        def fix_low(adj):
            if adj.get_value() > high.get_value(): high.set_value(adj.get_value())
        def fix_high(adj):
            if adj.get_value() < low.get_value(): low.set_value(adj.get_value())
        low.connect('value-changed', fix_low)
        high.connect('value-changed', fix_high)

    def _build(self):
        general = self.page('General', 'preferences-system-symbolic',
                            'Choose when Welcome plays and try it on this desktop.')
        on = self.group(general, 'Play on')
        self.switch(on, 'on-login', 'Login', 'Replace Cinnamon’s startup fade')
        self.switch(on, 'on-unlock', 'Unlock', 'Play after the lock screen closes')
        previews = self.group(general, 'Preview', 'Each preview uses your current settings and a fresh variation.')
        self.button(previews, 'Preview unlock', 'Play on this desktop', 'media-playback-start-symbolic',
                    lambda: self._preview('unlock'))
        self.button(previews, 'Preview login', 'Play on this desktop', 'media-playback-start-symbolic',
                    lambda: self._preview('login'))
        self.group(general, 'Tip', 'Move the pointer to a comfortable place before previewing. The animation covers all monitors briefly.')

        timing = self.page('Timing', 'alarm-symbolic',
                           'Set a duration range. Welcome picks a time inside it for each run.')
        self.duration(self.group(timing, 'Login duration'), 'login')
        self.duration(self.group(timing, 'Unlock duration'), 'unlock')
        self.slider(self.group(timing, 'Pace'), 'speed', 'Overall speed',
                    'Multiplier applied to both duration ranges', 0.5, 2, unit='×')

        motion = self.page('Motion', 'view-refresh-symbolic',
                           'Shape how the wallpaper colours move.')
        patterns = self.group(motion, 'Pattern')
        self.combo(patterns, 'motion-pattern', 'Motion', 'How the gradient flows',
                   [('Swirl', 'swirl'), ('Waves', 'waves'), ('Aurora', 'aurora'), ('Ripple', 'ripple')])
        self.slider(patterns, 'intensity', 'Colour motion', 'Strength of the moving gradient', 0.2, 1.6)
        colour = self.group(motion, 'Colour and light')
        self.slider(colour, 'hue-strength', 'Colour drift', 'How much the hue changes', 0, 2)
        self.slider(colour, 'sweep-strength', 'Light sweep', 'Brightness of the travelling light', 0, 2)
        self.slider(self.group(motion, 'Variation'), 'randomness', 'Different each time',
                    '0 is repeatable; 1 uses the full range of variations', 0, 1, step=0.05)

        reveal = self.page('Reveal', 'view-reveal-symbolic',
                           'Choose how the desktop comes into view.')
        reveal_group = self.group(reveal, 'Opening')
        self.combo(reveal_group, 'reveal-pattern', 'Pattern', 'The shape of the opening',
                   [('Bloom', 'bloom'), ('Horizontal wipe', 'horizontal'),
                    ('Vertical wipe', 'vertical'), ('Soft dissolve', 'dissolve')])
        self.slider(reveal_group, 'edge-softness', 'Softness', 'Width of the reveal edge', 0.3, 2)
        self.slider(reveal_group, 'glow-strength', 'Glow', 'Light around the reveal edge', 0, 2)

        greeting = self.page('Greeting', 'dialog-information-symbolic',
                             'Personalise the words shown while the colours move.')
        text = self.group(greeting, 'Message')
        self.switch(text, 'greeting', 'Show greeting', 'Display a welcome message during the transition')
        self.switch(text, 'show-date', 'Show date and time', 'Display below the greeting')
        entry = Adw.EntryRow(title='Custom message')
        entry.set_text(self.values['custom-greeting'])
        entry.connect('changed', lambda r: self.write('custom-greeting', r.get_text()[:100]))
        text.add(entry)
        self.group(greeting, 'Automatic message', 'Leave the custom message empty to use a time-aware greeting with your name.')

    def _preview(self, kind):
        self._flush()
        try:
            result = preview(kind)
            if result.returncode != 0 or 'offline' in result.stdout or result.stdout.startswith('(false'):
                self.add_toast(Adw.Toast(title='Enable the Welcome extension to preview'))
        except (OSError, subprocess.TimeoutExpired):
            self.add_toast(Adw.Toast(title='Could not reach the Cinnamon desktop'))


class Application(Adw.Application):
    def __init__(self):
        super().__init__(application_id='io.github.luna_nyro.WelcomeSettings',
                         flags=Gio.ApplicationFlags.FLAGS_NONE)

    def do_activate(self):
        win = self.props.active_window or Window(self)
        win.present()


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--preview' and sys.argv[2] in ('login', 'unlock'):
        try:
            result = preview(sys.argv[2])
            sys.exit(0 if result.returncode == 0 and 'offline' not in result.stdout
                     and not result.stdout.startswith('(false') else 1)
        except (OSError, subprocess.TimeoutExpired):
            sys.exit(1)
    sys.exit(Application().run(sys.argv))
