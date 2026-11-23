import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

const GLIDE = 'transform 400ms cubic-bezier(0.16, 1, 0.3, 1)';

export default function ReorderableLectureList({ items, disabled, onReorder, children }) {
  const [ids, setIds] = useState(() => items.map(item => item.id));
  const [dragging, setDragging] = useState(null);
  const listRef = useRef(null);
  const nodes = useRef(new Map());
  const drag = useRef(null);
  const previousTops = useRef(new Map());
  const frames = useRef(new Map());
  const itemMap = new Map(items.map(item => [item.id, item]));

  useEffect(() => {
    if (!drag.current) setIds(items.map(item => item.id));
  }, [items]);

  useEffect(() => () => {
    frames.current.forEach(frame => cancelAnimationFrame(frame));
    drag.current = null;
  }, []);

  useLayoutEffect(() => {
    const listTop = listRef.current?.getBoundingClientRect().top || 0;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    nodes.current.forEach((node, id) => {
      cancelAnimationFrame(frames.current.get(id));
      const active = drag.current;
      if (active?.id === id) {
        // Moving the DOM row changes its layout position. Adjust the origin by
        // the same amount so its visual position remains under the pointer.
        active.originY += node.offsetTop - active.top;
        active.top = node.offsetTop;
        node.style.transition = 'none';
        node.style.transform = `translateY(${active.y - active.originY}px)`;
      } else if (previousTops.current.has(id)) {
        const delta = previousTops.current.get(id) - (listTop + node.offsetTop);
        node.style.transition = 'none';
        node.style.transform = reduced ? '' : `translateY(${delta}px)`;
        // Commit the starting position before enabling the glide.
        node.getBoundingClientRect();
        frames.current.set(id, requestAnimationFrame(() => {
          node.style.transition = reduced ? 'none' : GLIDE;
          node.style.transform = '';
        }));
      }
    });
    previousTops.current.clear();
  }, [ids, dragging]);

  function rememberPositions() {
    previousTops.current = new Map([...nodes.current].map(([id, node]) => [id, node.getBoundingClientRect().top]));
  }

  function start(event, id) {
    if (disabled || items.length < 2 || drag.current || (event.button != null && event.button !== 0)) return;
    const node = nodes.current.get(id);
    event.preventDefault();
    event.currentTarget.focus();
    listRef.current.setPointerCapture?.(event.pointerId);
    cancelAnimationFrame(frames.current.get(id));
    drag.current = { id, pointerId: event.pointerId, y: event.clientY, originY: event.clientY,
      top: node.offsetTop, original: [...ids], order: [...ids] };
    node.style.transition = 'none';
    node.style.transform = '';
    setDragging(id);
  }

  function move(event) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    active.y = event.clientY;
    const node = nodes.current.get(active.id);
    node.style.transform = `translateY(${active.y - active.originY}px)`;
    const center = node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2;
    const order = [...active.order];
    let index = order.indexOf(active.id);
    const direction = active.y - active.originY >= 0 ? 1 : -1;
    while (order[index + direction] !== undefined) {
      const neighbor = nodes.current.get(order[index + direction]).getBoundingClientRect();
      if (direction > 0 ? center <= neighbor.top + neighbor.height / 2 : center >= neighbor.top + neighbor.height / 2) break;
      [order[index], order[index + direction]] = [order[index + direction], order[index]];
      index += direction;
    }
    if (order.some((id, i) => id !== active.order[i])) {
      rememberPositions();
      active.order = order;
      setIds(order);
    }
  }

  function finish(event, cancelled = false) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    rememberPositions();
    drag.current = null;
    setDragging(null);
    listRef.current?.releasePointerCapture?.(event.pointerId);
    if (cancelled) {
      setIds(active.original);
      return;
    }
    if (active.order.some((id, index) => id !== active.original[index])) {
      onReorder(active.order);
    }
  }

  function keyboardMove(event, id) {
    if (disabled || drag.current || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const index = ids.indexOf(id);
    const target = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (target < 0 || target >= ids.length) return;
    const order = [...ids];
    [order[index], order[target]] = [order[target], order[index]];
    rememberPositions();
    setIds(order);
    onReorder(order);
  }

  return <div className="managed-lecture-list" ref={listRef}
    onPointerMove={move} onPointerUp={finish}
    onPointerCancel={event => finish(event, true)}
    onLostPointerCapture={event => finish(event, true)}>
    {ids.filter(id => itemMap.has(id)).map((id, index) => {
      const item = itemMap.get(id);
      const handle = <button type="button" className="lecture-drag-handle"
        aria-label={`拖曳排序 ${item.title}`} title="拖曳調整順序，也可使用上下方向鍵"
        disabled={disabled || items.length < 2}
        onPointerDown={event => start(event, id)}
        onKeyDown={event => keyboardMove(event, id)}>
        <span aria-hidden="true">⠿</span>
      </button>;
      return <div key={id} ref={node => { if (node) nodes.current.set(id, node); else nodes.current.delete(id); }}
        className={`lecture-reorder-item${dragging === id ? ' is-dragging' : ''}`}>
        {children(item, index, handle)}
      </div>;
    })}
  </div>;
}
