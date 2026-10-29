import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import './login-attendance.css'

const portraits = ['woman-1', 'man-1', 'woman-2', 'man-2', 'woman-3']
const metrics = [[245, 'Total'], [236, 'Present'], [12, 'On Leave'], [7, 'WFH']]
const curve = 'M 4 76 C 20 63 27 71 37 76 S 54 76 64 65 S 82 65 94 58 S 110 58 123 49 S 145 41 156 52 S 177 63 188 47 S 209 10 224 23 S 242 56 260 46 S 280 44 294 54 S 316 58 333 45 S 353 32 371 38'

export default function LoginAttendance() {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame
    let start
    function tick(now) {
      start ??= now
      const elapsed = Math.min((now - start) / 1800, 1)
      setProgress(1 - Math.pow(1 - elapsed, 3))
      if (elapsed < 1) frame = requestAnimationFrame(tick)
    }
    function run() {
      cancelAnimationFrame(frame)
      if (motion.matches) setProgress(1)
      else { start = undefined; setProgress(0); frame = requestAnimationFrame(tick) }
    }
    run()
    motion.addEventListener('change', run)
    return () => { cancelAnimationFrame(frame); motion.removeEventListener('change', run) }
  }, [])

  return <div className="reference-art attendance-art">
    <section className="attendance-demo" aria-label="Illustrative attendance overview">
      <header className="attendance-demo-header"><span>Attendance Overview <ChevronRight aria-hidden="true"/></span><small><i/>All systems operational</small></header>
      <div className="attendance-demo-chart">
        <div className="attendance-demo-rate" aria-label="Attendance today: 96 percent"><span>Attendance today</span><strong aria-hidden="true">{Math.round(96 * progress)}%</strong><small>236 of 245 employees</small></div>
        <div className="attendance-demo-trend">
          <svg viewBox="0 0 375 100" role="img" aria-label="Weekly attendance trend, Monday through Sunday">
            <defs><linearGradient id="attendance-demo-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff6b25" stopOpacity=".27"/><stop offset="100%" stopColor="#ff6b25" stopOpacity=".02"/></linearGradient></defs>
            <path className="attendance-trend-area" d={`${curve} L 371 96 L 4 96 Z`} fill="url(#attendance-demo-fill)"/>
            <path className="attendance-trend-line" d={curve} fill="none" stroke="#ff500b" strokeWidth="2" strokeLinecap="round" pathLength="1"/>
          </svg>
          <div className="attendance-demo-days" aria-hidden="true">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=><span key={day}>{day}</span>)}</div>
        </div>
      </div>
      <div className="attendance-demo-team-heading"><span>Team overview</span><small>View team <ChevronRight aria-hidden="true"/></small></div>
      <div className="attendance-demo-team">
        <div className="attendance-demo-portraits" aria-label="Sample team portraits">{portraits.map(person=><img key={person} src={`/assets/team/${person}.jpg`} alt="" width="128" height="128" decoding="async"/>)}<span>+12</span></div>
        <div className="attendance-demo-metrics">{metrics.map(([value, label])=><div key={label} aria-label={`${label}: ${value}`}><strong aria-hidden="true">{Math.round(value * progress)}</strong><small>{label}</small></div>)}</div>
      </div>
    </section>
  </div>
}
