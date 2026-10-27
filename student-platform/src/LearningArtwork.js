/** Decorative, locally rendered artwork; no course data or progress is implied. */
export default function LearningArtwork() {
  return (
    <div className="learning-artwork" aria-hidden="true">
      <div className="artwork-orbit orbit-one" />
      <div className="artwork-orbit orbit-two" />
      <div className="artwork-orbit orbit-three" />
      <span className="artwork-spark spark-one">✳</span>
      <span className="artwork-spark spark-two">+</span>
      <div className="artwork-book book-back" />
      <div className="artwork-book book-front">
        <span className="book-kicker">A NEW PERSPECTIVE</span>
        <div className="book-symbol"><i /><i /><i /></div>
        <span className="book-title">知識，<br />從此連結。</span>
        <span className="book-bottom">LEARN · CONNECT · GROW <span>↗</span></span>
      </div>
      <div className="artwork-note"><span>✦</span><div>讓理解更進一步<small>YOUR AI LEARNING COMPANION</small></div></div>
    </div>
  );
}
