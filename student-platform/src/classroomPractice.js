export function partitionPracticeQuestions(questions) {
  return (questions || []).reduce((groups, question) => {
    if (question.learning_status === 'skipped') groups.pending.push(question);
    return groups;
  }, { pending: [] });
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
    const triggerTime = Number(question.source_timestamp);
    const reached = largeJump
      ? Math.abs(currentTime - triggerTime) <= 2
      : triggerTime > lowerBound && triggerTime <= currentTime + 0.75;
    return Number.isFinite(triggerTime)
      && reached
      && !completedIds.has(question.id)
      && !shownIds.has(question.id);
  });
}

export function lecturePlayerMode(lecture) {
  return lecture?.media_source === 'upload' ? 'local' : 'youtube';
}
