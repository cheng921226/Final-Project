export function partitionPracticeQuestions(questions, lectureCompleted = false) {
  return (questions || []).reduce((groups, question) => {
    if (question.learning_status === 'skipped'
      || (lectureCompleted && question.learning_status === 'unanswered')) {
      groups.pending.push(question);
    }
    return groups;
  }, { pending: [] });
}

export function questionPlaybackTime(question) {
  if (question.source_timestamp == null || question.source_timestamp === '') return null;
  const seconds = Number(question.source_timestamp);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function findTimedQuestion({
  questions,
  currentTime,
  previousTime,
  shownIds,
  completedIds,
}) {
  const largeJump = previousTime !== null && Math.abs(currentTime - previousTime) > 6;
  const lowerBound = previousTime === null ? currentTime - 3 : previousTime - 0.25;
  return (questions || []).find(question => {
    const triggerTime = questionPlaybackTime(question);
    if (triggerTime === null) return false;
    const reached = largeJump
      ? Math.abs(currentTime - triggerTime) <= 2
      : triggerTime > lowerBound && triggerTime <= currentTime + 0.75;
    return reached
      && !completedIds.has(question.id)
      && !shownIds.has(question.id);
  });
}

export function lecturePlayerMode(lecture) {
  return lecture?.media_source === 'upload' ? 'local' : 'youtube';
}
