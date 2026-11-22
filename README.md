# Word Mashup 3D

합성어 만들기 게임. 왼쪽 카드(앞 단어)와 오른쪽 카드(뒤 단어)를 하나씩 가운데 원(Gravity Zone)에 넣어 진짜 합성어를 만들어요(pan + cake = pancake). 맞으면 두 카드가 부딪혀 합성어 카드가 나오고, 튜터 글리(Glee)와 함께 그 단어를 따라 말해요. Phaser가 규칙·입력·HUD를 맡고 그 아래 three.js 층이 카드·무대·글리를 그려요 — 3D 구조·연출·글리 모델·카드 추가 방법은 [README-3D.md](README-3D.md).

- 플레이: https://jinilee-hue.github.io/phonics-wordmashup-3D/

## 실행·빌드·배포

- `npm install` → `npm run dev`(Vite 개발 서버). `실행.command`를 더블클릭하거나 `npx vite --port 5183`으로 띄우면 http://127.0.0.1:5183/ (QA 스크립트의 기본 주소).
- 빌드: `npm run build` = `tsc && vite build && node tools/drop_ort_wasm.mjs`. 마지막 단계는 Vite가 `dist/assets`에 복사한 onnxruntime `.wasm` 사본을 지워요. 기기 안 인식기는 사이트의 `stt/` 폴더에서 런타임을 받아서 이 사본은 쓰이지 않아요.
- `main`에 푸시하면 GitHub Actions(`.github/workflows/deploy.yml`, Node 20)가 `npm ci` → `npm run build` → GitHub Pages로 올려요.
- 주소 옵션: `?q=high|mid|low|2d`(품질 고정, `2d` = 원본 2D) · `?tutor=off`(글리의 진행·음성 끔) · `?glee=off`(글리 자체를 끔) · `?log`(듣기·판정 콘솔 로그) · `?debug`(phonics-api 시도를 화면에 표시). 나머지는 README-3D.md. 게임 상태는 `window.WM3D`.

## 화면과 조작

- **인트로**: 영상이 나오고 2초 뒤 SKIP, 영상이 끝나면 START. 한 번 누르면 소리가 켜져요.
- **카드**: 왼쪽 세 장(앞 단어), 오른쪽 세 장(뒤 단어). 한 장씩 끌어 가운데 원에 놓고, 양쪽이 다 들어가면 판정해요. 보이는 카드로 만들 수 있는 합성어는 정답 하나뿐이에요(`src/scenes/GameScene.ts` `startRound`). 틀리면 ✗와 함께 두 카드가 제자리로 돌아가요.
- **아래 버튼 줄**: Replay(새 게임) · Mic(두 단어를 말하면 카드가 들어감, 다시 누르면 취소) · Hint(정답 두 장을 빛내고 나머지를 흐리게, 3D에선 글리가 가리키며 이름을 말함) · Home(새로 고침 → 인트로).
- **위**: Compound Book(모은 합성어 도감) · 별/코인/보석 배지(누르면 설명) · 톱니(Settings: Music, Sounds, Speech server key).
- **글리**: 톡 누르면 말하고 뛰어요. 끌면 돌고, 길게(0.45초) 눌러 끌면 자리를 옮겨요(README-3D.md "글리 옮기기").

## 라운드

- 한 게임 6라운드(`ROUNDS`), 합성어 43쌍(`src/data/compounds.ts`)에서 무작위로 골라요. 위쪽에 `1 / 6` 진행.
- 한 라운드: 카드가 날아와 앉음 → 글리가 묻고 들음 → 정답이면 충돌 연출과 합성어 카드 → 글리 "Pan and cake make... pancake!" → **말하기 차례** → 칭찬 → 공간 이동(3D) → 다음 라운드.
- 6라운드가 끝나면 그 게임에서 만든 단어를 펼친 Compound Book과 Next Play(새 게임).

## 보상

