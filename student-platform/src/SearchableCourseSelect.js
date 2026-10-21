import React, { useEffect, useId, useMemo, useState } from 'react';

function courseTitle(course) {
  return course?.title || course?.course_name || `課程 ${course?.id}`;
}

export default function SearchableCourseSelect({
  courses = [],
  value = '',
  onChange,
  label = '課程',
  optionLabel = courseTitle,
  placeholder = '輸入課程名稱',
  className = '',
}) {
  const inputId = useId();
  const listId = `${inputId}-results`;
  const selectedCourse = courses.find(course => String(course.id) === String(value));
  const selectedTitle = selectedCourse ? courseTitle(selectedCourse) : '';
  const [query, setQuery] = useState(selectedTitle);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setQuery(selectedTitle);
  }, [selectedTitle]);

  const options = useMemo(() => {
    const keyword = query === selectedTitle
      ? ''
      : query.trim().toLocaleLowerCase('zh-TW');
    return courses.filter(course => (
      !keyword || courseTitle(course).toLocaleLowerCase('zh-TW').includes(keyword)
    ));
  }, [courses, query, selectedTitle]);

  function selectCourse(course) {
    const accepted = onChange?.(String(course.id));
    if (accepted === false) {
      setQuery(selectedTitle);
    } else {
      setQuery(courseTitle(course));
    }
    setOpen(false);
  }

  function handleKeyDown(event) {
    if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (event.key === 'Escape') {
      setQuery(selectedTitle);
      setOpen(false);
      return;
    }
    if (!options.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(current => (current + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(current => (current - 1 + options.length) % options.length);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      selectCourse(options[Math.min(activeIndex, options.length - 1)]);
    }
  }

  return (
    <div
      className={`searchable-course-select ${className}`.trim()}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setQuery(selectedTitle);
          setOpen(false);
        }
      }}
    >
      <label htmlFor={inputId}><span>{label}</span></label>
      <input
        id={inputId}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={event => {
          event.target.select();
          setActiveIndex(0);
          setOpen(true);
        }}
        onChange={event => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <div id={listId} className="course-search-results" role="listbox">
          {options.length ? options.map((course, index) => (
            <button
              type="button"
              role="option"
              aria-selected={String(course.id) === String(value)}
              className={index === activeIndex ? 'active' : ''}
              key={course.id}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectCourse(course)}
            >
              {optionLabel(course)}
            </button>
          )) : <p>找不到符合的課程</p>}
        </div>
      )}
    </div>
  );
}
