import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:8000';

function Home() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchCourses() {
      try {
        const response = await fetch(`${API_URL}/lectures`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          const teacherIds = Array.from(new Set(data.map(item => item.teacher_id).filter(Boolean)));
          const teacherMap = {};

          await Promise.all(teacherIds.map(async teacherId => {
            try {
              const teacherRes = await fetch(`${API_URL}/teachers/${teacherId}`);
              if (!teacherRes.ok) return;
              const teacherData = await teacherRes.json();
              if (teacherData?.id) {
                teacherMap[teacherData.id] = teacherData.name ?? teacherData.email ?? `講師 ${teacherData.id}`;
              }
            } catch (e) {
              // ignore individual teacher fetch errors
            }
          }));

          setCourses(data.map(item => ({
            id: item.id?.toString() ?? item.course_name ?? item.title ?? 'unknown',
            title: item.course_name ?? item.title ?? '未命名課程',
            teacher: item.teacher ?? item.teacher_name ?? teacherMap[item.teacher_id] ?? (item.teacher_id ? `講師 ${item.teacher_id}` : '未知講師'),
            status: item.status ?? '未設定狀態',
          })));
        }
      } catch (err) {
        setError(err.message || '取得課程失敗');
      } finally {
        setLoading(false);
      }
    }
    fetchCourses();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      {/* 搜尋區 */}
      <section className="max-w-4xl mx-auto mb-12 text-center">
        <h1 className="text-4xl font-extrabold text-slate-800 mb-4">今天想學什麼？</h1>
        <div className="relative">
          <input 
            type="text" 
            placeholder="搜尋課程內容或 AI 知識點..." 
            className="w-full p-4 rounded-2xl shadow-lg border-none focus:ring-2 focus:ring-blue-500"
          />
          <button className="absolute right-4 top-3 bg-blue-600 text-white px-4 py-1.5 rounded-xl">搜尋</button>
        </div>
      </section>

      {/* 課程列表區 */}
      <section className="max-w-6xl mx-auto">
        <h2 className="text-xl font-bold mb-6">我的課程</h2>
        {loading ? (
          <p className="text-slate-500">正在載入課程資料...</p>
        ) : error ? (
          <p className="text-red-500">{error}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map(course => (
              <Link to={`/course/${course.id}`} key={course.id}>
                <div className="bg-white p-5 rounded-2xl shadow-sm hover:shadow-xl transition-all border border-slate-100 group">
                  <div className="aspect-video bg-slate-200 rounded-xl mb-4 group-hover:bg-blue-100 transition-colors flex items-center justify-center text-slate-400">
                    影片封面圖
                  </div>
                  <h3 className="font-bold text-lg text-slate-800">{course.title}</h3>
                  <p className="text-slate-500 text-sm mb-3">{course.teacher}</p>
                  <span className={`text-xs px-2 py-1 rounded-full ${course.status === 'AI 分析完成' ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'}`}>
                    {course.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default Home;