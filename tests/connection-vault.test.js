import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberConnection, unlockConnection, hasConnection, forgetConnection } from '../js/connection-vault.js';

test('PIN保存、错误PIN和损坏密文不泄露长令牌；忘记连接不删除计时', async () => {
  const memory = new Map([['time-map-v2-data','synthetic ongoing timer']]);
  globalThis.localStorage = {getItem:k=>memory.get(k)??null, setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
  const connection = {base:'https://example.invalid',token:'synthetic-long-device-token'};
  await assert.rejects(rememberConnection('abc',connection));
  await rememberConnection('5505',connection);
  assert.equal(hasConnection(),true);
  const envelope = memory.get('time-map-connection-v1');
  assert.ok(!envelope.includes(connection.token) && !envelope.includes(connection.base));
  assert.deepEqual(await unlockConnection('5505'),connection);
  await assert.rejects(unlockConnection('1234'), /PIN不正确/);
  assert.equal(memory.get('time-map-connection-v1'),envelope);
  memory.set('time-map-connection-v1',envelope.replace('ciphertext','corrupted'));
  await assert.rejects(unlockConnection('5505'), /PIN不正确/);
  forgetConnection();
  assert.equal(hasConnection(),false);
  assert.equal(memory.get('time-map-v2-data'),'synthetic ongoing timer');
});
