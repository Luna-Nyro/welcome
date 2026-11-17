# Welcome: a sign-in transition for Cinnamon

**Welcome** is a Cinnamon desktop extension that plays an animation when you log in and when you
unlock the screen. Your wallpaper comes alive: its colours swirl and drift (a GLSL flow field, hue
drift and a light sweep), and a greeting fades in. Then the desktop opens from the centre through a
glowing, organic edge while the colours settle back onto the still wallpaper.

On login it takes the place of Cinnamon's black startup fade. On unlock it picks up from the dimmed
lock-screen wallpaper, so you don't see a flash of bare desktop.

> No screenshots or recordings are included yet. Use **Preview** in the settings (see below) to see it.

## Features

- **Login transition.** Takes over Cinnamon's startup animation and hands the session back (input,
  cursor, panels) as soon as the reveal begins.
- **Unlock transition.** Starts from the same 70%-black dim that `cinnamon-screensaver` draws over
  the wallpaper, so the hand-off is seamless.
- **Greeting.** "Good morning/afternoon/evening/night, *Name*" on login, "Welcome back, *Name*" on
  unlock, plus the date and time. The name is the first word of your account's real name, or your
  login name if the real name isn't set.
- **Different every time.** Each run randomises the flow phases, rotation and frequency, swirl
  direction, hue drift, light-sweep angle, the point the reveal grows from, the shape of its edge,
  the rim tint and the tempo (about ±7%). Every run ends on the plain wallpaper.
- **Multi-monitor.** Each monitor gets its own copy of the wallpaper with the correct aspect ratio.
  The greeting appears on the primary monitor.
- **Settings** (Cinnamon › Extensions › Welcome):
  | Setting | Default | Notes |
  |---|---|---|
  | On login | on | Replaces the black startup fade |
  | When unlocking the screen | on | |
  | Show greeting, date and time | on | |
  | Speed | 1.0 | 0.5–2.0, higher is faster |
  | Colour motion | 1.0 | 0.2–1.6, how strongly the gradient swirls |
  | Preview unlock / Preview login | — | Buttons that play the animation now |

At speed 1.0, the login animation lasts about 2.9 s and the unlock animation about 2.0 s.

## Requirements

- Cinnamon **6.4 or 6.6** (the versions declared in `metadata.json`), in an X11 session with the
  standard `cinnamon-screensaver` lock screen. The unlock detection looks for the screensaver's
  override-redirect window, `cinnamon-screensaver-window`.
- A GPU/driver that supports Clutter GLSL shader effects. Any normal Cinnamon setup should.
- Optional: the font **Google Sans Flex**, used for the greeting. If it isn't installed, the
  greeting falls back to Ubuntu, then any sans-serif font. No fonts are bundled.
- For the developer tool only: `python3` and `gdbus`. On most distros, `gdbus` comes with the
  GLib/`libglib2.0-bin` package.

## Install

```sh
git clone https://github.com/Luna-Nyro/welcome.git
cd welcome
mkdir -p ~/.local/share/cinnamon/extensions
ln -s "$PWD/welcome@luna-nyro.github.io" ~/.local/share/cinnamon/extensions/welcome@luna-nyro.github.io
```

If you'd rather not keep the clone, copy the folder instead of symlinking it:
`cp -r welcome@luna-nyro.github.io ~/.local/share/cinnamon/extensions/`.

Next, open **System Settings › Extensions**, select **Welcome** and enable it. (You may need to
restart Cinnamon first with <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Esc</kbd> or log out and back in.)

Note: the login transition only takes effect from your **next login**. Cinnamon's startup
animation has already run by the time you enable the extension mid-session. The unlock transition
and the preview buttons work straight away.

## Usage

Once it's enabled there's nothing else to do. The animation plays on login and on unlock. Change
the options or watch a preview in **System Settings › Extensions › Welcome › Configure**.

Test the unlock path without typing a password:

```sh
gdbus call --session --dest org.cinnamon.ScreenSaver --object-path /org/cinnamon/ScreenSaver \
  --method org.cinnamon.ScreenSaver.SetActive true
# ...then
gdbus call --session --dest org.cinnamon.ScreenSaver --object-path /org/cinnamon/ScreenSaver \
  --method org.cinnamon.ScreenSaver.SetActive false
```

