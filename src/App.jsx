import { useEffect, useMemo, useRef, useState } from 'react'
import puzzles from './puzzles.json'
import './App.css'

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const today = fmt(new Date())
const allDates = Object.keys(puzzles).sort()
// ponytail: 오늘 퍼즐이 없으면 가장 최근 과거 퍼즐로 폴백
const dateKey = puzzles[today] ? today : (allDates.filter((k) => k <= today).pop() ?? allDates[0])
const puzzle = puzzles[dateKey]

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

export default function App() {
  const { cells, wordNums } = useMemo(() => buildGrid(puzzle), [])
  const saved = useMemo(() => JSON.parse(localStorage.getItem(storeKey) || 'null'), [])
  const [entries, setEntries] = useState(saved?.entries ?? {})
  const [attempts, setAttempts] = useState(saved?.attempts ?? 0)
  const [done, setDone] = useState(saved?.done ?? false)
  const [result, setResult] = useState(null) // 확인 후 key -> 정답 여부
  const [activeWi, setActiveWi] = useState(0)
  const [copied, setCopied] = useState(false)
  const [streak, setStreak] = useState(() => {
    const s = JSON.parse(localStorage.getItem('crossword-streak') || 'null')
    return saved?.done && s?.last === dateKey ? s.count : 0
  })
  const inputs = useRef({})

  useEffect(() => {
    localStorage.setItem(storeKey, JSON.stringify({ entries, attempts, done }))
  }, [entries, attempts, done])

  const activeKeys = new Set(wordCells(puzzle.words[activeWi]))

  const setCell = (key, ch) => {
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
      const s = JSON.parse(localStorage.getItem('crossword-streak') || 'null')
      const [y, m, d] = dateKey.split('-').map(Number)
      const prevDay = fmt(new Date(y, m - 1, d - 1))
      const count = s?.last === dateKey ? s.count : s?.last === prevDay ? s.count + 1 : 1
      localStorage.setItem('crossword-streak', JSON.stringify({ last: dateKey, count }))
      setStreak(count)
    }
  }

  const share = async () => {
    const text = `🧩 매일 낱말퀴즈 ${dateKey}\n✅ 확인 ${attempts}번 만에 완성!\n🔥 연속 ${streak}일째\n${location.href}`
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const clueList = (dir, title) => (
    <div className="clues">
      <h2>{title}</h2>
      <ol>
        {puzzle.words.map((w, wi) =>
          w.dir === dir ? (
            <li
              key={wi}
              className={wi === activeWi ? 'active' : ''}
              onClick={() => {
                setActiveWi(wi)
                focusCell(`${w.row},${w.col}`)
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
        <h1>매일 낱말퀴즈</h1>
        <p className="date">
          {dateKey}
          {dateKey !== today && ' (오늘의 퍼즐이 아직 없어 최근 퍼즐을 보여드려요)'}
        </p>
      </header>

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
      </div>

      {done ? (
        <div className="panel">
          <p>
            🎉 완성! 확인 {attempts}번 · 🔥 연속 {streak}일째
          </p>
          <button onClick={share}>{copied ? '복사됨!' : '결과 복사하기'}</button>
          <p className="hint">내일 자정에 새 퍼즐이 열려요.</p>
        </div>
      ) : (
        <div className="panel">
          <button onClick={check}>정답 확인</button>
          {result && <p className="hint">빨간 칸이 틀린 곳이에요. ({attempts}번 확인)</p>}
        </div>
      )}

      <div className="clue-cols">
        {clueList('across', '가로 열쇠')}
        {clueList('down', '세로 열쇠')}
      </div>
    </div>
  )
}
