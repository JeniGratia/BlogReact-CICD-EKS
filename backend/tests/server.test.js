const request = require('supertest');

jest.mock('../src/config/db', () => ({
  checkDbConnection: jest.fn(),
  pool: {
    query: jest.fn(),
  },
}));

const { checkDbConnection } = require('../src/config/db');
const app = require('../src/server');

describe('Blog API health endpoints', () => {
  test('GET /healthz returns HTTP 200', async () => {
    const response = await request(app).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  test('GET /readyz returns ready when database is reachable', async () => {
    checkDbConnection.mockResolvedValueOnce(true);

    const response = await request(app).get('/readyz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
  });

  test('GET /readyz returns HTTP 503 when database is unavailable', async () => {
    checkDbConnection.mockRejectedValueOnce(new Error('Database unavailable'));

    const response = await request(app).get('/readyz');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not-ready');
  });

  test('unknown routes return HTTP 404', async () => {
    const response = await request(app).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Route not found' });
  });
});
