import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('markmap-lib', () => ({
  Transformer: jest.fn(),
}));

jest.mock('markmap-view', () => ({
  Markmap: { create: jest.fn() },
}));

test('renders the learning platform home navigation', () => {
  render(<App />);
  expect(screen.getByText('AI輔助線上學習平台')).toBeInTheDocument();
  expect(screen.getByText('登入')).toBeInTheDocument();
});
