// Corona — camera-facing billboard built in world space.
//
// The quad lies in the plane through the Sun's centre perpendicular to the
// camera direction. Its up vector follows the Sun's rotation axis, so the
// streamer pattern does not spin when the camera rolls. Each fragment gets
// its 3D offset from the Sun's centre (in limb radii); the fragment shader
// samples noise on that 3D direction, so orbiting the Sun reveals a
// consistent, volumetric-looking structure.

#include <common>
#include <logdepthbuf_pars_vertex>

uniform vec3 uAxis;          // Sun rotation axis, world space (unit)
uniform float uExtent;       // half-size of the quad in limb radii
uniform float uLimbRadius;   // apparent limb radius on this plane (world units)

varying vec3 vOffset;        // offset from centre, in limb radii
varying vec2 vPlane;         // same, in the billboard plane (x right, y towards the solar north)

void main() {
  vec3 center = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 toCam = normalize(cameraPosition - center);
  vec3 refUp = abs(dot(uAxis, toCam)) > 0.999 ? vec3(1.0, 0.0, 0.0) : uAxis;
  vec3 right = normalize(cross(refUp, toCam));
  vec3 up = cross(toCam, right);

  vec3 offset = (right * position.x + up * position.y) * uExtent;
  vOffset = offset;
  vPlane = position.xy * uExtent;

  vec3 world = center + offset * uLimbRadius;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  #include <logdepthbuf_vertex>
}
