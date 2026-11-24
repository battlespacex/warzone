import test from 'node:test';
import assert from 'node:assert/strict';
import { stratopsRouter } from '../src/routes.stratops.js';

test('report generation denies anonymous requests before accessing providers or databases', async () => {
    const route = stratopsRouter().stack.find(layer => layer.route?.path === '/reports/generate').route;
    const handler = route.stack.at(-1).handle;
    let status, body;
    await handler({ get: () => '' }, {
        status(value) { status = value; return this; },
        json(value) { body = value; },
    });
    assert.equal(status, 403);
    assert.match(body.error, /operator authorization/);
});
