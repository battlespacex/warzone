/**
 * @license
 * Cesium - https://github.com/CesiumGS/cesium
 * Version 1.143.0
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
import{a as x}from"./chunk-BKIYVF74.js";import{a as w}from"./chunk-G72JFEXW.js";import{j as c}from"./chunk-LNJEJFV5.js";import"./chunk-BPABSUDY.js";import"./chunk-ATKJRN2G.js";import"./chunk-RDX4QSUS.js";import"./chunk-G3GDHHWO.js";import{a as l,c as p}from"./chunk-2AIOP76V.js";import{a as h}from"./chunk-IAE6APK2.js";import{a as i}from"./chunk-3E7FIXV7.js";import"./chunk-NZBME2JK.js";import"./chunk-6DLS2UKD.js";var u=32767,F=new l,L=new h,b=new c,y=new p,a={min:void 0,max:void 0};function V(r){r=new Float64Array(r);let n=0;a.min=r[n++],a.max=r[n++],c.unpack(r,n,b),n+=c.packedLength,p.unpack(r,n,y)}function z(r,n){let t=new Uint16Array(r.positions);V(r.packedBuffer);let o=b,e=y,s=a.min,p=a.max,c=t.length/3,m=t.subarray(0,c),f=t.subarray(c,2*c),k=t.subarray(2*c,3*c);w.zigZagDeltaDecode(m,f,k);let j=new Float64Array(t.length);for(let a=0;a<c;++a){let r=m[a],n=f[a],t=k[a],c=i.lerp(o.west,o.east,r/u),w=i.lerp(o.south,o.north,n/u),y=i.lerp(s,p,t/u),b=l.fromRadians(c,w,y,F),A=e.cartographicToCartesian(b,L);h.pack(A,j,3*a)}return n.push(j.buffer),{positions:j.buffer}}var G=x(z);export{G as default};