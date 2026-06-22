const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET ||= 'x'.repeat(64);

const { MarketplaceService } = require('../dist/modules/marketplace/marketplace.service.js');

const TX_HASH = `0x${'a'.repeat(64)}`;

function createOrderRepo(overrides = {}) {
  const order = {
    orderId: 'order-1',
    playerId: '0xowner',
    status: 'pending',
  };

  return {
    async completePending(orderId, playerId, txHash) {
      if (order.orderId !== orderId || order.playerId !== playerId || order.status !== 'pending') {
        return null;
      }
      order.status = 'completed';
      order.txHash = txHash;
      return { ...order };
    },
    async findByOrderId(orderId) {
      return order.orderId === orderId ? { ...order } : null;
    },
    async findByPlayer() { return []; },
    ...overrides,
  };
}

function createService(orderRepo = createOrderRepo()) {
  return new MarketplaceService({}, orderRepo);
}

test('only one concurrent completion can claim a pending order', async () => {
  const service = createService();
  const results = await Promise.allSettled(
    Array.from({ length: 25 }, () => service.completeOrder('0xowner', 'order-1', TX_HASH)),
  );

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 24);
  for (const result of results.filter((result) => result.status === 'rejected')) {
    assert.equal(result.reason.statusCode, 409);
  }
});

test('completion is bound to the authenticated order owner', async () => {
  const service = createService();
  await assert.rejects(
    service.completeOrder('0xattacker', 'order-1', TX_HASH),
    (error) => error.statusCode === 403,
  );
});

test('completion rejects malformed transaction hashes', async () => {
  const service = createService();
  await assert.rejects(
    service.completeOrder('0xowner', 'order-1', 'not-a-transaction'),
    (error) => error.statusCode === 400,
  );
});
