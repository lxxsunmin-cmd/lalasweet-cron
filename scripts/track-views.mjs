// 조회수 자동 트래킹 — 회사 PC Apify 대체(클라우드).
// 캠페인 시트의 트래킹 탭에서 인스타 릴스 업로드 링크를 읽어, Apify로 현재 재생수(videoPlayCount)를
// 긁어 "오늘 날짜" 열에 누적조회수로 기록한다. (보드의 일별 추이는 이 누적값의 전일 대비 증가분으로 계산됨)
// secrets: APIFY_TOKEN, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY
import { google } from "googleapis";

const SHEET_ID = "1_lWuZ7ifU03Jd-U7v4CI1zomLOfhCcJp-pL8n3O0wHY";
const TABS = ["6월_트래킹_바이럴영상", "6월_트래킹_인플협찬"];
const ACTOR = "apify~instagram-scraper";

// ── 유틸 ──────────────────────────────────────────────────────────────────
function colLetter(idx0) {
  // 0-based 컬럼 인덱스 → A1 표기 (>=26 은 AA, AB...)
  let s = "", n = idx0;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
function kstToday() {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // UTC→KST
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
function shortcode(url) {
  const m = String(url || "").match(/instagram\.com\/(?:reel|reels|p|tv)\/([\w-]+)/i);
  return m ? m[1] : null;
}

async function apifyViews(urls) {
  // directUrls 모드로 릴스 재생수 수집 → { shortCode: videoPlayCount }
  if (!urls.length) return {};
  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${process.env.APIFY_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directUrls: urls, resultsType: "posts", resultsLimit: urls.length, addParentData: false }),
    }
  );
  if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const items = await res.json();
  const map = {};
  for (const p of items) {
    const code = p.shortCode || shortcode(p.url) || shortcode(p.inputUrl);
    if (!code) continue;
    const v = p.videoPlayCount ?? p.playCount ?? p.videoViewCount ?? null;
    if (typeof v === "number") map[code] = v;
  }
  return map;
}

async function trackTab(sheets, tab, viewByCode) {
  const range = `${tab}!A1:CZ400`;
  const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range })).data.values || [];
  const hIdx = rows.findIndex((r) => String(r?.[1] ?? "").trim() === "업로드 날짜");
  if (hIdx < 0) { console.log(`  [${tab}] 헤더 못 찾음 — 건너뜀`); return { tab, updated: 0 }; }
  const header = rows[hIdx];

  // 날짜열(K=10 이후, YYYY-MM-DD) 수집 + 오늘 열 찾기/추가
  const dateColIdxs = [];
  for (let j = 10; j < header.length; j++) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(header[j] ?? "").trim())) dateColIdxs.push(j);
  }
  const today = kstToday();
  let todayCol = header.findIndex((h, j) => j >= 10 && String(h ?? "").trim() === today);
  const isNewCol = todayCol < 0;
  if (isNewCol) todayCol = (dateColIdxs.length ? Math.max(...dateColIdxs) : 9) + 1;
  const cl = colLetter(todayCol);

  // 콘텐츠 행 매칭 → 오늘 셀에 쓸 값
  const data = [];
  if (isNewCol) data.push({ range: `${tab}!${cl}${hIdx + 1}`, values: [[today]] }); // 새 열 헤더
  let updated = 0, missing = 0;
  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!/^\d{4}[.\-]\d{1,2}[.\-]\d{1,2}/.test(String(r?.[1] ?? "").trim())) continue;
    const code = shortcode(r?.[6]); // G열 업로드 링크
    if (!code) continue;
    const v = viewByCode[code];
    if (typeof v !== "number") { missing++; continue; }
    data.push({ range: `${tab}!${cl}${i + 1}`, values: [[v]] });
    updated++;
  }
  if (data.length && process.env.DRY_RUN) {
    console.log(`  [${tab}] DRY_RUN — 쓰기 생략. 예시:`, data.slice(0, 3).map((d) => `${d.range}=${d.values[0][0]}`).join(", "));
  } else if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });
  }
  console.log(`  [${tab}] 오늘열 ${cl}(${today})${isNewCol ? " 신규" : ""} · 기록 ${updated} · 미수집 ${missing}`);
  return { tab, updated, missing };
}

async function main() {
  for (const k of ["APIFY_TOKEN", "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY"])
    if (!process.env[k]) throw new Error(`secret 누락: ${k}`);

  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, undefined,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/spreadsheets"]
  );
  const sheets = google.sheets({ version: "v4", auth });

  // 모든 탭의 릴스 링크 → 한 번에 스크랩(액터 부팅 비용 절약)
  const allUrls = new Set();
  const perTab = {};
  for (const tab of TABS) {
    const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!G1:G400` })).data.values || [];
    const urls = rows.flat().map((u) => String(u || "")).filter((u) => shortcode(u));
    perTab[tab] = urls;
    urls.forEach((u) => allUrls.add(u.split("?")[0]));
  }
  const urls = [...allUrls];
  console.log(`릴스 ${urls.length}개 Apify 수집 시작…`);
  const viewByCode = await apifyViews(urls);
  console.log(`조회수 수집됨: ${Object.keys(viewByCode).length}개`);

  let total = 0;
  for (const tab of TABS) total += (await trackTab(sheets, tab, viewByCode)).updated;
  console.log(`완료 — 총 ${total}개 콘텐츠 오늘 조회수 기록`);
}

main().catch((e) => { console.error("실패:", e.message); process.exit(1); });
