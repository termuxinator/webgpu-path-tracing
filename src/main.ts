// @ts-ignore
import outputWGSL from './output.wgsl?raw'
// @ts-ignore
import computeWGSL from './compute.wgsl?raw'

import scene from './scene.js';
import { CONFIG } from './settings.js';

const size = CONFIG.size

const canvas = document.querySelector("canvas")!
canvas.width = size.width;
canvas.height = size.height;

canvas.setAttribute('height', size.height + 'px')
canvas.setAttribute('width', size.width + 'px')

// when WebGPU is not available, show a video instead
const showVideo = (error: string) => {
  const disclaimer = document.createElement("div");
  disclaimer.id = "error";
  disclaimer.innerHTML = "⚠️ " + error + "<br> 🎥 This a video recording of the scene.";

  const video = document.createElement("video");
  video.src = "./video.mp4";
  video.poster = "./image.png";
  video.autoplay = true;
  video.loop = true;
  video.muted = true;
  video.height = size.height;
  video.width = size.width;
  video.setAttribute("playsinline", "playsinline");

  const viewport = document.querySelector("#viewport")!;
  viewport.append(disclaimer);
  viewport.append(video);

  canvas.style.display = "none";
}

// Initialize WebGPU context
// @ts-ignore
if (!navigator.gpu) {
  const e = "This browser does not support WebGPU.";
  showVideo(e);
  throw new Error(e);
}

// @ts-ignore
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) {
  const e = "Your GPU does not support WebGPU.";
  showVideo(e);
  throw new Error(e);
}

const device = await adapter.requestDevice();

const context = canvas.getContext("webgpu")! as any

// @ts-ignore
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
context.configure({
  device: device,
  format: canvasFormat,
});

// Setup the output render pipeline
const outputShaderModule = device.createShaderModule({
  label: "Output shader",
  code: outputWGSL
});

const renderOutputPipeline = device.createRenderPipeline({
  label: "Output render pipeline",
  layout: 'auto',
  vertex: {
    module: outputShaderModule,
    entryPoint: "vert_main",
  },
  fragment: {
    module: outputShaderModule,
    entryPoint: "frag_main",
    targets: [{
      format: canvasFormat
    }]
  },
});

const sampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

// Two textures for ping pong swap to accumulate compute passes
const textureA = device.createTexture({
  size,
  format: 'rgba8unorm',
  usage:

    // @ts-ignore
    GPUTextureUsage.COPY_DST |
    // @ts-ignore
    GPUTextureUsage.STORAGE_BINDING |
    // @ts-ignore
    GPUTextureUsage.TEXTURE_BINDING,
});

const textureB = device.createTexture({
  size,
  format: 'rgba8unorm',
  usage:
    // @ts-ignore
    GPUTextureUsage.COPY_DST |
    // @ts-ignore
    GPUTextureUsage.STORAGE_BINDING |
    // @ts-ignore
    GPUTextureUsage.TEXTURE_BINDING,
});

// Two bind groups to render the last accumulated compute pass
const renderOutputBindGroup = [
  device.createBindGroup({
    layout: renderOutputPipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: sampler,
      },
      {
        binding: 1,
        resource: textureA.createView(),
      },
    ],
  }),
  device.createBindGroup({
    layout: renderOutputPipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: sampler,
      },
      {
        binding: 1,
        resource: textureB.createView(),
      },
    ],
  }),
];

// Setup the compute pipeline
const computeShaderModule = device.createShaderModule({
  label: "Compute shader",
  code: computeWGSL
});

const computePipeline = device.createComputePipeline({
  label: "Compute pipeline",
  layout: 'auto',
  compute: {
    module: computeShaderModule,
    entryPoint: "compute_main",
  }
});

