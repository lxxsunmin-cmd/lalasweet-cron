# lalasweet-cron
라라스윗 운영 콘솔용 외부 스케줄러. GitHub Actions가 5분마다 콘솔의 메일→슬랙 알림 엔드포인트를 호출합니다.
민감정보 없음(시크릿은 GitHub Actions Secret으로 암호화 보관).

<!-- enable actions -->

## track-views (조회수 자동 트래킹)
매일 KST 09:00, 캠페인 시트의 트래킹 탭(바이럴/인플) 인스타 릴스 업로드 링크를 읽어 Apify로 현재 재생수를 긁어 **오늘 날짜 열**에 누적조회수로 기록한다. (회사 PC Apify 트래커 대체 — PC 안 켜도 돌아감)
- 스크립트: `scripts/track-views.mjs`  · 워크플로: `.github/workflows/track-views.yml`
- secrets: `APIFY_TOKEN`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`
- 콘솔 결과트래킹 보드가 이 누적값으로 일별 증가분 추이를 표시
