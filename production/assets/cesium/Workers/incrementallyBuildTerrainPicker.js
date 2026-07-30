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
import{a as y}from"./chunk-BKIYVF74.js";import{a as c}from"./chunk-5VFNV3LW.js";import"./chunk-3VUCSHGU.js";import{b as a}from"./chunk-BPABSUDY.js";import"./chunk-G3GDHHWO.js";import{a as n}from"./chunk-IAE6APK2.js";import"./chunk-3E7FIXV7.js";import"./chunk-NZBME2JK.js";import"./chunk-6DLS2UKD.js";var b=new n,d=new n,A=[new n,new n,new n],x=new c,f=new n(.5,.5,.5),p=new n(-.5,-.5,-.5);function h(r,t){let e=new Float64Array(r.aabbs),i=Array.from({length:4},(r,t)=>{let a=n.unpack(e,6*t,b),i=n.unpack(e,6*t+3,d);return c.fromCorners(a,i,new c)}),m=new Float64Array(r.inverseTransform),o=a.unpack(m,0,new a),u=new Uint32Array(r.triangleIndices),s=new Float64Array(r.trianglePositions),p=Array.from({length:4},()=>[]);for(let r=0;r<u.length;r++){n.unpack(s,9*r,A[0]),n.unpack(s,9*r+3,A[1]),n.unpack(s,9*r+6,A[2]);let t=k(o,A);for(let n=0;n<4;n++)i[n].intersectAxisAlignedBoundingBox(t)&&p[n].push(u[r])}return{intersectingTrianglesArrays:p.map(n=>{let r=new Uint32Array(n);return t.push(r.buffer),r.buffer})}}function k(r,t){a.multiplyByPoint(r,t[0],t[0]),a.multiplyByPoint(r,t[1],t[1]),a.multiplyByPoint(r,t[2],t[2]);let e=c.fromPoints(t,x);return n.clamp(e.minimum,p,f,e.minimum),n.clamp(e.maximum,p,f,e.maximum),e}var P=y(h);export{P as default};