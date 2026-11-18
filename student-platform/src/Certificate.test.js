import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toPng } from 'html-to-image';
import Certificate from './Certificate';

jest.mock('html-to-image', () => ({ toPng: jest.fn() }));

test('downloads a PNG from the certificate element shown on the page', async () => {
  const originalFetch = global.fetch;
  let filename;
  const download = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    filename = this.download;
  });
  localStorage.setItem('access_token', 'certificate-test-token');
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      student_name: '測試同學',
      course_name: '資料結構',
      earned_at: '2026-11-18T00:00:00Z',
      credits_awarded: 2,
      certificate_code: 'TEST-01',
    }),
  });
  toPng.mockResolvedValue('data:image/png;base64,test');

  try {
    render(
      <MemoryRouter initialEntries={['/certificate/1']}>
        <Routes><Route path="/certificate/:courseId" element={<Certificate />} /></Routes>
      </MemoryRouter>
    );

    const name = await screen.findByRole('heading', { name: '測試同學' });
    const sheet = name.closest('section');
    fireEvent.click(screen.getByRole('button', { name: '下載認證圖片' }));

    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(toPng).toHaveBeenCalledWith(sheet, { pixelRatio: 2 });
    expect(filename).toBe('資料結構_測試同學_certificate.png');
  } finally {
    global.fetch = originalFetch;
    localStorage.removeItem('access_token');
    download.mockRestore();
  }
});
