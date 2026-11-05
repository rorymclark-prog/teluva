import { useEffect, useRef, useState } from 'react';
import styles from './FeatureUpdatePreview.module.css';

/** A small illustrative walkthrough: no real account data or network requests. */
export default function FeatureUpdatePreview() {
  const [run, setRun] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let intersects = true;
    const update = () => setVisible(intersects && document.visibilityState !== 'hidden');
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
      intersects = entry.isIntersecting;
      update();
    });
    if (root.current) observer?.observe(root.current);
    document.addEventListener('visibilitychange', update);
    update();
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  return (
    <div ref={root} className={styles.preview} data-paused={paused || !visible} lang="en">
      <div key={run} className={styles.stage} role="img" aria-label="Illustration: open a saved family timeline moment and see it again in Flashback.">
        <div aria-hidden="true">
          <div className={styles.window}>
            <div className={styles.bar}><i className={styles.dot} /><i className={styles.dot} /><i className={styles.dot} /><span className={styles.brand}>TELUVA · DEMO</span></div>
            <p className={styles.title}>Your family timeline</p>
            <div className={`${styles.row} ${styles.selected}`}><span className={styles.check}>✓</span><span>A day to remember<br /><span className={styles.caption}>A saved family moment</span></span></div>
            <div className={styles.row}><span className={styles.check}>♡</span><span>Stories worth keeping</span></div>
          </div>
          <svg className={styles.cursor} viewBox="0 0 24 30"><path d="M2 2v22l6-6 5 10 4-2-5-10h9Z" fill="currentColor" stroke="white" strokeWidth="1.5" /></svg>
          <div className={styles.result}><span>✓</span>Rediscover it in Flashback</div>
        </div>
      </div>
      <div className={styles.controls}>
        <button type="button" onClick={() => setPaused(!paused)}>{paused ? 'Play animation' : 'Pause animation'}</button>
        <button type="button" onClick={() => { setPaused(false); setRun(run + 1); }}>Replay animation ↻</button>
      </div>
    </div>
  );
}
