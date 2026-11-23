import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChallenge, checkChallenge, normalizeContact, makeEmailText, MIN_AGE_MS, MAX_AGE_MS } from '../aws/contact-lambda/lib.mjs';
const secret='a'.repeat(64);
const valid={name:'Contact Person', email:'contact@example.com',organization:'Example Org',topic:'Research collaboration',message:'Can we discuss an OSINT research collaboration?',website:'',token:'signed-token',answer:'12'};

test('challenge signature is valid after minimum time and before expiry',()=>{
 const issued=100000;
 const made=createChallenge(secret,issued);
 assert.match(made.question,/\d+ \+ \d+ = \?/);
 assert.equal(checkChallenge(made.token,secret,issued+MIN_AGE_MS-1),null);
 const checked=checkChallenge(made.token,secret,issued+MIN_AGE_MS);
 assert.ok(checked && checked.nonceKey && Number.isInteger(checked.expected));
 assert.equal(checkChallenge(made.token,secret,issued+MAX_AGE_MS+1),null);
});
test('tampered and malformed signed challenges fail',()=>{
 const made=createChallenge(secret,500000);
 assert.equal(checkChallenge(made.token+'x',secret,504000),null);
 assert.equal(checkChallenge(made.token.replace(/.$/,'a'),secret,504000),null);
 assert.equal(checkChallenge('malformed',secret,504000),null);
 assert.equal(checkChallenge(made.token,'wrongsecret'.repeat(6),504000),null);
});
test('contact validation checks topic, email and honeypot',()=>{
 assert.equal(normalizeContact(valid).value.email,'contact@example.com');
 assert.ok(normalizeContact({...valid,email:'someone@invalid'}).error);
 assert.ok(normalizeContact({...valid,topic:'Unapproved'}).error);
 assert.ok(normalizeContact({...valid,website:'https://bot'}).error);
 assert.ok(normalizeContact({...valid,message:'short'}).error);
 assert.ok(normalizeContact({...valid,answer:'2+2'}).error);
});
test('email content uses fixed subject information and plain text body',()=>{
 const form=normalizeContact(valid).value;
 const message=makeEmailText(form);
 assert.match(message,/Research collaboration/);
 assert.match(message,/contact@example.com/);
});
