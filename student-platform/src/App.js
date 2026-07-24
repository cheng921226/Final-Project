import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './Layout';
import Home from './Home';
import CourseDetail from './CourseDetail';
import LectureDetail from './LectureDetail';
import Login from './Login';
import Register from './Register';
import Profile from './Profile';

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
        </Route>
      </Routes>
    </Router>
  );
}
