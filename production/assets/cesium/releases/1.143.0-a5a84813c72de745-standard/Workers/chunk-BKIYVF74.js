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
import{f}from"./chunk-6DLS2UKD.js";function c(e){let r,s=e.name,t=e.message;r=f(s)&&f(t)?`${s}: ${t}`:e.toString();let a=e.stack;return f(a)&&(r+=`\n${a}`),r}var i=c;function l(e){return self.onmessage=async function({data:r}){let s=[],t={id:r.id,result:void 0,error:void 0};self.CESIUM_BASE_URL=r.baseUrl;try{let a=await e(r.parameters,s);t.result=a}catch(e){e instanceof Error?t.error={name:e.name,message:e.message,stack:e.stack}:t.error=e}r.canTransferArrayBuffer||(s.length=0);try{postMessage(t,s)}catch(e){t.result=void 0,t.error=`postMessage failed with error: ${i(e)}\n  with responseMessage: ${JSON.stringify(t)}`,postMessage(t)}},self.onmessageerror=function(e){postMessage({id:e.data?.id,error:`postMessage failed with error: ${JSON.stringify(e)}`})},self}var d=l;export{d as a};