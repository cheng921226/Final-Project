import LearningArtwork from './LearningArtwork';

export default function AuthStory() {
  return (
    <aside className="auth-story">
      <p className="eyebrow">A SPACE TO GROW</p>
      <h2>每一次學習，<br />都離理解更近一步。</h2>
      <p>從一堂課開始，透過 AI 輔助，<br />把新的知識，變成自己的能力。</p>
      <LearningArtwork />
      <span className="auth-story-caption">專注學習，讓好奇心帶路。</span>
    </aside>
  );
}
