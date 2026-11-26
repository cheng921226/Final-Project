function seconds(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parts = String(value).trim().split(':');
  if (parts.length > 3 || parts.some(part => !/^\d+(\.\d+)?$/.test(part))) return null;
  const result = parts.reduce((total, part) => total * 60 + Number(part), 0);
  return Number.isFinite(result) ? result : null;
}

export function findActiveKnowledgePoint(points, currentTime) {
  if (!Number.isFinite(currentTime) || currentTime < 0) return null;
  const ranges = points.map((point, index) => ({
    index, start: seconds(point.start_time), end: seconds(point.end_time),
  })).filter(point => point.start !== null).sort((a, b) => a.start - b.start);
  let current = null;
  for (const point of ranges) {
    if (point.start > currentTime) break;
    current = point;
  }
  if (!current) return null;
  // A missing end extends to the next start (or to the end of the video).
  // An explicit end preserves gaps instead of labelling unrelated content.
  if (current.end !== null && currentTime >= current.end) return null;
  return current.index;
}