## Uninstall / rollback

1. Turn the extension off in **System Settings › Extensions**. Or, from a terminal, remove
   `welcome@luna-nyro.github.io` from the `enabled-extensions` list:
   ```sh
   gsettings get org.cinnamon enabled-extensions   # copy the list, drop 'welcome@luna-nyro.github.io'
   gsettings set org.cinnamon enabled-extensions "[...]"
   ```
   Disabling puts Cinnamon's original startup animation back and stops watching the screensaver.
2. Remove the extension files:
   ```sh
   rm ~/.local/share/cinnamon/extensions/welcome@luna-nyro.github.io   # the symlink (or rm -r for a copy)
   ```
3. Optionally, delete its saved settings:
   `rm -r ~/.config/cinnamon/spices/welcome@luna-nyro.github.io` (this path is where Cinnamon normally stores
   extension settings).

## Troubleshooting

- **Nothing happens on unlock.** Make sure *When unlocking the screen* is on, and that desktop
  effects/animations are enabled in Cinnamon. The extension skips the unlock animation when
  animations are turned off. It also only recognises the stock `cinnamon-screensaver` lock window.
- **Nothing happens on login.** Make sure the extension was enabled *before* this session started
  (see the Install notes). If the animation throws an error, the extension falls back to Cinnamon's
  normal startup fade.
- **Errors.** Look in `~/.xsession-errors` or in Looking Glass (<kbd>Super</kbd>+<kbd>L</kbd>, or
  run `cinnamon-looking-glass`) › *Log* for lines starting with `welcome@luna-nyro.github.io:`.
- **A frame stays stuck on screen.** The extension has a safety net: if the lock window vanishes
  without the screensaver reporting that it's inactive, the parked overlay is removed after about
  1.2 s. If something still gets stuck, restart Cinnamon (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Esc</kbd>)
  or disable the extension.

## How it works

- `welcome@luna-nyro.github.io/extension.js` builds a full-screen Clutter actor with one `St.Widget` per monitor.
  Each widget shows the current wallpaper (`org.cinnamon.desktop.background picture-uri`) and has a
  fragment-shader `Clutter.ShaderEffect` that handles the flow, hue drift, light sweep, fade-in and
  reveal edge.
- **Login:** it patches `Main.layoutManager.startupAnimation.run` and calls the original animation's
  `_finished()` when the reveal starts.
- **Unlock:** while the lock screen is up, a copy dimmed to the lock screen's level
  (`LOCK_DIM = 0.3`) is parked at the top of `Main.uiGroup`. That puts it just under
  `global.top_window_group`, where the lock window lives. The animation starts on the screensaver's
  `ActiveChanged(false)` D-Bus signal. The overlay is never placed *inside* `top_window_group`:
  Muffin restacks that group and would put it above the lock screen.

## Status and limitations

This is a small personal project shared as-is. It has only been used on the author's own setup.

- Only tested against Cinnamon 6.4/6.6 on X11. Wayland sessions and other lock screens aren't
  supported.
- Parts of it depend on Cinnamon internals (`startupAnimation.run`/`_finished`, the screensaver
  window title). A future Cinnamon release could break them.
- If the wallpaper is set to "No picture", it shows a solid dark-blue background (`#0b1a2a`).
  Slideshow and per-monitor wallpapers aren't handled specially: the current `picture-uri` is
  used on every monitor.
- The greeting text is English-only. The date and time follow your locale.
- The animation is visual only. It doesn't add security to the lock screen and doesn't delay
  input after the reveal starts.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the hot-reload workflow (`tools/dev.py`).

## Credits

Written by Luna-Nyro. Built on the Cinnamon/Muffin, Clutter and St APIs from the Linux Mint
project. No third-party code or assets are bundled.

## License

Welcome is free software; you can redistribute it and/or modify it under the terms of the GNU General
Public License as published by the Free Software Foundation; either version 2 of the License, or (at
your option) any later version. See [LICENSE](LICENSE).
