import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

function emptyForm(course = {}) {
  return {
    credit_value: course.credit_value ?? 2,
    partial_credit_enabled: Boolean(course.partial_credit_enabled),
    completion_threshold: course.completion_threshold ?? 100,
    passing_score: course.passing_score ?? 70,
    require_passing_score: Boolean(course.require_passing_score),
    certification_enabled: course.certification_enabled ?? true,
    rules: course.rules?.length
      ? course.rules.map((rule, index) => ({
          label: rule.label || '',
          required_completion_percentage: rule.required_completion_percentage ?? 100,
          required_score: rule.required_score ?? '',
          credits_awarded: rule.credits_awarded ?? 0,
          sort_order: index,
        }))
      : [],
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
      setError('請先使用老師帳號登入。');
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

  function updateRule(index, field, value) {
    setForm(prev => ({
      ...prev,
      rules: prev.rules.map((rule, ruleIndex) => (
        ruleIndex === index ? { ...rule, [field]: value } : rule
      )),
    }));
  }

  function addRule() {
    setForm(prev => ({
      ...prev,
      rules: [
        ...prev.rules,
        {
          label: '',
          required_completion_percentage: 100,
          required_score: '',
          credits_awarded: prev.credit_value || 0,
          sort_order: prev.rules.length,
        },
      ],
    }));
  }

  function removeRule(index) {
    setForm(prev => ({
      ...prev,
      rules: prev.rules.filter((_, ruleIndex) => ruleIndex !== index),
    }));
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!courseId || saving) return;

    setSaving(true);
    setMessage('');
    try {
      const payload = {
        credit_value: toNumber(form.credit_value),
        partial_credit_enabled: Boolean(form.partial_credit_enabled),
        completion_threshold: toNumber(form.completion_threshold, 100),
        passing_score: form.require_passing_score ? toNumber(form.passing_score, 70) : null,
        require_passing_score: Boolean(form.require_passing_score),
        certification_enabled: Boolean(form.certification_enabled),
        rules: form.rules.map((rule, index) => ({
          label: rule.label || null,
          required_completion_percentage: toNumber(rule.required_completion_percentage, 100),
          required_score: rule.required_score === '' ? null : toNumber(rule.required_score, 70),
          credits_awarded: toNumber(rule.credits_awarded),
          sort_order: index,
        })),
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
          <p>設定每門課的學分數、通過門檻與部分學分規則，學生端會依這裡的規則顯示進度。</p>
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
            <p>沒有自訂規則時，系統會用下方基本規則計算完整學分。</p>
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
            <input type="number" min="0" max="100" value={form.passing_score} disabled={!form.require_passing_score} onChange={event => updateField('passing_score', event.target.value)} />
          </label>
        </div>

        <div className="settings-switches">
          <label><input type="checkbox" checked={form.require_passing_score} onChange={event => updateField('require_passing_score', event.target.checked)} /> 需要測驗分數達標</label>
          <label><input type="checkbox" checked={form.partial_credit_enabled} onChange={event => updateField('partial_credit_enabled', event.target.checked)} /> 允許部分學分</label>
          <label><input type="checkbox" checked={form.certification_enabled} onChange={event => updateField('certification_enabled', event.target.checked)} /> 完成後顯示認證</label>
        </div>

        <div className="rules-block">
          <div className="panel-title">
            <div>
              <h3>自訂學分規則</h3>
              <p>例如 50% 給 1 學分、100% 給 2 學分。留空時使用基本規則。</p>
            </div>
            <button type="button" className="question-secondary-button" onClick={addRule}>新增規則</button>
          </div>
          {form.rules.length ? form.rules.map((rule, index) => (
            <div className="rule-row" key={`${index}-${rule.label}`}>
              <label className="review-field">
                <span>名稱</span>
                <input value={rule.label} placeholder="例如：完整學分" onChange={event => updateRule(index, 'label', event.target.value)} />
              </label>
              <label className="review-field">
                <span>完成度 (%)</span>
                <input type="number" min="0" max="100" value={rule.required_completion_percentage} onChange={event => updateRule(index, 'required_completion_percentage', event.target.value)} />
              </label>
              <label className="review-field">
                <span>最低分數</span>
                <input type="number" min="0" max="100" value={rule.required_score} placeholder="可空白" onChange={event => updateRule(index, 'required_score', event.target.value)} />
              </label>
              <label className="review-field">
                <span>給予學分</span>
                <input type="number" min="0" step="0.5" value={rule.credits_awarded} onChange={event => updateRule(index, 'credits_awarded', event.target.value)} />
              </label>
              <button type="button" className="question-delete-button" onClick={() => removeRule(index)}>刪除</button>
            </div>
          )) : (
            <div className="teacher-empty compact">目前沒有自訂規則。</div>
          )}
        </div>

        {message && <p className="question-review-message">{message}</p>}
        <div className="question-editor-actions">
          <button className="question-save-button" type="submit" disabled={saving}>{saving ? '儲存中...' : '儲存設定'}</button>
        </div>
      </form>
    </div>
  );
}
