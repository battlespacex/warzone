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
var i=Object.create,t=Object.defineProperty,r=Object.getOwnPropertyDescriptor,l=Object.getOwnPropertyNames,o=Object.getPrototypeOf,c=Object.prototype.hasOwnProperty,p=(e,r,o)=>r in e?t(e,r,{enumerable:!0,configurable:!0,writable:!0,value:o}):e[r]=o,b=(e=>typeof require<"u"?require:typeof Proxy<"u"?new Proxy(e,{get:(e,r)=>(typeof require<"u"?require:e)[r]}):e)(function(e){if(typeof require<"u")return require.apply(this,arguments);throw Error('Dynamic require of "'+e+'" is not supported')}),g=e=>r=>{var t=e[r];if(t)return t();throw new Error("Module not found in bundle: "+r)},h=(e,r)=>()=>{try{return r||e((r={exports:{}}).exports,r),r.exports}catch(e){throw r=0,e}},x=(e,o,u,n)=>{if(o&&"object"==typeof o||"function"==typeof o)for(let a of l(o))!c.call(e,a)&&a!==u&&t(e,a,{get:()=>o[a],enumerable:!(n=r(o,a))||n.enumerable});return e},j=(e,r,u)=>(u=null!=e?i(o(e)):{},x(!r&&e&&e.__esModule?u:t(u,"default",{value:e,enumerable:!0}),e)),k=(e,r,t)=>p(e,"symbol"!=typeof r?r+"":r,t);function a(e){return null!=e}var q=a;export{b as a,g as b,h as c,j as d,k as e,q as f};