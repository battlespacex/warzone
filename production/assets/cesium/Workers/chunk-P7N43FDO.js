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
import{h as C}from"./chunk-LNJEJFV5.js";import{a as n,b}from"./chunk-IAE6APK2.js";import{a as w}from"./chunk-3E7FIXV7.js";var j={},q=new n,L=new n,Q=new C,G=new b;function W(t,e,r,a,o,i,l,s,y,c){let m=t+e;n.multiplyByScalar(a,Math.cos(m),q),n.multiplyByScalar(r,Math.sin(m),L),n.add(q,L,q);let u=Math.cos(t);u*=u;let w=Math.sin(t);w*=w;let h=i/Math.sqrt(l*u+o*w)/s;return C.fromAxisAngle(q,h,Q),b.fromQuaternion(Q,G),b.multiplyByVector(G,y,c),n.normalize(c,c),n.multiplyByScalar(c,s,c),c}var U=new n,Z=new n,N=new n,v=new n;j.raisePositionsToHeight=function(t,e,r){let a=e.ellipsoid,o=e.height,i=e.extrudedHeight,l=r?t.length/3*2:t.length/3,s=new Float64Array(3*l),y=t.length,c=r?y:0;for(let e=0;e<y;e+=3){let l=e+1,y=e+2,m=n.fromArray(t,e,U);a.scaleToGeodeticSurface(m,m);let u=n.clone(m,Z),w=a.geodeticSurfaceNormal(m,v),h=n.multiplyByScalar(w,o,N);n.add(m,h,m),r&&(n.multiplyByScalar(w,i,h),n.add(u,h,u),s[e+c]=u.x,s[l+c]=u.y,s[y+c]=u.z),s[e]=m.x,s[l]=m.y,s[y]=m.z}return s};var D=new n,J=new n,K=new n;j.computeEllipsePositions=function(t,e,r){let a=t.semiMinorAxis,o=t.semiMajorAxis,i=t.rotation,l=t.center,s=8*t.granularity,y=a*a,c=o*o,m=o*a,u=n.magnitude(l),h=n.normalize(l,D),x=n.cross(n.UNIT_Z,l,J);x=n.normalize(x,x);let z=n.cross(h,x,K),f=1+Math.ceil(w.PI_OVER_TWO/s),_=w.PI_OVER_TWO/(f-1),p=w.PI_OVER_TWO-f*_;p<0&&(f-=Math.ceil(Math.abs(p)/_));let O,P,d,I,E,M=e?new Array(3*(f*(f+2)*2)):void 0,T=0,V=U,g=Z,A=4*f*3,j=A-1,v=0,R=r?new Array(A):void 0;for(p=w.PI_OVER_TWO,V=W(p,i,z,x,y,m,c,u,h,V),e&&(M[T++]=V.x,M[T++]=V.y,M[T++]=V.z),r&&(R[j--]=V.z,R[j--]=V.y,R[j--]=V.x),p=w.PI_OVER_TWO-_,O=1;O<f+1;++O){if(V=W(p,i,z,x,y,m,c,u,h,V),g=W(Math.PI-p,i,z,x,y,m,c,u,h,g),e){for(M[T++]=V.x,M[T++]=V.y,M[T++]=V.z,d=2*O+2,P=1;P<d-1;++P)I=P/(d-1),E=n.lerp(V,g,I,N),M[T++]=E.x,M[T++]=E.y,M[T++]=E.z;M[T++]=g.x,M[T++]=g.y,M[T++]=g.z}r&&(R[j--]=V.z,R[j--]=V.y,R[j--]=V.x,R[v++]=g.x,R[v++]=g.y,R[v++]=g.z),p=w.PI_OVER_TWO-(O+1)*_}for(O=f;O>1;--O){if(p=w.PI_OVER_TWO-(O-1)*_,V=W(-p,i,z,x,y,m,c,u,h,V),g=W(p+Math.PI,i,z,x,y,m,c,u,h,g),e){for(M[T++]=V.x,M[T++]=V.y,M[T++]=V.z,d=2*(O-1)+2,P=1;P<d-1;++P)I=P/(d-1),E=n.lerp(V,g,I,N),M[T++]=E.x,M[T++]=E.y,M[T++]=E.z;M[T++]=g.x,M[T++]=g.y,M[T++]=g.z}r&&(R[j--]=V.z,R[j--]=V.y,R[j--]=V.x,R[v++]=g.x,R[v++]=g.y,R[v++]=g.z)}p=w.PI_OVER_TWO,V=W(-p,i,z,x,y,m,c,u,h,V);let S={};return e&&(M[T++]=V.x,M[T++]=V.y,M[T++]=V.z,S.positions=M,S.numPts=f),r&&(R[j--]=V.z,R[j--]=V.y,R[j--]=V.x,S.outerPositions=R),S};var tt=j;export{tt as a};