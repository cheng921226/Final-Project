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

function HotspotList({ title, subtitle, items, type }) {
  const max = Math.max(...items.map(item => item.count), 1);
  return (
    <section className="teacher-panel hotspot-panel">
      <div className="panel-title">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span className={`panel-dot panel-dot-${type}`} />
      </div>
      {items.length ? (
        <div className="hotspot-list">
          {items.map(item => (
            <div className="hotspot-row" key={`${type}-${item.start}`}>
              <div className="hotspot-label">
                <span className="hotspot-time">{formatDuration(item.start)}–{formatDuration(item.end)}</span>
                <small>
                  {item.knowledge_points?.length
                    ? item.knowledge_points.join('、')
                    : '未設定知識點'}
                </small>
              </div>
              <div className="hotspot-track">
                <div
                  className={`hotspot-fill hotspot-fill-${type}`}
                  style={{ width: `${Math.max((item.count / max) * 100, 8)}%` }}
                />
              </div>
              <strong>{item.count} 次</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className="teacher-empty compact">目前還沒有足夠的事件資料</div>
      )}
    </section>
  );
}

export default function TeacherDashboard() {
  const [data, setData] = useState(null);
  const [courseId, setCourseId] = useState('');
  const [lectureId, setLectureId] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const course = useMemo(
    () => data?.courses?.find(item => String(item.id) === courseId),
    [data, courseId]
  );
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
          <HotspotList
            title="暫停熱點"
            subtitle={`${selectedLecture.title}中，學生經常停下來思考的位置`}
            items={selectedLecture.pause_hotspots}
            type="pause"
          />
          <HotspotList
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
            <span className="table-count">{course.students.length} 位學生</span>
          </div>
          <div className="teacher-table-wrap">
            <table className="teacher-table">
              <thead><tr><th>學生</th><th>完成小節</th><th>觀看時間</th><th>答題率</th><th>最近活動</th></tr></thead>
              <tbody>
                {course.students.map(student => (
                  <tr key={student.id}>
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
              <h3>需關注題目</h3>
              <p>{selectedLecture ? `${selectedLecture.title} · 依正確率由低至高` : '全部小節 · 依正確率由低至高'}</p>
            </div>
          </div>
          {visibleQuestions.length ? (
            <div className="question-insight-list">
              {visibleQuestions.slice(0, 5).map((question, index) => (
                <div className="question-insight" key={question.id}>
                  <span>{index + 1}</span>
                  <div><p>{question.text}</p><small>{question.attempts} 次作答</small></div>
                  <strong>{question.accuracy}%</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="teacher-empty compact">
              {selectedLecture ? '這個小節目前還沒有作答紀錄' : '目前還沒有作答紀錄'}
            </div>
          )}
        </section>
      </section>
    </div>
  );
}
