// Corona billboard for stars in the galaxy view: the solar corona's quad,
// built camera-relative (view space) so stars kiloparsecs from the origin
// stay steady. vOffset is still expressed along world axes, so the streamer
// pattern stays fixed to the star while the camera orbits.

#include <common>
#include <logdepthbuf_pars_vertex>

uniform vec3 uAxis;          // rotation axis, world space (unit)
uniform float uExtent;       // half-size of the quad in limb radii
uniform float uLimbRadius;   // apparent limb radius, view units

varying vec3 vOffset;
varying vec2 vPlane;

void main() {
  vec3 centerV = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  mat3 viewRot = mat3(viewMatrix);
  vec3 toCam = normalize(-centerV);
  vec3 axisV = normalize(viewRot * uAxis);
  vec3 refUp = abs(dot(axisV, toCam)) > 0.999 ? vec3(1.0, 0.0, 0.0) : axisV;
  vec3 right = normalize(cross(refUp, toCam));
  vec3 up = cross(toCam, right);

  vec3 offsetV = (right * position.x + up * position.y) * uExtent;
  vOffset = transpose(viewRot) * offsetV;
  vPlane = position.xy * uExtent;

  gl_Position = projectionMatrix * vec4(centerV + offsetV * uLimbRadius, 1.0);
  #include <logdepthbuf_vertex>
}
