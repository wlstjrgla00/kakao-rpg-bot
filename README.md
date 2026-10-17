# 카카오톡 채널 RPG 챗봇 (초기 MVP)

카카오 오픈빌더 스킬 API용 Cloudflare Worker + D1 게임 서버입니다.

## 현재 구현된 기능
- `게임시작`: 봇별 사용자 식별키로 캐릭터 생성
- `내정보`: 레벨/경험치/골드/스탯/스태미나/스테이지 조회
- `사냥`: 서버 전투 판정, 보상, 레벨업(+1 스탯 포인트), 스태미나 소모
- `스탯`, `힘 올리기`, `방어 올리기`, `민첩 올리기`: 포인트로 성장
- `랭킹`: 상위 10명
- `도움말`: 명령어 안내

## 준비
1. Node.js 20+ 설치. `npm install`
2. `npx wrangler login` 실행하여 Cloudflare 계정 로그인
3. `npx wrangler d1 create kakao-rpg-db` 실행
4. 결과의 database_id를 `wrangler.jsonc`의 REPLACE_WITH_REAL_D1_DATABASE_ID에 입력
5. 카카오 오픈빌더의 봇 ID를 `EXPECTED_BOT_ID`에 입력
6. `npx wrangler secret put KAKAO_SKILL_KEY` 실행: 랜덤 인증키 입력
7. `npm run db:remote` 실행
8. `npm run deploy` 실행
9. 오픈빌더의 스킬 URL로 `https://실제-worker주소/kakao/skill` 입력, HTTP 헤더에 `x-api-key` 및 인증키를 설정
10. 블록별 발화를 명령어에 연결하고 스킬 데이터 응답을 활성화, 테스트 후 배포

`GET /health`는 공개 헬스체크입니다. 게임 요청은 `POST /kakao/skill`만 받습니다.

## 주의사항
- 초기 MVP입니다. 보스/장비/인벤토리/출석/스태미나 회복은 아직 구현하지 않았습니다.
- 동일 유저의 동시 사냥은 버전 검사와 3초 쿨다운으로 제한하지만 완전한 중복 처리 방지는 아닙니다.
- 스태미나는 20에서 소모만 되고 자동 회복하지 않으므로 운영 전에 보완해야 합니다.
- 랭킹에는 기본 닉네임 '모험가'가 표시됩니다. 운영 전 닉네임 설정과 공개 동의가 필요합니다.
- `KAKAO_SKILL_KEY`는 GitHub에 넣지 말고 Cloudflare Secret으로 관리하세요.
