// Volumetric bar/bulge: the line integral of a Gaussian ellipsoid of light
// along the view ray, in closed form. In units where the ellipsoid is a
// unit Gaussian (q = p / sigma) the integral along q0 + t dq is
//   sqrt(pi) / |dq| * exp(-(|q0|^2 - (q0.dq)^2 / |dq|^2)),
// times the world length per unit t. So the bulge is a real 3-D glow:
// round and bright face-on, a fat lens edge-on, never a flat sticker.

#include <common>
#include <logdepthbuf_pars_fragment>

uniform vec3 uCamObj;     // camera in the box's object space (box spans ±0.5)
uniform vec3 uSize;       // box size, world units
uniform vec3 uColor;
uniform float uIntensity;

varying vec3 vObj;

void main() {
  #include <logdepthbuf_fragment>
  // Box = ±3 sigma on each axis.
  const float SIGMA = 1.0 / 6.0;
  vec3 d = normalize(vObj - uCamObj);
  vec3 q0 = uCamObj / SIGMA;
  vec3 dq = d / SIGMA;
  float dq2 = dot(dq, dq);
  float b = dot(q0, dq);
  float perp2 = max(dot(q0, q0) - b * b / dq2, 0.0);
  float worldPerT = length(d * uSize);
  float column = 1.7724539 * worldPerT / sqrt(dq2) * exp(-perp2);
  // Normalised to the face-on central column.
  float k = column / (1.7724539 * uSize.z * SIGMA);
  vec3 c = uColor * uIntensity * k;
  if (!(max(c.r, max(c.g, c.b)) >= 0.0005)) discard;
  gl_FragColor = vec4(c, 1.0);
}
