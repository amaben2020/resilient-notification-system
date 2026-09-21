import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class { send = sendMock; },
  GetParametersByPathCommand: class { constructor(input) { this.input = input; } },
}));

import { loadSecrets } from '../../src/config/secrets.js';

const saved = { ...process.env };
beforeEach(() => { sendMock.mockReset(); });
afterEach(() => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); });

describe('loadSecrets', () => {
  it('does nothing without SSM_PREFIX (local dev uses .env)', async () => {
    delete process.env.SSM_PREFIX;
    expect(await loadSecrets()).toEqual([]);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('maps /prefix/database-url -> DATABASE_URL, skips placeholders, follows pagination', async () => {
    process.env.SSM_PREFIX = '/notif-system/staging';
    delete process.env.DATABASE_URL;
    sendMock
      .mockResolvedValueOnce({ Parameters: [{ Name: '/notif-system/staging/database-url', Value: 'postgres://x' }], NextToken: 't1' })
      .mockResolvedValueOnce({ Parameters: [{ Name: '/notif-system/staging/grafana-cloud-api-key', Value: 'PLACEHOLDER' }] });

    const loaded = await loadSecrets();

    expect(loaded).toEqual(['DATABASE_URL']);
    expect(process.env.DATABASE_URL).toBe('postgres://x');
    expect(process.env.GRAFANA_CLOUD_API_KEY).toBeUndefined();
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0][0].input).toMatchObject({ Path: '/notif-system/staging', WithDecryption: true });
    expect(sendMock.mock.calls[1][0].input.NextToken).toBe('t1');
  });

  it('never overrides an explicitly set env var', async () => {
    process.env.SSM_PREFIX = '/notif-system/staging';
    process.env.DATABASE_URL = 'postgres://explicit';
    sendMock.mockResolvedValueOnce({ Parameters: [{ Name: '/notif-system/staging/database-url', Value: 'postgres://ssm' }] });
    await loadSecrets();
    expect(process.env.DATABASE_URL).toBe('postgres://explicit');
  });
});
