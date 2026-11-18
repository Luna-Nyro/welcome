# Welcome: a sign-in transition for Cinnamon

**Welcome** is a Cinnamon desktop extension that plays an animation when you log in and when you
unlock the screen. Your wallpaper comes alive: its colours swirl and drift (a GLSL flow field, hue
drift and a light sweep), and a greeting fades in. Then the desktop opens from the centre through a
glowing, organic edge while the colours settle back onto the still wallpaper.

On login it takes the place of Cinnamon's black startup fade. While the screen is locked and the
password prompt is up, the wallpaper behind the lock screen flows in a calm, seamless loop. When you
unlock, that same motion carries on, faster and stronger, and opens onto the desktop.

> No screenshots or recordings are included yet. Use **Preview** in the settings (see below) to see it.

## Features

- **Login transition.** Takes over Cinnamon's startup animation and hands the session back (input,
  cursor, panels) as soon as the reveal begins.
- **Lock-screen loop.** While the password prompt is shown (or always, if you prefer), the
  wallpaper behind the lock screen flows in a loop that repeats without a visible seam. Only the
  wallpaper moves: the clock, prompt, avatar and media controls are left untouched. The loop fades
  out when the prompt hides and never runs while the screen is off.
- **Unlock transition.** Continues the lock-screen loop from the exact frame it was on, at the same
  70%-black dim that `cinnamon-screensaver` uses, then speeds up and surges into the reveal. There is
  no jump or flash at the hand-off.
- **Greeting.** "Good morning/afternoon/evening/night, *Name*" on login, "Welcome back, *Name*" on
  unlock, plus the date and time. The name is the first word of your account's real name, or your
  login name if the real name isn't set.
- **Different every time.** Each run randomises the flow phases, rotation and frequency, swirl
  direction, hue drift, light-sweep angle, the point the reveal grows from, the shape of its edge,
  the rim tint and the duration within your chosen range. Every run ends on the plain wallpaper.
- **Multi-monitor.** Each monitor gets its own copy of the wallpaper with the correct aspect ratio.
  The greeting appears on the primary monitor.
- **Welcome Settings app** (GNOME / Libadwaita): six searchable pages with immediate saving:
  General (login/unlock and previews), Lock screen (when the loop plays, loop speed and strength,
  how much faster and stronger it gets on unlock), Timing (separate duration ranges and speed), Motion
  (swirl/waves/aurora/ripple, strength, colour, light, variation), Reveal
  (bloom/wipes/dissolve, softness and glow), and Greeting (message and date/time).
- **Optional Touch Bar scenes** for each settings page: Escape, login/unlock previews and page
  navigation. The app works without barkeep.

Default durations are 2.7–3.1 s at login and 1.9–2.2 s at unlock. The app saves changes
immediately; the next preview or sign-in uses them.

## Requirements

- Cinnamon **6.4 or 6.6** (the versions declared in `metadata.json`), in an X11 session with the
  standard `cinnamon-screensaver` lock screen. The unlock detection looks for the screensaver's
  override-redirect window, `cinnamon-screensaver-window`.
- A GPU/driver that supports Clutter GLSL shader effects. Any normal Cinnamon setup should.
- Optional: the font **Google Sans Flex**, used for the greeting. If it isn't installed, the
  greeting falls back to Ubuntu, then any sans-serif font. No fonts are bundled.
- For the settings app: Python 3, PyGObject, GTK 4, Libadwaita 1 and `gdbus`. On Linux Mint,
  the packages are typically `python3-gi`, `gir1.2-gtk-4.0`, `gir1.2-adw-1` and
  `libglib2.0-bin`. The animation extension itself does not need the app.

## Install

```sh
git clone https://github.com/Luna-Nyro/welcome.git
cd welcome
./install-local.sh
```

The installer links the extension into Cinnamon, adds **Welcome Settings** to the app menu,
and installs optional Touch Bar scenes if barkeep is present. It can be run again after updates.

Next, open **System Settings › Extensions**, select **Welcome** and enable it. (You may need to
restart Cinnamon first with <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Esc</kbd> or log out and back in.)

Note: the login transition only takes effect from your **next login**. Cinnamon's startup
animation has already run by the time you enable the extension mid-session. The unlock transition
and the preview buttons work straight away.

## Usage

Once enabled, open **Welcome Settings** from the app menu or run `./welcome-settings` from the
repository. Changes save immediately. Use the preview buttons to see a new version each time.
You can also use the extension's basic settings in **System Settings › Extensions › Welcome › Configure**.

For scripts and Touch Bar keys, `./welcome-settings --preview unlock`,
`./welcome-settings --preview login` and `./welcome-settings --preview lock` (a few seconds of the
lock-screen loop, then the unlock) play the current animation without opening the app. The
**Alt+1** through **Alt+6** shortcuts switch between the six settings pages.

Test the lock-screen loop and the unlock without typing a password (press a key such as Shift
after the first command to bring up the prompt):

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
2. Remove the optional Touch Bar scenes with `python3 tools/install-bar-scenes.py --remove`.
   This leaves all other scenes intact. Remove the app menu entry with
   `rm ~/.local/share/applications/io.github.luna_nyro.WelcomeSettings.desktop`.
3. Remove the extension files:
   ```sh
   rm ~/.local/share/cinnamon/extensions/welcome@luna-nyro.github.io   # the symlink (or rm -r for a copy)
   ```
4. Optionally, delete its saved settings:
   `rm -r ~/.config/cinnamon/spices/welcome@luna-nyro.github.io` (this path is where Cinnamon normally stores
   extension settings).

## Touch Bar

Six optional scenes follow the active settings page. **Esc** is first; **Unlock** and **Login**
play previews (on the Lock screen page, **Loop** previews the lock-screen loop); **Home**, **Lock**,
**Time**, **Flow**, **Reveal** and **Text** jump to the six pages. They use the app's own
Alt+1…Alt+6 shortcuts. To remove them, run
`python3 tools/install-bar-scenes.py --remove`. No Touch Bar is needed to use the app.

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
- **Seamless loop:** every moving term in the shader runs at a whole multiple of one base
  frequency (2π / 24 s), so the flow is exactly periodic. Speeding up just advances the same
  clock faster, which is how the unlock continues the loop without a jump.
- **Lock screen:** `cinnamon-screensaver` is a separate process, so the loop is drawn in the
  compositor. A shader effect on the screensaver's window gets a second texture: a stage-sized
  reference copy of the plain wallpaper. For each pixel it checks whether the lock window shows
  just the wallpaper under a uniform dark shade. Those pixels are replaced by the animated
  wallpaper at the same shade; anything else (text, icons, the entry, the avatar) is kept as it
  is. The shader only reads the lock window and the wallpaper, never the desktop. Pixel positions
  come from `gl_FragCoord`, because the lock window's own texture can be scaled and padded.
  Whether the prompt is up is inferred from the idle time (the screensaver hides it after 30 s).
- **Unlock:** while the lock screen is up, the overlay is parked at the top of `Main.uiGroup`,
  just under `global.top_window_group`, where the lock window lives. When the lock window is
  destroyed, the parked overlay takes over the loop in the same main-loop pass, before the next
  frame, so nothing visibly changes. The fast continuation starts on the screensaver's
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
- The lock-screen loop assumes the stock screensaver look (wallpaper under a 70% black shade). If
  a theme draws it differently, pixels simply fail the match and stay unchanged.
- While the loop runs, unredirection of fullscreen windows is turned off so the compositor
  draws the lock window; it is turned back on after unlock.
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
