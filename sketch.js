// script.js

// Maximum possible number of blobs
const MAX_BLOBS = 64;
// Number of blobs per image or default layer
const blobsPerImage = 7;

// Array to store image data: each has a texture and aspect ratio
let images = [];

// —— WebGL setup ——
const cvs = document.getElementById("glcanvas");
const gl = cvs.getContext("webgl");
if (!gl) throw "WebGL not supported";

let fbo, fboTex, fboStretch, fboStretchTex; // Declare framebuffers
window.addEventListener("resize", resize);
resize();

function resize() {
  cvs.width = window.innerWidth;
  cvs.height = window.innerHeight;
  initFramebuffers();
}

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    console.error(gl.getShaderInfoLog(s));
  return s;
}

function link(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    console.error(gl.getProgramInfoLog(p));
  return p;
}

// —— Vertex shader (shared) ——
const vertSrc = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0, 1);
}
`;

// —— Stretch shader: stretches images along spikes ——
const fragStretchSrc = `
precision highp float;
uniform vec2      iResolution;
uniform sampler2D iChannel0;
uniform float     iTime;
uniform int       uBlobStart;
uniform int       uBlobCount;
uniform float     uTexAspect;

float rand(int i){
  return fract(sin(float(i)*12.9898 + 78.233)*43758.5453);
}

vec3 get_blob(int i, float t){
  float spd   = 0.05; // Reduced speed for subtle movement
  float range = 0.2;  // Smaller range for controlled stretching
  vec2 c = vec2(rand(i), rand(i+42)) * 0.9 + 0.05; // Wide random spread
  c += range * vec2(
    sin(spd * t * rand(i+2)) * rand(i+56),
    cos(spd * t * rand(i+9)) * rand(i*3)
  );
  float r = 0.0000000000025 + 0.0000005 * abs(rand(i+1));
  return vec3(c, r);
}

void main(){
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  float canvasAsp = iResolution.x / iResolution.y;
  float scale = uTexAspect / canvasAsp;
  float x0 = (1.0 - scale) * 0.5;
  vec2 iUV = vec2(x0 + uv.x * scale, 1.0 - uv.y);

  float asp = iResolution.y / iResolution.x;
  vec2 muv = uv; muv.y *= asp;

  vec2 stretchUV = iUV;
  for(int j = 0; j < 64; ++j){
    if(j >= uBlobCount) break;
    int i = uBlobStart + j;
    vec3 b = get_blob(i, iTime);
    vec2 center = b.xy; center.y *= asp;
    float dist = length(muv - center);
    float angle = atan(muv.y - center.y, muv.x - center.x);
    float seed = rand(i+77) * 6.2831853;
    float spike = pow(max(cos(angle - seed), 0.0), 150.0);
    float stretchFactor = spike * 0.1; // Adjust stretch intensity
    if(dist < 0.1){ // Only stretch near blobs
      stretchUV.x += stretchFactor * cos(angle);
      stretchUV.y += stretchFactor * sin(angle);
    }
  }

  if(stretchUV.x >= 0.0 && stretchUV.x <= 1.0 && stretchUV.y >= 0.0 && stretchUV.y <= 1.0){
    gl_FragColor = texture2D(iChannel0, stretchUV);
  } else {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
  }
}
`;

const progStretch = link(vertSrc, fragStretchSrc);

// —— Mask shader: renders each image or default layer with its mask ——
const fragMaskSrc = `
precision highp float;
uniform vec2      iResolution;
uniform sampler2D iChannel0;
uniform float     iTime;
uniform int       uBlobStart;
uniform int       uBlobCount;
uniform float     uTexAspect;
uniform bool      isFirstImage;
uniform bool      isImage;
uniform int       layerIndex;

float rand(int i){
  return fract(sin(float(i)*12.9898 + 78.233)*43758.5453);
}

vec3 get_blob(int i, float t){
  float spd   = 0.05; // Reduced speed for subtle movement
  float range = 0.2;  // Smaller range for controlled movement
  vec2 c = vec2(rand(i), rand(i+42)) * 0.9 + 0.05; // Wide random spread
  c += range * vec2(
    sin(spd * t * rand(i+2)) * rand(i+56),
    cos(spd * t * rand(i+9)) * rand(i*3)
  );
  float r = 0.0000000000025 + 0.0000005 * abs(rand(i+1));
  return vec3(c, r);
}

