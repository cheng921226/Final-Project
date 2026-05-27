import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

function UploadLecture() {
  const navigate = useNavigate();

  // 下拉選單資料
  const [teachers, setTeachers] = useState([]);
  const [courses, setCourses] = useState([]);

  // 老師欄位
  const [teacherMode, setTeacherMode] = useState('select'); // 'select' | 'new'
  const [selectedTeacherId, setSelectedTeacherId] = useState('');
  const [newTeacherName, setNewTeacherName] = useState('');
  const [newTeacherEmail, setNewTeacherEmail] = useState('');

  // 課程欄位
  const [courseMode, setCourseMode] = useState('select'); // 'select' | 'new'
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [newCourseTitle, setNewCourseTitle] = useState('');

  // 小節欄位
  const [lectureTitle, setLectureTitle] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');

  // 狀態
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    async function fetchOptions() {
      try {
        const teacherRes = await fetch(`${API_URL}/teachers`);
        if (teacherRes.ok) {
          const data = await teacherRes.json();
          setTeachers(Array.isArray(data) ? data : []);
        }
      } catch (e) {}

      try {
        const courseRes = await fetch(`${API_URL}/courses`);
        if (courseRes.ok) {
          const data = await courseRes.json();
          setCourses(Array.isArray(data) ? data : []);
        }
      } catch (e) {}
    }
    fetchOptions();
  }, []);

  async function handleSubmit() {
    setErrorMsg('');
    setSuccessMsg('');

    // 驗證
    if (teacherMode === 'select' && !selectedTeacherId) {
      setErrorMsg('請選擇老師或輸入新老師資料');
      return;
    }
    if (teacherMode === 'new' && !newTeacherName.trim()) {
      setErrorMsg('請輸入老師姓名');
      return;
    }
    if (courseMode === 'select' && !selectedCourseId) {
      setErrorMsg('請選擇課程或輸入新課程名稱');
      return;
    }
    if (courseMode === 'new' && !newCourseTitle.trim()) {
      setErrorMsg('請輸入課程名稱');
      return;
    }
    if (!lectureTitle.trim()) {
      setErrorMsg('請輸入小節標題');
      return;
    }
    if (!mediaUrl.trim()) {
      setErrorMsg('請輸入影片連結');
      return;
    }

    setSubmitting(true);
    try {
      // Step 1: 若需要新增老師
      let teacherId = selectedTeacherId;
      if (teacherMode === 'new') {
        const res = await fetch(`${API_URL}/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newTeacherName.trim(),
            email: newTeacherEmail.trim() || null,
            role: 'teacher',
          }),
        });
        if (!res.ok) throw new Error('新增老師失敗');
        const data = await res.json();
        teacherId = data.id;
      }

      // Step 2: 若需要新增課程
      let courseId = selectedCourseId;
      if (courseMode === 'new') {
        const res = await fetch(`${API_URL}/courses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: newCourseTitle.trim(),
            teacher_id: teacherId,
          }),
        });
        if (!res.ok) throw new Error('新增課程失敗');
        const data = await res.json();
        courseId = data.id;
      }

      // Step 3: 新增小節
      const res = await fetch(`${API_URL}/lectures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: lectureTitle.trim(),
          media_url: mediaUrl.trim(),
          course_id: courseId,
          status: 'uploaded',
        }),
      });
      if (!res.ok) throw new Error('新增小節失敗');

      setSuccessMsg('✅ 上傳成功！');
      // 清空表單
      setSelectedTeacherId('');
      setNewTeacherName('');
      setNewTeacherEmail('');
      setSelectedCourseId('');
      setNewCourseTitle('');
      setLectureTitle('');
      setMediaUrl('');
      setTeacherMode('select');
      setCourseMode('select');
    } catch (err) {
      setErrorMsg(err.message || '上傳失敗，請再試一次');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <header className="max-w-2xl mx-auto mb-8 flex justify-between items-center">
        <div>
          <Link to="/" className="text-blue-500 text-sm hover:underline">← 返回首頁</Link>
          <h1 className="text-2xl font-bold text-slate-800 mt-1">上傳課程小節</h1>
          <p className="text-slate-500 text-sm">填寫以下資訊以新增影片小節</p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto bg-white p-8 rounded-2xl shadow-sm space-y-6">

        {/* 老師 */}
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">老師</label>
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => setTeacherMode('select')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition ${teacherMode === 'select' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'}`}
            >
              從清單選擇
            </button>
            <button
              type="button"
              onClick={() => setTeacherMode('new')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition ${teacherMode === 'new' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'}`}
            >
              新增老師
            </button>
          </div>
          {teacherMode === 'select' ? (
            <select
              value={selectedTeacherId}
              onChange={e => setSelectedTeacherId(e.target.value)}
              className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
            >
              <option value="">請選擇老師</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>{t.name}（{t.email}）</option>
              ))}
            </select>
          ) : (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="老師姓名（必填）"
                value={newTeacherName}
                onChange={e => setNewTeacherName(e.target.value)}
                className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
              />
              <input
                type="email"
                placeholder="老師 Email（選填）"
                value={newTeacherEmail}
                onChange={e => setNewTeacherEmail(e.target.value)}
                className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
              />
            </div>
          )}
        </div>

        {/* 課程 */}
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">課程</label>
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => setCourseMode('select')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition ${courseMode === 'select' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'}`}
            >
              從清單選擇
            </button>
            <button
              type="button"
              onClick={() => setCourseMode('new')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition ${courseMode === 'new' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'}`}
            >
              新增課程
            </button>
          </div>
          {courseMode === 'select' ? (
            <select
              value={selectedCourseId}
              onChange={e => setSelectedCourseId(e.target.value)}
              className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
            >
              <option value="">請選擇課程</option>
              {courses.map(c => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              placeholder="課程名稱（必填）"
              value={newCourseTitle}
              onChange={e => setNewCourseTitle(e.target.value)}
              className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
            />
          )}
        </div>

        {/* 小節標題 */}
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">小節標題</label>
          <input
            type="text"
            placeholder="例如：第一章：資料結構簡介"
            value={lectureTitle}
            onChange={e => setLectureTitle(e.target.value)}
            className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
          />
        </div>

        {/* 影片連結 */}
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">YouTube 影片連結</label>
          <input
            type="url"
            placeholder="https://www.youtube.com/watch?v=..."
            value={mediaUrl}
            onChange={e => setMediaUrl(e.target.value)}
            className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
          />
        </div>

        {/* 錯誤 / 成功訊息 */}
        {errorMsg && <p className="text-red-500 text-sm">{errorMsg}</p>}
        {successMsg && <p className="text-green-600 text-sm">{successMsg}</p>}

        {/* 送出 */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300 text-white font-bold py-3 rounded-xl transition text-sm"
        >
          {submitting ? '上傳中...' : '送出'}
        </button>
      </main>
    </div>
  );
}

export default UploadLecture;