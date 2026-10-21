import { fireEvent, render, screen } from '@testing-library/react';
import SearchableCourseSelect from './SearchableCourseSelect';

test('filters courses by title and selects a matching result', () => {
  const onChange = jest.fn();
  render(
    <SearchableCourseSelect
      courses={[
        { id: 1, title: '資料結構' },
        { id: 2, title: '演算法' },
      ]}
      value="1"
      onChange={onChange}
    />
  );

  const input = screen.getByRole('combobox', { name: '課程' });
  expect(input).toHaveValue('資料結構');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '演算' } });
  expect(screen.queryByRole('option', { name: '資料結構' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('option', { name: '演算法' }));
  expect(onChange).toHaveBeenCalledWith('2');
  expect(input).toHaveValue('演算法');
});
