/* StratOps public website contact API. Deployed independently from the operational app.
 * Requests are validated on the server, CAPTCHA tokens are signed and one-use,
 * and SES is the only path that returns a true successful submission.
 */
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { createChallenge, checkChallenge, normalizeContact, makeEmailText } from './lib.mjs';

const ses = new SESv2Client({});
const ddb = new DynamoDBClient({});
const origins = new Set(String(process.env.ALLOWED_ORIGINS || 'https://stratops.space,https://www.stratops.space,http://localhost:4174')
  .split(',').map(s=>s.trim()).filter(Boolean));
function response(event, status, payload) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  return {
    statusCode:status,
    headers:{
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store, max-age=0',
      'X-Content-Type-Options':'nosniff',
      ...(origins.has(origin) ? {'Access-Control-Allow-Origin':origin,'Vary':'Origin'} : {})
    },
    body:JSON.stringify(payload)
  };
}
export async function handler(event) {
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const route = String(event.rawPath || event.path || '/');
  if (!process.env.CAPTCHA_SECRET || process.env.CAPTCHA_SECRET.length < 32 ||
      !process.env.NONCE_TABLE || !process.env.FROM_EMAIL || !process.env.TO_EMAIL) {
    console.error('[stratops-contact] Missing server-side configuration');
    return response(event,503,{ok:false,message:'The contact service is not configured.'});
  }
  if (method === 'GET' && route === '/challenge') {
    const details = createChallenge(process.env.CAPTCHA_SECRET);
    return response(event,200,{ok:true,...details});
  }
  if (method !== 'POST' || route !== '/contact') return response(event,404,{ok:false,message:'Not found.'});
  let body;
  try {
    const decoded = event.isBase64Encoded ? Buffer.from(event.body||'','base64').toString('utf8') : String(event.body || '');
    if (Buffer.byteLength(decoded,'utf8') > 14_000) return response(event,413,{ok:false,message:'The message is too long.'});
    body = JSON.parse(decoded);
  } catch { return response(event,400,{ok:false,message:'Invalid form request.'}); }
  const validated = normalizeContact(body);
  if (validated.error) return response(event,400,{ok:false,message:validated.error});
  const form = validated.value;
  const challenge = checkChallenge(form.token,process.env.CAPTCHA_SECRET);
  if (!challenge) return response(event,400,{ok:false,message:'The security question expired or was not valid. Request a new question.'});
  // Reserve the signed token BEFORE checking the answer. Wrong guesses use up their nonce.
  try {
    await ddb.send(new PutItemCommand({
      TableName:process.env.NONCE_TABLE,
      Item:{ tokenId:{S:challenge.nonceKey}, expiry:{N:String(challenge.expires)} },
      ConditionExpression:'attribute_not_exists(tokenId)'
    }));
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') return response(event,409,{ok:false,message:'This question was already used. Request a new question.'});
    console.error('[stratops-contact] Challenge store unavailable:',error.name);
    return response(event,503,{ok:false,message:'Security verification is temporarily unavailable.'});
  }
  if (form.answer !== challenge.expected) return response(event,400,{ok:false,message:'Incorrect security answer. Request a new question.'});
  try {
    const result = await ses.send(new SendEmailCommand({
      FromEmailAddress:process.env.FROM_EMAIL,
      Destination:{ToAddresses:[process.env.TO_EMAIL]},
      ReplyToAddresses:[form.email],
      Content:{ Simple:{
        Subject:{Data:`StratOps website / ${form.topic}`,Charset:'UTF-8'},
        Body:{Text:{Data:makeEmailText(form),Charset:'UTF-8'}}
      }}
    }));
    if (!result?.MessageId) throw new Error('MissingMessageId');
    return response(event,200,{ok:true,message:'Your message was accepted for delivery.'});
  } catch (error) {
    console.error('[stratops-contact] SES send failed:',error.name);
    return response(event,503,{ok:false,message:'The message could not be sent. Please try again.'});
  }
}
