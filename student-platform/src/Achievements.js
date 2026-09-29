import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

function progressStyle(value) {
  return { width: `${Math.max(0, Math.min(Number(value) || 0, 100))}%` };
}

function formatFinalScore(value) {
  return value === null || value === undefined ? '尚未測驗' : `${value}%`;
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
        {token ? (
          <button type="button" className="primary-link" onClick={() => window.location.reload()}>
            重新載入
          </button>
        ) : (
          <Link to="/login" className="primary-link">前往登入</Link>
        )}
      </div>
    );
  }

  return (
    <div className="achievement-page">
      <header className="review-hero">
        <div>
          <p className="eyebrow">Learning credits</p>
          <h1>學習成就與學分進度</h1>
          <p>完成課程內容並通過正式測驗後，即可取得學分與課程完成認證。</p>
        </div>
      </header>

      <section className="teacher-metrics">
        <SummaryCard label="通過課程" value={data.summary.completed_courses} note="已達全部通過條件" />
        <SummaryCard label="累積學習" value={`${data.summary.learning_hours} 小時`} note="依觀看紀錄加總" tone="blue" />
        <SummaryCard label="取得學分" value={data.summary.earned_credits} note="通過後一次取得" tone="green" />
        <SummaryCard label="課程認證" value={data.summary.certifications} note="已取得的課程認證" tone="coral" />
      </section>

      <section className="achievement-list">
        {courses.map(course => (
          <article className="achievement-card" key={course.course_id}>
            <div className="achievement-card-head">
              <div>
                <span className={`achievement-status ${course.status}`}>{course.status_label}</span>
                <h2>{course.title}</h2>
                <p>{course.completed_lectures} / {course.lecture_count} 個小節完成，最終測驗 {formatFinalScore(course.final_score)}</p>
              </div>
              <strong>
                {course.credits_total > 0
                  ? `${course.credits_earned} / ${course.credits_total} 學分`
                  : '尚未設定學分'}
              </strong>
            </div>

            <div className="achievement-progress">
              <span>課程完成度</span>
              <b>{course.completion_percentage}%</b>
              <i><em style={progressStyle(course.completion_percentage)} /></i>
            </div>

            <div className="achievement-meta">
              <span>觀看時間：{course.watched_hours} 小時</span>
              <span>正式測驗次數：{course.final_attempt_count}</span>
              <span>{course.has_final_assessment ? '正式測驗已建立' : '正式測驗準備中'}</span>
            </div>

            {course.requirements?.length ? (
              <div className={`achievement-requirements ${course.course_passed ? 'success' : ''}`}>
                <small>通過條件</small>
                <ul>
                  {course.requirements.map(requirement => (
                    <li className={requirement.met ? 'is-met' : ''} key={requirement.key}>
                      <span aria-hidden="true">{requirement.met ? '✓' : '○'}</span>
                      <div>
                        <strong>{requirement.label}</strong>
                        <p>
                          {requirement.current === null ? '尚無作答' : `${requirement.current}${requirement.unit}`}
                          {' / '}{requirement.target}{requirement.unit}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                {course.course_passed && <p className="achievement-passed-note">已完成課程並取得完整學分。</p>}
              </div>
            ) : (
              <div className="achievement-next">
                <small>狀態</small>
                <p>這門課目前尚未設定學分與通過條件。</p>
              </div>
            )}

            <div className="achievement-card-actions">
              {course.certification_earned ? (
                <Link className="question-save-button" to={`/certificate/${course.course_id}`}>查看認證</Link>
              ) : (
                <Link className="secondary-button" to={`/course/${course.course_id}/final-assessment`}>
                  {course.final_attempt_count > 0 ? '查看正式測驗' : '前往正式測驗'}
                </Link>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
