/**
 * @jest-environment node
 *
 * Tests run in Node because the route uses Node APIs (Response, JSON).
 * No DB needed — getSettings and upsertSettings are mocked at module level.
 */

// ---------------------------------------------------------------------------
// Module mocks — declared before imports so jest hoists them
// ---------------------------------------------------------------------------

jest.mock('../../../../lib/server/db', () => ({
  getSettings: jest.fn(() => ({ name: '', personalizationPrompt: '' })),
  upsertSettings: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { getSettings, upsertSettings } from '../../../../lib/server/db';
import { GET, POST } from '../route';

const mockGetSettings = getSettings as jest.MockedFunction<typeof getSettings>;
const mockUpsertSettings = upsertSettings as jest.MockedFunction<typeof upsertSettings>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonRequest(method: 'GET' | 'POST', body?: unknown): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new Request('http://localhost/api/settings', init);
}

// ---------------------------------------------------------------------------
// Suite 1: GET /api/settings
// ---------------------------------------------------------------------------

describe('GET /api/settings', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns current settings as JSON', async () => {
    mockGetSettings.mockReturnValueOnce({ name: 'Alice', personalizationPrompt: 'Be concise' });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ name: 'Alice', personalizationPrompt: 'Be concise' });
  });

  it('returns empty strings when no settings are configured', async () => {
    // Default mock already returns empty strings
    const response = await GET();
    const body = await response.json();

    expect(body).toEqual({ name: '', personalizationPrompt: '' });
  });
});

// ---------------------------------------------------------------------------
// Suite 2: POST /api/settings — happy path
// ---------------------------------------------------------------------------

describe('POST /api/settings — happy path', () => {
  afterEach(() => jest.clearAllMocks());

  it('saves valid settings and returns them', async () => {
    const request = jsonRequest('POST', { name: 'Bob', personalizationPrompt: 'Be helpful' });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockUpsertSettings).toHaveBeenCalledWith({
      name: 'Bob',
      personalizationPrompt: 'Be helpful',
    });
    expect(body).toEqual({ name: 'Bob', personalizationPrompt: 'Be helpful' });
  });

  it('trims whitespace from name', async () => {
    const request = jsonRequest('POST', { name: '  Alice  ', personalizationPrompt: 'prompt' });

    await POST(request);

    expect(mockUpsertSettings).toHaveBeenCalledWith({
      name: 'Alice',
      personalizationPrompt: 'prompt',
    });
  });

  it('allows empty strings (clearing settings)', async () => {
    const request = jsonRequest('POST', { name: '', personalizationPrompt: '' });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockUpsertSettings).toHaveBeenCalledWith({ name: '', personalizationPrompt: '' });
  });
});

// ---------------------------------------------------------------------------
// Suite 3: POST /api/settings — validation errors
// ---------------------------------------------------------------------------

describe('POST /api/settings — validation', () => {
  afterEach(() => jest.clearAllMocks());

  it('rejects non-object body', async () => {
    const request = jsonRequest('POST', 'not-an-object');

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(mockUpsertSettings).not.toHaveBeenCalled();
  });

  it('rejects missing name field', async () => {
    const request = jsonRequest('POST', { personalizationPrompt: 'prompt' });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(mockUpsertSettings).not.toHaveBeenCalled();
  });

  it('rejects missing personalizationPrompt field', async () => {
    const request = jsonRequest('POST', { name: 'Alice' });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(mockUpsertSettings).not.toHaveBeenCalled();
  });

  it('rejects non-string name', async () => {
    const request = jsonRequest('POST', { name: 123, personalizationPrompt: '' });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(mockUpsertSettings).not.toHaveBeenCalled();
  });

  it('rejects non-string personalizationPrompt', async () => {
    const request = jsonRequest('POST', { name: '', personalizationPrompt: true });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(mockUpsertSettings).not.toHaveBeenCalled();
  });
});
