import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value));
}

function safeFilename(value) {
  return String(value || 'course').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_');
}

export default function Certificate() {
  const { courseId } = useParams();
  const token = localStorage.getItem('access_token');
  const [certificate, setCertificate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError('請先使用學生帳號登入。');
      setLoading(false);
      return;
    }
    fetch(`${API_URL}/student/certificates/${courseId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.detail || '無法取得課程認證');
        return body;
      })
      .then(setCertificate)
      .catch(err => setError(err.message || '認證載入失敗'))
      .finally(() => setLoading(false));
  }, [courseId, token]);

  function downloadCertificate() {
    if (!certificate) return;
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 900;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#0f766e';
    ctx.lineWidth = 18;
    ctx.strokeRect(38, 38, 1524, 824);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.strokeRect(70, 70, 1460, 760);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 62px sans-serif';
    ctx.fillText('課程完成認證', 800, 180);
    ctx.fillStyle = '#0f766e';
    ctx.font = '600 24px sans-serif';
    ctx.fillText('CERTIFICATE OF COMPLETION', 800, 225);
    ctx.fillStyle = '#475569';
    ctx.font = '28px sans-serif';
    ctx.fillText('茲證明', 800, 305);
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 52px sans-serif';
    ctx.fillText(certificate.student_name || 'Student', 800, 380);
    ctx.fillStyle = '#475569';
    ctx.font = '28px sans-serif';
    ctx.fillText('已完成課程', 800, 440);
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 46px sans-serif';
    ctx.fillText(certificate.course_name || 'Course', 800, 510);

    const details = [
      `完成日期  ${formatDate(certificate.earned_at)}`,
      `取得學分  ${Number(certificate.credits_awarded || 0).toFixed(1)}`,
      `學習時數  ${Number(certificate.learning_hours || 0).toFixed(1)} 小時`,
    ];
    if (certificate.show_final_score && certificate.final_score !== null && certificate.final_score !== undefined) {
      details.push(`最終測驗  ${certificate.final_score} 分`);
    }
    ctx.fillStyle = '#334155';
    ctx.font = '26px sans-serif';
    details.forEach((line, index) => ctx.fillText(line, 800, 600 + index * 42));
    ctx.fillStyle = '#64748b';
    ctx.font = '21px monospace';
    ctx.fillText(`Certificate ID: ${certificate.certificate_code}`, 800, 780);
    ctx.font = '22px sans-serif';
    ctx.fillText('Student-Platform', 800, 815);

    const link = document.createElement('a');
    link.download = `${safeFilename(certificate.course_name)}_${safeFilename(certificate.student_name)}_certificate.png`;
    link.href = canvas.toDataURL('image/png', 1);
    link.click();
  }

  if (loading) return <div className="teacher-state"><div className="teacher-loader" /><p>正在載入課程認證...</p></div>;
  if (error) return <div className="teacher-state"><span className="teacher-state-icon">!</span><h1>無法開啟認證</h1><p>{error}</p><Link className="primary-link" to="/achievements">返回學習成就</Link></div>;

  return (
    <div className="certificate-page">
      <div className="certificate-toolbar">
        <Link className="secondary-button" to="/achievements">返回學習成就</Link>
        <button className="question-save-button" type="button" onClick={downloadCertificate}>下載認證圖片</button>
      </div>
      <section className="certificate-sheet">
        <div className="certificate-inner">
          <p className="certificate-kicker">CERTIFICATE OF COMPLETION</p>
          <h1>課程完成認證</h1>
          <p className="certificate-copy">茲證明</p>
          <h2>{certificate.student_name}</h2>
          <p className="certificate-copy">已完成課程</p>
          <h3>{certificate.course_name}</h3>
          <div className="certificate-details">
            <span><small>完成日期</small>{formatDate(certificate.earned_at)}</span>
            <span><small>取得學分</small>{Number(certificate.credits_awarded || 0).toFixed(1)}</span>
            <span><small>學習時數</small>{Number(certificate.learning_hours || 0).toFixed(1)} 小時</span>
            {certificate.show_final_score && certificate.final_score !== null && certificate.final_score !== undefined && <span><small>最終測驗</small>{certificate.final_score} 分</span>}
          </div>
          <footer><span>Student-Platform</span><code>{certificate.certificate_code}</code></footer>
        </div>
      </section>
    </div>
  );
}
