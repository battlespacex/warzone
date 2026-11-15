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
import{a as f}from"./chunk-E7EKLP3B.js";import"./chunk-W5OEMTMB.js";import"./chunk-PYMQNHFO.js";import{a as u}from"./chunk-BKIYVF74.js";import"./chunk-LN2UT4R3.js";import"./chunk-P5EFSOUF.js";import"./chunk-G72JFEXW.js";import"./chunk-BDWA46XV.js";import"./chunk-5VFNV3LW.js";import"./chunk-SRA5MBUT.js";import"./chunk-5AAMOBJK.js";import"./chunk-4WQ4VT5S.js";import"./chunk-D3TVNJ6W.js";import"./chunk-3VUCSHGU.js";import"./chunk-LNJEJFV5.js";import"./chunk-BPABSUDY.js";import"./chunk-ATKJRN2G.js";import"./chunk-RDX4QSUS.js";import"./chunk-G3GDHHWO.js";import"./chunk-2AIOP76V.js";import"./chunk-IAE6APK2.js";import"./chunk-3E7FIXV7.js";import"./chunk-NZBME2JK.js";import"./chunk-6DLS2UKD.js";function h(i,t){let n=f.upsampleMesh(i),o=n.vertices.buffer,u=n.indices.buffer,r=n.westIndicesSouthToNorth.buffer,e=n.southIndicesEastToWest.buffer,s=n.eastIndicesNorthToSouth.buffer,h=n.northIndicesWestToEast.buffer;return t.push(o,u,r,e,s,h),{verticesBuffer:o,indicesBuffer:u,vertexCountWithoutSkirts:n.vertexCountWithoutSkirts,indexCountWithoutSkirts:n.indexCountWithoutSkirts,encoding:n.encoding,westIndicesBuffer:r,southIndicesBuffer:e,eastIndicesBuffer:s,northIndicesBuffer:h,minimumHeight:n.minimumHeight,maximumHeight:n.maximumHeight,boundingSphere:n.boundingSphere3D,orientedBoundingBox:n.orientedBoundingBox,horizonOcclusionPoint:n.horizonOcclusionPoint}}var I=u(h);export{I as default};