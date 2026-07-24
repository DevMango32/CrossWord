// 퍼즐 다시 만들기: 2·3·4글자를 고루 섞는다.
//   node tools/gen-puzzles.mjs [시작날짜=2026-07-24]
// 시작날짜부터의 퍼즐만 갈아엎고, 지난 퍼즐(아카이브)은 그대로 둔다.
import { readFile, writeFile } from 'node:fs/promises'

const SIZE = 10
const CAP = { 2: 7, 3: 7, 4: 6 } // 길이별 한도 — 이 비율이 곧 2·3·4글자 섞임 정도
const MIN_WORDS = 19

const puzzles = JSON.parse(await readFile('src/puzzles.json', 'utf8'))
const extra = JSON.parse(await readFile('tools/extra-words.json', 'utf8'))

// 낱말 통: 기존 퍼즐에 쓰인 것 + 새로 채운 3·4글자
const bank = new Map()
for (const p of Object.values(puzzles)) for (const w of p.words) bank.set(w.answer, w.clue)
for (const [a, c] of extra) bank.set(a, c)

const byLen = { 2: [], 3: [], 4: [] }
for (const [answer, clue] of bank) byLen[[...answer].length]?.push({ answer, clue })

// 날짜를 씨앗으로 쓰는 난수 (같은 날은 언제 돌려도 같은 퍼즐)
function rngFor(seedStr) {
  let h = 2166136261
  for (const ch of seedStr) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const shuffled = (arr, rng) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const cellsOf = (w) =>
  [...w.answer].map((ch, i) => [w.dir === 'across' ? w.row : w.row + i, w.dir === 'across' ? w.col + i : w.col, ch])

// 격자에서 길이 2 이상으로 이어진 모든 줄. 이게 놓은 낱말들과 정확히 같아야
// "뜻 없는 글자 뭉치"가 안 생긴다.
function runs(grid) {
  const out = []
  for (const dir of ['across', 'down'])
    for (let a = 0; a < SIZE; a++) {
      let start = null
      let str = ''
      for (let b = 0; b <= SIZE; b++) {
        const ch = b < SIZE ? grid.get(dir === 'across' ? `${a},${b}` : `${b},${a}`) : undefined
        if (ch) {
          if (start === null) start = b
          str += ch
        } else {
          if (str.length > 1)
            out.push({ dir, row: dir === 'across' ? a : start, col: dir === 'across' ? start : a, answer: str })
          start = null
          str = ''
        }
      }
    }
  return out
}

const sig = (ws) => ws.map((w) => `${w.dir}|${w.row}|${w.col}|${w.answer}`).sort().join('\n')

// 한 판에 앞뒤 두 글자가 겹치는 낱말은 함께 쓰지 않는다.
// 망원경·망원렌즈, 수요일·목요일처럼 뜻풀이가 닮아 헷갈리기 때문.
const key2 = (a) => [`^${a.slice(0, 2)}`, `${a.slice(-2)}$`]

// 놓아 보고 격자가 여전히 성립하면 true.
// 격자를 통째로 다시 훑는 대신 낱말 주변만 본다 — 같은 값인데 수백 배 빨라서
// "더 못 넣을 때까지" 채워 넣을 수 있다.
function place(grid, dirs, placed, cand) {
  const cells = cellsOf(cand)
  if (cells.some(([r, c]) => r < 0 || c < 0 || r >= SIZE || c >= SIZE)) return false
  const across = cand.dir === 'across'
  const [hr, hc] = [cells[0][0], cells[0][1]]
  const [tr, tc] = [cells[cells.length - 1][0], cells[cells.length - 1][1]]
  // 앞뒤가 비어 있어야 한다 (기존 낱말 꼬리에 붙어 늘어나면 안 된다)
  if (grid.has(across ? `${hr},${hc - 1}` : `${hr - 1},${hc}`)) return false
  if (grid.has(across ? `${tr},${tc + 1}` : `${tr + 1},${tc}`)) return false
  let cross = 0
  for (const [r, c, ch] of cells) {
    const key = `${r},${c}`
    const cur = grid.get(key)
    if (cur !== undefined) {
      if (cur !== ch) return false
      if (dirs.get(key)?.has(cand.dir)) return false // 같은 방향 낱말과 포개짐
      cross++
    } else if (grid.has(across ? `${r - 1},${c}` : `${r},${c - 1}`) || grid.has(across ? `${r + 1},${c}` : `${r},${c + 1}`)) {
      return false // 직각 방향으로 뜻 없는 글자 뭉치가 생긴다
    }
  }
  if (!cross && placed.length) return false // 어디에도 안 걸치면 탈락
  if (cross === cells.length) return false // 새로 채우는 칸이 없으면 새 낱말이 아니다
  for (const [r, c, ch] of cells) {
    const key = `${r},${c}`
    grid.set(key, ch)
    ;(dirs.get(key) ?? dirs.set(key, new Set()).get(key)).add(cand.dir)
  }
  placed.push(cand)
  return true
}

function build(seed) {
  const rng = rngFor(seed)
  const grid = new Map()
  const dirs = new Map()
  const placed = []
  const used = new Set()
  const count = { 2: 0, 3: 0, 4: 0 }

  const first = shuffled(byLen[4], rng)[0]
  place(grid, dirs, placed, { ...first, dir: rng() < 0.5 ? 'across' : 'down', row: 2 + Math.floor(rng() * 2), col: 2 })
  key2(first.answer).forEach((k) => used.add(k))
  count[4]++

  const put = (word) => {
    // 이미 놓인 글자와 겹치는 자리를 전부 후보로 놓고 하나씩 시험
    const cands = []
    for (const [key, ch] of grid) {
      const [r, c] = key.split(',').map(Number)
      ;[...word.answer].forEach((wc, i) => {
        if (wc !== ch) return
        cands.push({ ...word, dir: 'across', row: r, col: c - i })
        cands.push({ ...word, dir: 'down', row: r - i, col: c })
      })
    }
    return shuffled(cands, rng).some((cand) => place(grid, dirs, placed, cand))
  }

  // 긴 낱말부터 한도까지 채우고, 더 들어갈 자리가 없을 때까지 되풀이한다.
  // 길이별 한도가 2·3·4글자 비율을 잡아 준다.
  for (let round = 0; round < 6; round++) {
    let progress = false
    for (const L of [4, 3, 2]) {
      for (const word of shuffled(byLen[L], rng)) {
        if (count[L] >= CAP[L]) break
        if (key2(word.answer).some((k) => used.has(k)) || !put(word)) continue
        key2(word.answer).forEach((k) => used.add(k))
        count[L]++
        progress = true
      }
    }
    if (!progress) break
  }
  return placed
}

// 여러 씨앗을 돌려 가장 알찬 판을 고른다 (자리가 안 나와 낱말이 적게 붙는 날 대비)
function makePuzzle(date) {
  let best = []
  for (let k = 0; k < 400; k++) {
    const ws = build(`${date}#${k}`)
    if (ws.length > best.length) best = ws
    if (best.length >= 20) break
  }
  if (best.length < MIN_WORDS) throw new Error(`${date}: 낱말 ${best.length}개뿐`)
  // 낱말이 자란 방향 때문에 한쪽으로 쏠린다 — 쓴 칸 전체를 격자 가운데로 민다
  const cells = best.flatMap(cellsOf)
  const rows = cells.map(([r]) => r)
  const cols = cells.map(([, c]) => c)
  const dr = Math.floor((SIZE - 1 - Math.max(...rows) - Math.min(...rows)) / 2)
  const dc = Math.floor((SIZE - 1 - Math.max(...cols) - Math.min(...cols)) / 2)
  return {
    size: SIZE,
    words: best
      .map((w) => ({ ...w, row: w.row + dr, col: w.col + dc }))
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map((w) => ({ dir: w.dir, row: w.row, col: w.col, answer: w.answer, clue: bank.get(w.answer) })),
  }
}

// ---- 만들고 검사하고 저장 ----
const from = process.argv[2] ?? '2026-07-24'
const mix = { 2: 0, 3: 0, 4: 0 }
for (const date of Object.keys(puzzles).filter((d) => d >= from)) {
  const p = makePuzzle(date)
  const grid = new Map()
  for (const w of p.words) for (const [r, c, ch] of cellsOf(w)) grid.set(`${r},${c}`, ch)
  if (sig(runs(grid)) !== sig(p.words)) throw new Error(`${date}: 격자와 낱말 목록이 어긋남`)
  if (p.words.some((w) => !w.clue)) throw new Error(`${date}: 뜻풀이 없는 낱말`)
  for (const w of p.words) mix[[...w.answer].length]++
  puzzles[date] = p
}
await writeFile('src/puzzles.json', JSON.stringify(puzzles, null, 2) + '\n')
console.log('길이별 낱말 수', mix)
