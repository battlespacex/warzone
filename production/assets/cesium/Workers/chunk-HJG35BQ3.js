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
import{a as d}from"./chunk-XVAXSA53.js";import{a as i}from"./chunk-VGILZD7B.js";import{b as a}from"./chunk-TXOEXY5C.js";import{e as c}from"./chunk-VIMSDF2W.js";function t(m,n,t){this.minimum=i.clone(m??i.ZERO),this.maximum=i.clone(n??i.ZERO),t=c(t)?i.clone(t):i.midpoint(this.minimum,this.maximum,new i),this.center=t}t.fromCorners=function(m,n,e){return a.defined("minimum",m),a.defined("maximum",n),c(e)||(e=new t),e.minimum=i.clone(m,e.minimum),e.maximum=i.clone(n,e.maximum),e.center=i.midpoint(m,n,e.center),e},t.fromPoints=function(m,n){if(c(n)||(n=new t),!c(m)||0===m.length)return n.minimum=i.clone(i.ZERO,n.minimum),n.maximum=i.clone(i.ZERO,n.maximum),n.center=i.clone(i.ZERO,n.center),n;let e=m[0].x,u=m[0].y,a=m[0].z,r=m[0].x,o=m[0].y,x=m[0].z,s=m.length;for(let i=1;i<s;i++){let n=m[i],t=n.x,c=n.y,s=n.z;e=Math.min(t,e),r=Math.max(t,r),u=Math.min(c,u),o=Math.max(c,o),a=Math.min(s,a),x=Math.max(s,x)}let l=n.minimum;l.x=e,l.y=u,l.z=a;let d=n.maximum;return d.x=r,d.y=o,d.z=x,n.center=i.midpoint(l,d,n.center),n},t.clone=function(m,n){if(c(m))return c(n)?(n.minimum=i.clone(m.minimum,n.minimum),n.maximum=i.clone(m.maximum,n.maximum),n.center=i.clone(m.center,n.center),n):new t(m.minimum,m.maximum,m.center)},t.equals=function(m,n){return m===n||c(m)&&c(n)&&i.equals(m.center,n.center)&&i.equals(m.minimum,n.minimum)&&i.equals(m.maximum,n.maximum)};var y=new i;t.intersectPlane=function(m,n){a.defined("box",m),a.defined("plane",n),y=i.subtract(m.maximum,m.minimum,y);let t=i.multiplyByScalar(y,.5,y),e=n.normal,u=t.x*Math.abs(e.x)+t.y*Math.abs(e.y)+t.z*Math.abs(e.z),r=i.dot(m.center,e)+n.distance;return r-u>0?d.INSIDE:r+u<0?d.OUTSIDE:d.INTERSECTING},t.intersectAxisAlignedBoundingBox=function(i,m){return a.defined("box",i),a.defined("other",m),i.minimum.x<=m.maximum.x&&i.maximum.x>=m.minimum.x&&i.minimum.y<=m.maximum.y&&i.maximum.y>=m.minimum.y&&i.minimum.z<=m.maximum.z&&i.maximum.z>=m.minimum.z},t.prototype.clone=function(i){return t.clone(this,i)},t.prototype.intersectPlane=function(i){return t.intersectPlane(this,i)},t.prototype.intersectAxisAlignedBoundingBox=function(i){return t.intersectAxisAlignedBoundingBox(this,i)},t.prototype.equals=function(i){return t.equals(this,i)};var O=t;export{O as a};