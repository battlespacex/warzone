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
import{a as f}from"./chunk-3QC4KPK5.js";import"./chunk-X2JEUMCS.js";import"./chunk-AJGKN5FZ.js";import{a as u}from"./chunk-CMB3O7X2.js";import"./chunk-BPTWZPZ6.js";import"./chunk-GVYQ2MV7.js";import"./chunk-CAEAJPBH.js";import"./chunk-HZDH6VFE.js";import"./chunk-HJG35BQ3.js";import"./chunk-5U3HZZCI.js";import"./chunk-QITOM3FA.js";import"./chunk-74XTGJKF.js";import"./chunk-WQ5ZC6ME.js";import"./chunk-XVAXSA53.js";import"./chunk-V6RJRUKY.js";import"./chunk-R6PWD5CA.js";import"./chunk-BDF6MEVU.js";import"./chunk-XB2TPQAQ.js";import"./chunk-OEIACSKL.js";import"./chunk-F2ZMVLJV.js";import"./chunk-VGILZD7B.js";import"./chunk-RXYBLNW3.js";import"./chunk-TXOEXY5C.js";import"./chunk-VIMSDF2W.js";function h(i,t){let n=f.upsampleMesh(i),o=n.vertices.buffer,u=n.indices.buffer,r=n.westIndicesSouthToNorth.buffer,e=n.southIndicesEastToWest.buffer,s=n.eastIndicesNorthToSouth.buffer,h=n.northIndicesWestToEast.buffer;return t.push(o,u,r,e,s,h),{verticesBuffer:o,indicesBuffer:u,vertexCountWithoutSkirts:n.vertexCountWithoutSkirts,indexCountWithoutSkirts:n.indexCountWithoutSkirts,encoding:n.encoding,westIndicesBuffer:r,southIndicesBuffer:e,eastIndicesBuffer:s,northIndicesBuffer:h,minimumHeight:n.minimumHeight,maximumHeight:n.maximumHeight,boundingSphere:n.boundingSphere3D,orientedBoundingBox:n.orientedBoundingBox,horizonOcclusionPoint:n.horizonOcclusionPoint}}var I=u(h);export{I as default};