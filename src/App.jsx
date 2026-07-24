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
  // 시작 칸에 읽기 순서대로 번호 부여. 한 칸에서 가로·세로가 같이 시작하면 번호도 같다
  // (신문 낱말퀴즈 방식 — "가로 10번", "세로 10번"으로 구분해 부른다)
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

const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ']
const chosung = (ch) => { const c = ch.charCodeAt(0) - 0xac00; return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch }

function wordCells(w) {
  return [...w.answer].map((_, k) => (w.dir === 'across' ? `${w.row},${w.col + k}` : `${w.row + k},${w.col}`))
}

const storeKey = `crossword-state-${dateKey}`

// 번호는 읽기 순서(위→아래, 왼→오른쪽)로 매겨지므로 목록도 같은 순서로 정렬한다.
// JSON의 words 배열 순서에 기대지 않아야 번호가 뒤죽박죽으로 보이지 않는다.
const readingOrder = puzzle.words
  .map((_, wi) => wi)
  .sort((x, y) => puzzle.words[x].row - puzzle.words[y].row || puzzle.words[x].col - puzzle.words[y].col)

// 단어 순환 순서(Space로 단어 끝을 넘길 때): 가로 먼저, 세로 다음
const wordOrder = [
  ...readingOrder.filter((wi) => puzzle.words[wi].dir === 'across'),
  ...readingOrder.filter((wi) => puzzle.words[wi].dir === 'down'),
]

