/**
 * @license
 * Cesium - https://github.com/CesiumGS/cesium
 * Version 1.139.1
 *
 * Copyright 2011-2022 Cesium Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Columbus View (Pat. Pend.)
 *
 * Portions licensed separately.
 * See https://github.com/CesiumGS/cesium/blob/main/LICENSE.md for full licensing details.
 */
import{a as K}from"./chunk-CMB3O7X2.js";import{a as G}from"./chunk-CAEAJPBH.js";import{a as S}from"./chunk-74XTGJKF.js";import{c as B,j as R}from"./chunk-V6RJRUKY.js";import"./chunk-R6PWD5CA.js";import"./chunk-BDF6MEVU.js";import"./chunk-XB2TPQAQ.js";import"./chunk-OEIACSKL.js";import{a as _,c as L}from"./chunk-F2ZMVLJV.js";import{a as t}from"./chunk-VGILZD7B.js";import{a as F}from"./chunk-RXYBLNW3.js";import"./chunk-TXOEXY5C.js";import"./chunk-VIMSDF2W.js";var O=32767,ct=new _,rt=new t;function it(e,r,a,n,u){let o=e.length/3,s=e.subarray(0,o),f=e.subarray(o,2*o),i=e.subarray(2*o,3*o);G.zigZagDeltaDecode(s,f,i);let c=new Float64Array(e.length);for(let e=0;e<o;++e){let o=s[e],p=f[e],l=i[e],d=F.lerp(r.west,r.east,o/O),k=F.lerp(r.south,r.north,p/O),h=F.lerp(a,n,l/O),m=_.fromRadians(d,k,h,ct),b=u.cartographicToCartesian(m,rt);t.pack(b,c,3*e)}return c}var Y=it,X=new R,$=new L,j=new t,H={min:void 0,max:void 0};function at(e){e=new Float64Array(e);let r=0;H.min=e[r++],H.max=e[r++],R.unpack(e,r,X),r+=R.packedLength,L.unpack(e,r,$),r+=L.packedLength,t.unpack(e,r,j)}function ft(t){let e=t.length,r=new Uint32Array(e+1),a=0;for(let n=0;n<e;++n)r[n]=a,a+=t[n];return r[e]=a,r}var Z=new t,q=new t,J=new t,dt=new t,Q=new t;function ut(e,r){let a=new Uint16Array(e.positions),n=new Uint16Array(e.widths),u=new Uint32Array(e.counts),o=new Uint16Array(e.batchIds);at(e.packedBuffer);let s,f=X,i=$,c=j,p=H.min,l=H.max,d=Y(a,f,p,l,i),k=d.length/3,h=4*k-4,m=new Float32Array(3*h),b=new Float32Array(3*h),w=new Float32Array(3*h),A=new Float32Array(2*h),y=new Uint16Array(h),F=0,E=0,L=0,R=0,g=u.length;for(s=0;s<g;++s){let e=u[s],r=n[s],a=o[s];for(let n=0;n<e;++n){let u;if(0===n){let e=t.unpack(d,3*R,Z),r=t.unpack(d,3*(R+1),q);u=t.subtract(e,r,J),t.add(e,u,u)}else u=t.unpack(d,3*(R+n-1),J);let o,s=t.unpack(d,3*(R+n),dt);if(n===e-1){let r=t.unpack(d,3*(R+e-1),Z),a=t.unpack(d,3*(R+e-2),q);o=t.subtract(r,a,Q),t.add(r,o,o)}else o=t.unpack(d,3*(R+n+1),Q);t.subtract(u,c,u),t.subtract(s,c,s),t.subtract(o,c,o);let f=n===e-1?2:4;for(let e=0===n?2:0;e<f;++e){t.pack(s,m,F),t.pack(u,b,F),t.pack(o,w,F),F+=3;let n=e-2<0?-1:1;A[E++]=e%2*2-1,A[E++]=n*r,y[L++]=a}}R+=e}let D=S.createTypedArray(h,6*k-6),I=0,P=0;for(g=k-1,s=0;s<g;++s)D[P++]=I,D[P++]=I+2,D[P++]=I+1,D[P++]=I+1,D[P++]=I+2,D[P++]=I+3,I+=4;r.push(m.buffer,b.buffer,w.buffer),r.push(A.buffer,y.buffer,D.buffer);let U={indexDatatype:2===D.BYTES_PER_ELEMENT?S.UNSIGNED_SHORT:S.UNSIGNED_INT,currentPositions:m.buffer,previousPositions:b.buffer,nextPositions:w.buffer,expandAndWidth:A.buffer,batchIds:y.buffer,indices:D.buffer};if(e.keepDecodedPositions){let t=ft(u);r.push(d.buffer,t.buffer),U=B(U,{decodedPositions:d.buffer,decodedPositionOffsets:t.buffer})}return U}var It=K(ut);export{It as default};