import { randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';

export const TOPICS = Object.freeze(['General enquiry','Research collaboration','Data partnership','Technical issue','Media request']);
export const MAX_AGE_MS = 5 * 60 * 1000;
export const MIN_AGE_MS = 1800;

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}
function signatureEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}
export function createChallenge(secret, issued = Date.now()) {
  if (String(secret).length < 32) throw new Error('CAPTCHA_SECRET must be at least 32 characters');
  const a = 2 + randomBytes(1)[0] % 14;
  const b = 2 + randomBytes(1)[0] % 14;
  const nonce = randomBytes(20).toString('base64url');
  const encoded = Buffer.from(JSON.stringify({a,b,issued,nonce})).toString('base64url');
  return { question:`${a} + ${b} = ?`, token:encoded+'.'+sign(encoded,secret) };
}
export function checkChallenge(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[\w-]+$/.test(parts[0]) || !/^[\w-]+$/.test(parts[1])) return null;
  if (!signatureEqual(parts[1],sign(parts[0],secret))) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    if (!Number.isInteger(data.a) || !Number.isInteger(data.b) || !Number.isInteger(data.issued)) return null;
    if (data.a < 2 || data.a > 15 || data.b < 2 || data.b > 15) return null;
    if (typeof data.nonce !== 'string' || !/^[\w-]{20,40}$/.test(data.nonce)) return null;
    const age = now - data.issued;
    if (age < MIN_AGE_MS || age > MAX_AGE_MS) return null;
    return { expected:data.a+data.b, nonceKey:createHash('sha256').update(data.nonce).digest('hex'), expires:Math.ceil((data.issued+MAX_AGE_MS+60000)/1000) };
  } catch { return null; }
}
export function normalizeContact(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {error:'Enter the contact details.'};
  const strip = (key, max) => {
    if (typeof raw[key] !== 'string') return null;
    const value = raw[key].replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').trim();
    if (value.length > max) return null;
    return value;
  };
  const name=strip('name',100), email=strip('email',254), organization=strip('organization',120);
  const message=strip('message',5000), topic=strip('topic',40);
  if (name === null || email === null || organization === null || message === null || topic === null) return {error:'One or more fields are too long.'};
  if (typeof raw.website !== 'string' || raw.website.trim()) return {error:'Invalid submission.'};
  if (name.length < 2 || name.includes('\n') || name.includes('\r')) return {error:'Enter a name of at least two characters.'};
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || email.includes('\n') || email.includes('\r')) return {error:'Enter a valid email address.'};
  if (!TOPICS.includes(topic)) return {error:'Choose an enquiry type.'};
  if (message.length < 15) return {error:'Please add more detail to your message.'};
  if (typeof raw.answer !== 'string' || !/^\d{1,3}$/.test(raw.answer.trim())) return {error:'Enter the numeric answer to the security question.'};
  if (typeof raw.token !== 'string' || !raw.token) return {error:'Refresh the security question and try again.'};
  return {value:{name,email,organization,topic,message,answer:Number(raw.answer.trim()),token:raw.token}};
}
export function makeEmailText(form) {
  return `New StratOps website enquiry\n\nType: ${form.topic}\nName: ${form.name}\nEmail: ${form.email}\nOrganization: ${form.organization || '(not provided)'}\n\nMessage:\n${form.message}\n\nSubmitted through https://stratops.space/contact/`;
}