- 이긴 라운드마다 **별 +10 · 코인 +15 · 보석 +3**, 그리고 그 합성어가 Compound Book에 들어가요(localStorage `phonics_collected_v1`).
- **보석은 기기에 남아요**(localStorage `wm.gems.v1`; 별·코인·하트는 게임마다 새로). Compound Book(위쪽 막대·결과 화면)의 '?' 카드를 누르면 보석 5 가격표, 한 번 더 누르면 보석 5개로 카드가 뒤집혀 열려요(단어 소리, 도감에 들어감). 보석이 모자라면 가격표가 흐리고 보석 배지가 흔들릴 뿐 아무것도 안 써요.
- 글리가 진행할 때(3D)는 이 보상을 말하기 차례가 끝날 때까지 붙잡아 두고, **단어를 말했을 때만** 줘요(`src/gl/index.ts` `holdForSay`). JUMP · 두 번 틀림 · 두 번 무음 · 판정 불가면 그 단어의 별·코인·보석·도감 카드는 없어요. 라운드 진행 자체는 그대로예요.
- 2D(`?q=2d`, 느린 기기 폴백)와 `?tutor=off`·`?glee=off`에는 말하기 차례가 없어서 이기면 바로 줘요.

## 글리 (튜터, `src/gl/tutor.ts`)

- 말풍선 없이 목소리로만 게임을 이끌어요. 한 번에 한 명만 말하고, 아이가 카드를 잡으면 말을 멈추고 그 카드를 읽어 줘요.
- 방문의 첫 게임은 인사 뒤에 **설명**(아래 "첫 게임 설명"), 다음 게임부터는 "Let's play again!". 라운드마다 "Which two go together?" 하고 들어요. 합성어를 말하면 두 장을 다 넣고, 카드 단어 하나를 말하면 그 카드를 넣고 "What goes with pan?" 하고 다시 들어요. 카드로 해도 돼요.
- 틀린 쌍은 목소리로 안내해요: 두 카드를 읽고 "That's not a word!" → 한 장이 맞았으면 그 카드를 다시 넣고 짝을 물어요. 둘 다 틀리면 1번째 "Let's try again!", 2번째 첫 카드를 넣어 주고 짝을 묻고, 3번째 힌트. Mic 버튼의 안내 토스트도 글리 목소리로 바뀌어요.
- 15초 동안 아무것도 안 하면 카드 하나를 가리키고, 28초면 힌트를 보여 줘요.
- 목소리: 파닉스 게임 공통 튜터 목소리(phonics-api TTS, Azure `en-US-AvaMultilingualNeural`을 예전 'aiden' 높이·빠르기로 맞춤). 영어 430줄. `uv run --quiet --with numpy python tools/build_glee_voice.py`(키 `~/.config/phonics-api/key`) → `public/gl/voice/`, `src/gl/gleeVoice.ts`.

## 말하기 차례 (파닉스 공통 규칙, `src/gl/tutor.ts` `sayTurn`)

1. 결과 카드가 뜨면 "Say it with me! Pancake!" → 6초 들어요(머리 옆 민트 귀 아이콘).
2. 통과 → 칭찬, 보상.
3. 틀림 → "Listen! Pan! Cake! Pancake! Your turn!" → 다시 들음. **두 번 틀리면 "Good try! Pancake!"** 로 끝(보상 없음).
4. 조용함 → "Pancake! Your turn!" 하고 한 번 더 기다려요(7.5초). 게임의 첫 무음 때는 먼저 흰 장갑이 JUMP를 두 번 누르고 글리가 가리키며 "Want to skip? Tap the jump button!". **두 번째 무음이면 보상 없이 넘어가요.**
5. **JUMP**(결과 카드 오른쪽 위 초록 동그라미, `src/gl/jump.ts`) → 듣기·대사를 바로 끊고 곧바로 다음 라운드로. 보상 없음.
6. 판정할 수 없음(마이크 거부·무응답, 인식기를 못 씀) → 차례 없이 넘어가요. 보상 없음.

결과 카드는 차례가 끝날 때까지 기다려요(멈춤 방지용 상한 60초).

## 판정 — phonics-api 먼저, 다음은 기기 안 whisper

- 모든 듣기는 게임이 직접 녹음해요(`src/gl/apiSR.ts` `recordTake`: 방 소음보다 큰 소리 150 ms로 시작, 0.7초 조용하면 끝).
- **말하기 차례**(`src/gl/sayJudge.ts`)
  1. phonics-api(키가 있는 기기): `/v1/speech/analyze`(서버는 녹음을 저장하지 않음)가 들은 소리열을 `PhonicsAPI.judge`가 합성어의 기대 소리열(`src/data/phonemes.ts`)과 비교해요. 두 부분 단어가 라이벌이라 "pan"만 말하면 통과하지 못해요.
  2. 키가 없거나 서버가 그 녹음에 실패하면 **같은 녹음**을 기기 안 whisper가 글자로 읽고 엄격하게 봐요: 합성어 한 단어(또는 복수형)이거나 두 부분을 이어서("pan cake", 같은 소리 표기 "see shell"). 비슷한 철자나 아무 소리는 통과하지 않아요.
  3. 둘 다 못 하면 `nojudge` → 보상 없이 넘어감.
