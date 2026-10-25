# Word Mashup 3D

WebGL(three.js) 3D 버전. 원본 `jinilee-hue/phonics-wordmashup`(@3f32c16)을 복제한 별도 저장소이며, 원본은 건드리지 않는다.

## 실행
- `실행.command` 더블클릭 → http://127.0.0.1:5183/
- 또는 `npm install && npx vite --port 5183`

## 구조
- Phaser 캔버스를 투명하게 두고, 그 아래에 three.js 캔버스(`src/gl/`)를 깐다.
- Phaser가 규칙·입력·HUD·팝업·이펙트를 그대로 맡는다. 3D 층은 매 프레임 Phaser 객체(카드 위치·크기·알파, 존 위치)를 읽어 그린다.
  - `src/gl/stage.ts` — 렌더러·카메라(z=0 평면이 Phaser 좌표와 1:1)·배경·조명·패럴랙스
  - `src/gl/cards3d.ts` — 두께 있는 점토 카드(앞면 = 펴낸 카드 그림), 떠다님·기울기·들어올림·그림자·힌트
  - `src/gl/zone3d.ts` — Gravity Zone: 깔때기(중력 우물)·자이로 링·나선 입자·네온 글자
  - `src/gl/index.ts` — 품질 단계(high/mid/low), 느리면 단계 하향, 최후에는 2D로 복귀
- 카드 앞면: `tools/unwarp_cards.py`가 원본 카드 그림(기울기·두께가 그려진 PNG)에서 앞면만 찾아 정면으로 편다 → `public/gl/cards/*.webp`, `src/gl/cardFaces.ts`.
  - 실행: `uv run --with pillow --with numpy python tools/unwarp_cards.py [--debug DIR]`

## URL 옵션
- `?q=high|mid|low|2d` 품질 고정 (`2d` = 원본 2D)
- `?fps` 프레임 표시
- `?cal` 카드를 정면으로 고정(조명 보정용)
