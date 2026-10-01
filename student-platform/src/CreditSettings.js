import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

function emptyForm(course = {}) {
  return {
    credit_value: course.credit_value ?? 2,
    completion_threshold: course.completion_threshold ?? 100,
    passing_score: course.passing_score ?? 70,
    retest_cooldown_minutes: course.retest_cooldown_minutes ?? 60,
    final_question_count: course.final_question_count ?? 10,
    certification_enabled: course.certification_enabled ?? true,
    certificate_show_score: course.certificate_show_score ?? true,
  };
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function CreditSettings() {
  const token = localStorage.getItem('access_token');
  const [data, setData] = useState(null);
  const [courseId, setCourseId] = useState('');
  const [form, setForm] = useState(emptyForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function loadSettings(preferredCourseId = courseId) {
    if (!token) {
      setError('請先使用教師或校園平台端帳號登入。');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/teacher/course-credit-settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(res.status === 403 ? '這個帳號沒有老師權限。' : body.detail || '無法取得學分設定。');
      }
      const result = await res.json();
      setData(result);
      const nextCourse = result.courses?.find(course => String(course.id) === String(preferredCourseId))
        || result.courses?.[0];
      if (nextCourse) {
        setCourseId(String(nextCourse.id));
        setForm(emptyForm(nextCourse));
      }
    } catch (err) {
      setError(err.message || '學分設定載入失敗');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const selectedCourse = useMemo(
    () => data?.courses?.find(course => String(course.id) === String(courseId)),
    [data, courseId]
  );

  function selectCourse(nextCourseId) {
    const course = data?.courses?.find(item => String(item.id) === String(nextCourseId));
    setCourseId(nextCourseId);
    setForm(emptyForm(course));
    setMessage('');
  }

  function updateField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!courseId || saving) return;

    setSaving(true);
    setMessage('');
    try {
      const payload = {
        credit_value: toNumber(form.credit_value),
        completion_threshold: toNumber(form.completion_threshold, 100),
        passing_score: toNumber(form.passing_score, 70),
        retest_cooldown_minutes: toNumber(form.retest_cooldown_minutes, 60),
        final_question_count: toNumber(form.final_question_count, 10),
        certification_enabled: Boolean(form.certification_enabled),
        certificate_show_score: Boolean(form.certificate_show_score),
      };

      const res = await fetch(`${API_URL}/teacher/courses/${courseId}/credit-settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || '儲存學分設定失敗');
      }
      setMessage('學分設定已更新。');
      await loadSettings(courseId);
    } catch (err) {
      setMessage(err.message || '儲存學分設定失敗');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="teacher-state"><div className="teacher-loader" /><p>正在載入學分設定...</p></div>;
  }

  if (error) {
    return (
      <div className="teacher-state">
        <span className="teacher-state-icon">!</span>
        <h1>無法開啟學分設定</h1>
        <p>{error}</p>
        <Link to="/login" className="primary-link">前往登入</Link>
      </div>
    );
  }

  if (!data?.courses?.length) {
    return (
      <div className="teacher-state">
        <span className="teacher-state-icon">＋</span>
        <h1>尚無可設定課程</h1>
        <p>請先建立課程，並把 teacher_id 指定給目前老師帳號。</p>
      </div>
    );
  }

  return (
    <div className="teacher-page credit-settings-page">
      <header className="teacher-hero">
        <div>
          <p className="eyebrow">Credit rules</p>
          <h1>學分與認證設定</h1>
          <p>設定影片完成門檻與正式測驗規則；影片中的練習題不列入學分計算。</p>
        </div>
        <div className="teacher-filters">
          <label>
            <span>課程</span>
            <select value={courseId} onChange={event => selectCourse(event.target.value)}>
              {data.courses.map(course => (
                <option key={course.id} value={course.id}>{course.title || `課程 ${course.id}`}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <form className="teacher-panel settings-form" onSubmit={saveSettings}>
        <div className="panel-title">
          <div>
            <h3>{selectedCourse?.title || '課程設定'}</h3>
            <p>學生完成課程內容並通過 Course 層級最終測驗後，才會取得學分與認證。</p>
          </div>
        </div>

        <div className="settings-grid">
          <label className="review-field">
            <span>課程總學分</span>
            <input type="number" min="0" step="0.5" value={form.credit_value} onChange={event => updateField('credit_value', event.target.value)} />
          </label>
          <label className="review-field">
            <span>完成度門檻 (%)</span>
            <input type="number" min="0" max="100" value={form.completion_threshold} onChange={event => updateField('completion_threshold', event.target.value)} />
          </label>
          <label className="review-field">
            <span>及格分數</span>
            <input type="number" min="0" max="100" value={form.passing_score} onChange={event => updateField('passing_score', event.target.value)} />
          </label>
          <label className="review-field">
            <span>重測冷卻時間（分鐘）</span>
            <input type="number" min="0" max="43200" value={form.retest_cooldown_minutes} onChange={event => updateField('retest_cooldown_minutes', event.target.value)} />
          </label>
          <label className="review-field">
            <span>每次正式測驗題數</span>
            <input type="number" min="1" max="50" value={form.final_question_count} onChange={event => updateField('final_question_count', event.target.value)} />
          </label>
        </div>

        <div className="settings-switches">
          <label><input type="checkbox" checked={form.certification_enabled} onChange={event => updateField('certification_enabled', event.target.checked)} /> 完成後顯示認證</label>
          <label><input type="checkbox" checked={form.certificate_show_score} onChange={event => updateField('certificate_show_score', event.target.checked)} /> 認證顯示最終測驗成績</label>
        </div>

        <div className="final-bank-status">
          <div>
            <strong>正式測驗題庫</strong>
            <p>{(selectedCourse?.final_assessment_question_count ?? 0) > 0 ? '已建立' : '尚未建立'}，目前啟用 {selectedCourse?.final_assessment_question_count ?? 0} 題。</p>
          </div>
          <Link className="secondary-button" to="/teacher/final-assessment">前往最終測驗</Link>
        </div>

        {message && <p className="question-review-message">{message}</p>}
        <div className="question-editor-actions">
          <button className="question-save-button" type="submit" disabled={saving}>{saving ? '儲存中...' : '儲存設定'}</button>
        </div>
      </form>
    </div>
  );
}