- **글리의 질문과 Mic 버튼**은 글자를 써요(`hearText`): phonics-api `/v1/speech/transcribe`, 안 되면 whisper. Mic 버튼은 `GameScene.startMic`이 `new SpeechRecognition()`을 만드는데, `apiSR.ts`가 `window.SpeechRecognition`을 `LocalSR`로 바꿔 둬서 같은 길로 가요.
- **브라우저 음성 인식은 쓰지 않아요**(목소리가 구글로 감). 아이 목소리는 제3자 서버로 보내지 않아요.
- whisper: tiny.en 8-bit, 워커(`src/gl/stt.ts`, `sttWorker.ts`), 모델·런타임은 `public/stt/`(약 55 MB). 첫 탭이나 키 입력 때부터 백그라운드로 받아요. 아직 로딩 중이면 말하기 차례는 최대 8초 기다리고, 글리의 질문은 듣지 않고 카드로 답하게 해요.
- **마이크 권한 15초 제한**: 마이크 열기는 15초와 JUMP에 경주해요. 아무도 권한 창에 답하지 않거나 거부하면 이번 방문 동안 마이크 없음으로 쳐요(차례 없음, 보상 없음).
- 키: Settings › Speech server key(알약: 초록 Linked / Add key)에서 기기마다 한 번 넣고, localStorage `phonics_api_key`에 남아요. 공개 저장소라 코드·저장소에 넣지 않아요.
- 기대 소리열: `python3 tools/build_phonemes.py` → `src/data/phonemes.ts`(카드를 더하면 다시 돌림).

## 언어

- **언어 선택 없음.** 글리 목소리도 화면 글자도 영어만이에요(사용자 2026-11-22: "word mashup은 언어 선택 빼줘. 별도로 가기로 했잖아!" — 파닉스 공통 규칙의 언어 토글을 이 게임은 따르지 않아요). 한국어 음성(`public/gl/voice/ko/`)과 토글(`src/gl/lang.ts`, localStorage `wm-lang`)은 지웠어요.

## 첫 게임 설명 (`src/gl/tutor.ts` `teach`, `src/gl/howto.ts`)

방문(페이지를 연 뒤)의 첫 게임에서 1라운드를 하기 전에, 다른 파닉스 게임처럼 실제로 한 판을 보여 줘요(사용자 2026-11-22: "설명 있는게 맞지", Puzzle의 teachDemo와 같은 방식).

1. "Hi! I'm Glee!" → "Let's make new words together!" → "Look! Pick two cards that make one word."(두 줄을 가리킴)
2. 흰 장갑(JUMP 안내와 같은 `public/gl/hand.webp`)이 1라운드 정답 왼쪽 카드를 눌러 가운데 원에 끌어다 놓고, 오른쪽 카드도 똑같이. 카드를 집을 때마다 글리가 읽어 줘요("Pan!" "Cake!"). 놓기·판정은 게임의 것 그대로(`selectedLeft/Right` + `snapToZone` → `checkMatch`)라 두 카드가 진짜로 부딪혀 합성어 카드가 나와요 — "Pan and cake make... pancake!"
3. 말하기 차례를 잠깐 보여 줌: "Now say it! Pancake!" → 귀 아이콘 1.4초(마이크는 열지 않고 판정도 없음).
4. 합성어 카드가 빠지고 같은 1라운드를 다시 나눠 줘요 → "Now you try!" → 보통 라운드처럼 들어요.

- **아무것도 주지도 깎지도 않아요**: 별·코인·보석·하트·도감 카드·진행 막대·공통 기록 모두 그대로(`index.ts`가 설명의 `onRoundWin`을 건너뜀). 설명 동안 카드·Hint·Mic는 막혀 있어요.
- **SKIP**(오른쪽 아래, 아래 버튼 줄 높이의 흰 반투명 유리 알약 — phonics-kit 공통 규칙 1): 첫 대사부터 설명 끝(1라운드를 다시 나눠 줄 때)까지 보여요. 누르면 목소리와 장갑이 바로 멈추고 판이 아이 것이 돼요 — 장갑이 옮기던 카드는 제자리로, 부딪히는 중이었으면 1라운드를 다시 나눠 줘요(남은 충돌 연출은 `crashGen`으로 끊음).
- 같은 방문의 다음 게임(Replay)에는 설명이 없어요. Home은 페이지를 새로 열어서 다시 나와요. 2D(`?q=2d`)·`?tutor=off`·`?glee=off`에는 글리가 없어 설명도 없어요.
- 대사: `teach1` "Look! Pick two cards that make one word." · `teach_say` "Now say it!" · `teach_try` "Now you try!"(영어만). 카드 단어는 기존 `w_`·`mk_`·`r_` 대사.

