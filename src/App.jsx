import { useEffect, useMemo, useRef, useState } from 'react'
import puzzles from './puzzles.json'
import './App.css'

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 제호에 쓰는 신문식 날짜: 2026년 7월 9일 (목)
function kdate(key) {
  const [y, m, d] = key.split('-').map(Number)
  return `${y}년 ${m}월 ${d}일 (${'일월화수목금토'[new Date(y, m - 1, d).getDay()]})`
}

// ponytail: 풀이 시간은 벽시계 기준(자리 비운 시간 포함), 하루 넘으면 일 단위로 뭉뚱그림
function fmtTime(s) {
  if (s >= 86400) return `${Math.floor(s / 86400)}일`
  if (s >= 3600) return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`
  if (s >= 60) return `${Math.floor(s / 60)}분 ${s % 60}초`
  return `${s}초`
}

const today = fmt(new Date())
const allDates = Object.keys(puzzles).sort()
// ponytail: 오늘 퍼즐이 없으면 가장 최근 과거 퍼즐로 폴백
const latestKey = puzzles[today] ? today : (allDates.filter((k) => k <= today).pop() ?? allDates[0])
// 지난 퍼즐 아카이브: URL 해시(#YYYY-MM-DD)로 선택. 미래 날짜는 차단
const hashDate = decodeURIComponent(location.hash.slice(1))
const dateKey = puzzles[hashDate] && hashDate <= latestKey ? hashDate : latestKey
const puzzle = puzzles[dateKey]
const playable = allDates.filter((k) => k <= latestKey)
// ponytail: 상태가 전부 모듈 레벨 상수라 날짜 이동은 그냥 새로고침
const goDate = (delta) => {
  const d = playable[playable.indexOf(dateKey) + delta]
  if (d) {
    location.hash = d
    location.reload()
  }
}

// 단어 목록에서 격자 유도. 교차점 글자가 어긋나면 콘솔 경고 (퍼즐 제작 실수 방지)
function buildGrid(p) {
  const cells = new Map()
  p.words.forEach((w, wi) => {
    ;[...w.answer].forEach((ch, k) => {
      const r = w.dir === 'across' ? w.row : w.row + k
      const c = w.dir === 'across' ? w.col + k : w.col
      if (r >= p.size || c >= p.size) console.warn(`퍼즐 오류: "${w.answer}"가 격자를 벗어남`)
      const key = `${r},${c}`
      const cell = cells.get(key) ?? { r, c, answer: ch, words: {}, num: null }
      if (cell.answer !== ch) console.warn(`퍼즐 오류: (${r},${c}) 교차 글자 불일치 "${cell.answer}" ≠ "${ch}" (${w.answer})`)
      cell.words[w.dir] = wi
      cells.set(key, cell)
    })
  })
  // 시작 칸에 읽기 순서대로 번호 부여
  const wordNums = p.words.map(() => 0)
  let n = 0
  for (let r = 0; r < p.size; r++)
    for (let c = 0; c < p.size; c++) {
      const starts = p.words.map((w, wi) => wi).filter((wi) => p.words[wi].row === r && p.words[wi].col === c)
      if (starts.length) {
        n++
        cells.get(`${r},${c}`).num = n
        starts.forEach((wi) => (wordNums[wi] = n))
      }
    }
  return { cells, wordNums }
}

function wordCells(w) {
  return [...w.answer].map((_, k) => (w.dir === 'across' ? `${w.row},${w.col + k}` : `${w.row + k},${w.col}`))
}

const storeKey = `crossword-state-${dateKey}`

// Tab 순환 순서: 열쇠 목록 표시 순서와 동일하게 가로 먼저, 세로 다음
const wordOrder = [
  ...puzzle.words.map((w, wi) => (w.dir === 'across' ? wi : -1)),
  ...puzzle.words.map((w, wi) => (w.dir === 'down' ? wi : -1)),
].filter((wi) => wi >= 0)

export default function App() {
  const { cells, wordNums } = useMemo(() => buildGrid(puzzle), [])
  const saved = useMemo(() => JSON.parse(localStorage.getItem(storeKey) || 'null'), [])
  const [entries, setEntries] = useState(saved?.entries ?? {})
  const [attempts, setAttempts] = useState(saved?.attempts ?? 0)
  const [hints, setHints] = useState(saved?.hints ?? 0)
  const [done, setDone] = useState(saved?.done ?? false)
  const [startTs, setStartTs] = useState(saved?.start ?? null) // 첫 입력 시각
  const [elapsed, setElapsed] = useState(saved?.time ?? null) // 완성까지 걸린 초
  const [result, setResult] = useState(null) // 확인 후 key -> 정답 여부
  const [activeWi, setActiveWi] = useState(0)
  const [copied, setCopied] = useState(false)
  const [streak, setStreak] = useState(() => {
    const s = JSON.parse(localStorage.getItem('crossword-streak') || 'null')
    return saved?.done && s?.last === dateKey ? s.count : 0
  })
  const [theme, setTheme] = useState(
    () => localStorage.getItem('crossword-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  )
  const inputs = useRef({})

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('crossword-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(storeKey, JSON.stringify({ entries, attempts, hints, done, start: startTs, time: elapsed }))
  }, [entries, attempts, hints, done, startTs, elapsed])

  const activeKeys = new Set(wordCells(puzzle.words[activeWi]))

  const setCell = (key, ch) => {
    if (!startTs) setStartTs(Date.now())
    setEntries((e) => ({ ...e, [key]: ch }))
    setResult(null)
  }

  const focusCell = (key) => {
    const el = inputs.current[key]
    if (el) {
      el.focus()
      el.select()
    }
  }

  const step = (key, delta) => {
    const cell = cells.get(key)
    const dir = puzzle.words[activeWi].dir
    const next = dir === 'across' ? `${cell.r},${cell.c + delta}` : `${cell.r + delta},${cell.c}`
    if (cells.has(next)) focusCell(next)
  }

  const onCellClick = (key) => {
    const ws = cells.get(key).words
    const both = Object.values(ws)
    // 같은 칸을 다시 누르면 가로/세로 전환
    if (both.length === 2 && both.includes(activeWi)) setActiveWi(both.find((wi) => wi !== activeWi))
    else setActiveWi(ws.across ?? ws.down)
  }

  // input은 uncontrolled — controlled로 하면 React가 조합(IME) 중인 입력창을
  // 이전 값으로 되돌려서 한글 입력이 끊긴다. DOM 값은 여기서 직접 정리한다.
  const onInput = (key, e) => {
    if (e.nativeEvent?.isComposing) return // 한글 조합 중에는 건드리지 않음
    const ch = [...e.target.value.trim()].pop() ?? ''
    e.target.value = ch
    setCell(key, ch)
    if (ch) step(key, 1)
  }

  // Windows IME는 음절 단위로 조합이 끝나므로 여기서 확정하고 다음 칸으로 이동
  const onCompose = (key, e) => {
    const ch = [...e.data.trim()].pop() ?? ''
    e.target.value = ch
    setCell(key, ch)
    if (ch) step(key, 1)
  }

  const onKeyDown = (key, e) => {
    if (e.nativeEvent?.isComposing) return // 조합 중 백스페이스는 IME에 맡김
    const cell = cells.get(key)
    const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }
    if (moves[e.key]) {
      e.preventDefault()
      const [dr, dc] = moves[e.key]
      const next = `${cell.r + dr},${cell.c + dc}`
      if (cells.has(next)) focusCell(next)
    } else if (e.key === 'Tab') {
      e.preventDefault() // 다음/이전 열쇠 단어로 점프 (열쇠 하이라이트도 함께 이동)
      const pos = wordOrder.indexOf(activeWi)
      const next = wordOrder[(pos + (e.shiftKey ? -1 : 1) + wordOrder.length) % wordOrder.length]
      setActiveWi(next)
      focusCell(`${puzzle.words[next].row},${puzzle.words[next].col}`)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      step(key, 1) // 진행 방향(가로/세로)의 다음 칸으로
    } else if (e.key === 'Backspace' && !entries[key]) {
      e.preventDefault()
      step(key, -1)
    }
  }

  const check = () => {
    const res = {}
    let all = true
    for (const [key, cell] of cells) {
      res[key] = (entries[key] ?? '') === cell.answer
      if (!res[key]) all = false
    }
    setResult(res)
    setAttempts((a) => a + 1)
    if (all && !done) {
      setDone(true)
      if (startTs) setElapsed(Math.round((Date.now() - startTs) / 1000))
      // 지난 퍼즐(아카이브)은 연속 기록에 반영하지 않음
      if (dateKey !== latestKey) return
      const s = JSON.parse(localStorage.getItem('crossword-streak') || 'null')
      // 달력상 전날이 아니라 "직전 퍼즐 날짜" 기준 (퍼즐이 빠진 날에 끊기지 않게)
      const prevDay = allDates[allDates.indexOf(dateKey) - 1]
      const count = s?.last === dateKey ? s.count : s?.last === prevDay ? s.count + 1 : 1
      localStorage.setItem('crossword-streak', JSON.stringify({ last: dateKey, count }))
      setStreak(count)
    }
  }

  // 힌트: 진행 중인 단어에서 틀리거나 빈 첫 칸을 공개, 없으면 격자 전체에서
  const hint = () => {
    const key = [...wordCells(puzzle.words[activeWi]), ...cells.keys()].find(
      (k) => (entries[k] ?? '') !== cells.get(k).answer,
    )
    if (!key) return
    const ch = cells.get(key).answer
    if (inputs.current[key]) inputs.current[key].value = ch // uncontrolled input이라 DOM도 직접 갱신
    setCell(key, ch)
    setHints((h) => h + 1)
  }

  const share = async () => {
    const lines = [`🧩 매일 낱말퀴즈 ${dateKey}`, `✅ 확인 ${attempts}번 만에 완성!`]
    if (elapsed != null) lines.push(`⏱ ${fmtTime(elapsed)} 걸렸어요`)
    if (hints) lines.push(`💡 힌트 ${hints}개 사용`)
    if (dateKey === latestKey) lines.push(`🔥 연속 ${streak}일째`)
    const text = [...lines, location.href].join('\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const clueList = (dir, title) => (
    <div className="clues">
      <h2>
        <span className="bullet" />
        {title}
      </h2>
      <ol>
        {puzzle.words.map((w, wi) =>
          w.dir === dir ? (
            <li
              key={wi}
              className={wi === activeWi ? 'active' : ''}
              onClick={() => {
                setActiveWi(wi)
                // 첫 빈 칸으로, 다 채웠으면 단어 시작 칸으로
                focusCell(wordCells(w).find((k) => !entries[k]) ?? `${w.row},${w.col}`)
              }}
            >
              <b>{wordNums[wi]}.</b> {w.clue} ({w.answer.length}글자)
            </li>
          ) : null,
        )}
      </ol>
    </div>
  )

  return (
    <div className="app">
      <header>
        <div className="mast-top">
          <span>제 {playable.indexOf(dateKey) + 1} 호</span>
          <span>
            <button className="nav-btn" onClick={() => goDate(-1)} disabled={playable.indexOf(dateKey) === 0} aria-label="이전 퍼즐">
              ◀
            </button>
            {kdate(dateKey)}
            <button className="nav-btn" onClick={() => goDate(1)} disabled={dateKey === latestKey} aria-label="다음 퍼즐">
              ▶
            </button>
          </span>
          <span>
            값 없음 · 자유 배포
            <button
              className="theme-btn"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              aria-label="다크모드 전환"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </span>
        </div>
        <h1>가로세로 낱말풀이</h1>
        <p className="sub">
          {dateKey !== latestKey
            ? '지난 호 다시 풀기'
            : dateKey !== today
              ? '오늘의 퍼즐이 아직 없어 최근 호를 보여드려요'
              : '매일 아침, 우리말 한 판'}
        </p>
      </header>

      <div className="layout">
        <div className="left">
      <div className="board" style={{ gridTemplateColumns: `repeat(${puzzle.size}, 1fr)` }}>
        {Array.from({ length: puzzle.size * puzzle.size }, (_, i) => {
          const key = `${Math.floor(i / puzzle.size)},${i % puzzle.size}`
          const cell = cells.get(key)
          if (!cell) return <div key={key} className="cell black" />
          const cls = [
            'cell',
            activeKeys.has(key) && 'hl',
            result && (result[key] ? 'ok' : 'bad'),
            done && 'ok',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div key={key} className={cls} onMouseDown={() => onCellClick(key)}>
              {cell.num && <span className="num">{cell.num}</span>}
              <input
                ref={(el) => (inputs.current[key] = el)}
                defaultValue={entries[key] ?? ''}
                disabled={done}
                onChange={(e) => onInput(key, e)}
                onCompositionEnd={(e) => onCompose(key, e)}
                onKeyDown={(e) => onKeyDown(key, e)}
                onFocus={(e) => e.target.select()}
                aria-label={`${cell.r + 1}행 ${cell.c + 1}열`}
              />
            </div>
          )
        })}
        {done && (
          <div className="stamp" aria-hidden="true">
            <span>완성</span>
          </div>
        )}
      </div>

      {done ? (
        <div className="panel">
          <p>
            🎉 완성! 확인 {attempts}번{elapsed != null && ` · ⏱ ${fmtTime(elapsed)}`}
            {hints > 0 && ` · 💡 힌트 ${hints}개`}
            {dateKey === latestKey && ` · 🔥 연속 ${streak}일째`}
          </p>
          <button onClick={share}>{copied ? '복사됨!' : '결과 복사하기'}</button>
          <p className="hint">내일 자정에 새 퍼즐이 열려요.</p>
        </div>
      ) : (
        <div className="panel">
          <button onClick={check}>정답 확인</button>
          <button className="ghost" onClick={hint}>
            💡 힌트{hints > 0 && ` (${hints})`}
          </button>
          <button className="ghost" onClick={() => window.print()}>
            🖨 인쇄
          </button>
          {result && <p className="hint">빨간 칸이 틀린 곳이에요. ({attempts}번 확인)</p>}
        </div>
      )}
      <p className="help">칸을 클릭해 입력 · Tab 다음 열쇠 · ←↑↓→ 이동 · Enter 다음 칸</p>
        </div>

        <aside className="clue-cols">
          {clueList('across', '가로 열쇠')}
          {clueList('down', '세로 열쇠')}
        </aside>
      </div>
    </div>
  )
}
