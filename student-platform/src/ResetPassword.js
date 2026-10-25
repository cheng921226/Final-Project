import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

export default function ResetPassword() {
  const recoveryToken = useMemo(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return hash.get('access_token') || '';
  }, []);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [completed, setCompleted] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setMessage('兩次輸入的密碼不一致。');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/campus/personnel/account/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${recoveryToken}` },
        body: JSON.stringify({ password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || '密碼更新失敗');
      window.history.replaceState({}, '', '/reset-password');
      setCompleted(true);
      setMessage('密碼已更新，請重新登入。');
    } catch (err) {
      setMessage(err.message || '密碼更新失敗');
    } finally {
      setBusy(false);
    }
  }

  if (!recoveryToken && !completed) return <div className="teacher-state"><span className="teacher-state-icon">!</span><h1>重設連結無效</h1><p>請重新申請密碼重設信。</p><Link to="/login" className="primary-link">返回登入</Link></div>;

  return <div className="auth-page"><form className="auth-card" onSubmit={submit}><div className="auth-icon">R</div><h1>設定新密碼</h1><p className="intro">請輸入至少 9 個字元的新密碼。</p>{message && <p className={completed ? 'auth-alert' : 'auth-error'}>{message}</p>}{!completed && <><label className="field"><span>新密碼</span><input type="password" minLength={9} required value={password} onChange={event => setPassword(event.target.value)} /></label><label className="field"><span>再次輸入</span><input type="password" minLength={9} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label><button type="submit" className="auth-submit" disabled={busy}>{busy ? '更新中...' : '更新密碼'}</button></>}{completed && <Link to="/login" className="primary-link">前往登入</Link>}</form></div>;
}