## 기록

- 게임이 끝나면(6라운드 뒤) 파닉스 게임 공통 기록(localStorage `phonics.progress`)에 `word-mashup` 한 줄: 만든 단어 수, 말하기 통과 수(`said`)·차례 수(`sayTurns`), 별·코인·그 게임에서 번 보석, 보석으로 연 카드(`gemsSpent`·`cardsOpened`, 결과 화면에서 연 것도 그 줄에 더함), 시간, 틀린 쌍 수(`src/progress.ts`, phonics-kit `phonics-progress.js` 복사본). 기록만 하고 레벨 선택은 없어요. 2D도 기록해요(말하기 차례 없음).
- 그 밖의 localStorage: `phonics_collected_v1`(도감), `wm.gems.v1`(보석), `wm3d-glee-spot-v1`(글리 자리), `wm3d-quality-v2`(자동 품질), `phonics_api_key`.

## 도구

| 스크립트 | 하는 일 |
|---|---|
| `tools/build_glee_voice.py` | 글리 대사 음성(영어) |
| `tools/build_phonemes.py` | phonics-api 기대 소리열 |
| `tools/unwarp_cards.py` · `tools/build_depth.py` | 3D 카드 앞면 / 배경 깊이 지도(README-3D.md) |
| `tools/drop_ort_wasm.mjs` | 빌드 뒤 쓰지 않는 onnxruntime wasm 삭제 |
| `tools/qa/` | 헤드리스 QA — 목록은 `tools/qa/README.md` |

`tools/qa/tutor_flow.py`와 그 `FAKE_SR`를 가져다 쓰는 `tutor_guide.py`, `tools/qa/api_sr.py`는 **지금 코드와 맞지 않아요**. 앞의 둘은 브라우저 `SpeechRecognition`을 가짜로 바꿔 글리에게 말을 들려주는데, 이제 글리는 마이크를 직접 녹음하고 `apiSR.ts`가 `window.SpeechRecognition`을 `LocalSR`로 덮어써요. `api_sr.py`는 예전 Mic 연결(키가 없으면 브라우저 인식기)과 말하기 차례의 `transcribe` 로그를 전제로 해요(지금 말하기 차례는 `analyze`). 다시 쓰기 전에는 결과를 믿지 마세요.

## 파일

| 파일 | 역할 |
|---|---|
| `src/main.ts` | 인트로 영상·SKIP/START, Phaser 게임 시작, 3D 시작 |
| `src/scenes/GameScene.ts` | 규칙·입력·HUD·Mic·Hint·Settings·도감·피날레(Phaser). NUL 바이트가 섞여 있어 `grep -a`로 찾아요 |
| `src/data/compounds.ts` · `phonemes.ts` | 합성어 43쌍 / 기대 소리열 |
| `src/gl/index.ts` | 3D 층 연결, 품질 단계, 보상 붙잡기, JUMP 자리 |
| `src/gl/tutor.ts` · `glee.ts` · `gleeVoice.ts` · `jump.ts` · `howto.ts` | 글리 진행·첫 게임 설명 / 글리 모델 / 대사 데이터 / JUMP / 설명 SKIP·장갑 |
| `src/gl/apiSR.ts` · `sayJudge.ts` · `stt.ts` · `sttWorker.ts` | 녹음·글자 듣기·Mic / 말하기 판정 / 기기 안 whisper |
| `src/progress.ts` | 공통 기록 |
| `src/vendor/phonics-api.js` · `phonics-progress.js` | phonics-kit 복사본 — kit을 고친 뒤 다시 복사 |
| `public/gl/` · `public/stt/` | 3D 카드 앞면·글리 음성·배경 깊이 / whisper 모델·런타임 |
| `Word Mashup/` | 원본 카드 그림(`Images/`)과 인트로 영상 |