void main(){
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  float canvasAsp = iResolution.x / iResolution.y;
  float scale = uTexAspect / canvasAsp;
  float x0 = (1.0 - scale) * 0.5;
  vec2 iUV = vec2(x0 + uv.x * scale, 1.0 - uv.y);

  float asp = iResolution.y / iResolution.x;
  vec2 muv = uv; muv.y *= asp;

  float sum = 0.0;
  for(int j = 0; j < 64; ++j){
    if(j >= uBlobCount) break;
    int i = uBlobStart + j;
    vec3 b = get_blob(i, iTime);
    vec2 center = b.xy; center.y *= asp;
    float angle = atan(muv.y - center.y, muv.x - center.x);
    float seed = rand(i+77) * 6.2831853;
    float phase = iTime * 0.5 + seed;
    float show = max(sin(phase) * 0.5 + 0.5, 0.0);
    float spike = pow(max(cos(angle - seed), 0.0), 150.0);
    float spikeAmp = 0.9 * show;
    float R = b.z + spikeAmp * spike;
    float d = max(length(center - muv) - R, 0.0);
    sum += 1.0 / pow(d * 2.0, 4.0);
  }

  vec3 bg = vec3(0.882, 0.882, 0.875); // #E1E1DF
  vec4 layerColor;
  if(layerIndex == 0){
    layerColor = vec4(0.494, 0.494, 0.494, 1.0); // #7E7E7E with 50% opacity
  } else if(layerIndex == 1){
    layerColor = vec4(0.686, 0.686, 0.690, 1.0); // #AFAFB0 with 50% opacity
  }

  if(sum > 3000.0){
    if(isImage && iUV.x >=0.0 && iUV.x <=1.0 && iUV.y >=0.0 && iUV.y <=1.0){
      vec4 col = texture2D(iChannel0, iUV);
      gl_FragColor = vec4(col.rgb, 1.0);
    } else if(!isImage){
      gl_FragColor = layerColor;
    } else {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    }
  } else if(isFirstImage){
    gl_FragColor = vec4(bg, 1.0);
  } else {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
  }
}
`;

const progMask = link(vertSrc, fragMaskSrc);

// —— Final shader: renders FBO to screen ——
const fragFinalSrc = `
precision highp float;
uniform vec2      iResolution;
uniform sampler2D iChannel0;

