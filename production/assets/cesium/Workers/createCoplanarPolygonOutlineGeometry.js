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
import{a as T}from"./chunk-MOHWP7VV.js";import"./chunk-P5EFSOUF.js";import{a as l}from"./chunk-IEITL4VO.js";import"./chunk-AJH5KBOO.js";import{a as G}from"./chunk-XRJOFXJF.js";import{a as C}from"./chunk-QNPYEODC.js";import"./chunk-G72JFEXW.js";import"./chunk-6W2XFGWI.js";import"./chunk-BDWA46XV.js";import"./chunk-5VFNV3LW.js";import"./chunk-TCOMWBL2.js";import{a as L}from"./chunk-G2QPRBZU.js";import"./chunk-37ETYCYM.js";import"./chunk-SRA5MBUT.js";import"./chunk-5AAMOBJK.js";import{a as w}from"./chunk-4WQ4VT5S.js";import{a as O}from"./chunk-6EINM7EY.js";import{b,c as d,d as k}from"./chunk-A4I25VN7.js";import{c as P}from"./chunk-D3TVNJ6W.js";import"./chunk-3VUCSHGU.js";import"./chunk-LNJEJFV5.js";import"./chunk-BPABSUDY.js";import{a as H}from"./chunk-ATKJRN2G.js";import"./chunk-RDX4QSUS.js";import"./chunk-G3GDHHWO.js";import{c as g}from"./chunk-2AIOP76V.js";import{a as y,c as u}from"./chunk-IAE6APK2.js";import"./chunk-3E7FIXV7.js";import{b as m}from"./chunk-NZBME2JK.js";import{f}from"./chunk-6DLS2UKD.js";function E(r){let t=r.length,o=new Float64Array(3*t),e=w.createTypedArray(t,2*t),n=0,i=0;for(let s=0;s<t;s++){let c=r[s];o[n++]=c.x,o[n++]=c.y,o[n++]=c.z,e[i++]=s,e[i++]=(s+1)%t}let s=new O({position:new k({componentDatatype:H.DOUBLE,componentsPerAttribute:3,values:o})});return new d({attributes:s,indices:e,primitiveType:b.LINES})}function c(r){let t=(r=r??u.EMPTY_OBJECT).polygonHierarchy;m.defined("options.polygonHierarchy",t),this._polygonHierarchy=t,this._workerName="createCoplanarPolygonOutlineGeometry",this.packedLength=l.computeHierarchyPackedLength(t,y)+1}c.fromPositions=function(r){return r=r??u.EMPTY_OBJECT,m.defined("options.positions",r.positions),new c({polygonHierarchy:{positions:r.positions}})},c.pack=function(r,t,o){return m.typeOf.object("value",r),m.defined("array",t),o=o??0,t[o=l.packPolygonHierarchy(r._polygonHierarchy,t,o,y)]=r.packedLength,t};var v={polygonHierarchy:{}};c.unpack=function(r,t,o){m.defined("array",r),t=t??0;let e=l.unpackPolygonHierarchy(r,t,y);t=e.startingIndex,delete e.startingIndex;let n=r[t];return f(o)||(o=new c(v)),o._polygonHierarchy=e,o.packedLength=n,o},c.createGeometry=function(r){let t=r._polygonHierarchy,o=t.positions;if(o=L(o,y.equalsEpsilon,!0),o.length<3||!T.validOutline(o))return;let e=l.polygonOutlinesFromHierarchy(t,!1);if(0===e.length)return;let n=[];for(let r=0;r<e.length;r++){let t=new G({geometry:E(e[r])});n.push(t)}let i=C.combineInstances(n)[0],s=P.fromPoints(t.positions);return new d({attributes:i.attributes,indices:i.indices,primitiveType:i.primitiveType,boundingSphere:s})};var h=c;function A(r,t){return f(t)&&(r=h.unpack(r,t)),r._ellipsoid=g.clone(r._ellipsoid),h.createGeometry(r)}var Z=A;export{Z as default};