# Word Mashup — 서비스 전체 개요

> 5~7세 아동을 위한 영어 복합어 학습 웹 게임

**작성자**: 이진희 | **팀**: AI Product팀

---

## 1. 서비스 개요

| 항목 | 내용 |
|------|------|
| 서비스명 | **Word Mashup** |
| 장르 | 영어 학습 퍼즐 게임 |
| 대상 | 5~7세 한국 아동 |
| 플랫폼 | 웹 브라우저 (PC · 태블릿) |
| 접속 방법 | URL 직접 접속, 설치 불필요 |
| 언어 | 영어 콘텐츠 + 한국어 UI |

---

## 2. 핵심 학습 목표

영어 **복합어(Compound Word)** 를 두 단어 조각을 직접 합쳐보는 행위를 통해 자연스럽게 익힌다.

- **학습 방식**: 설명 없이 게임 안에서 직접 맞춰보며 체득
- **성공 기준**: 5세 아이가 혼자 앉아서 어른 도움 없이 6라운드를 완주

---

## 3. 게임 플로우

```
인트로 영상 재생
    ↓ SKIP 또는 영상 종료 후 START
로딩 화면 (BootScene)
    ↓
메인 게임 (GameScene) — 6라운드 반복
    ↓ 6라운드 완료
결과 화면 (Finale — Compound Book)
    ↓ Next Play
다시 GameScene 재시작
```

### 3-1. 인트로 영상

- 게임 시작 전 **intro.mp4** 전체 화면 재생
- 2초 후 **SKIP** 버튼 표시 (반투명 pill 스타일, 파동 애니메이션)
- 영상 종료 시 버튼이 **START** 로 전환 (더 크고 밝게)
- 클릭 시 페이드 아웃 후 게임 진입

### 3-2. 라운드 진행

한 세션당 **6라운드**, 30개 복합어 풀에서 무작위 선택.

```
라운드 시작 → 카드 등장 (float 애니메이션)
    ↓
왼쪽 카드 1장 선택 + 오른쪽 카드 1장 선택
    ↓
중앙 Gravity Zone에 드롭/탭으로 조합 시도
    ↓
정답 → 파티클 폭발 + 사운드 + 결과 카드 표시 → 다음 라운드
오답 → 카드 흔들림 + 오답 사운드 → 재시도
    ↓ 6라운드 완료
결과 화면
```

---

## 4. 게임 콘텐츠 (복합어 30종)

| # | Word 1 | Word 2 | Result | 발음 |
|---|--------|--------|--------|------|
| 1 | pan | cake | **pancake** | PAN·cake |
| 2 | sun | flower | **sunflower** | SUN·flow·er |
| 3 | star | fish | **starfish** | STAR·fish |
| 4 | rain | bow | **rainbow** | RAIN·bow |
| 5 | birth | day | **birthday** | BIRTH·day |
| 6 | butter | fly | **butterfly** | BUT·ter·fly |
| 7 | base | ball | **baseball** | BASE·ball |
| 8 | foot | ball | **football** | FOOT·ball |
| 9 | snow | ball | **snowball** | SNOW·ball |
| 10 | water | fall | **waterfall** | WA·ter·fall |
| 11 | moon | light | **moonlight** | MOON·light |
| 12 | fire | place | **fireplace** | FIRE·place |
| 13 | book | shelf | **bookshelf** | BOOK·shelf |
| 14 | cup | cake | **cupcake** | CUP·cake |
| 15 | sea | shell | **seashell** | SEA·shell |
| 16 | hand | bag | **handbag** | HAND·bag |
| 17 | door | bell | **doorbell** | DOOR·bell |
| 18 | eye | ball | **eyeball** | EYE·ball |
| 19 | key | board | **keyboard** | KEY·board |
| 20 | note | book | **notebook** | NOTE·book |
| 21 | play | ground | **playground** | PLAY·ground |
| 22 | snow | flake | **snowflake** | SNOW·flake |
| 23 | sun | rise | **sunrise** | SUN·rise |
| 24 | sun | set | **sunset** | SUN·set |
| 25 | tea | pot | **teapot** | TEA·pot |
| 26 | tooth | brush | **toothbrush** | TOOTH·brush |
| 27 | water | melon | **watermelon** | WA·ter·mel·on |
| 28 | week | end | **weekend** | WEEK·end |
| 29 | light | house | **lighthouse** | LIGHT·house |
| 30 | news | paper | **newspaper** | NEWS·pa·per |

