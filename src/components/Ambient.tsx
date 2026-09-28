/**
 * Fond immersif commun (app, connexion, suivi public) : aurores lentes,
 * réseau logistique en filigrane où circulent des flux, grain et vignette.
 * Purement décoratif (aria-hidden) ; coupé par prefers-reduced-motion (CSS).
 */
const NODES: Array<[number, number]> = [
  [140, 180], [420, 110], [690, 240], [980, 150], [1250, 260], [1480, 120],
  [260, 470], [560, 420], [860, 520], [1130, 440], [1390, 560],
  [120, 760], [430, 700], [740, 820], [1040, 740], [1330, 820], [1560, 690],
]

const LINKS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [0, 6], [6, 7], [7, 2], [7, 8], [8, 9],
  [9, 4], [9, 10], [10, 5], [6, 11], [11, 12], [12, 7], [12, 13], [13, 8], [13, 14],
  [14, 9], [14, 15], [15, 10], [15, 16], [16, 10],
]

/** Liaisons animées (flux de fret) : un sous-ensemble, pour rester discret. */
const FLOWS = [1, 4, 7, 10, 13, 17, 20, 22]

function curve([x1, y1]: [number, number], [x2, y2]: [number, number]): string {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.12
  return `M${x1},${y1} Q${mx},${my} ${x2},${y2}`
}

export function Ambient() {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="aurora a1" />
      <div className="aurora a2" />
      <div className="aurora a3" />
      <svg className="network" viewBox="0 0 1680 940" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="flow" x1="0" x2="1">
            <stop offset="0" stopColor="#1fe0b8" stopOpacity="0" />
            <stop offset="0.5" stopColor="#1fe0b8" stopOpacity="0.9" />
            <stop offset="1" stopColor="#12b8ff" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        {LINKS.map(([a, b], i) => (
          <path key={`r${i}`} className="route" d={curve(NODES[a], NODES[b])} />
        ))}
        {FLOWS.map((i, k) => {
          const [a, b] = LINKS[i]
          return (
            <path key={`f${i}`} className="flow" d={curve(NODES[a], NODES[b])} style={{ animationDelay: `${-k * 0.8}s`, animationDuration: `${5 + (k % 3)}s` }} />
          )
        })}
        {NODES.map(([x, y], i) => (
          <g key={`n${i}`}>
            <circle className="node" cx={x} cy={y} r={2.4} />
            {i % 4 === 0 && <circle className="node-halo" cx={x} cy={y} r={5} style={{ animationDelay: `${-i * 0.4}s` }} />}
          </g>
        ))}
      </svg>
      <div className="grain" />
      <div className="vignette" />
    </div>
  )
}
