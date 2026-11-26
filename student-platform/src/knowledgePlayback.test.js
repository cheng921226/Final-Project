import { findActiveKnowledgePoint } from './knowledgePlayback';

test('tracks timed ranges, exact boundaries, gaps and backward seeks', () => {
  const points = [{ start_time: 10, end_time: 20 }, { start_time: '0:30', end_time: '0:40' }];
  expect([0, 10, 19.9, 20, 25, 30, 40, 15].map(time => findActiveKnowledgePoint(points, time)))
    .toEqual([null, 0, 0, null, null, 1, null, 0]);
});

test('uses the next start for missing ends, preserving the original list index', () => {
  const points = [{ start_time: '1:00' }, { start_time: '0:10' }, { title: '沒有時間' }];
  expect(findActiveKnowledgePoint(points, 30)).toBe(1);
  expect(findActiveKnowledgePoint(points, 60)).toBe(0);
  expect(findActiveKnowledgePoint(points, 90)).toBe(0);
});

test('ignores invalid timestamps and prefers the most recently started range', () => {
  const points = [{ start_time: null }, { start_time: 'invalid' }, { start_time: 0, end_time: 100 }, { start_time: 20, end_time: 30 }];
  expect(findActiveKnowledgePoint(points, 0)).toBe(2);
  expect(findActiveKnowledgePoint(points, 25)).toBe(3);
  expect(findActiveKnowledgePoint(points, 35)).toBeNull();
  expect(findActiveKnowledgePoint(points, NaN)).toBeNull();
});
