#!/usr/bin/env python3
"""Hot-load welcome@luna-nyro.github.io into the running shell and/or play a preview.
usage: dev.py load | dev.py preview [login|unlock] | dev.py disable | dev.py -e 'js'"""
import subprocess, sys, ast, os
EXT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "welcome@luna-nyro.github.io", "extension.js")
def ev(js):
    js = js.replace("\\", "\\\\")   # gdbus parses backslash escapes in string args
    r = subprocess.run(["gdbus", "call", "--session", "--dest", "org.Cinnamon", "--object-path", "/org/Cinnamon",
                        "--method", "org.Cinnamon.Eval", js], capture_output=True, text=True)
    print(r.stdout.strip()[:600] or r.stderr.strip())
cmd = sys.argv[1] if len(sys.argv) > 1 else "load"
if cmd == "load":
    src = open(EXT).read()
    ev("(function(){ try { if (global.__welcomeDev) { global.__welcomeDev.disable(); }\n" + src +
       "\n; global.__welcomeDev = { enable, disable }; enable(); return 'enabled'; } catch (e) { return 'ERR ' + e + ' @' + e.lineNumber; } })()")
elif cmd == "disable":
    ev("(function(){ if (global.__welcomeDev) { global.__welcomeDev.disable(); global.__welcomeDev = null; } return 'disabled'; })()")
elif cmd == "preview":
    kind = sys.argv[2] if len(sys.argv) > 2 else "unlock"
    ev(f"(function(){{ try {{ global.__welcomeTransition.preview('{kind}'); return 'playing'; }} catch (e) {{ return 'ERR ' + e; }} }})()")
elif cmd == "-e":
    ev(sys.argv[2])
