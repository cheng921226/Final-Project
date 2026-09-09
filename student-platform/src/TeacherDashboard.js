import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const remainder = Math.floor(value % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatDate(value) {
  if (!value) return '尚無活動';
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function MetricCard({ label, value, note, tone = 'violet' }) {
  return (
    <article className={`teacher-metric teacher-metric-${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{note}</span>
    </article>
  );
}

export function HotspotTimeline({ title, subtitle, items = [], type, timelineEnd }) {
  const sortedItems = [...items].sort((a, b) => a.start - b.start);
  const [selectedStart, setSelectedStart] = useState(null);
  const selected = sortedItems.find(item => item.start === selectedStart) || sortedItems[0];
  const max = Math.max(...items.map(item => item.count), 1);
  const end = Math.max(timelineEnd || 0, ...items.map(item => item.end), 30);
  return (
    <section className={`teacher-panel hotspot-panel hotspot-panel-${type}`}>
      <div className="panel-title">
        <div><h3>{title}</h3><p>{subtitle}</p></div>
        <span className={`panel-dot panel-dot-${type}`} />
      </div>
      {sortedItems.length ? (
        <>
          <div className="hotspot-legend"><span>熱門 {items.length} 個時段 · 每段 30 秒</span><span>柱高代表次數</span></div>
          <div className="hotspot-chart" role="group" aria-label={`${title}時間軸`}>
            <div className="hotspot-chart-grid" aria-hidden="true" />
            {sortedItems.map(item => (
              <button
                type="button"
                key={item.start}
                className="hotspot-marker"
                aria-pressed={selected?.start === item.start}
                aria-label={`${formatDuration(item.start)}–${formatDuration(item.end)}，${item.count} 次，${item.knowledge_points?.join('、') || '未設定知識點'}`}
                title={`${formatDuration(item.start)}–${formatDuration(item.end)} · ${item.count} 次`}
                onClick={() => setSelectedStart(item.start)}
                style={{ left: `${item.start / end * 100}%`, width: `${(item.end - item.start) / end * 100}%` }}
              >
                <span className="hotspot-column" style={{ height: `${Math.max(item.count / max * 100, 8)}%` }} />
              </button>
            ))}
          </div>
          <div className="hotspot-axis" aria-label="影片時間刻度">
            {[0, 1, 2, 3, 4].map(tick => <span key={tick}>{formatDuration(end * tick / 4)}</span>)}
          </div>
          <p className="hotspot-axis-note">影片時間 · 刻度至兩類熱門時段的最晚位置</p>
          <div className="hotspot-detail" aria-live="polite" aria-atomic="true">
            <div><span className="hotspot-time">{formatDuration(selected.start)}–{formatDuration(selected.end)}</span><strong>{selected.count} 次</strong></div>
            <p>{selected.knowledge_points?.length ? selected.knowledge_points.join('、') : '未設定知識點'}</p>
          </div>
          <p className="hotspot-hint">點選柱狀熱點查看詳細資訊；空白處不代表沒有事件。</p>
        </>
      ) : <div className="teacher-empty compact">目前還沒有足夠的事件資料</div>}
    </section>
  );
}

export default function TeacherDashboard() {
  const [data, setData] = useState(null);
  const [courseId, setCourseId] = useState('');
  const [lectureId, setLectureId] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [showEmailPreview, setShowEmailPreview] = useState(false);
  const [emailPreview, setEmailPreview] = useState({ subject: '', body: '' });

  useEffect(() => {
    setShowAllQuestions(false);
    setSelectedStudentIds([]);
    setShowEmailPreview(false);
    setEmailPreview({ subject: '', body: '' });
  }, [courseId, lectureId]);

  const course = useMemo(
    () => data?.courses?.find(item => String(item.id) === courseId),
    [data, courseId]
  );

  const students = course?.students || [];
  const selectedStudents = useMemo(
    () => students.filter(student => selectedStudentIds.includes(student.id)),
    [students, selectedStudentIds]
  );
  const allStudentsSelected = students.length > 0 && students.every(student => selectedStudentIds.includes(student.id));
  const selectedStudentEmails = selectedStudents
    .map(student => student.email)
    .filter(Boolean);

  const handleToggleStudent = studentId => {
    setSelectedStudentIds(current =>
      current.includes(studentId)
        ? current.filter(id => id !== studentId)
        : [...current, studentId]
    );
  };

  const handleToggleAllStudents = () => {
    if (!students.length) return;
    setSelectedStudentIds(current => {
      const ids = students.map(student => student.id);
      return ids.every(id => current.includes(id)) ? [] : ids;
    });
  };

  const [sendingEmails, setSendingEmails] = useState(false);

  const buildEmailDraft = () => {
    const lectureName = selectedLecture?.title;
    const courseName = course?.title || '課程';
    const emailSubject = selectedLecture
      ? `[${courseName}] 學習提醒：${lectureName}`
      : `[${courseName}] 學習提醒`;

    const emailBody = lectureName
      ? [
        '親愛的同學您好：',
        '',
        `這封信是來自「${courseName}」課程的學習提醒。`,
        '',
        `目前系統判定您尚未完成「${lectureName}」的學習內容，請登入平台完成該小節內容，以維持學習進度。`,
        '',
        '若您已完成相關內容，請忽略此信，或稍後再次確認學習紀錄是否已更新。',
        '',
        '如有任何問題，歡迎與授課教師聯繫。',
        '',
        '祝學習順利！',
        'AI輔助線上學習平台',
      ].join('\n')
      : [
        '親愛的同學您好：',
        '',
        `這封信是來自「${courseName}」課程的學習提醒。`,
        '',
        '目前系統判定您尚未完成本課程的學習內容，請登入平台確認目前進度，並完成尚未完成的學習內容。',
        '',
        '若您已完成相關內容，請忽略此信，或稍後再次確認學習紀錄是否已更新。',
        '',
        '如有任何問題，歡迎與授課教師聯繫。',
        '',
        '祝學習順利！',
        'AI輔助線上學習平台',
      ].join('\n');

    return { subject: emailSubject, body: emailBody };
  };

  const handleOpenEmailPreview = () => {
    if (!selectedStudentEmails.length) return;
    setEmailPreview(buildEmailDraft());
    setShowEmailPreview(true);
  };

  const handleSendSelectedEmails = async () => {
    if (!selectedStudentEmails.length) return;

    const token = localStorage.getItem('access_token');
    if (!token) {
      setError('請先使用老師帳號登入。');
      return;
    }

    const subject = emailPreview.subject.trim() || buildEmailDraft().subject;
    const body = emailPreview.body.trim() || buildEmailDraft().body;

    setSendingEmails(true);

    try {
      const response = await fetch(`${API_URL}/email/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: selectedStudentEmails,
          subject,
          body,
        }),
      });

      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(responseBody.detail || '寄信失敗');
      }

      setShowEmailPreview(false);
      setEmailPreview({ subject: '', body: '' });
      window.alert(`已寄送通知信給 ${selectedStudentEmails.length} 位學生`);
    } catch (err) {
      window.alert(err.message || '寄信失敗');
    } finally {
      setSendingEmails(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      setError('請先使用老師帳號登入。');
      setLoading(false);
      return;
    }

    fetch(`${API_URL}/teacher/analytics`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async response => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            response.status === 403
              ? '這個帳號沒有老師權限。'
              : body.detail || '無法取得課程分析資料。'
          );
        }
        return response.json();
      })
      .then(result => {
        setData(result);
        if (result.courses?.length) setCourseId(String(result.courses[0].id));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const selectedLecture = useMemo(
    () => lectureId === 'all'
      ? null
      : course?.lectures?.find(item => String(item.id) === lectureId),
    [course, lectureId]
  );

  const visibleLectures = selectedLecture ? [selectedLecture] : (course?.lectures || []);
  const visibleQuestions = selectedLecture
    ? (course?.questions || []).filter(
      question => String(question.lecture_id) === String(selectedLecture.id)
    )
    : (course?.questions || []);

  const sortedQuestions = [...visibleQuestions].sort((a, b) => a.accuracy - b.accuracy);
  const displayedQuestions = showAllQuestions
    ? sortedQuestions
    : sortedQuestions.filter(question => question.accuracy < 100).slice(0, 5);

  if (loading) {
    return <div className="teacher-state"><div className="teacher-loader" /><p>正在整理學習數據...</p></div>;
  }

  if (error) {
    return (
      <div className="teacher-state">
        <span className="teacher-state-icon">!</span>
        <h1>無法開啟老師分析頁</h1>
        <p>{error}</p>
        <Link to="/login" className="primary-link">前往登入</Link>
      </div>
    );
  }

  if (!data?.courses?.length) {
    return (
      <div className="teacher-state">
        <span className="teacher-state-icon">＋</span>
        <h1>還沒有可分析的課程</h1>
        <p>將課程的 teacher_id 指定給這個老師帳號後，資料就會出現在這裡。</p>
      </div>
    );
  }

  return (
    <div className="teacher-page">
      {showEmailPreview && (
        <div className="email-preview-backdrop" onClick={() => setShowEmailPreview(false)}>
          <div className="email-preview" onClick={event => event.stopPropagation()}>
            <div className="email-preview-header">
              <div>
                <p>寄信預覽</p>
                <h3>{selectedStudentEmails.length} 位學生</h3>
              </div>
              <button type="button" className="email-close-button" onClick={() => setShowEmailPreview(false)} aria-label="關閉信件預覽">
                ×
              </button>
            </div>

            <div className="email-preview-body">
              <label className="email-preview-row">
                <span>主旨</span>
                <input
                  type="text"
                  value={emailPreview.subject}
                  onChange={event => setEmailPreview(current => ({ ...current, subject: event.target.value }))}
                  aria-label="信件主旨"
                />
              </label>

              <label className="email-preview-field">
                <span>信件內容</span>
                <textarea
                  value={emailPreview.body}
                  onChange={event => setEmailPreview(current => ({ ...current, body: event.target.value }))}
                  aria-label="信件內容"
                />
              </label>
            </div>

            <div className="email-preview-actions">
              <button type="button" className="email-secondary-button" onClick={() => setShowEmailPreview(false)}>
                取消
              </button>
              <button type="button" className="email-primary-button" onClick={handleSendSelectedEmails} disabled={sendingEmails}>
                {sendingEmails ? '寄信中...' : '確認寄送'}
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="teacher-hero">
        <div>
          <p className="eyebrow">Teacher insight center</p>
          <h1>學習成效，一眼看懂</h1>
          <p>從觀看行為與作答表現，找到學生真正需要協助的地方。</p>
        </div>
        <div className="teacher-filters">
          <label>
            <span>課程</span>
            <select value={courseId} onChange={event => {
              setCourseId(event.target.value);
              setLectureId('all');
            }}>
              {data.courses.map(item => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>
          </label>
          <label>
            <span>分析範圍</span>
            <select value={lectureId} onChange={event => setLectureId(event.target.value)}>
              <option value="all">全部小節</option>
              {course?.lectures.map(lecture => (
                <option key={lecture.id} value={lecture.id}>{lecture.title}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <section className="teacher-metrics">
        <MetricCard
          label="修課學生"
          value={course.summary.students}
          note={`${course.summary.active_students} 位已有學習活動`}
        />
        <MetricCard
          label="整體完成率"
          value={`${selectedLecture ? selectedLecture.completion_rate : course.summary.completion_rate}%`}
          note={selectedLecture ? selectedLecture.title : `${course.summary.lectures} 個課程小節`}
          tone="coral"
        />
        <MetricCard
          label="累積觀看"
          value={selectedLecture ? `${selectedLecture.watched_minutes} 分` : `${course.summary.watched_hours} 小時`}
          note="所有學生累積時間"
          tone="blue"
        />
        <MetricCard
          label="答題正確率"
          value={`${selectedLecture ? selectedLecture.accuracy : course.summary.question_accuracy}%`}
          note={`${selectedLecture ? selectedLecture.attempts : course.questions.reduce((sum, item) => sum + item.attempts, 0)} 次作答`}
          tone="green"
        />
      </section>

      <section className="teacher-grid teacher-grid-wide">
        <section className="teacher-panel lecture-performance">
          <div className="panel-title">
            <div>
              <h3>小節學習表現</h3>
              <p>完成率、互動與作答狀況</p>
            </div>
          </div>
          <div className="lecture-analysis-list">
            {visibleLectures.map((lecture, index) => (
              <button
                type="button"
                className="lecture-analysis-row"
                key={lecture.id}
                onClick={() => setLectureId(String(lecture.id))}
              >
                <span className="analysis-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="analysis-name">
                  <strong>{lecture.title}</strong>
                  <small>{lecture.students_started} 人開始 · {lecture.pause_count} 次暫停 · {lecture.seek_count} 次跳轉</small>
                </span>
                <span className="analysis-progress">
                  <span><b>{lecture.completion_rate}%</b> 完成</span>
                  <i><em style={{ width: `${lecture.completion_rate}%` }} /></i>
                </span>
                <span className="analysis-accuracy">{lecture.accuracy}%<small>正確率</small></span>
              </button>
            ))}
          </div>
        </section>
      </section>

      {selectedLecture && (
        <section className="teacher-grid">
          <HotspotTimeline
            key={`${selectedLecture.id}-pause`}
            timelineEnd={Math.max(30, ...[...(selectedLecture.pause_hotspots || []), ...(selectedLecture.seek_hotspots || [])].map(item => item.end))}
            title="暫停熱點"
            subtitle={`${selectedLecture.title}中，學生經常停下來思考的位置`}
            items={selectedLecture.pause_hotspots}
            type="pause"
          />
          <HotspotTimeline
            key={`${selectedLecture.id}-seek`}
            timelineEnd={Math.max(30, ...[...(selectedLecture.pause_hotspots || []), ...(selectedLecture.seek_hotspots || [])].map(item => item.end))}
            title="跳轉熱點"
            subtitle={`${selectedLecture.title}中，學生拖曳或重看的影片位置`}
            items={selectedLecture.seek_hotspots}
            type="seek"
          />
        </section>
      )}

      <section className="teacher-grid teacher-grid-students">
        <section className="teacher-panel">
          <div className="panel-title">
            <div>
              <h3>學生學習狀態</h3>
              <p>依課程累積進度與近期活動整理</p>
            </div>
            <div className="student-panel-actions">
              <span className="table-count">{selectedStudentIds.length} / {course.students.length} 已選</span>
              <button
                type="button"
                className="teacher-mail-button"
                onClick={handleOpenEmailPreview}
                disabled={!selectedStudentEmails.length || sendingEmails}
              >
                {sendingEmails ? '寄信中...' : '寄信給選取學生'}
              </button>
            </div>
          </div>
          <div className="teacher-table-wrap">
            <table className="teacher-table">
              <thead><tr><th className="student-checkbox-col"><input
                type="checkbox"
                checked={allStudentsSelected}
                onChange={handleToggleAllStudents}
                aria-label="全選學生"
              /></th><th>學生</th><th>完成小節</th><th>觀看時間</th><th>答題率</th><th>最近活動</th></tr></thead>
              <tbody>
                {course.students.map(student => (
                  <tr key={student.id}>
                    <td className="student-checkbox-col">
                      <input
                        type="checkbox"
                        checked={selectedStudentIds.includes(student.id)}
                        onChange={() => handleToggleStudent(student.id)}
                        aria-label={`選擇 ${student.name}`}
                      />
                    </td>
                    <td><div className="student-cell"><span>{student.name.charAt(0)}</span><div><strong>{student.name}</strong><small>{student.email}</small></div></div></td>
                    <td><b>{student.completed_lectures}</b> / {student.total_lectures}</td>
                    <td>{student.watched_minutes} 分鐘</td>
                    <td><span className={`accuracy-chip ${student.accuracy < 60 ? 'needs-help' : ''}`}>{student.accuracy}%</span></td>
                    <td>{formatDate(student.last_active)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="teacher-panel question-panel">
          <div className="panel-title">
            <div>
              <h3>{showAllQuestions ? '所有題目錯誤率' : '需關注題目'}</h3>
              <p>{selectedLecture ? `${selectedLecture.title} · 依錯誤率由高至低` : '全部小節 · 依錯誤率由高至低'}</p>
            </div>
          </div>
          {visibleQuestions.length > 0 && (
            <button
              type="button"
              className="question-view-toggle"
              aria-expanded={showAllQuestions}
              aria-controls="question-error-results"
              onClick={() => setShowAllQuestions(value => !value)}
            >
              {showAllQuestions ? '收合，僅顯示需關注題目' : `顯示所有題目錯誤率（${visibleQuestions.length} 題）`}
            </button>
          )}
          <div id="question-error-results">
            {displayedQuestions.length ? (
              <div className="question-insight-list">
                {displayedQuestions.map((question, index) => (
                  <div className="question-insight" key={question.id}>
                    <span>{index + 1}</span>
                    <div><p>{question.text}</p><small>{question.attempts} 次作答</small></div>
                    <strong className={`question-error-rate ${100 - question.accuracy >= 80 ? 'error-red' : 100 - question.accuracy >= 60 ? 'error-orange' : 100 - question.accuracy >= 40 ? 'error-yellow' : 'error-neutral'}`}>
                      <span>錯誤率</span>{100 - question.accuracy}%
                    </strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="teacher-empty compact">
                {visibleQuestions.length ? '目前所有題目的錯誤率皆為 0%，沒有需關注題目。' : selectedLecture ? '這個小節目前還沒有作答紀錄' : '目前還沒有作答紀錄'}
              </div>
            )}
          </div>
        </section>
      </section>
    </div>
  );
}
