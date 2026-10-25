import React, { useEffect, useMemo, useState } from 'react';

const API_URL = 'http://127.0.0.1:8000';
const ROLE_LABELS = { student: '學生', teacher: '教師', campus: '平台端' };
const STATUS_LABELS = { active: '啟用', disabled: '停用', incomplete: '未建立登入' };
const EMPTY_FORM = {
  id: null,
  name: '',
  email: '',
  password: '',
  role: 'student',
  student_number: '',
  class_id: '',
};

function formFromPerson(person) {
  return {
    id: person.id,
    name: person.name || '',
    email: person.email || '',
    password: '',
    role: person.role || 'student',
    student_number: person.student_number || '',
    class_id: person.class_id ? String(person.class_id) : '',
  };
}

export default function PersonnelManagement() {
  const token = localStorage.getItem('access_token');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [classFilter, setClassFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [form, setForm] = useState(null);

  async function load() {
    if (!token) {
      setError('請先使用校園平台端帳號登入。');
      setLoading(false);
      return;
    }
    setError('');
    try {
      const response = await fetch(`${API_URL}/campus/personnel`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || '無法取得人員資料');
      setData(body);
    } catch (err) {
      setError(err.message || '人員資料載入失敗');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredPersonnel = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('zh-TW');
    return (data?.personnel || []).filter(person => {
      const matchesKeyword = !keyword || [
        person.name,
        person.email,
        person.student_number,
        person.class_name,
      ].some(value => String(value || '').toLocaleLowerCase('zh-TW').includes(keyword));
      return matchesKeyword
        && (roleFilter === 'all' || person.role === roleFilter)
        && (classFilter === 'all' || String(person.class_id || '') === classFilter)
        && (statusFilter === 'all' || person.account_status === statusFilter);
    });
  }, [classFilter, data, roleFilter, search, statusFilter]);

  const counts = useMemo(() => ({
    total: data?.personnel?.length || 0,
    student: data?.personnel?.filter(item => item.role === 'student').length || 0,
    teacher: data?.personnel?.filter(item => item.role === 'teacher').length || 0,
    campus: data?.personnel?.filter(item => item.role === 'campus').length || 0,
  }), [data]);

  function updateForm(field, value) {
    setForm(current => ({
      ...current,
      [field]: value,
      ...(field === 'role' && value !== 'student'
        ? { student_number: '', class_id: '' }
        : {}),
    }));
  }

  async function save(event) {
    event.preventDefault();
    if (!form || busy) return;
    setBusy('save');
    setMessage('');
    try {
      const isEditing = Boolean(form.id);
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        student_number: form.role === 'student' ? form.student_number.trim() : null,
        class_id: form.role === 'student' && form.class_id ? Number(form.class_id) : null,
        ...(!isEditing ? { password: form.password } : {}),
      };
      const response = await fetch(
        `${API_URL}/campus/personnel${isEditing ? `/${form.id}` : ''}`,
        {
          method: isEditing ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || '人員資料儲存失敗');
      setMessage(body.message || '人員資料已儲存');
      setForm(null);
      await load();
    } catch (err) {
      setMessage(err.message || '人員資料儲存失敗');
    } finally {
      setBusy('');
    }
  }

  async function toggleStatus(person) {
    if (busy) return;
    const nextActive = person.account_status !== 'active';
    if (!window.confirm(`確定要${nextActive ? '啟用' : '停用'}「${person.name}」的登入帳號嗎？`)) return;
    setBusy(`status-${person.id}`);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/campus/personnel/${person.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ active: nextActive }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || '帳號狀態更新失敗');
      setMessage(body.message);
      await load();
    } catch (err) {
      setMessage(err.message || '帳號狀態更新失敗');
    } finally {
      setBusy('');
    }
  }

  async function sendPasswordReset(person) {
    if (busy || !window.confirm(`確定寄送密碼重設信給 ${person.email} 嗎？`)) return;
    setBusy(`reset-${person.id}`);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/campus/personnel/${person.id}/password-reset`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || '密碼重設信寄送失敗');
      setMessage(body.message);
    } catch (err) {
      setMessage(err.message || '密碼重設信寄送失敗');
    } finally {
      setBusy('');
    }
  }

  if (loading) return <div className="teacher-state"><div className="teacher-loader" /><p>正在載入人員資料...</p></div>;
  if (error) return <div className="teacher-state"><span className="teacher-state-icon">!</span><h1>無法開啟人員管理</h1><p>{error}</p></div>;

  return (
    <div className="teacher-page personnel-page">
      <header className="teacher-hero personnel-hero">
        <div><p className="eyebrow">Personnel</p><h1>人員管理</h1><p>管理學生、教師與平台端的基本資料及登入狀態。</p></div>
        <button type="button" className="question-save-button" onClick={() => setForm({ ...EMPTY_FORM })}>新增人員</button>
      </header>

      <section className="personnel-metrics" aria-label="人員統計">
        <div><span>全部人員</span><strong>{counts.total}</strong></div>
        <div><span>學生</span><strong>{counts.student}</strong></div>
        <div><span>教師</span><strong>{counts.teacher}</strong></div>
        <div><span>平台端</span><strong>{counts.campus}</strong></div>
      </section>

      {message && <p className="question-review-message">{message}</p>}

      {form && (
        <form className="teacher-panel personnel-editor" onSubmit={save}>
          <div className="panel-title"><div><h3>{form.id ? '修改人員' : '新增人員'}</h3><p>{form.id ? '更新基本資料與角色。' : '建立 Supabase 登入帳號與人員資料。'}</p></div><button type="button" className="question-secondary-button compact" onClick={() => setForm(null)}>取消</button></div>
          <div className="personnel-form-grid">
            <label className="review-field"><span>姓名</span><input required value={form.name} onChange={event => updateForm('name', event.target.value)} /></label>
            <label className="review-field"><span>Email</span><input required type="email" value={form.email} onChange={event => updateForm('email', event.target.value)} /></label>
            {!form.id && <label className="review-field"><span>初始密碼</span><input required minLength={9} type="password" value={form.password} onChange={event => updateForm('password', event.target.value)} /><small>至少 9 個字元，系統不會顯示或保存明文密碼。</small></label>}
            <label className="review-field"><span>角色</span><select value={form.role} onChange={event => updateForm('role', event.target.value)}><option value="student">學生</option><option value="teacher">教師</option><option value="campus">平台端</option></select></label>
            {form.role === 'student' && <><label className="review-field"><span>學號</span><input required value={form.student_number} onChange={event => updateForm('student_number', event.target.value)} /></label><label className="review-field"><span>班級</span><select value={form.class_id} onChange={event => updateForm('class_id', event.target.value)}><option value="">未分班</option>{(data.classes || []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></>}
          </div>
          <div className="personnel-editor-actions"><button type="submit" className="question-save-button" disabled={Boolean(busy)}>{busy === 'save' ? '儲存中...' : '儲存人員'}</button></div>
        </form>
      )}

      <section className="teacher-panel personnel-list-panel">
        <div className="panel-title"><div><h3>人員名單</h3><p>可依姓名、Email、學號、角色、班級與帳號狀態篩選。</p></div><span className="table-count">{filteredPersonnel.length} 人</span></div>
        <div className="personnel-filters">
          <label><span>搜尋</span><input aria-label="搜尋人員" value={search} onChange={event => setSearch(event.target.value)} placeholder="姓名、Email 或學號" /></label>
          <label><span>角色</span><select value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="all">全部角色</option><option value="student">學生</option><option value="teacher">教師</option><option value="campus">平台端</option></select></label>
          <label><span>班級</span><select value={classFilter} onChange={event => setClassFilter(event.target.value)}><option value="all">全部班級</option>{(data.classes || []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>帳號</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">全部狀態</option><option value="active">啟用</option><option value="disabled">停用</option><option value="incomplete">未建立登入</option></select></label>
        </div>

        <div className="personnel-table-wrap">
          <table className="personnel-table">
            <thead><tr><th>人員</th><th>角色</th><th>學號／班級</th><th>帳號狀態</th><th>最近登入</th><th>操作</th></tr></thead>
            <tbody>
              {filteredPersonnel.map(person => (
                <tr key={person.id} className={person.account_status === 'disabled' ? 'is-disabled' : ''}>
                  <td><strong>{person.name}</strong><span>{person.email || '未填寫 Email'}</span></td>
                  <td><span className={`personnel-role role-${person.role}`}>{ROLE_LABELS[person.role] || person.role}</span></td>
                  <td>{person.role === 'student' ? <><strong>{person.student_number || '未填學號'}</strong><span>{person.class_name || '未分班'}</span></> : <span>—</span>}</td>
                  <td><span className={`personnel-status status-${person.account_status}`}>{STATUS_LABELS[person.account_status]}</span>{person.email_confirmed && <small>已驗證 Email</small>}</td>
                  <td>{person.last_sign_in_at ? new Date(person.last_sign_in_at).toLocaleString('zh-TW') : '尚未登入'}</td>
                  <td><div className="personnel-actions"><button type="button" onClick={() => setForm(formFromPerson(person))}>修改</button><button type="button" onClick={() => sendPasswordReset(person)} disabled={person.account_status === 'incomplete' || Boolean(busy)}>重設密碼</button><button type="button" className={person.account_status === 'active' ? 'danger' : 'enable'} onClick={() => toggleStatus(person)} disabled={person.account_status === 'incomplete' || person.id === data.actor_id || Boolean(busy)}>{person.account_status === 'active' ? '停用' : '啟用'}</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filteredPersonnel.length && <div className="teacher-empty compact">找不到符合條件的人員。</div>}
        </div>
      </section>
    </div>
  );
}
