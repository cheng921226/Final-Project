import React from 'react';
import { Link } from 'react-router-dom';
import { courses } from './data';

function Home() {
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
      </section>
    </div>
  );
}

export default Home;