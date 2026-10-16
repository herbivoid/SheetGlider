import * as THREE from "three";

// Depth fog that fades things out with distance instead of tinting them toward
// a fog color, so the background stays transparent for compositing. Replaces
// three.js's fog shader chunk; must run before any material is compiled.
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.a *= 1.0 - fogFactor;
#endif
`;

// Fog starts and ends at multiples of the camera distance, so it keeps working
// when you zoom: things around the character stay clear, farther ones fade.
export function applyFog(scene, params) {
  scene.fog = params.fog
    ? new THREE.Fog(0x000000, params.camDistance * params.fogStart, params.camDistance * Math.max(params.fogEnd, params.fogStart + 0.05))
    : null;
}
