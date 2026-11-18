export function partitionPracticeQuestions(questions, lectureCompleted = false, videoEnded = false) {
  return (questions || []).reduce((groups, question) => {
    if (question.learning_status === 'skipped'
      || (question.learning_status === 'unanswered'
        && (lectureCompleted || (videoEnded && questionPlaybackTime(question) === null)))) {
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

export function savedPositionReachedEnd(position, duration) {
  return Number.isFinite(duration) && duration >= 1
    && Number.isFinite(position) && position >= Math.floor(duration);
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
