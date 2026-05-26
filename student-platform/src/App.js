import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './Home';
import CourseDetail from './CourseDetail';
import LectureDetail from './LectureDetail';
import UploadLecture from './UploadLecture';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/course/:id" element={<CourseDetail />} />
        <Route path="/course/:id/lecture/:lectureId" element={<LectureDetail />} />
        <Route path="/upload-lecture" element={<UploadLecture />} />
      </Routes>
    </Router>
  );
}