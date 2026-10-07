// Planet surface — shared vertex stage (rocky, Earth, gas giants, clouds).
//
// The mesh is a unit sphere; the parent group applies radius, polar
// flattening and orientation. Normals therefore go through the inverse
// transpose of the model matrix so flattened planets shade correctly.

#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uShellScale;   // >1 for cloud shells, 1 for the surface

varying vec2 vUv;
varying vec3 vObjPos;        // unit-sphere position, object space
varying vec3 vNormalW;       // render-space normal
varying vec3 vPosW;          // render-space position
varying vec3 vTangentW;      // render-space east tangent

void main() {
  vUv = uv;
  vObjPos = normalize(position);
  vec3 p = position * uShellScale;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vPosW = wp.xyz;
  mat3 normalW = transpose(inverse(mat3(modelMatrix)));
  vNormalW = normalize(normalW * normal);
  // East tangent of the unit sphere; tangents transform with the model matrix.
  vec3 tObj = vec3(vObjPos.z, 0.0, -vObjPos.x);
  tObj = length(tObj) > 1e-5 ? normalize(tObj) : vec3(1.0, 0.0, 0.0);
  vTangentW = normalize(mat3(modelMatrix) * tObj);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
