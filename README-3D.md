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
    - 카드 각도는 화면 축이 아니라 '카메라에서 카드를 보는 방향' 기준이라 어느 자리에 있어도 같은 각도로 보인다(원본 그림처럼).
      기본값 돌림 28°·뒤로 젖힘 10°·두께 30은 원본 그림의 옆벽·아랫벽 두께와 기울기에 맞춘 값(`tools/qa/pose_fit.py`).
    - 모서리: 앞면 그림·카드 몸통·베벨이 같은 원호 모서리(`FACE_RADIUS`, 원본 그림에서 잰 값)를 쓴다. 그림자·힌트 빛은 카드보다 먼저 그려서 카드 위로 덮이지 않는다.
  - `src/gl/zone3d.ts` — Gravity Zone: 깔때기(중력 우물)·자이로 링·나선 입자·네온 글자
  - `src/gl/travel.ts` — 라운드 사이 공간 이동: 정답 후 카메라가 존을 지나 배경의 아치 게이트로 날아감(속도선·플래시) → 다음 카드들이 게이트에서 날아와 자리에 앉음. 이동 중에는 입력을 막는다. 움직임 줄이기(reduced motion) 설정이면 원래처럼 옆에서 미끄러져 들어온다.
  - `src/gl/index.ts` — 품질 단계(high/mid/low), 느리면 단계 하향, 최후에는 2D로 복귀
- 배경 깊이: `tools/build_depth.py`가 배경 그림의 깊이 지도(Depth Anything V2 Small, 로컬 CPU)를 만들어 `public/gl/bg_depth.png`에 저장 → 배경이 입체 부조가 되어 카메라가 움직이면 시차가 생긴다(정지 화면은 원본과 똑같다).
  - 실행: `uv run --with torch --with transformers --with pillow --with numpy python tools/build_depth.py`
- 카드 앞면: `tools/unwarp_cards.py`가 원본 카드 그림(기울기·두께가 그려진 PNG)에서 앞면만 찾아 정면으로 편다 → `public/gl/cards/*.webp`, `src/gl/cardFaces.ts`.
  - 실행: `uv run --with pillow --with numpy python tools/unwarp_cards.py [--debug DIR]`
  - 텍스처는 불투명: 모양은 3D 앞면 도형이 자르고, 가장자리 5px은 안쪽 색으로 다시 채운다(벽색·번짐 제거). 실행하면 그림 모서리 반지름 측정값도 출력한다.

## URL 옵션
- `?q=high|mid|low|2d` 품질 고정 (`2d` = 원본 2D)
- `?fps` 프레임 표시
- `?cal` 카드를 정면으로 고정(조명 보정용)
- `?pose=돌림,젖힘,화면기울기비율,두께` 카드 각도 비교용 (예: `?pose=28,10,1,30`)
