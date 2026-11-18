# 나의 서가 — 노션 데이터베이스와 연동되는 독서 서가 웹사이트

노션 데이터베이스에 책을 적으면, GitHub Actions가 6시간마다 노션을 읽어
연도별 서가 웹사이트(GitHub Pages)를 다시 만들어 줍니다.
서버 비용이 들지 않고, 노션 토큰은 GitHub 비밀값(Secrets)에만 저장되어 밖으로 드러나지 않아요.

```
노션 데이터베이스 ──(6시간마다 / 수동 실행)──▶ GitHub Actions
                                         └─ scripts/fetch-notion.mjs → site/books.json
                                                                      └▶ GitHub Pages (site/)
```

## 폴더 구성

| 경로 | 설명 |
| --- | --- |
| `site/index.html` | 서가 페이지 (연도 탭, 책등, 펼친 페이지) |
| `site/books.json` | 책 데이터. 처음엔 샘플이 들어 있고, Actions가 실행되면 노션 내용으로 바뀜 |
| `site/fonts/` | Pretendard 글꼴 (SIL Open Font License) |
| `scripts/fetch-notion.mjs` | 노션 API로 데이터베이스를 읽어 `books.json`을 만드는 스크립트 (추가 설치 불필요) |
| `.github/workflows/deploy.yml` | 6시간마다 / 푸시할 때 / 수동으로 실행되는 배포 작업 |

---

## 1단계 · 노션 데이터베이스 만들기

노션에서 새 페이지 → `/database` → **데이터베이스 - 전체 페이지**를 만들고, 아래 속성을 추가하세요.
**속성 이름이 정확히 같아야** 합니다. (다른 이름을 쓰고 싶으면 `scripts/fetch-notion.mjs` 맨 위 `P` 목록을 함께 고치면 돼요.)

| 속성 이름 | 유형 | 필수 | 예시 / 설명 |
| --- | --- | --- | --- |
| 제목 | 제목(Title) | ✅ | 올란도 |
| 연도 | 숫자 | ✅ | 2026 — **읽은 해**. 이 값으로 선반이 나뉨 |
| 순서 | 숫자 | | 1, 2, 3… 선반 안에서의 순서 (비우면 만든 순서) |
| 분야 | 선택 | | 영미소설, 에세이, 시, 인문 … (장르 버튼에 쓰임) |
| 저자 | 텍스트 | | 버지니아 울프 (역자는 괄호로) |
| 출판사 | 텍스트 | | 평단출판사 |
| 발행연월 | 텍스트 또는 날짜 | | 2004년 1월 |
| 쪽수 | 숫자 | | 376 — 책등 두께가 됨 |
| 가격 | 숫자 또는 텍스트 | | 9500 |
| 감상 | 텍스트 | | 짧은 감상·메모 |
| 밑줄 | 텍스트 | | 밑줄 친 문장. **빈 줄로 구분**하면 여러 개. 끝에 `(p.93)`을 쓰면 쪽수로 표시. **굵게** 한 부분은 형광펜으로 강조 |
| 200자 요약 | 텍스트 | | 200자 요약 |
| 서가에 꽂기 | 체크박스 | | 체크 해제하면 서가에서 빠짐 (기록은 남기고 서가에만 숨기고 싶을 때) |

> 💡 밑줄 문장이 길다면 `밑줄` 속성 대신 **책 페이지 본문**에 글머리 기호(•)나 인용 블록으로 적어도 됩니다.
> `밑줄` 속성이 비어 있으면 본문의 글머리 기호·번호 목록·인용을 밑줄로, 일반 문단을 감상으로 읽어요.
> (`200자 요약`이라는 토글 안의 내용은 읽지 않습니다.)

## 2단계 · 노션 통합(Integration) 만들고 토큰 받기

1. https://www.notion.so/profile/integrations (또는 notion.so/my-integrations) 에 들어가 **새 통합 만들기**를 누릅니다.
2. 이름은 `서가`처럼 아무거나, 유형은 **내부(Internal)**, 워크스페이스를 선택하고 저장합니다.
3. **기능(Capabilities)**에서 *콘텐츠 읽기*만 켜 두면 충분해요. (쓰기 권한은 필요 없음)
4. **내부 통합 시크릿**(`ntn_...` 으로 시작)을 복사해 둡니다. → 이게 `NOTION_TOKEN`
5. 1단계의 데이터베이스 페이지 오른쪽 위 `•••` → **연결(Connections)** → 방금 만든 통합을 추가합니다.
   **이걸 빠뜨리면 404 오류**가 나요.

