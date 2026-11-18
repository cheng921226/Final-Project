import React, { useEffect, useRef, useState } from 'react';
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
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const sheetRef = useRef(null);
  const credits = Number(certificate?.credits_awarded || 0);

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

  async function downloadCertificate() {
    const sheet = sheetRef.current;
    if (!certificate || !sheet || downloading) return;

    setDownloading(true);
    setDownloadError('');
    try {
      const { toPng } = await import('html-to-image');
      await document.fonts?.ready;
      const image = await toPng(sheet, { pixelRatio: 2 });
      const link = document.createElement('a');
      link.download = `${safeFilename(certificate.course_name)}_${safeFilename(certificate.student_name)}_certificate.png`;
      link.href = image;
      link.click();
    } catch {
      setDownloadError('無法下載認證圖片，請稍後再試。');
    } finally {
      setDownloading(false);
    }
  }

  if (loading) return <div className="teacher-state"><div className="teacher-loader" /><p>正在載入課程認證...</p></div>;
  if (error) return <div className="teacher-state"><span className="teacher-state-icon">!</span><h1>無法開啟認證</h1><p>{error}</p><Link className="primary-link" to="/achievements">返回學習成就</Link></div>;

  return (
    <div className="certificate-page">
      <div className="certificate-toolbar">
        <Link className="secondary-button" to="/achievements">返回學習成就</Link>
        <button className="question-save-button" type="button" onClick={downloadCertificate} disabled={downloading}>
          {downloading ? '正在準備圖片…' : '下載認證圖片'}
        </button>
      </div>
      {downloadError && <p className="auth-error" role="alert">{downloadError}</p>}
      <div className="certificate-display">
        <section className="certificate-sheet" ref={sheetRef}>
          <div className="certificate-inner">
            <div className="certificate-corners" aria-hidden="true"><i /><i /><i /><i /></div>
            <img className="certificate-watermark" src="/fcu-logo.svg" alt="" aria-hidden="true" />
            <h1>課程完成認證</h1>
            <p className="certificate-kicker">CERTIFICATE OF COMPLETION</p>
            <div className="certificate-divider" aria-hidden="true"><i /></div>
            <p className="certificate-copy">茲證明</p>
            <h2>{certificate.student_name}</h2>
            <p className="certificate-copy">已通過課程</p>
            <h3>{certificate.course_name}</h3>
            <div className="certificate-details">
              <span><small>通過日期</small>{formatDate(certificate.earned_at)}</span>
              {credits > 0 && <span><small>取得學分</small>{credits.toFixed(1)}</span>}
            </div>
            <footer><span>Student-Platform</span><code>{certificate.certificate_code}</code></footer>
          </div>
        </section>
        <div className="certificate-light" aria-hidden="true" />
      </div>
    </div>
  );
}
