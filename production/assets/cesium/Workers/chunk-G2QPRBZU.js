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
import{a as C}from"./chunk-3E7FIXV7.js";import{b as g}from"./chunk-NZBME2JK.js";import{f}from"./chunk-6DLS2UKD.js";var d=C.EPSILON10;function x(r,e,s,n){if(g.defined("equalsEpsilon",e),!f(r))return;s=s??!1;let t=f(n),i=r.length;if(i<2)return r;let u,l,o,h=r[0],p=0,a=-1;for(u=1;u<i;++u)l=r[u],e(h,l,d)?(f(o)||(o=r.slice(0,u),p=u-1,a=0),t&&n.push(u)):(f(o)&&(o.push(l),p=u,t&&(a=n.length)),h=l);return s&&e(r[0],r[i-1],d)&&(t&&(f(o)?n.splice(a,0,p):n.push(i-1)),f(o)?o.length-=1:o=r.slice(0,-1)),f(o)?o:r}var k=x;export{k as a};