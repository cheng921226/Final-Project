import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

function progressStyle(value) {
  return { width: `${Math.max(0, Math.min(Number(value) || 0, 100))}%` };
}

function formatQuizAverage(value) {
  return value === null || value === undefined ? '尚無作答' : `${value}%`;
}

function SummaryCard({ label, value, note, tone = 'violet' }) {
  return (
    <article className={`teacher-metric teacher-metric-${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{note}</span>
    </article>
  );
}

export default function Achievements() {
  const token = localStorage.getItem('access_token');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError('請先使用學生帳號登入。');
      setLoading(false);
      return;
    }

    fetch(`${API_URL}/student/achievements`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async response => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.detail || '無法取得學習成就資料。');
        }
        return response.json();
      })
      .then(result => setData(result))
      .catch(err => setError(err.message || '學習成就資料載入失敗'))
      .finally(() => setLoading(false));
  }, [token]);

  const courses = useMemo(() => data?.courses || [], [data]);

  if (loading) {
    return <div className="teacher-state"><div className="teacher-loader" /><p>正在整理學習成就...</p></div>;
  }

  if (error) {
    return (
      <div className="teacher-state">
        <span className="teacher-state-icon">!</span>
        <h1>無法開啟學習成就</h1>
        <p>{error}</p>
        <Link to="/login" className="primary-link">前往登入</Link>
      </div>
    );
  }

  return (
    <div className="achievement-page">
      <header className="review-hero">
        <div>
          <p className="eyebrow">Learning credits</p>
          <h1>學習成就與學分進度</h1>
          <p>依照課程完成度、作答狀況與老師設定的規則，整理每門課目前可取得的學分與認證狀態。</p>
        </div>
      </header>

      <section className="teacher-metrics">
        <SummaryCard label="完成課程" value={data.summary.completed_courses} note="已達完整認證條件" />
        <SummaryCard label="累積學習" value={`${data.summary.learning_hours} 小時`} note="依觀看紀錄加總" tone="blue" />
        <SummaryCard label="取得學分" value={data.summary.earned_credits} note="依課程規則計算" tone="green" />
        <SummaryCard label="課程認證" value={data.summary.certifications} note="可列入成果紀錄" tone="coral" />
      </section>

      <section className="achievement-list">
        {courses.map(course => (
          <article className="achievement-card" key={course.course_id}>
            <div className="achievement-card-head">
              <div>
                <span className={`achievement-status ${course.status}`}>{course.status_label}</span>
                <h2>{course.title}</h2>
                <p>{course.completed_lectures} / {course.lecture_count} 個小節完成，測驗表現 {formatQuizAverage(course.quiz_average)}</p>
              </div>
              <strong>{course.credits_earned} / {course.credits_total} 學分</strong>
            </div>

            <div className="achievement-progress">
              <span>課程完成度</span>
              <b>{course.completion_percentage}%</b>
              <i><em style={progressStyle(course.completion_percentage)} /></i>
            </div>

            <div className="achievement-meta">
              <span>觀看時間：{course.watched_hours} 小時</span>
              <span>作答次數：{course.attempt_count}</span>
              <span>{course.has_questions ? '已有測驗資料' : '尚無測驗資料'}</span>
            </div>

            {course.next_requirements?.length ? (
              <div className="achievement-next">
                <small>下一步</small>
                <p>{course.next_requirements.join('、')}</p>
              </div>
            ) : (
              <div className="achievement-next success">
                <small>狀態</small>
                <p>{course.certification_earned ? '已符合完整認證條件。' : '這門課目前沒有設定學分規則。'}</p>
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
