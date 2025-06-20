// script.js

// максимально возможное число блобов
const MAX_BLOBS = 64;
// по умолчанию 7 блобов
let blobCount = 7;
let texAspect = 1;
let imageLoaded = false;

// ——— WebGL setup ———
const cvs = document.getElementById("glcanvas");
const gl = cvs.getContext("webgl");
if (!gl) throw "WebGL not supported";

let fbo, fboTex; // объявляем ДО resize/initFramebuffer
window.addEventListener("resize", resize);
resize();

function resize() {
  cvs.width = window.innerWidth;
  cvs.height = window.innerHeight;
  initFramebuffer();
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

// ——— первый проход: рисуем фон/картинку с обрезкой по ширине ———
const vertSrc = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0, 1);
}
`;

const fragImgSrc = `
precision highp float;
uniform vec2  iResolution;
uniform sampler2D iChannel0;
uniform bool  hasImage;
uniform float uTexAspect;

void main(){
  vec2 uv = gl_FragCoord.xy / iResolution;
  float canvasAsp = iResolution.x / iResolution.y;
  float scale     = uTexAspect / canvasAsp;
  float x0        = (1.0 - scale) * 0.5;
  vec2 iUV;
  // поворот UV на 180°
  iUV.x = x0 + uv.x * scale;
  iUV.y = 1.0 - uv.y;
  
  vec4 col = vec4(0.882,0.882,0.875,1.0); // фон #E1E1DF
  if(hasImage && iUV.x>=0.0 && iUV.x<=1.0 && iUV.y>=0.0 && iUV.y<=1.0) {
    col = texture2D(iChannel0, iUV);
  }
  gl_FragColor = col;
}
`;

const progImg = link(vertSrc, fragImgSrc);

// ——— второй проход: маска с «spikes» ———
const fragMaskSrc = `
precision highp float;
uniform vec2  iResolution;
uniform sampler2D iChannel0;
uniform bool  hasImage;
uniform float iTime;
uniform int   uBlobCount;

float rand(int i){
  return fract(sin(float(i)*12.9898 + 78.233)*43758.5453);
}

vec3 get_blob(int i, float t){
    float spd   = 0.1;    // медленнее
    float range = 0.0005;    // дальше друг от друга
    vec2  c     = vec2(0.5) + 0.1 * vec2(rand(i), rand(i+42));
    c += range * vec2(
      sin(spd * t * rand(i+2)) * rand(i+56),
     -sin(spd * t) * rand(i*9)
    );
    float r = 0.025 + 0.005 * abs(rand(i+3)); // чуть меньше
    return vec3(c, r);
}

void main(){
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  float asp = iResolution.y / iResolution.x;
  vec2 muv = uv; muv.y *= asp;

  float sum = 0.0;
  for(int i = 0; i < ${MAX_BLOBS}; ++i){
    if(i >= uBlobCount) break;
    vec3 b      = get_blob(i, iTime);
    vec2 center = b.xy; center.y *= asp;

    float angle = atan(muv.y - center.y, muv.x - center.x);

    // плавная видимость спайка
    float seed  = rand(i+77) * 6.2831853;
    float phase = iTime * 0.5 + seed;
    float show  = max(sin(phase) * 0.5 + 0.5, 0.0);

    // один спайк
    float spike     = pow(max(cos(angle - seed), 0.0), 150.0);
    float spikeAmp  = 0.6 * show; // в 2× длиннее

    float R = b.z + spikeAmp * spike;
    float d = max(length(center - muv) - R, 0.0);
    sum += 1.0 / pow(d, 4.0);
  }

  vec3 bg = vec3(0.882, 0.882, 0.875); // #E1E1DF
  if(sum > 3000.0){
    vec4 col = texture2D(iChannel0, uv);
    gl_FragColor = hasImage ? col : vec4(vec3(0.6), 1.0);
  } else {
    gl_FragColor = vec4(bg, 1.0);
  }
}
`;

const progMask = link(vertSrc, fragMaskSrc);

// ——— создаём общий квад ———
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

// ——— FBO ———
function initFramebuffer() {
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
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
initFramebuffer();

// ——— основная текстура (placeholder) ———
const tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texImage2D(
  gl.TEXTURE_2D,
  0,
  gl.RGBA,
  1,
  1,
  0,
  gl.RGBA,
  gl.UNSIGNED_BYTE,
  new Uint8Array([153, 153, 153, 255])
);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

// ——— uniform locations ———
const uImg = {
  res: gl.getUniformLocation(progImg, "iResolution"),
  tex: gl.getUniformLocation(progImg, "iChannel0"),
  has: gl.getUniformLocation(progImg, "hasImage"),
  asp: gl.getUniformLocation(progImg, "uTexAspect"),
};
const uMsk = {
  res: gl.getUniformLocation(progMask, "iResolution"),
  tex: gl.getUniformLocation(progMask, "iChannel0"),
  has: gl.getUniformLocation(progMask, "hasImage"),
  t: gl.getUniformLocation(progMask, "iTime"),
  cnt: gl.getUniformLocation(progMask, "uBlobCount"),
};

// ——— render loop ———
function render(ts) {
  // 1) в FBO рисуем фон/картинку
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, cvs.width, cvs.height);
  gl.useProgram(progImg);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  setupAttrib(progImg);

  gl.uniform2f(uImg.res, cvs.width, cvs.height);
  gl.uniform1i(uImg.tex, 0);
  gl.uniform1i(uImg.has, imageLoaded ? 1 : 0);
  gl.uniform1f(uImg.asp, texAspect);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // 2) на экран: маска с metaballs+spikes
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, cvs.width, cvs.height);
  gl.useProgram(progMask);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  setupAttrib(progMask);

  gl.uniform2f(uMsk.res, cvs.width, cvs.height);
  gl.uniform1i(uMsk.tex, 0);
  gl.uniform1i(uMsk.has, imageLoaded ? 1 : 0);
  gl.uniform1f(uMsk.t, ts * 0.001);
  gl.uniform1i(uMsk.cnt, blobCount);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, fboTex);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

// ——— drag & drop ———
cvs.addEventListener("dragover", (e) => e.preventDefault());
cvs.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith("image/")) return;
  const img = new Image();
  img.onload = () => {
    texAspect = img.width / img.height;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    imageLoaded = true;
    blobCount = Math.min(blobCount + 1, MAX_BLOBS);
  };
  img.src = URL.createObjectURL(file);
});
