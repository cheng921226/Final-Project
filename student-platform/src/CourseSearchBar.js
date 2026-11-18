export default function CourseSearchBar({ value, onChange, onSearch, placeholder, disabled }) {
  function submitSearch(event) {
    event.preventDefault();
    onSearch(value.trim().toLocaleLowerCase('zh-TW'));
  }

  return (
    <form className="search-panel" onSubmit={submitSearch}>
      <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label="搜尋課程"
        disabled={disabled}
      />
      <button type="submit" disabled={disabled}>搜尋</button>
    </form>
  );
}
