import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './Layout';
import Home from './Home';
import CourseDetail from './CourseDetail';
import LectureDetail from './LectureDetail';
import Login from './Login';
import Register from './Register';
import Profile from './Profile';
import ReviewMode from './ReviewMode';
import TeacherDashboard from './TeacherDashboard';
import QuestionReview from './QuestionReview';
import Achievements from './Achievements';
import CourseUpload from './CourseUpload';
import CreditSettings from './CreditSettings';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("access_token"));

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout token={token} setToken={setToken} />}>
          <Route index element={<Home token={token} />} />
          <Route path="course/:id" element={<CourseDetail />} />
          <Route path="course/:id/lecture/:lectureId" element={<LectureDetail />} />
          <Route path="login" element={<Login setToken={setToken} />} />
          <Route path="register" element={<Register />} />
          <Route path="profile" element={<Profile />} />
          <Route path="review" element={<ReviewMode />} />
          <Route path="achievements" element={<Achievements />} />
          <Route path="teacher" element={<TeacherDashboard />} />
          <Route path="teacher/upload" element={<CourseUpload />} />
          <Route path="teacher/questions" element={<QuestionReview />} />
          <Route path="teacher/credits" element={<CreditSettings />} />
        </Route>
      </Routes>
    </Router>
  );
}
