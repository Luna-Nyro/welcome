# Contributing

Thanks for your interest! This is a small hobby project. Issues and pull requests are welcome,
but reviews may be slow.

## Layout

```
welcome@luna-nyro.github.io/
  extension.js         # all logic: GLSL shader, overlay, login/unlock controller
  metadata.json        # Cinnamon extension metadata (uuid, supported versions)
  settings-schema.json # options shown in System Settings › Extensions › Welcome
tools/
  dev.py               # hot-load / preview helper using Cinnamon's org.Cinnamon.Eval D-Bus method
```

## Dev loop

`tools/dev.py` sends JavaScript to the running Cinnamon through `org.Cinnamon.Eval`, so you can
iterate without restarting the shell:

```sh
tools/dev.py load              # (re)load extension.js into the running shell and enable it
tools/dev.py preview login     # play the login animation now
tools/dev.py preview unlock    # play the unlock animation now (default)
tools/dev.py disable           # tear down the hot-loaded copy
tools/dev.py -e 'js'           # evaluate arbitrary JS in the shell
```

Notes:

- A hot-loaded copy runs **without settings**: `ExtensionSettings` isn't available that way, so
  the defaults in `Welcome.opts` are used.
- Disable the installed extension before you hot-load. Otherwise two instances will both react to
  unlocks.
- The login hook only installs before Cinnamon's startup animation runs, so in a hot-loaded
  session you can test login with `preview login` only.
- To freeze one frame for inspection (the overlay is held for 2.5 s):
  ```sh
  tools/dev.py -e 'global.__welcomeTransition.opts.freezeAt=1.4; global.__welcomeTransition.preview("unlock")'
  tools/dev.py -e 'global.__welcomeTransition.opts.freezeAt=null'
  ```
- To test unlock without a password, see the `SetActive` commands in the README.
- To check the lock-screen shader, set a debug view before locking, then reset it:
  `tools/dev.py -e 'global.__welcomeTransition.opts.debugMask=1'` (1 = which pixels are replaced,
  white; 2 = the reference wallpaper; 3 = difference between lock window and reference, ×20).
  Use `0` to turn it off. A new value applies to the next lock.
- After a GType is registered it stays registered for the shell's lifetime, which is why
  `DualShaderEffect` is cached on `global` and picks a free type name when reloaded.
- Errors show up in Looking Glass (`cinnamon-looking-glass`) › *Log* and in `~/.xsession-errors`.

## Guidelines

- Keep the end state exact: every animation must finish on the plain, untouched wallpaper
  (`amp = 0`, `reveal = 1`, `fade = 1`).
- Keep the flow periodic: any new time term in `FLOW_COMMON` must use a whole multiple of `W`,
  or the lock-screen loop will jump once per cycle.
- Never leave an overlay covering the desktop when something fails. Errors on the login path must
  fall back to Cinnamon's original startup animation.
- Never put the overlay inside `global.top_window_group` (see README › How it works).
- If you change supported Cinnamon versions, update `cinnamon-version` in `metadata.json`.
- Test login (`preview login`, ideally a real login too), unlock (real lock and `SetActive`), and
  multi-monitor if you can.
