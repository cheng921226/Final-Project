import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
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
import FinalAssessment from './FinalAssessment';
import TeacherFinalAssessment from './TeacherFinalAssessment';
import Certificate from './Certificate';
import CourseManagement from './CourseManagement';

function RequireAuth({ children }) {
  const location = useLocation();
  const token = localStorage.getItem('access_token');

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("access_token"));

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout token={token} setToken={setToken} />}>
          <Route index element={<Home token={token} />} />
          <Route path="course/:id" element={<RequireAuth><CourseDetail /></RequireAuth>} />
          <Route path="course/:id/lecture/:lectureId" element={<RequireAuth><LectureDetail /></RequireAuth>} />
          <Route path="course/:id/final-assessment" element={<RequireAuth><FinalAssessment /></RequireAuth>} />
          <Route path="login" element={<Login setToken={setToken} />} />
          <Route path="register" element={<Register />} />
          <Route path="profile" element={<Profile />} />
          <Route path="review" element={<ReviewMode />} />
          <Route path="achievements" element={<Achievements />} />
          <Route path="certificate/:courseId" element={<Certificate />} />
          <Route path="teacher" element={<TeacherDashboard />} />
          <Route path="teacher/upload" element={<CourseUpload />} />
          <Route path="teacher/questions" element={<QuestionReview />} />
          <Route path="teacher/final-assessment" element={<TeacherFinalAssessment />} />
          <Route path="teacher/credits" element={<CreditSettings />} />
          <Route path="teacher/courses" element={<CourseManagement />} />
        </Route>
      </Routes>
    </Router>
  );
}