## 3단계 · 데이터베이스 ID 확인

데이터베이스를 전체 페이지로 열고 주소를 복사합니다.

```
https://www.notion.so/내워크스페이스/0123456789abcdef0123456789abcdef?v=...
                                    └──────── 이 32자리가 ID ────────┘
```

주소 전체를 그대로 넣어도 스크립트가 알아서 ID를 뽑아요. → 이게 `NOTION_DATABASE_ID`

## 4단계 · GitHub에 올리기

1. GitHub에서 새 저장소를 만듭니다. (예: `bookshelf`, 공개/비공개 모두 가능*)
2. 이 폴더의 파일을 전부 올립니다. (`.github` 폴더 포함 — 숨김 폴더라 빠뜨리기 쉬워요)
   ```bash
   cd notion-bookshelf
   git init && git add . && git commit -m "나의 서가"
   git branch -M main
   git remote add origin https://github.com/내아이디/bookshelf.git
   git push -u origin main
   ```
3. 저장소 **Settings → Secrets and variables → Actions → New repository secret**에서 두 개를 추가합니다.
   - `NOTION_TOKEN` : 2단계의 시크릿
   - `NOTION_DATABASE_ID` : 3단계의 ID (또는 주소)
4. **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 바꿉니다.
5. **Actions** 탭 → `노션에서 서가 만들기` → **Run workflow**를 누릅니다.
   1~2분 뒤 `https://내아이디.github.io/bookshelf/` 에서 서가를 볼 수 있어요.

\* 비공개 저장소에서 GitHub Pages를 쓰려면 유료 플랜이 필요해요. 무료라면 공개 저장소로 만드세요.
  (공개 저장소여도 노션 토큰은 Secrets에 있어서 보이지 않습니다. 다만 사이트 자체와 `books.json`은 누구나 볼 수 있어요.)

## 노션을 고친 뒤 반영되는 시점

- **자동**: 6시간마다 (`deploy.yml`의 `cron`을 바꾸면 주기 조절 가능. 예: 매일 아침 9시(한국) → `"0 0 * * *"`)
- **바로**: Actions 탭에서 **Run workflow**
- 페이지 오른쪽 아래에 `노션 기준 · 마지막 반영 시각`이 표시돼요.

## 내 컴퓨터에서 먼저 확인해 보기 (선택)

Node.js 18 이상이 필요합니다.

```bash
NOTION_TOKEN=ntn_xxx NOTION_DATABASE_ID=xxxxxxxx node scripts/fetch-notion.mjs
npx serve site        # 또는: cd site && python3 -m http.server
```

`books.json 생성 완료: 2024년 35권, …` 이 나오면 성공이에요.

## 바꾸고 싶을 때

| 바꿀 것 | 위치 |
| --- | --- |
| 연도별 목표 권수 | `scripts/fetch-notion.mjs` → `GOALS` |
| 장르별 표지 색 · 뒷면 종이 색 | `site/index.html` → `PALETTE`, `--paper-back` |
| 배경·선반 색 | `site/index.html` → `:root` 의 `--bg`, `.shelf` |
| 책 한 권에 보이는 밑줄 개수(기본 3) | `scripts/fetch-notion.mjs` → `pickQuotes(list, max = 3)` |

## 자주 나는 오류

| 메시지 | 해결 |
| --- | --- |
| `데이터베이스를 찾을 수 없어요` (404) | 데이터베이스 `•••` → 연결에 통합을 추가했는지, ID가 **데이터베이스** ID인지(일반 페이지 ID 아님) 확인 |
| `토큰이 올바르지 않아요` (401) | Secrets의 `NOTION_TOKEN` 다시 붙여넣기 |
| 사이트가 404 | Settings → Pages의 Source가 *GitHub Actions*인지, 워크플로가 초록색으로 끝났는지 확인 |
| 책이 안 보임 | `제목`과 `연도`가 둘 다 채워져 있는지, `서가에 꽂기`가 체크돼 있는지 확인 |
