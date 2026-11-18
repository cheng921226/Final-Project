import {
  findTimedQuestion,
  lecturePlayerMode,
  partitionPracticeQuestions,
} from './classroomPractice';

test('only includes explicitly skipped questions in classroom practice', () => {
  const result = partitionPracticeQuestions([
    { id: 1, learning_status: 'skipped' },
    { id: 2, learning_status: 'completed' },
    { id: 3, learning_status: 'unanswered' },
  ]);
  expect(result.pending.map(item => item.id)).toEqual([1]);
});

test('does not repeat shown or completed timed questions', () => {
  const questions = [
    { id: 1, source_timestamp: 10 },
    { id: 2, source_timestamp: 12 },
  ];
  expect(findTimedQuestion({
    questions,
    currentTime: 12,
    previousTime: 10,
    shownIds: new Set([1]),
    completedIds: new Set(),
  })?.id).toBe(2);
  expect(findTimedQuestion({
    questions,
    currentTime: 12,
    previousTime: 10,
    shownIds: new Set([1]),
    completedIds: new Set([2]),
  })).toBeUndefined();
});

test('a large seek does not trigger old questions in bulk', () => {
  expect(findTimedQuestion({
    questions: [{ id: 1, source_timestamp: 10 }, { id: 2, source_timestamp: 50 }],
    currentTime: 50,
    previousTime: 5,
    shownIds: new Set(),
    completedIds: new Set(),
  })?.id).toBe(2);
});

test('selects HTML5 only for uploaded media', () => {
  expect(lecturePlayerMode({ media_source: 'upload' })).toBe('local');
  expect(lecturePlayerMode({ media_source: 'youtube' })).toBe('youtube');
});

test('includes unanswered questions after the lecture is complete', () => {
  const questions = [
    { id: 1, learning_status: 'skipped' },
    { id: 2, learning_status: 'completed' },
    { id: 3, learning_status: 'unanswered', source_timestamp: null },
  ];
  expect(partitionPracticeQuestions(questions, true).pending.map(question => question.id)).toEqual([1, 3]);
});

test('questions without timestamps never trigger during playback', () => {
  expect(findTimedQuestion({
    questions: [{ id: 1, source_timestamp: null }],
    currentTime: 0,
    previousTime: null,
    shownIds: new Set(),
    completedIds: new Set(),
  })).toBeUndefined();
});

test('shows untimed unanswered questions at the end even below the completion threshold', () => {
  const questions = [
    { id: 1, learning_status: 'unanswered', source_timestamp: 10 },
    { id: 2, learning_status: 'unanswered', source_timestamp: null },
    { id: 3, learning_status: 'completed', source_timestamp: null },
  ];
  expect(partitionPracticeQuestions(questions, false, true).pending.map(item => item.id)).toEqual([2]);
});
