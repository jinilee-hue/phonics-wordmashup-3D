# QA scripts (headless Chrome, never touch the user's browser)

Run against the dev server (`실행.command` or `npx vite --port 5183`). Screens go to `$WM3D_OUT` (default /tmp/wm3d).

- `uv run --with playwright python tools/qa/wm3d_shot.py 'http://127.0.0.1:5183/?q=high' tag` — idle / hover / drag / zone / hint / impact / result / next round
- `uv run --with playwright python tools/qa/regress.py` — `?q=2d` fallback, Compound Book over 3D, 1180x820 touch round
- `uv run --with playwright --with pillow --with numpy python tools/qa/calibrate.py` — `?cal` face colour vs card art (linear ratio, target ~1.0)
- `uv run --with pillow --with numpy python tools/qa/rim_profile.py public/gl/cards` — un-warp check: wall-side rim vs far-side rim
- `uv run --with playwright python tools/qa/zone_shot.py URL out.png [WxH] [dpr]` — one settled still

Always pass `?q=high`: on SwiftShader the auto quality judge would fall back to 2D.
