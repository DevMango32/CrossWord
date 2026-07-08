import { writeFile, mkdir } from "node:fs/promises";

// ----- API 키 입력 (공개 저장소이므로 하드코딩 금지) -----
const KEY = process.argv[2];
if (!KEY) {
  console.error("발급키를 인자로 주세요: node tools/fetch-stdict.mjs <KEY>");
  process.exit(1);
}

// ----- 검색용 시드(완성형 초성+모음) -----
const seeds = [
  "가","갸","거","겨","고","교","구","규","그","기",
  "나","냐","너","녀","노","뇨","누","뉴","느","니",
  "다","댜","더","뎌","도","됴","두","듀","드","디",
  "라","랴","러","려","로","료","루","류","르","리",
  "마","먀","머","며","모","묘","무","뮤","므","미",
  "바","뱌","버","벼","보","뵤","부","뷰","브","비",
  "사","샤","서","셔","소","쇼","수","슈","스","시",
  "아","야","어","여","오","요","우","유","으","이",
  "자","쟈","저","져","조","죠","주","쥬","즈","지",
  "차","챠","처","쳐","초","쵸","추","츄","츠","치",
  "카","커","코","쿠","크","키",
  "타","터","토","투","트","티",
  "파","퍼","포","푸","프","피",
  "하","허","호","후","흐","히"
];

// ----- 표준국어대사전 API 호출 -----
async function fetchWords(query) {
  const url = new URL("https://stdict.korean.go.kr/api/search.do");
  url.searchParams.set("key", KEY);
  url.searchParams.set("q", query);
  url.searchParams.set("req_type", "json");
  url.searchParams.set("advanced", "y");
  url.searchParams.set("pos", "1,5,6");   // 명사(1), 동사(5), 형용사(6)
  url.searchParams.set("letter_s", "2");  // 2음절 이상
  url.searchParams.set("letter_e", "5");  // 5음절 이하
  url.searchParams.set("method", "include");
  url.searchParams.set("num", "100");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API 오류: ${res.status}`);
  return res.json();
}

function isClean(word) {
  return /^[가-힣]{2,5}$/.test(word);
}

const pool = new Map();

for (const seed of seeds) {
  const data = await fetchWords(seed);
  const items = data?.channel?.item ?? [];
  for (const it of items) {
    const w = String(it.word || "").trim();
    const def = it?.sense?.definition || "";
    if (isClean(w)) pool.set(w, { word: w, def });
  }
}

// ----- 결과 저장 -----
await mkdir("tmp", { recursive: true });
await writeFile("tmp/words.json", JSON.stringify([...pool.values()], null, 2), "utf8");

console.log("수집 완료:", pool.size, "개 단어 저장됨 → tmp/words.json");