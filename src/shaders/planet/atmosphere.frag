// Atmospheric scattering — single scattering, Rayleigh + Mie
// (Nishita-style ray march, as popularised by O'Neil and Bruneton).
//
// All maths happens in the planet's object space where the surface is the
// unit sphere: camera position and sun direction arrive as uniforms
// computed on the CPU in double precision, so there is no float jitter even
// far from the origin.
//
// Per pixel: march the view ray through the shell (stopping at the ground),
// and at each sample march towards the Sun to get the light's optical depth.
// Output is premultiplied: rgb = in-scattered light, a = average
// transmittance, blended as  dst * a + rgb  — so the surface behind is both
// dimmed and reddened (sunsets) and the haze is added on top.

#include <common>
#include <logdepthbuf_pars_fragment>
#include <space_planet>

uniform vec3 uCamLocal;     // camera, object space
uniform vec3 uSunDirLocal;  // towards the Sun, object space (unit)
uniform float uTop;         // top radius
uniform vec3 uBetaR;        // Rayleigh scattering at the surface (per planet radius)
uniform float uBetaM;       // Mie scattering at the surface (per planet radius)
uniform float uHR;          // Rayleigh scale height (planet radii)
uniform float uHM;          // Mie scale height (planet radii)
uniform float uG;           // Mie anisotropy
uniform float uIntensity;
uniform vec3 uMieTint;

varying vec3 vLocal;

#define PRIMARY_STEPS 12
const float MIE_EXTINCTION = 1.1; // Mie extinction / scattering ratio

// Optical depth from a point towards the Sun, in scale heights, for an
// exponential atmosphere: Schüler's approximation of the Chapman function
// (GPU Pro 3, 2012). X = planet radius / H, h = height / H, mu = cos of the
// Sun's zenith angle there. Replaces a 5-step march per sample.
float chapman(float X, float h, float mu) {
  float c = sqrt(X + h);
  if (mu >= 0.0) return c / (c * mu + 1.0) * exp(-h);
  float x0 = sqrt(1.0 - mu * mu) * (X + h);
  float c0 = sqrt(x0);
  // Grazing rays below the horizon: huge depth (fully extinguished anyway).
  return 2.0 * c0 * exp(min(X - x0, 60.0)) - c / (1.0 - c * mu) * exp(-h);
}

// Soft planet shadow along the light ray: 0 = fully in shadow.
float sunVisibility(vec3 p, vec3 L) {
  float b = dot(p, L);
  if (b > 0.0) return 1.0;
  float closest = length(p - L * b);
  return smoothstep(0.985, 1.01, closest);
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 ro = uCamLocal;
  vec3 rd = normalize(vLocal - uCamLocal);
  vec3 L = uSunDirLocal;

  vec2 tA = raySphere(ro, rd, uTop);
  if (tA.x > tA.y || tA.y < 0.0) discard;
  float t0 = max(tA.x, 0.0);
  float t1 = tA.y;
  vec2 tP = raySphere(ro, rd, 1.0);
  bool ground = tP.x < tP.y && tP.x > 0.0;
  if (ground) t1 = min(t1, tP.x);

  float ds = (t1 - t0) / float(PRIMARY_STEPS);
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  float odR = 0.0;
  float odM = 0.0;

  for (int i = 0; i < PRIMARY_STEPS; i++) {
    vec3 p = ro + rd * (t0 + (float(i) + 0.5) * ds);
    float h = max(length(p) - 1.0, 0.0);
    float dR = exp(-h / uHR) * ds;
    float dM = exp(-h / uHM) * ds;
    odR += dR;
    odM += dM;

    float vis = sunVisibility(p, L);
    if (vis <= 0.0) continue;

    float r = length(p);
    float mu = dot(p, L) / r;
    float lR = uHR * chapman(1.0 / uHR, h / uHR, mu);
    float lM = uHM * chapman(1.0 / uHM, h / uHM, mu);
    vec3 tau = uBetaR * (odR + lR) + uBetaM * MIE_EXTINCTION * (odM + lM);
    vec3 att = exp(-tau) * vis;
    sumR += dR * att;
    sumM += dM * att;
  }

  float mu = dot(rd, L);
  float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = uG;
  float g2 = g * g;
  float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu))
               / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));

  vec3 inscatter = (sumR * uBetaR * phaseR + sumM * uBetaM * phaseM * uMieTint)
                 * uIntensity * uSunColor * uSunIntensity;

  vec3 trans = exp(-(uBetaR * odR + uBetaM * MIE_EXTINCTION * odM));
  float T = dot(trans, vec3(1.0 / 3.0));

  gl_FragColor = vec4(inscatter, T);
}
