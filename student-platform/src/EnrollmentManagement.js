import React, { useEffect, useMemo, useState } from 'react';
import SearchableCourseSelect from './SearchableCourseSelect';

const API_URL = 'http://127.0.0.1:8000';

export default function EnrollmentManagement() {
  const token = localStorage.getItem('access_token');
  const courseFromUrl = new URLSearchParams(window.location.search).get('course') || '';
  const [data, setData] = useState(null);
  const [courseId, setCourseId] = useState(courseFromUrl);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);

  async function load(preferredCourseId = courseId) {
    if (!token) {
      setError('請先使用校園平台端帳號登入。');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const query = preferredCourseId ? `?course_id=${preferredCourseId}` : '';
      const response = await fetch(`${API_URL}/campus/enrollments${query}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || '無法取得選課資料');
      setData(body);
      const nextCourseId = body.course_id ? String(body.course_id) : '';
      setCourseId(nextCourseId);
      setSelectedIds([]);
      const url = new URL(window.location.href);
      if (nextCourseId) url.searchParams.set('course', nextCourseId);
      else url.searchParams.delete('course');
      window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    } catch (err) {
      setError(err.message || '選課資料載入失敗');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(courseFromUrl); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCourse = useMemo(
    () => data?.courses?.find(course => String(course.id) === String(courseId)),
    [courseId, data]
  );
  const enrolledCount = data?.students?.filter(student => student.enrolled).length || 0;
  const visibleStudents = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('zh-TW');
    return (data?.students || []).filter(student => {
      const matchesKeyword = !keyword || [student.name, student.email, student.student_number]
        .some(value => String(value || '').toLocaleLowerCase('zh-TW').includes(keyword));
      return matchesKeyword
        && (classFilter === 'all' || String(student.class_id || '') === classFilter)
        && (statusFilter === 'all'
          || (statusFilter === 'enrolled' && student.enrolled)
          || (statusFilter === 'available' && !student.enrolled));
    });
  }, [classFilter, data, search, statusFilter]);
  const visibleIds = visibleStudents.map(student => student.id);
  const allVisibleSelected = Boolean(visibleIds.length)
    && visibleIds.every(id => selectedIds.includes(id));

  function toggleStudent(studentId) {
    setSelectedIds(current => current.includes(studentId)
      ? current.filter(id => id !== studentId)
      : [...current, studentId]);
  }

  function toggleAllVisible() {
    setSelectedIds(current => {
      if (allVisibleSelected) return current.filter(id => !visibleIds.includes(id));
      return Array.from(new Set([...current, ...visibleIds]));
    });
  }

  async function updateEnrollments(action) {
    if (!courseId || !selectedIds.length || busy) return;
    if (action === 'remove' && !window.confirm(`確定將選取的 ${selectedIds.length} 位學生移出「${selectedCourse?.title || '此課程'}」嗎？\n\n既有觀看、作答與學分紀錄會保留。`)) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/campus/enrollments/${courseId}`, {
        method: action === 'add' ? 'POST' : 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ student_ids: selectedIds }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || '選課名單更新失敗');
      setMessage(body.message);
      await load(courseId);
    } catch (err) {
      setMessage(err.message || '選課名單更新失敗');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <div className="teacher-state"><div className="teacher-loader" /><p>正在載入選課資料...</p></div>;
  if (error && !data) return <div className="teacher-state"><span className="teacher-state-icon">!</span><h1>無法開啟選課管理</h1><p>{error}</p></div>;

  return (
    <div className="teacher-page enrollment-page">
      <header className="teacher-hero"><div><p className="eyebrow">Enrollment</p><h1>選課管理</h1><p>依課程與班級安排學生選課，並管理目前的修課名單。</p></div></header>

      <section className="teacher-panel enrollment-course-panel">
        <SearchableCourseSelect
          courses={data?.courses || []}
          value={courseId}
          onChange={nextCourseId => { setCourseId(nextCourseId); load(nextCourseId); }}
          optionLabel={course => `${course.title || `課程 ${course.id}`}｜${course.teacher_name || '尚未指派'}`}
        />
        {selectedCourse && <div className="enrollment-course-summary"><div><span>目前課程</span><strong>{selectedCourse.title}</strong><small>{selectedCourse.teacher_name || '尚未指派'} · {selectedCourse.status === 'published' ? '已發布' : '草稿'}</small></div><div><span>選課人數</span><strong>{enrolledCount}</strong><small>全校學生共 {data.students.length} 人</small></div></div>}
      </section>

      {message && <p className="question-review-message">{message}</p>}

      <section className="teacher-panel enrollment-roster-panel">
        <div className="panel-title"><div><h3>學生名單</h3><p>可先依班級或選課狀態篩選，再批次加入或移出課程。</p></div><span className="table-count">已選 {selectedIds.length} 人</span></div>
        <div className="enrollment-toolbar">
          <label><span>搜尋</span><input aria-label="搜尋學生" value={search} onChange={event => setSearch(event.target.value)} placeholder="姓名、Email 或學號" /></label>
          <label><span>班級</span><select aria-label="班級篩選" value={classFilter} onChange={event => setClassFilter(event.target.value)}><option value="all">全部班級</option>{(data?.classes || []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>選課狀態</span><select aria-label="選課狀態篩選" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">全部學生</option><option value="enrolled">已選課</option><option value="available">尚未選課</option></select></label>
          <div className="enrollment-batch-actions"><button type="button" className="question-save-button" disabled={!selectedIds.length || busy} onClick={() => updateEnrollments('add')}>{busy ? '處理中...' : '加入課程'}</button><button type="button" className="course-delete-button" disabled={!selectedIds.length || busy} onClick={() => updateEnrollments('remove')}>移出課程</button></div>
        </div>

        <div className="personnel-table-wrap">
          <table className="personnel-table enrollment-table">
            <thead><tr><th><input type="checkbox" aria-label="選取目前篩選的全部學生" checked={allVisibleSelected} onChange={toggleAllVisible} /></th><th>學號</th><th>學生</th><th>班級</th><th>選課狀態</th><th>選課時間</th></tr></thead>
            <tbody>{visibleStudents.map(student => <tr key={student.id}><td><input type="checkbox" aria-label={`選取 ${student.name}`} checked={selectedIds.includes(student.id)} onChange={() => toggleStudent(student.id)} /></td><td><strong>{student.student_number || '未填學號'}</strong></td><td><strong>{student.name}</strong><span>{student.email}</span></td><td>{student.class_name || '未分班'}</td><td><span className={`personnel-status ${student.enrolled ? 'status-active' : 'status-incomplete'}`}>{student.enrolled ? '已選課' : '尚未選課'}</span></td><td>{student.enrolled_at ? new Date(student.enrolled_at).toLocaleString('zh-TW') : '—'}</td></tr>)}</tbody>
          </table>
          {!visibleStudents.length && <div className="teacher-empty compact">找不到符合條件的學生。</div>}
        </div>
      </section>
    </div>
  );
}