export default function App() {
  const { cells, wordNums } = useMemo(() => buildGrid(puzzle), [])
  const saved = useMemo(() => JSON.parse(localStorage.getItem(storeKey) || 'null'), [])
  const [entries, setEntries] = useState(saved?.entries ?? {})
  const [done, setDone] = useState(saved?.done ?? false)
  const [startTs, setStartTs] = useState(saved?.start ?? null) // 첫 입력 시각
  const [elapsed, setElapsed] = useState(saved?.time ?? null) // 완성까지 걸린 초
  const [activeWi, setActiveWi] = useState(0)
  const [hints, setHints] = useState({}) // { "r,c": 초성 } — 힌트 켠 빈 칸
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
    localStorage.setItem(storeKey, JSON.stringify({ entries, done, start: startTs, time: elapsed }))
  }, [entries, done, startTs, elapsed])

  const activeKeys = new Set(wordCells(puzzle.words[activeWi]))

  // 판정은 언제나 단어 단위. 한 단어를 다 써야 맞았는지 틀렸는지 알려 준다
  // (쓰는 도중에 한 글자씩 타박하지 않는다).
  const solvedKeys = new Set() // 다 맞은 단어: 초록
  const wrongKeys = new Set() // 다 썼는데 틀린 글자: 빨강
  puzzle.words.forEach((w) => {
    const ks = wordCells(w)
    if (!ks.every((k) => entries[k])) return
    if (ks.every((k) => entries[k] === cells.get(k).answer)) ks.forEach((k) => solvedKeys.add(k))
    else ks.forEach((k) => wrongKeys.add(k)) // 틀린 글자만이 아니라 단어 전체를 빨갛게
  })
  // 교차하는 칸은 초록이 이긴다: 세로가 틀려도 가로를 맞혔으면 그 칸은 맞은 칸
  solvedKeys.forEach((k) => wrongKeys.delete(k))

  const setCell = (key, ch) => {
    if (!startTs) setStartTs(Date.now())
    setEntries((e) => ({ ...e, [key]: ch }))
  }

  // 처음 상태로. 칸은 uncontrolled(defaultValue)라 DOM 값도 직접 비워야 한다.
  // 연속 기록은 이미 저장됐으니 건드리지 않는다 (다시 풀어도 두 번 세지 않음).
  const reset = () => {
    Object.values(inputs.current).forEach((el) => el && (el.value = ''))
    setEntries({})
    setHints({})
    setStartTs(null) // 타이머도 다시 첫 입력부터
    setElapsed(null)
    setDone(false)
  }

  const clearAll = () => {
    if (!Object.values(entries).some(Boolean)) return
    if (!window.confirm('입력한 글자를 모두 지울까요?')) return
    reset()
  }

  // 지금 선택한 열쇠의 빈 칸에 정답 초성을 placeholder로 (채우면 자동으로 사라진다)
  const showHint = () => {
    const add = {}
    wordCells(puzzle.words[activeWi]).forEach((k) => {
      if (!entries[k]) add[k] = chosung(cells.get(k).answer)
    })
    setHints((h) => ({ ...h, ...add }))
  }

  // 지금 선택한 열쇠의 칸만 비우기 (되돌리기 쉬우니 확인창 없음). 초점은 있던 자리에 그대로 둔다.
  const clearWord = () => {
    const ks = wordCells(puzzle.words[activeWi]).filter((k) => !solvedKeys.has(k)) // 맞힌 칸은 남긴다
    ks.forEach((k) => inputs.current[k] && (inputs.current[k].value = ''))
    setEntries((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !ks.includes(k))))
  }

  // 초점만 옮긴다. 찬 칸이면 onFocus가 기존 글자를 선택해 둬서 새로 치면 덮어써진다.
  const focusCell = (key) => inputs.current[key]?.focus()

  // 초점이 활성 단어 밖으로 나가면 활성 단어도 따라가게 한다.
  // (안 그러면 초점은 6번 칸에 있는데 열쇠는 9번이 켜져 있는 식으로 어긋난다)
  const syncActiveTo = (key, preferDir) => {
    const ws = cells.get(key).words
    if (Object.values(ws).includes(activeWi)) return
    setActiveWi(ws[preferDir] ?? ws.across ?? ws.down)
  }

  // 활성 단어 안에서만 한 칸 이동. 옮겼으면 true (단어 밖으로 새지 않는다)
  const step = (key, delta) => {
    const w = puzzle.words[activeWi]
    const cell = cells.get(key)
    const next = w.dir === 'across' ? `${cell.r},${cell.c + delta}` : `${cell.r + delta},${cell.c}`
    if (!wordCells(w).includes(next)) return false
    focusCell(next)
    return true
  }

  // 스페이스: 다음 칸으로, 단어 끝이면 다음 열쇠의 첫 칸으로 (항상 뭔가는 움직인다)
  const advance = (key) => {
    if (step(key, 1)) return
    const pos = wordOrder.indexOf(activeWi)
    const nextWi = wordOrder[(pos + 1) % wordOrder.length]
    setActiveWi(nextWi)
    focusCell(`${puzzle.words[nextWi].row},${puzzle.words[nextWi].col}`)
  }

  // 클릭은 언제나 같은 결과를 내야 한다: 번호가 붙은 칸을 누르면 그 번호의 단어.
  // (예전엔 가로↔세로 토글이 먼저 걸려서, 10번 칸을 다시 누르면 9번이 열렸다.)
  // 방향을 바꾸고 싶으면 열쇠 목록에서 고른다.
  const onCellClick = (key) => {
    const cell = cells.get(key)
    const ws = cell.words
    const startsHere = (wi) =>
      wi !== undefined && puzzle.words[wi].row === cell.r && puzzle.words[wi].col === cell.c
    if (startsHere(ws.across)) setActiveWi(ws.across)
    else if (startsHere(ws.down)) setActiveWi(ws.down)
    else setActiveWi(ws.across ?? ws.down)
  }

  // 찬 칸을 클릭하면 기존 글자를 선택해 둔다 → 새로 치면 바로 덮어써진다 (라틴/붙여넣기).
  // 한글은 조합 시작 때 칸을 비워 새 음절이 깔끔히 들어가게 한다 (아래 onCompStart).
  const onFocusCell = (e) => e.target.select()
  const onCompStart = (key, e) => { if (entries[key]) e.target.value = '' }

  // 한글은 compositionend에서 음절이 확정된다. 글자를 넣어도 칸을 자동으로 넘기지 않는다 — 이동은 Space·화살표로만.
  const onInput = (key, e) => {
    if (e.nativeEvent?.isComposing) return // 조합 중인 글자는 건드리지 않는다 (건드리면 IME가 꼬인다)
    const ch = ([...e.target.value].pop() ?? '').trim() // 붙여넣기 등으로 여러 글자가 와도 하나만
    e.target.value = ch
    setCell(key, ch)
  }

  const onCompose = (key, e) => {
    const ch = ([...e.data.trim()].pop() ?? '').trim()
    e.target.value = ch
    setCell(key, ch)
  }

  const onKeyDown = (key, e) => {
    if (e.nativeEvent?.isComposing) return
    const cell = cells.get(key)
    const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }
    if (moves[e.key]) {
      e.preventDefault()
      const [dr, dc] = moves[e.key]
      const next = `${cell.r + dr},${cell.c + dc}`
      if (cells.has(next)) {
        focusCell(next)
        syncActiveTo(next, dr !== 0 ? 'down' : 'across')
      }
    } else if (e.key === ' ') {
      e.preventDefault()
      advance(key)
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      // 상태와 어긋나지 않게 직접 비운다. 빈 칸에서 눌러도 앞 칸으로 넘어가지 않는다 (글자만 지우는 키)
      e.preventDefault()
      if (entries[key] && !solvedKeys.has(key)) { // 맞힌 칸은 못 지운다
        e.target.value = ''
        setCell(key, '')
      }
    }
  }

  // 정답 확인 버튼 없이, 모든 칸이 맞으면 자동으로 완성 처리
  useEffect(() => {
    if (done) return
    const all = [...cells].every(([key, cell]) => (entries[key] ?? '') === cell.answer)
    if (!all) return
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
  }, [entries, done])

  const share = async () => {
    const lines = [`🧩 매일 낱말퀴즈 ${dateKey}`, `✅ 완성!`]
    if (elapsed != null) lines.push(`⏱ ${fmtTime(elapsed)} 걸렸어요`)
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
        {readingOrder.map((wi) => {
          const w = puzzle.words[wi]
          return w.dir === dir ? (
            <li
              key={wi}
              className={wi === activeWi ? 'active' : ''}
              onClick={() => {
                // 이미 켜진 열쇠를 또 누르면 = 다시 풀기: 그 단어를 비우고 처음 칸으로
                // (찬 칸은 readOnly라 이렇게 지워야 고쳐 쓸 수 있다)
                if (wi === activeWi) {
                  clearWord()
                  focusCell(`${w.row},${w.col}`)
                  return
                }
                setActiveWi(wi)
                // 첫 빈 칸으로, 다 채웠으면 단어 시작 칸으로
                focusCell(wordCells(w).find((k) => !entries[k]) ?? `${w.row},${w.col}`)
              }}
            >
              <b>{wordNums[wi]}.</b> {w.clue} ({w.answer.length}글자)
            </li>
          ) : null
        })}
      </ol>
    </div>
  )

  return (
    <div className="app">
      <header>
        <div className="mast-top">
          <span>제 {playable.indexOf(dateKey) + 1} 호</span>
          <span>{kdate(dateKey)}</span>
          <span>
            야간모드
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
            solvedKeys.has(key) && 'filled', // 단어를 다 맞힌 칸: 초록
            wrongKeys.has(key) && 'wrong', // 단어를 다 썼는데 틀린 칸: 빨강
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
                placeholder={hints[key] ?? ''} // 초성 힌트 — 값이 차면 브라우저가 자동으로 감춘다
                readOnly={solvedKeys.has(key)} // 맞힌 칸은 잠금: 덮어쓰기·삭제 금지
                disabled={done}
                onFocus={onFocusCell}
                onChange={(e) => onInput(key, e)}
                onCompositionStart={(e) => onCompStart(key, e)}
                onCompositionEnd={(e) => onCompose(key, e)}
                onKeyDown={(e) => onKeyDown(key, e)}
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
        <div className="panel done">
          <p>
            🎉 완성!{elapsed != null && ` ⏱ ${fmtTime(elapsed)}`}
            {dateKey === latestKey && ` · 🔥 연속 ${streak}일째`}
          </p>
          <button onClick={share}>{copied ? '복사됨!' : '결과 복사하기'}</button>
          <button className="ghost" onClick={reset}>
            다시 풀기
          </button>
          <p className="hint">내일 자정에 새 퍼즐이 열려요.</p>
        </div>
      ) : (
        <div className="panel">
          <button
            className="ghost"
            onMouseDown={(e) => e.preventDefault()} // 버튼이 초점을 뺏지 않게 (쓰던 칸에 그대로 둔다)
            onClick={showHint}
          >
            초성 힌트
          </button>
          <button
            className="ghost"
            onMouseDown={(e) => e.preventDefault()} // 버튼이 초점을 뺏지 않게 (쓰던 칸에 그대로 둔다)
            onClick={clearWord}
          >
            칸 지우기
          </button>
          <button className="ghost" onClick={clearAll}>
            다 지우기
          </button>
        </div>
      )}
      <p className="help">칸을 클릭해 입력 · 열쇠를 클릭해 이동 · ←↑↓→ 이동 · Space 다음 칸</p>
        </div>

        <aside className="clue-cols">
          {clueList('across', '가로 열쇠')}
          {clueList('down', '세로 열쇠')}
        </aside>
      </div>
    </div>
  )
}
