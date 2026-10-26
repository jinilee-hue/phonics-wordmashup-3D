# QA scripts (headless Chrome, never touch the user's browser)

Run against the dev server (`실행.command` or `npx vite --port 5183`). Screens go to `$WM3D_OUT` (default /tmp/wm3d).

- `uv run --with playwright python tools/qa/wm3d_shot.py 'http://127.0.0.1:5183/?q=high' tag` — idle / hover / drag / zone / hint / impact / result / next round
- `uv run --with playwright python tools/qa/regress.py` — `?q=2d` fallback, Compound Book over 3D, 1180x820 touch round
- `uv run --with playwright --with pillow --with numpy python tools/qa/calibrate.py` — `?cal` face colour vs card art (linear ratio, target ~1.0)
- `uv run --with pillow --with numpy python tools/qa/rim_profile.py public/gl/cards` — un-warp check: wall-side rim vs far-side rim
- `uv run --with playwright python tools/qa/zone_shot.py URL out.png [WxH] [dpr]` — one settled still

Always pass `?q=high`: on SwiftShader the auto quality judge would fall back to 2D.
- `uv run --with playwright python tools/qa/wm3d_travel.py URL tag [--full] [--reduced]` — round-to-round travel: frozen-clock stills, round 2/3 playable, full game to the finale, reduced-motion path
- `uv run --with playwright python tools/qa/travel_video.py URL out.mp4` — preview video of the travel (frozen clock, 30 fps, needs ffmpeg)
- `uv run --with playwright python tools/qa/quality_check.py` — auto quality (no ?q, real GPU via Metal): rule table, stale v1 "2d" ignored, stays 3D
- `uv run --with playwright python tools/qa/gpu_cost.py URL 1440x900 2` — real GPU ms per 3D frame (render + gl.finish); headless rAF intervals are NOT a speed measure
- `uv run --with playwright python tools/qa/pose_fit.py URL [yaws] [pitches] [thicks]` — measure 3D card pose metrics (near wall, bottom wall, edge lean, face aspect) on a grid and rank them against the art's medians
- `uv run --with playwright --with pillow python tools/qa/pose_compare.py URL tag name=yaw,pitch,roll,thick ...` — same seeded round: original 2D cards (Phaser sprites shown in the 3D page) next to 3D poses
- `uv run --with playwright --with pillow python tools/qa/corner_zoom.py URL tag` — DPR-2 close-ups of every card corner
- `uv run --with playwright python tools/qa/card_probe.py URL tag` — which mesh is it? material state, shadows off, cards only, 3D canvas only, body/face painted