---

## 5. 화면 구성

### 5-1. 게임 화면 (GameScene)

```
┌─────────────────────────────────────────────────────┐
│  [Compound Book ━━━━━━━] [★Score] [💰Coin] [💎Gem]  │  ← HUD
├─────────────────────────────────────────────────────┤
│                                                     │
│  [LEFT CARD] [LEFT CARD] [LEFT CARD]                │  ← 왼쪽 단어 카드 3장
│                                                     │
│                  ╔══════╗                           │
│                  ║  ✦   ║  ← Gravity Zone           │
│                  ╚══════╝    (조합 드롭 영역)         │
│                                                     │
│  [RIGHT CARD] [RIGHT CARD] [RIGHT CARD]             │  ← 오른쪽 단어 카드 3장
│                                                     │
├─────────────────────────────────────────────────────┤
│   [←Back]   [↺Replay]   [💡Hint]   [🎤Mic]         │  ← 하단 네비게이션
└─────────────────────────────────────────────────────┘
```

#### HUD 구성 요소

| 요소 | 역할 |
|------|------|
| Compound Book 진행 바 | 현재 라운드 진행률 (1/6 ~ 6/6) |
| ★ Score | 정답 맞출 때 획득 |
| 💰 Coin | 게임 내 재화 |
| 💎 Gem | 게임 내 재화 |
| ⚙️ 설정 | BGM / SFX 개별 토글 |

#### HUD 배지 레이아웃 상세 (Figma 기준 정렬)

상단 4종(뒤로가기 · Compound Book 알약 · 배지 3개 · 설정)을 **Figma 스펙(top=13, height=62)** 에 맞춰 통일 배치한다.

