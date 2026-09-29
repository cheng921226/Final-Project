import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

function errorMessage(data, fallback) {
  if (typeof data?.detail === 'string') return data.detail;
  if (typeof data?.detail?.message === 'string') return data.detail.message;
  return fallback;
}

function getOptions(question) {
  if (Array.isArray(question?.options_json)) return question.options_json;
  if (typeof question?.options_json === 'string') {
    try {
      const parsed = JSON.parse(question.options_json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function formatCountdown(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours} 小時 ${minutes} 分 ${rest} 秒`
    : `${minutes} 分 ${rest} 秒`;
}

function formatDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function FinalAssessment() {
  const { id } = useParams();
  const token = localStorage.getItem('access_token');
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [remaining, setRemaining] = useState(0);

  const loadStatus = useCallback(async () => {
    if (!token) {
      setError('請先使用學生帳號登入。');
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(`${API_URL}/courses/${id}/final-assessment`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(body, '無法取得正式測驗狀態'));
      setData(body);
      setRemaining(body.retry_seconds_remaining || 0);
      setError('');
    } catch (err) {
      setError(err.message || '正式測驗載入失敗');
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const retryAt = data?.retry_available_at;
    if (!retryAt) return undefined;
    const updateRemaining = () => {
      const seconds = Math.ceil((new Date(retryAt).getTime() - Date.now()) / 1000);
      setRemaining(Math.max(0, seconds));
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [data?.retry_available_at]);

  const questions = useMemo(() => data?.questions || [], [data]);

  async function startAssessment() {
    if (!token || working) return;
    setWorking(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch(`${API_URL}/courses/${id}/final-assessment/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(body, '無法開始正式測驗'));
      setData(body);
      setAnswers({});
    } catch (err) {
      setError(err.message || '無法開始正式測驗');
    } finally {
      setWorking(false);
    }
  }

  async function submitAssessment() {
    if (!data?.attempt?.id || working) return;
    if (questions.some(question => !answers[question.question_id])) {
      setError('請完成所有題目後再送出。');
      return;
    }
    setWorking(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/final-assessment/attempts/${data.attempt.id}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          answers: questions.map(question => ({
            question_id: question.question_id,
            selected_answer: answers[question.question_id],
          })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(body, '正式測驗送出失敗'));
      setResult(body);
      setAnswers({});
      await loadStatus();
    } catch (err) {
      setError(err.message || '正式測驗送出失敗');
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return <div className="teacher-state"><div className="teacher-loader" /><p>正在確認正式測驗資格...</p></div>;
  }

  if (error && !data) {
    return <div className="teacher-state"><span className="teacher-state-icon">!</span><h1>無法開啟正式測驗</h1><p>{error}</p></div>;
  }

  return (
    <div className="final-assessment-page">
      <header className="review-hero final-assessment-hero">
        <div>
          <p className="eyebrow">Final assessment</p>
          <h1>{data?.course?.title || '課程最終測驗'}</h1>
          <p>這是正式學分評量。影片中的即時題目只供練習，不會計入本次成績。</p>
        </div>
        <Link className="secondary-button" to={`/course/${id}`}>返回課程</Link>
      </header>

      <section className="final-assessment-summary">
        <div><span>影片完成度</span><strong>{data?.completion?.completion_percentage ?? 0}%</strong></div>
        <div><span>及格分數</span><strong>{data?.settings?.passing_score ?? 70} 分</strong></div>
        <div><span>已測驗次數</span><strong>{data?.attempt_count ?? 0}</strong></div>
      </section>

      {error && <p className="question-review-message">{error}</p>}

      {result && (
        <section className={`assessment-result ${result.passed ? 'passed' : 'failed'}`}>
          <div>
            <small>本次正式測驗</small>
            <h2>{result.passed ? '測驗通過' : '尚未通過'}</h2>
            <p>成績 {result.score} 分，通過標準 {result.passing_score} 分。</p>
          </div>
          {result.certificate && <Link className="question-save-button" to={`/certificate/${id}`}>查看課程認證</Link>}
        </section>
      )}

      {data?.state === 'locked' && (
        <section className="assessment-state-card">
          <h2>完成課程後解鎖</h2>
          <p>目前完成 {data.completion.completed_lectures} / {data.completion.lecture_count} 個小節，需要達到 {data.completion.completion_threshold}% 才能進行正式測驗。</p>
          <Link className="question-save-button" to={`/course/${id}`}>繼續觀看課程</Link>
        </section>
      )}

      {data?.state === 'unconfigured' && (
        <section className="assessment-state-card">
          <h2>學分規則尚未設定</h2>
          <p>教師尚未完成這門課的學分與正式測驗設定。</p>
        </section>
      )}

      {data?.state === 'not_ready' && (
        <section className="assessment-state-card"><h2>正式測驗準備中</h2><p>教師尚未建立這門課的正式測驗題庫。</p></section>
      )}

      {data?.state === 'cooldown' && (
        <section className="assessment-state-card cooldown">
          <h2>重新測驗尚未開放</h2>
          <p>上次成績 {data.latest_attempt?.score ?? 0} 分，通過標準 {data.settings.passing_score} 分。</p>
          <strong>{formatCountdown(remaining)}</strong>
          <p>重新測驗開放時間：{formatDateTime(data.retry_available_at)}</p>
          <p>等待期間仍可觀看影片、使用複習模式及回顧知識點。</p>
          {remaining === 0 && <button className="question-save-button" type="button" onClick={loadStatus}>重新確認資格</button>}
        </section>
      )}

      {data?.state === 'passed' && (
        <section className="assessment-state-card passed">
          <h2>課程已完成</h2>
          <p>最終測驗已通過，課程學分已正式取得。</p>
          {data.certificate && <Link className="question-save-button" to={`/certificate/${id}`}>查看認證</Link>}
        </section>
      )}

      {data?.state === 'ready' && (
        <section className="assessment-state-card ready">
          <h2>可以開始正式測驗</h2>
          <p>本次會從目前 {data.question_bank_count} 題題庫中選出 {Math.min(data.settings.question_count, data.question_bank_count)} 題。送出後未通過需等待 {data.settings.retest_cooldown_minutes} 分鐘。</p>
          <button className="question-save-button" type="button" onClick={startAssessment} disabled={working}>{working ? '準備中...' : '開始正式測驗'}</button>
        </section>
      )}

      {data?.state === 'in_progress' && questions.length > 0 && (
        <section className="final-question-panel">
          <div className="panel-title"><div><h2>正式測驗</h2><p>請完成全部題目後一次送出。</p></div><span className="table-count">第 {data.attempt?.attempt_number} 次</span></div>
          <div className="review-question-list">
            {questions.map((question, index) => (
              <article className="review-question final-question" key={question.question_id}>
                <small>題目 {index + 1} / {questions.length}</small>
                <strong>{question.question_text}</strong>
                <div className="review-options retest-options">
                  {getOptions(question).map(option => {
                    const value = option.trim().charAt(0).toUpperCase();
                    return (
                      <label key={`${question.question_id}-${value}`}>
                        <input type="radio" name={`final-${question.question_id}`} checked={answers[question.question_id] === value} onChange={() => setAnswers(current => ({ ...current, [question.question_id]: value }))} />
                        <span>{option}</span>
                      </label>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
          <div className="question-editor-actions"><button className="question-save-button" type="button" onClick={submitAssessment} disabled={working}>{working ? '送出中...' : '送出正式測驗'}</button></div>
        </section>
      )}
    </div>
  );
}
