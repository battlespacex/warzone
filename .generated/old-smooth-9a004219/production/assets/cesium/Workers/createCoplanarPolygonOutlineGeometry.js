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
import{a as T}from"./chunk-HIUJYQZS.js";import"./chunk-GVYQ2MV7.js";import{a as l}from"./chunk-XTSHH6EW.js";import"./chunk-W6IDXQXA.js";import{a as G}from"./chunk-WT7GGKRT.js";import{a as C}from"./chunk-EUZUEBB2.js";import"./chunk-CAEAJPBH.js";import"./chunk-WAWDCDZ5.js";import"./chunk-HZDH6VFE.js";import"./chunk-HJG35BQ3.js";import"./chunk-SROZO5QJ.js";import{a as L}from"./chunk-QWRZXNH3.js";import"./chunk-B4VO3QSH.js";import"./chunk-5U3HZZCI.js";import"./chunk-QITOM3FA.js";import{a as w}from"./chunk-74XTGJKF.js";import{a as O}from"./chunk-EJPD5BNO.js";import{b,c as d,d as k}from"./chunk-AD7XFG6M.js";import{c as P}from"./chunk-WQ5ZC6ME.js";import"./chunk-XVAXSA53.js";import"./chunk-V6RJRUKY.js";import"./chunk-R6PWD5CA.js";import{a as H}from"./chunk-BDF6MEVU.js";import"./chunk-XB2TPQAQ.js";import"./chunk-OEIACSKL.js";import{c as g}from"./chunk-F2ZMVLJV.js";import{a as y,c as u}from"./chunk-VGILZD7B.js";import"./chunk-RXYBLNW3.js";import{b as m}from"./chunk-TXOEXY5C.js";import{e as f}from"./chunk-VIMSDF2W.js";function E(r){let t=r.length,e=new Float64Array(3*t),o=w.createTypedArray(t,2*t),n=0,i=0;for(let s=0;s<t;s++){let c=r[s];e[n++]=c.x,e[n++]=c.y,e[n++]=c.z,o[i++]=s,o[i++]=(s+1)%t}let s=new O({position:new k({componentDatatype:H.DOUBLE,componentsPerAttribute:3,values:e})});return new d({attributes:s,indices:o,primitiveType:b.LINES})}function c(r){let t=(r=r??u.EMPTY_OBJECT).polygonHierarchy;m.defined("options.polygonHierarchy",t),this._polygonHierarchy=t,this._workerName="createCoplanarPolygonOutlineGeometry",this.packedLength=l.computeHierarchyPackedLength(t,y)+1}c.fromPositions=function(r){return r=r??u.EMPTY_OBJECT,m.defined("options.positions",r.positions),new c({polygonHierarchy:{positions:r.positions}})},c.pack=function(r,t,e){return m.typeOf.object("value",r),m.defined("array",t),e=e??0,t[e=l.packPolygonHierarchy(r._polygonHierarchy,t,e,y)]=r.packedLength,t};var v={polygonHierarchy:{}};c.unpack=function(r,t,e){m.defined("array",r),t=t??0;let o=l.unpackPolygonHierarchy(r,t,y);t=o.startingIndex,delete o.startingIndex;let n=r[t];return f(e)||(e=new c(v)),e._polygonHierarchy=o,e.packedLength=n,e},c.createGeometry=function(r){let t=r._polygonHierarchy,e=t.positions;if(e=L(e,y.equalsEpsilon,!0),e.length<3||!T.validOutline(e))return;let o=l.polygonOutlinesFromHierarchy(t,!1);if(0===o.length)return;let n=[];for(let r=0;r<o.length;r++){let t=new G({geometry:E(o[r])});n.push(t)}let i=C.combineInstances(n)[0],s=P.fromPoints(t.positions);return new d({attributes:i.attributes,indices:i.indices,primitiveType:i.primitiveType,boundingSphere:s})};var h=c;function A(r,t){return f(t)&&(r=h.unpack(r,t)),r._ellipsoid=g.clone(r._ellipsoid),h.createGeometry(r)}var Z=A;export{Z as default};