- **높이 통일**: 모든 요소의 "보이는 몸통 높이"를 `bodyH = sz(58)` 로 통일. 버튼(btn_back/btn_setting)은 viewBox 68에 몸통 58(그림자 여백 포함)이라, 정사각 `sz(68)`로 그린 뒤 y보정해 몸통을 정확히 `bodyH`로 맞춤.
- **우측 그룹 정렬**: 배지 3개 + 설정을 **오른쪽 끝 기준**으로 정렬(오른쪽 여백 = 왼쪽 back 여백 = `14 * sx`), 요소 간 간격은 `sz(12)` 로 균일. 뒤로가기↔Compound Book 간격도 동일하게 `sz(12)`.
- **컬러 3D 밑단**: 알약은 `hud_bar_main`(#3F2586 보라), 배지는 `badge_shadow`(#6A92BE 파랑)를 메인보다 `sz(4)` 아래에 깔아 입체 밑단 표현.
- **공통 드롭섀도**: 네 요소 모두 동일한 `drawTopShadow`(동심 소프트 섀도) 하나로만 그림 — 버튼의 baked 그림자를 제거하고 통일해 크기·톤 완전 일치.
- **진한 파란 바** (`0x426295`): 배지 숫자용 인셋 바.
- **+ 버튼**: 배지 우측 끝. 클릭 시 **재화 정책 안내 모달**(showCurrencyInfo) 표시.
- **Compound Book 알약**: 전체 클릭 시 **모은 단어 도감 팝업**(showCollection) 표시.
- 모든 버튼은 hover 시 손가락 커서(`useHandCursor`).

#### 하단 네비게이션 버튼

| 버튼 | 기능 |
|------|------|
| ← Back | 페이드 아웃 후 씬 재시작 |
| ↺ Replay | 현재 라운드 카드 재배치 |
| 💡 Hint | (예비) |
| 🎤 Mic | (예비) |

#### 카드 동작

- **카드 크기**: `CARD_SCALE = 0.972 × 0.8 × s` (기존 대비 80%로 축소, 화면 배율 `s` 비례)
- **배치**: 카드 6장 + Gravity Zone을 화면 중앙 기준 아래로 `30`(디자인px, 해상도 비례) 이동
- **Float 애니메이션**: 카드가 위아래로 부드럽게 떠다님
- **Drag & Drop**: 마우스/터치로 드래그 → Gravity Zone에 드롭
- **Tap 선택**: 좌우 카드를 순서대로 탭해도 조합 가능
- **선택/드래그 피드백**: 모든 스케일 트윈은 `baseScale`(= `CARD_SCALE`) 기준 상대값 — 선택 `×1.08`, 드래그 `×1.06`, 존 스냅 `×1.15`. (절대값 사용 시 축소된 카드가 클릭하면 원래 크기로 튀는 버그를 방지)
- **오답 피드백**: 카드 흔들기(shakeBack) → 원위치 복귀

#### 보기 카드 선택 규칙

- **정답 조합 1개만**: 보여지는 좌·우 카드로 만들 수 있는 실제 합성어가 **정답 쌍 하나뿐**이 되도록 distractor를 검증 선택 (좌측 distractor는 정답 word2와, 우측 distractor는 어떤 좌측 카드와도 합성어가 되지 않는 단어만).
- **중복 카드 금지**: 좌/우 각각 같은 단어 카드가 두 번 나오지 않음.

#### 카드 드래그 구현 방식 (거리 기반 그랩)

Phaser 히트존 + `setDraggable` 방식은 터치에서 `pointerover` 이벤트가 `touchstart` 이전에 발화하지 않아 겹친 카드 선택이 불안정했다. 이를 거리 기반 그랩으로 교체했다.

- **GRAB_R** = `(Math.hypot(CARD_W/2, CARD_H/2) * 0.972 * 0.8 + 20) * s` (카드 80% 축소·화면 배율 반영)
- `pointerdown` 시 zone 밖 카드 중 포인터와 가장 가까운 카드를 잡음 (동률이면 제일 가까운 카드 우선)
- `pointermove` 에서 `ptr.isDown` 확인 후 카드 위치 갱신
- `pointermove` 에서 동일 GRAB_R 기준으로 가장 가까운 카드가 있으면 커서를 `pointer`(손 모양)로 변경
- `pointerup` 에서 드롭 처리 후 커서를 `default`로 복원

#### Gravity Zone (중앙 조합 영역)

- 네온 glow 애니메이션 (색상 보간)
- 회전하는 스핀 아우라
- 카드 드롭 시 snapping (scale 1.15× 확대)

---

### 5-2. 결과 화면 — Compound Book

6라운드 완료 시 책 형태의 결과 팝업 등장.

```
┌────────────────────────────────────────────────────────┐
│  📖 Compound Book          [설정 패널 닫힘]             │
│  ─────────────────────────┬─────────────────────── ── │
│  (왼쪽 페이지)             │  (오른쪽 페이지)           │
│                           │                           │
│  이번 라운드               │  미획득 카드 도감           │
│  획득한 카드 6장           │  (회색 톤다운 + ?)         │
│  (컬러 팝인 애니메이션)     │  6장씩 페이지네이션        │
│                           │  ● ○ ○ ○ ○  ← 도트 인디케이터│
│                           │  ‹              ›         │
└───────────────────────────┴───────────────────────────┘
                   ▶ Next Play
```

#### 왼쪽 페이지 — 이번 회차 결과

- 이번 라운드에서 조합한 복합어 카드 **6장** (3열 × 2행)
- 신규 획득 카드: **Back.easeOut 팝인 + 파티클 버스트**
- 기존 보유 카드: 페이드 인

#### 오른쪽 페이지 — 미획득 카드 도감

- **미획득 카드만** 표시 (획득 카드는 제외)
- 실제 카드 이미지를 **회색 틴트(0x888888) + 투명도 40%** 로 표시
- 카드 위 **"?" 텍스트** (흰색, 그림자)
- **6장씩 페이지네이션** (최대 5페이지)
- 하단 **원형 도트 인디케이터** (활성: 진한 보라 / 비활성: 연한 반투명)
- `‹` / `›` 화살표 버튼으로 페이지 이동
- 전체 수집 시 "All Collected! 🎉" 메시지

#### 카운트 표시

- 오른쪽 상단 타이틀 위치: **`19 / 30`** 형태로 누적 획득 수

---

## 6. 도감 시스템 (Collection)

### 저장 방식

```
localStorage key: 'phonics_collected_v1'
value: JSON array of result strings
예시: ["pancake","sunflower","birthday","baseball",...]
```

### 동작 방식

- 라운드 정답 맞힐 때마다 결과 단어를 컬렉션에 추가
- **세션 초기화 후에도 유지** (localStorage 영속)
- 새 기기 / 시크릿 탭에서는 초기화됨
- 수동 초기화: 브라우저 콘솔에서 `localStorage.removeItem('phonics_collected_v1')`

---

## 7. 비주얼 & 애니메이션

### 파티클 시스템

| 텍스처 | 용도 |
|--------|------|
| pDot | 기본 원형 파티클 (폭발 효과) |
| ray | 흰색 캡슐 — 선버스트 방사 |
| rayGrad | 그라디언트 갓 레이 |
| starSpark | 4방향 별 반짝임 |
| cloudPuff | 흰 구름 퍼프 |

### 카드 시각 요소

| 타입 | 구성 |
|------|------|
| 이미지 카드 | PNG 배경 이미지 (card_left_*.png, card_right_*.png) |
| 결과 카드 | PNG 복합어 일러스트 (card_pancake.png 등 30종) |
| 폴백 카드 | 이모지 + 단어 텍스트 (이미지 로드 실패 시) |

### 컬러 팔레트 (카드 8가지 배색)

sky blue / rose pink / mint green / amber orange / lavender / butter yellow / ice blue / coral red

---

## 8. 오디오

| 항목 | 내용 |
|------|------|
| BGM | intro.mp4 오디오 트랙 루프 (게임 전반 동일 사운드) |
| SFX 정답 | Web Audio API 합성 — 상승 반짝임 4음 (A5·D6·G6·C7) |
| SFX 오답 | Web Audio API 합성 — 부드러운 하강 2음 (Eb4→Bb3) |
| 자동 재생 정책 | 첫 포인터 이벤트에서 AudioContext unlock |
| 토글 | BGM / SFX 각각 설정 패널에서 on/off |

---

## 9. 기술 스택

| 항목 | 버전 / 선택 |
|------|------------|
| 게임 프레임워크 | **Phaser 3.88.2** |
| 언어 | **TypeScript** |
| 빌드 도구 | **Vite 8.x** |
| 스케일 모드 | `Phaser.Scale.RESIZE` (전체 화면 대응) |
| 기준 해상도 | 1280 × 720 (p/q/sz 헬퍼로 비율 계산) |
| 저장소 | **localStorage** (서버 불필요) |
| 폰트 | Baloo 2, Inter (Google Fonts) |
| 배포 | **GitHub Pages** (GitHub Actions 자동 빌드) |

### 주요 파일 구조

```
src/
├── main.ts              — Phaser.Game 초기화 + 인트로 영상 오버레이
├── audio.ts             — BGM(HTMLAudio) + SFX(Web Audio API) 통합 관리
├── scenes/
│   ├── BootScene.ts     — 에셋 프리로드 + 로딩 바
│   └── GameScene.ts     — 핵심 게임 루프 (HUD, 카드, Zone, Finale)
├── objects/
│   └── WordCard.ts      — 드래그/탭 가능한 단어 카드 컴포넌트
└── data/
    └── compounds.ts     — 30개 복합어 데이터 + 카드 배색 스킴
```

### 스케일 헬퍼 (GameScene)

```typescript
const p  = (fx: number) => fx * GW / 1280;   // 가로 기준 픽셀
const q  = (fy: number) => fy * GH / 720;    // 세로 기준 픽셀
const sz = (f:  number) => f  * Math.min(GW / 1280, GH / 720);  // 균등 스케일
```

---

## 10. 배포

- **저장소**: GitHub (`jinilee-hue/phonics-wordmashup`)
- **CI/CD**: `main` 브랜치 push → GitHub Actions **공식 Pages 배포**(`actions/configure-pages` + `actions/upload-pages-artifact` + `actions/deploy-pages`)
- **빌드**: `npm run build` (tsc + vite build)
- **정적 자산**: 빌드 시 `dist/.nojekyll` 생성 — 번들 JS/SVG의 `{{ }}` / `{% %}` 시퀀스로 인한 Jekyll 빌드 실패 방지
- **필수 저장소 설정**:
  - Settings → Pages → **Source = "GitHub Actions"**
  - Settings → Environments → `github-pages` → **`main` 브랜치 배포 허용** (환경 보호 규칙)
  - (과거 `peaceiris/actions-gh-pages`(gh-pages 브랜치) 방식에서 전환 — 브랜치 기반 "pages build and deployment"가 실패하던 문제 해결)

---

## 11. 구현 현황

| 항목 | 상태 | 비고 |
|------|------|------|
| Hint 버튼 기능 | ✅ 구현됨 | 정답 카드 황색 glow·도트링 하이라이트 + 오답 카드 dim 처리 |
| Mic 버튼 기능 | ✅ 구현됨 | Web Speech API 음성 인식, 활성 시 링·웨이브 시각 피드백 |
| 발음 표기 표시 | ✅ 구현됨 | 결과 카드에 pron 텍스트 표시 (예: PAN · cake) |
| 코인/젬 적립 | ✅ 구현됨 | 정답 시 coin +15, gem +3 자동 적립 + 카운트업 애니메이션 |
| 재화 정책 안내 모달 | ✅ 구현됨 | + 버튼 클릭 → 별/동전/보석 모으기·혜택 안내 (좌측 상세 + 우측 목록 전환) |
| 도감 상시 열람 | ✅ 구현됨 | Compound Book 알약 클릭 시 언제든 도감 팝업(획득/미획득 카드, 페이지네이션) |
| 음성 발음 재생 | 🔲 미구현 | pron 텍스트 데이터는 완비, 오디오 재생 미구현 |
| 재화 지출/교환 실동작 | 🔲 미구현 | 정책 안내는 완료, 실제 힌트 차감·별↔동전 교환·보석 카드 소환 등 지출 로직 미연동 |
| 레벨/스테이지 구분 | 🔲 미구현 | 현재 단일 랜덤 라운드 방식 |
| 사용자 계정 / 클라우드 저장 | 🔲 미구현 | localStorage 로컬 저장만 지원 |
| 멀티플레이어 | 🔲 미구현 | — |

---

## 12. 최근 개선 사항 (2026-07-06)

### 재화 정책 & 안내 모달
- **정책 설계**: ⭐별(학습 포인트) — 정답 +10·첫 시도 보너스 / 힌트 −5·별100→동전1 교환. 🪙동전(게임 기회) — 별 교환·세트 완주 보너스 / 재도전 기회 1회. 💎보석(특별 도움) — 세트 완주·콤보 보너스 / 미획득 카드 보기 소환.
- **안내 모달**: `+` 버튼 클릭 시 표시. 좌측에 선택 재화 크게(고해상도 아이콘 + 모으기/쓰기), 우측에 3종 목록(탭하여 전환). 도감과 동일한 책 스프레드 틀(가운데 접힘선), 바깥 탭·X로 닫힘.

### 도감(Compound Book) 상시 열람
- 알약(Compound Book) 클릭 → 전체 30종 그리드(획득=컬러 카드 / 미획득=흐린 `?`), 획득 수, 페이지네이션, 두 페이지 스프레드.

### 상단 HUD Figma 정렬
- 뒤로가기·Compound Book·배지 3개·설정 **높이 통일(몸통 sz58)**, 우측 그룹 우측 정렬(여백 대칭)·간격 `sz(12)` 균일, 컬러 3D 밑단, **네 요소 공통 소프트 드롭섀도**.

### Gravity Zone
- 배경에 겹쳐 보이던 하늘색 복제 텍스트 제거(흰색 코어 1개만).
- 메인 링을 민트 링처럼 **핑크 한 색으로만** 은은히 발광, 바깥 눈금·점 핑크를 링 톤(#FF5BFD)에 통일(민트/시안은 유지).

### 에셋 · 렌더 품질
- 화살표·톱니·하단 버튼 아이콘을 **PNG로 교체**(SVG 필터 래스터라이즈 시 라인·지글거림 제거). 뒤로가기 화살표는 단일 stroke 경로로 재작성(이음새 제거).
- 별·동전·보석·책 **고해상도 아이콘(320px)** 교체 + 파일명 `_v2`로 캐시 무력화 + **preFX 소프트 드롭섀도**.
- 아이콘 PNG는 표시 크기에 맞춰 리사이즈해 다운스케일 앨리어싱 방지.

### 버그 수정
- 카드 클릭 시 크기가 튀던 문제(스케일 트윈을 `baseScale` 기준 상대값으로).
- 모든 버튼 hover 손가락 커서(카드 근접 `pointermove`가 커서를 덮어쓰던 문제 해결 — `overButton` 플래그).
- 보기 카드: 정답 조합 1개만·중복 카드 금지.
- `card_left_cake.png` 404 제거(cake는 word1로 미사용).
- 배포 실패 해결: GitHub 공식 Pages Actions로 전환 + `github-pages` 환경 `main` 브랜치 허용.

---

*최종 업데이트: 2026-07-06*