// Populate the GPU buffers from imported scene data
const vertexBuffer = device.createBuffer({
  label: "vertex buffer",
  size: scene.vertexArray.byteLength,
  // @ts-ignore
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(vertexBuffer, 0, scene.vertexArray);

const indexBuffer = device.createBuffer({
  label: "index buffer",
  size: scene.indexArray.byteLength,
  // @ts-ignore
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(indexBuffer, 0, scene.indexArray);

const meshBuffer = device.createBuffer({
  label: "mesh buffer",
  size: scene.meshArray.byteLength,
  // @ts-ignore
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(meshBuffer, 0, scene.meshArray);

const materialBuffer = device.createBuffer({
  label: "material buffer",
  size: scene.materialArray.byteLength,
  // @ts-ignore
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(materialBuffer, 0, scene.materialArray);

// Compute shader uniforms
const computeUniformsArray = new ArrayBuffer(32);
const computeUniformsFloat = new Float32Array(computeUniformsArray, 0, 6);
const computeUniformsUint = new Uint32Array(computeUniformsArray, 24, 2);

computeUniformsFloat[0] = 100.0;  // seed
computeUniformsFloat[1] = 1.0;    // weight
computeUniformsFloat[2] = 0.0;    // cam_azimuth
computeUniformsFloat[3] = 0.0;    // cam_elevation
computeUniformsFloat[4] = size.width;
computeUniformsFloat[5] = size.height;
computeUniformsUint[0] = 1;       // bounces
computeUniformsUint[1] = 1;       // samples

const computeUniformsBuffer = device.createBuffer({
  label: "Compute uniforms",
  size: computeUniformsArray.byteLength,
  // @ts-ignore
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(computeUniformsBuffer, 0, computeUniformsArray);

// Two bind groups to accumulate compute passes
const computeBindGroup = [
  device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: textureA.createView(),
      },
      {
        binding: 1,
        resource: textureB.createView(),
      },
      {
        binding: 2,
        resource: { buffer: vertexBuffer },
      },
      {
        binding: 3,
        resource: { buffer: indexBuffer }
      },
      {
        binding: 4,
        resource: { buffer: meshBuffer }
      },
      {
        binding: 5,
        resource: { buffer: materialBuffer }
      },
      {
        binding: 6,
        resource: { buffer: computeUniformsBuffer },
      },
    ],
  }),
  device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: textureB.createView(),
      },
      {
        binding: 1,
        resource: textureA.createView(),
      },
      {
        binding: 2,
        resource: { buffer: vertexBuffer },
      },
      {
        binding: 3,
        resource: { buffer: indexBuffer }
      },
      {
        binding: 4,
        resource: { buffer: meshBuffer }
      },
      {
        binding: 5,
        resource: { buffer: materialBuffer }
      },
      {
        binding: 6,
        resource: { buffer: computeUniformsBuffer },
      },
    ],
  }),
]

let initialSeed = 100.0;
let step = 0;
let cameraAzimuth = 0.0;
let cameraElevation = 0.0;
let requestId: number;

const workgroupCountX = size.width >> 3; // int(width/8)
const workgroupCountY = size.height >> 3;

const renderLoop = () => {

  if (step > 100) return; // stop passes after 100 steps

  const encoder = device.createCommandEncoder();

  // Do the compute 
  const computePass = encoder.beginComputePass();
  computePass.setPipeline(computePipeline);
  computePass.setBindGroup(0, computeBindGroup[step % 2]);
  computePass.dispatchWorkgroups(workgroupCountX, workgroupCountY, 1);
  computePass.end();

  // Output render
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: "clear",
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      storeOp: "store",
    }]
  });
  pass.setPipeline(renderOutputPipeline);
  pass.setBindGroup(0, renderOutputBindGroup[step % 2]);
  pass.draw(6, 1);
  pass.end();

  // Update uniforms buffer
  initialSeed += 0.01;
  computeUniformsFloat[0] = initialSeed;
  computeUniformsFloat[1] = 1.0 / ++step;
  computeUniformsFloat[2] = cameraAzimuth;
  computeUniformsFloat[3] = cameraElevation;

  // when moving the camera, to improve responsiveness
  // reduce samples and bounces to the minimum
  if (pointerMoving) {
    computeUniformsUint[0] = 1;  // bounces
    computeUniformsUint[1] = 1;  // samples
  } else {
    computeUniformsUint[0] = 4;
    computeUniformsUint[1] = 5;
  }

  device.queue.writeBuffer(computeUniformsBuffer, 0, computeUniformsArray);

  // Submit the command buffer
  device.queue.submit([encoder.finish()]);

  // just one pass when moving the camera
  if (pointerMoving) return;

  requestId = requestAnimationFrame(renderLoop);
}

requestId = requestAnimationFrame(renderLoop);

// Camera orbit controls
let pointerPrevX = 0, pointerPrevY = 0;
let pointerMoving = false;

const onPointerMove = (e: any) => {
  e.preventDefault();
  e = typeof (e.touches) != 'undefined' ? e.touches[0] : e;

  cameraAzimuth += (e.clientX - pointerPrevX) * Math.PI / 180;
  cameraElevation += (e.clientY - pointerPrevY) * Math.PI / 180;
  pointerPrevX = e.clientX;
  pointerPrevY = e.clientY;

  // reset render loop
  step = 0;
  if (requestId) cancelAnimationFrame(requestId);
  requestId = requestAnimationFrame(renderLoop);
}

// mobile touch events
canvas.addEventListener('touchmove', onPointerMove, { passive: true });
canvas.addEventListener('touchstart', (e) => {
  pointerPrevX = e.touches[0].clientX;
  pointerPrevY = e.touches[0].clientY;
  pointerMoving = true;
}, { passive: true });

canvas.addEventListener('touchend', (e) => {
  pointerMoving = false;
  requestId = requestAnimationFrame(renderLoop);
});

// desktop mouse events
canvas.addEventListener('mousedown', (e) => {
  pointerPrevX = e.clientX;
  pointerPrevY = e.clientY;
  canvas.addEventListener('mousemove', onPointerMove);
  pointerMoving = true;
});

addEventListener('mouseup', () => {
  canvas.removeEventListener('mousemove', onPointerMove);
  pointerMoving = false;
  requestId = requestAnimationFrame(renderLoop);
});
