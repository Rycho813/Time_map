// Local convenience lock only. The PIN is never sent to the API or saved in plaintext.
const KEY = 'time-map-connection-v1';
const AAD = new TextEncoder().encode('time-map-connection-v1');
const ITERATIONS = 210000;
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const base64 = value => btoa(String.fromCharCode(...new Uint8Array(value)));
export const hasConnection = () => localStorage.getItem(KEY) !== null;
export const forgetConnection = () => localStorage.removeItem(KEY);
function check(pin) {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('请输入4至8位数字PIN。');
  if (!globalThis.crypto?.subtle) throw new Error('此浏览器需要HTTPS才能保存PIN连接。');
}
async function key(pin, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'}, material, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
}
export async function rememberConnection(pin, connection) {
  check(pin);
  if (!connection.base || !connection.token) throw new Error('先填写API地址和设备凭据。');
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:AAD}, await key(pin,salt), new TextEncoder().encode(JSON.stringify(connection)));
  localStorage.setItem(KEY, JSON.stringify({version:1,salt:base64(salt),iv:base64(iv),ciphertext:base64(ciphertext)}));
}
export async function unlockConnection(pin) {
  check(pin);
  try {
    const envelope = JSON.parse(localStorage.getItem(KEY));
    if (envelope.version !== 1) throw new Error();
    const plaintext = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv),additionalData:AAD}, await key(pin,bytes(envelope.salt)), bytes(envelope.ciphertext));
    const result = JSON.parse(new TextDecoder().decode(plaintext));
    if (typeof result.base !== 'string' || typeof result.token !== 'string' || !result.base || !result.token) throw new Error();
    return result;
  } catch { throw new Error('PIN不正确或本机连接已损坏；原始计时数据未改变。'); }
}
