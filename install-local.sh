#!/bin/sh
set -eu
root_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ext_dir="$HOME/.local/share/cinnamon/extensions"
app_dir="$HOME/.local/share/applications"
mkdir -p "$ext_dir" "$app_dir"
ln -sfn "$root_dir/welcome@luna-nyro.github.io" "$ext_dir/welcome@luna-nyro.github.io"
cat > "$app_dir/io.github.luna_nyro.WelcomeSettings.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Welcome Settings
Comment=Customize the login and unlock animation
Exec=$root_dir/welcome-settings
Icon=preferences-desktop-wallpaper
Categories=Settings;DesktopSettings;
Terminal=false
StartupNotify=true
EOF
update-desktop-database "$app_dir" 2>/dev/null || true
python3 "$root_dir/tools/install-bar-scenes.py"
printf 'Installed Welcome and Welcome Settings. Enable Welcome in Cinnamon Extensions.\n'
