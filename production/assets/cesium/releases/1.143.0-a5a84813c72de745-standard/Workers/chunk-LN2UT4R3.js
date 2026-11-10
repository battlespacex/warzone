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
import{a as c,c as x}from"./chunk-2AIOP76V.js";import{a as h}from"./chunk-IAE6APK2.js";import{a as u}from"./chunk-3E7FIXV7.js";import{a as d}from"./chunk-NZBME2JK.js";import{f as n}from"./chunk-6DLS2UKD.js";var s=class t{constructor(t){this._ellipsoid=t??x.WGS84,this._semimajorAxis=this._ellipsoid.maximumRadius,this._oneOverSemimajorAxis=1/this._semimajorAxis}get ellipsoid(){return this._ellipsoid}static mercatorAngleToGeodeticLatitude(t){return u.PI_OVER_TWO-2*Math.atan(Math.exp(-t))}static geodeticLatitudeToMercatorAngle(e){e>t.MaximumLatitude?e=t.MaximumLatitude:e<-t.MaximumLatitude&&(e=-t.MaximumLatitude);let i=Math.sin(e);return.5*Math.log((1+i)/(1-i))}project(e,i){let a=this._semimajorAxis,r=e.longitude*a,o=t.geodeticLatitudeToMercatorAngle(e.latitude)*a,s=e.height;return n(i)?(i.x=r,i.y=o,i.z=s,i):new h(r,o,s)}unproject(e,i){if(!n(e))throw new d("cartesian is required");let a=this._oneOverSemimajorAxis,r=e.x*a,o=t.mercatorAngleToGeodeticLatitude(e.y*a),s=e.z;return n(i)?(i.longitude=r,i.latitude=o,i.height=s,i):new c(r,o,s)}};s.MaximumLatitude=s.mercatorAngleToGeodeticLatitude(Math.PI);var L=s;export{L as a};