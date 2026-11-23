import { fireEvent, render, screen } from '@testing-library/react';
import ReorderableLectureList from './ReorderableLectureList';

const items = [{ id: 1, title: '第一節' }, { id: 2, title: '第二節' }, { id: 3, title: '第三節' }];
const originalPointerEvent = window.PointerEvent;

beforeEach(() => {
  window.PointerEvent = MouseEvent;
  jest.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function () {
    return this.classList.contains('lecture-reorder-item') ? [...this.parentElement.children].indexOf(this) * 100 : 0;
  });
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const translate = Number(this.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1] || 0);
    const top = this.offsetTop + translate;
    return { top, bottom: top + 100, height: 100, left: 0, right: 300, width: 300 };
  });
});
afterEach(() => {
  window.PointerEvent = originalPointerEvent;
  jest.restoreAllMocks();
});

function setup(props = {}) {
  const onReorder = jest.fn();
  const result = render(<ReorderableLectureList items={items} onReorder={onReorder} {...props}>
    {(item, index, handle) => <article>{handle}<span>{index + 1} {item.title}</span></article>}
  </ReorderableLectureList>);
  return { ...result, onReorder };
}

function titles() {
  return screen.getAllByRole('article').map(node => node.textContent.replace('⠿', ''));
}

test('crosses multiple midpoints, stays under the pointer, and saves only on release', () => {
  const { onReorder } = setup();
  const handle = screen.getByRole('button', { name: '拖曳排序 第一節' });
  fireEvent.pointerDown(handle, { clientY: 50, button: 0 });
  fireEvent.pointerMove(handle, { clientY: 260 });
  expect(titles()).toEqual(['1 第二節', '2 第三節', '3 第一節']);
  const dragged = handle.closest('.lecture-reorder-item');
  expect(dragged).toHaveClass('is-dragging');
  expect(dragged.getBoundingClientRect().top).toBe(210);
  expect(onReorder).not.toHaveBeenCalled();
  fireEvent.pointerUp(handle, { clientY: 260 });
  expect(onReorder).toHaveBeenCalledTimes(1);
  expect(onReorder).toHaveBeenCalledWith([2, 3, 1]);
  expect(dragged).not.toHaveClass('is-dragging');
});

test('supports dragging upward and cancelling without saving', () => {
  const { onReorder } = setup();
  const handle = screen.getByRole('button', { name: '拖曳排序 第三節' });
  fireEvent.pointerDown(handle, { clientY: 250, button: 0 });
  fireEvent.pointerMove(handle, { clientY: 40 });
  expect(titles()).toEqual(['1 第三節', '2 第一節', '3 第二節']);
  fireEvent.pointerCancel(handle);
  expect(titles()).toEqual(['1 第一節', '2 第二節', '3 第三節']);
  expect(onReorder).not.toHaveBeenCalled();
});

test('clicking without a move does not save and keyboard arrows can reorder', () => {
  const { onReorder } = setup();
  const handle = screen.getByRole('button', { name: '拖曳排序 第一節' });
  fireEvent.pointerDown(handle, { clientY: 50, button: 0 });
  fireEvent.pointerUp(handle, { clientY: 50 });
  expect(onReorder).not.toHaveBeenCalled();
  fireEvent.keyDown(handle, { key: 'ArrowUp' });
  expect(onReorder).not.toHaveBeenCalled();
  fireEvent.keyDown(handle, { key: 'ArrowDown' });
  expect(onReorder).toHaveBeenCalledWith([2, 1, 3]);
});

test('disabled lists do not allow dragging or keyboard moves', () => {
  const { onReorder } = setup({ disabled: true });
  const handle = screen.getByRole('button', { name: '拖曳排序 第一節' });
  fireEvent.pointerDown(handle, { clientY: 50, button: 0 });
  fireEvent.pointerMove(handle, { clientY: 260 });
  fireEvent.pointerUp(handle);
  fireEvent.keyDown(handle, { key: 'ArrowDown' });
  expect(onReorder).not.toHaveBeenCalled();
});
