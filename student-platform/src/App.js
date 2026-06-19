import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './Layout';
import Home from './Home';
import CourseDetail from './CourseDetail';
import LectureDetail from './LectureDetail';
import UploadLecture from './UploadLecture';
import Login from './Login';
import Register from './Register';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="course/:id" element={<CourseDetail />} />
          <Route path="course/:id/lecture/:lectureId" element={<LectureDetail />} />
          <Route path="upload-lecture" element={<UploadLecture />} />
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
        </Route>
      </Routes>
    </Router>
  );
}