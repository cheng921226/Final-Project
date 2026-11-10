import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Markmap } from 'markmap-view';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LectureDetail from './LectureDetail';

jest.mock('markmap-view', () => ({
  Markmap: { create: jest.fn() },
}));

test('uses measured zoom bounds and cancels mindmap animations when leaving the tab', async () => {
  const originalFetch = global.fetch;
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = jest.fn();
  jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const responses = {
    '/lectures/2': [{}],
    '/lectures/2/mindmaps': [{ mindmap_json: { markdown: '# 課程\n## 走訪' } }],
    '/lectures/2/knowledge_points': [{ id: 1, title: '走訪', start_time: 205 }],
  };
  global.fetch = jest.fn(async url => ({
    ok: true,
    json: async () => responses[new URL(url).pathname] ?? [],
  }));

  const markmap = {
    zoom: { extent: jest.fn() },
    state: {},
    svg: {
      interrupt: jest.fn().mockReturnThis(),
      selectAll: jest.fn().mockReturnThis(),
    },
    setData: jest.fn(root => { markmap.state.data = root; }),
    destroy: jest.fn(() => {
      expect(markmap.state.data).toBeUndefined();
      expect(markmap.svg.interrupt).toHaveBeenCalledTimes(2);
    }),
  };
  Markmap.create.mockReturnValue(markmap);

  try {
    render(
      <MemoryRouter initialEntries={['/course/1/lecture/2']}>
        <Routes>
          <Route path="/course/:id/lecture/:lectureId" element={<LectureDetail />} />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /心智圖/ }));
    await waitFor(() => expect(markmap.setData).toHaveBeenCalledTimes(1));

    const [svg] = Markmap.create.mock.calls[0];
    const [extent] = markmap.zoom.extent.mock.calls[0];
    const measure = jest.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ width: 640, height: 420 });
    expect(extent()).toEqual([[0, 0], [640, 420]]);
    expect(markmap.state.data.children[0].content).not.toContain('<button');

    fireEvent.click(screen.getByRole('button', { name: /AI 摘要/ }));
    expect(svg.isConnected).toBe(false);
    expect(markmap.destroy).toHaveBeenCalledTimes(1);
    measure.mockReturnValue({ width: 0, height: 0 });
    expect(extent()).toEqual([[0, 0], [1, 1]]);
  } finally {
    Markmap.create.mockReset();
    global.fetch = originalFetch;
    Element.prototype.scrollIntoView = originalScrollIntoView;
    jest.restoreAllMocks();
  }
});
