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

let fbo, fboTex; // Declare framebuffer
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

// —— Vertex shader (shared) ——
const vertSrc = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0, 1);
}
`;

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
  float spd   = 0.05;
  float range = 0.2;
  vec2 c = vec2(rand(i), rand(i+42)) * 0.9 + 0.05;
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
  float texAsp    = uTexAspect;
  float ratio     = texAsp / canvasAsp;
  vec2 scale = (ratio > 1.0)
    ? vec2(ratio, 1.0)
    : vec2(1.0, 1.0/ratio);
  vec2 centered = (uv - 0.5) / scale + 0.5;
  // flip vertically
  vec2 iUV = vec2(centered.x, 1.0 - centered.y);


  float asp = iResolution.y / iResolution.x;
  vec2 muv = uv; muv.y *= asp;

  float sum = 0.0;
  for(int j = 0; j < 64; ++j){
    if(j >= uBlobCount) break;
    int i = uBlobStart + j;
    vec3 b = get_blob(i, iTime);
    vec2 center = b.xy; center.y *= asp;
    
    // Вынесенный угол спайка в отдельную переменную
    float spikeAngle = rand(i+77) * 6.2831853;
    
    float angle = atan(muv.y - center.y, muv.x - center.x);
    float spikeAngleSharpness = mix(800.0, 880.0, rand(i+20));
    float spikeLengthFactor = mix(0.05, 0.1, rand(i+30));
    float spike = pow(max(cos(angle - spikeAngle), 0.0), spikeAngleSharpness);
    float spikeAmp = spikeLengthFactor; // <- убрали умножение на show
    float R = b.z + spikeAmp * spike;

    float d = max(length(center - muv) - R, 0.0);

    float sharpness = mix(3.0, 6.0, rand(i + 99)); // насколько резко спадает blob
    float blobScale = mix(1.5, 3.5, rand(i + 133)); // насколько "толстый" контур
    sum += 1.0 / pow(d * blobScale, sharpness);

    // Добавленные узкие прямоугольники
    vec2 rayDir = vec2(cos(spikeAngle), sin(spikeAngle));
    vec2 rayEnd = center + rayDir * 100.0; // Выходим далеко за пределы экрана
    
    // Рассчет расстояния до линии
    vec2 lineDir = rayEnd - center;
    vec2 toPoint = muv - center;
    float t = clamp(dot(toPoint, lineDir) / dot(lineDir, lineDir), 0.0, 1.0);
    vec2 closestPoint = center + t * lineDir;
    float lineDist = length(muv - closestPoint);
    
    // ВАРИАЦИЯ ПРЯМОУГОЛЬНИКОВ: случайные параметры для каждого
    float lineWidth = mix(0.0004, 0.002, rand(i+400));     // вариация ширины
    float lineSharpness = mix(80.0, 120.0, rand(i+500));    // вариация резкости
    float lineStrength = mix(0.7, 0.9, rand(i+600));        // вариация интенсивности
    
    // Добавляем вклад прямоугольника в общую сумму
    sum += lineStrength / pow(lineDist / lineWidth, lineSharpness);
  }

  vec3 bg = vec3(0.882, 0.882, 0.875); // #E1E1DF
  vec4 layerColor;
  if(layerIndex == 0){
    layerColor = vec4(0.494, 0.494, 0.494, 1.0); // #7E7E7E fully opaque
  } else if(layerIndex == 1){
    layerColor = vec4(0.686, 0.686, 0.690, 1.0); // #AFAFB0 fully opaque
  } else {
    layerColor = vec4(0.0, 0.0, 0.0, 1.0);
  }

  if(sum > 3000.0){
    if(isImage && iUV.x >= 0.0 && iUV.x <= 1.0 && iUV.y >= 0.0 && iUV.y <= 1.0){
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

  // Render to FBO (composite layers or images with masks)
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
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, img.texture);
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

  // Render FBO to screen
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
