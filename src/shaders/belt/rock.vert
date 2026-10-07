// Belt rocks — one instanced draw for thousands of bodies. Orbits are
// solved on the CPU (Belt.ts) at an epoch; the vertex shader extrapolates
// each centre along its velocity, tumbles the rock about its spin axis and
// scales it by its size.

#include <common>
#include <logdepthbuf_pars_vertex>
#include <space_kepler>

uniform float uTime;          // real seconds (tumbling)
uniform float uSizeBoost;     // visual exaggeration of rock sizes
uniform float uDt;            // days since the CPU solve

attribute vec3 aCenter;       // scene position at the epoch (CPU Kepler)
attribute vec3 aVelocity;     // scene units per day at the epoch
attribute float aSize;        // diameter, km
attribute vec4 aSpin;         // axis xyz, rate (rad/s)
attribute vec3 aShape;        // per-axis stretch
attribute vec3 aColor;

varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vColor;

vec3 rotateAxis(vec3 v, vec3 k, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

void main() {
  vec3 centre = aCenter + aVelocity * uDt;
  float r = sceneRadius(aSize) * uSizeBoost;
  vec3 axis = normalize(aSpin.xyz);
  float ang = aSpin.w * uTime;
  vec3 local = rotateAxis(position * aShape, axis, ang);
  vec3 n = rotateAxis(normalize(normal / aShape), axis, ang);

  vec4 wp = modelMatrix * vec4(centre + local * r, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * n);
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