void main(){
  vec2 uv = gl_FragCoord.xy / iResolution;
  gl_FragColor = texture2D(iChannel0, uv);
}
`;

const progFinal = link(vertSrc, fragFinalSrc);

// —— Create quad ——
const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
  gl.STATIC_DRAW
);

function setupAttrib(prog) {
  const loc = gl.getAttribLocation(prog, "aPosition");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

// —— Framebuffer setup ——
function initFramebuffers() {
  // Main FBO
  if (fbo) gl.deleteFramebuffer(fbo);
  if (fboTex) gl.deleteTexture(fboTex);

  fboTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, fboTex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    cvs.width,
    cvs.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    fboTex,
    0
  );

  // Stretch FBO
  if (fboStretch) gl.deleteFramebuffer(fboStretch);
  if (fboStretchTex) gl.deleteTexture(fboStretchTex);

  fboStretchTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, fboStretchTex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    cvs.width,
    cvs.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  fboStretch = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboStretch);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    fboStretchTex,
    0
  );

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
initFramebuffers();

// —— Placeholder texture for default layers ——
const placeholderTex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, placeholderTex);
gl.texImage2D(
  gl.TEXTURE_2D,
  0,
  gl.RGBA,
  1,
  1,
  0,
  gl.RGBA,
  gl.UNSIGNED_BYTE,
  new Uint8Array([0, 0, 0, 255])
);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

// —— Uniform locations ——
const uStretch = {
  res: gl.getUniformLocation(progStretch, "iResolution"),
  tex: gl.getUniformLocation(progStretch, "iChannel0"),
  t: gl.getUniformLocation(progStretch, "iTime"),
  uBlobStart: gl.getUniformLocation(progStretch, "uBlobStart"),
  uBlobCount: gl.getUniformLocation(progStretch, "uBlobCount"),
  uTexAspect: gl.getUniformLocation(progStretch, "uTexAspect"),
};

const uMsk = {
  res: gl.getUniformLocation(progMask, "iResolution"),
  tex: gl.getUniformLocation(progMask, "iChannel0"),
  t: gl.getUniformLocation(progMask, "iTime"),
  uBlobStart: gl.getUniformLocation(progMask, "uBlobStart"),
  uBlobCount: gl.getUniformLocation(progMask, "uBlobCount"),
  uTexAspect: gl.getUniformLocation(progMask, "uTexAspect"),
  isFirstImage: gl.getUniformLocation(progMask, "isFirstImage"),
  isImage: gl.getUniformLocation(progMask, "isImage"),
  layerIndex: gl.getUniformLocation(progMask, "layerIndex"),
};

const uFinal = {
  res: gl.getUniformLocation(progFinal, "iResolution"),
  tex: gl.getUniformLocation(progFinal, "iChannel0"),
};

// —— Render loop ——
function render(ts) {
  gl.viewport(0, 0, cvs.width, cvs.height);

  // Step 1: Render to FBO Stretch (for images only)
  gl.useProgram(progStretch);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  setupAttrib(progStretch);
  gl.uniform2f(uStretch.res, cvs.width, cvs.height);
  gl.uniform1f(uStretch.t, ts * 0.001);

  // Step 2: Render to FBO (composite layers or images with masks)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.clearColor(0.882, 0.882, 0.875, 1.0); // #E1E1DF
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  gl.useProgram(progMask);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  setupAttrib(progMask);
  gl.uniform2f(uMsk.res, cvs.width, cvs.height);
  gl.uniform1f(uMsk.t, ts * 0.001);

  if (images.length === 0) {
    // Render two default layers
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, placeholderTex);
    gl.uniform1i(uMsk.tex, 0);
    gl.uniform1f(uMsk.uTexAspect, 1.0);

    // Lower layer (#AFAFB0)
    gl.uniform1i(uMsk.uBlobStart, 0);
    gl.uniform1i(uMsk.uBlobCount, blobsPerImage);
    gl.uniform1i(uMsk.isFirstImage, 1);
    gl.uniform1i(uMsk.isImage, 0);
    gl.uniform1i(uMsk.layerIndex, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Higher layer (#7E7E7E)
    gl.uniform1i(uMsk.uBlobStart, blobsPerImage);
    gl.uniform1i(uMsk.isFirstImage, 0);
    gl.uniform1i(uMsk.layerIndex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  } else {
    // Render each image with its mask
    images.forEach((img, index) => {
      // Stretch pass
      gl.bindFramebuffer(gl.FRAMEBUFFER, fboStretch);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, img.texture);
      gl.uniform1i(uStretch.tex, 0);
      gl.uniform1i(uStretch.uBlobStart, index * blobsPerImage);
      gl.uniform1i(uStretch.uBlobCount, blobsPerImage);
      gl.uniform1f(uStretch.uTexAspect, img.aspect);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Mask pass
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fboStretchTex);
      gl.uniform1i(uMsk.tex, 0);
      gl.uniform1i(uMsk.uBlobStart, index * blobsPerImage);
      gl.uniform1i(uMsk.uBlobCount, blobsPerImage);
      gl.uniform1f(uMsk.uTexAspect, img.aspect);
      gl.uniform1i(uMsk.isFirstImage, index === 0 ? 1 : 0);
      gl.uniform1i(uMsk.isImage, 1);
      gl.uniform1i(uMsk.layerIndex, -1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
  }

  gl.disable(gl.BLEND);

  // Step 3: Render FBO to screen
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.useProgram(progFinal);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  setupAttrib(progFinal);
  gl.uniform2f(uFinal.res, cvs.width, cvs.height);
  gl.uniform1i(uFinal.tex, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, fboTex);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  requestAnimationFrame(render);
}
requestAnimationFrame(render);

// —— Drag & drop ——
cvs.addEventListener("dragover", (e) => e.preventDefault());
cvs.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith("image/")) return;

  const img = new Image();
  img.onload = () => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const aspect = img.width / img.height;
    images.push({ texture, aspect });
  };
  img.src = URL.createObjectURL(file);
});
