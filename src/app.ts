import { mat4 } from 'gl-matrix'
import { BlockAtlas } from './BlockAtlas'
import { ModelManager } from './ModelManager';

const blocksTextureIds = [
  'block/crafting_table_front',
  'block/crafting_table_side',
  'block/crafting_table_top',
  'block/oak_planks',
  'block/dirt',
  'block/sand',
  'block/cobblestone',
]

const blockModelIds = [
  'crafting_table'
]

type GL = WebGLRenderingContext

const structure = {
  size: [1, 1, 1],
  palette: [
    { Name: 'crafting_table' },
  ],
  blocks: [
    { pos: [0, 0, 0], state: 0 },
  ]
}

const vsSource = `
  attribute vec4 vertPos;
  attribute vec2 texCoord;

  uniform mat4 mView;
  uniform mat4 mProj;

  varying highp vec2 vTexCoord;

  void main(void) {
    gl_Position = mProj * mView * vertPos;
    vTexCoord = texCoord;
  }
`;

const fsSource = `
  varying highp vec2 vTexCoord;

  uniform sampler2D sampler;

  void main(void) {
    gl_FragColor = texture2D(sampler, vTexCoord);
  }
`;

let blockAtlas = new BlockAtlas(1)
let modelManager = new ModelManager({})

let xTime = 0.0;
let xRotation = 0.6;
let yRotation = 0.0;

main();

async function main() {
  const canvas = document.querySelector('#glcanvas') as HTMLCanvasElement;
  const gl = canvas.getContext('webgl');

  if (!gl) {
    console.error('Unable to initialize WebGL. Your browser or machine may not support it.');
    return;
  }

  const shaderProgram = initShaderProgram(gl, vsSource, fsSource);
  if (!shaderProgram) {
    return
  }

  // Fetch block textures
  blockAtlas = await BlockAtlas.fromIds(blocksTextureIds)
  // Create atlas texture
  const atlasTexture = blockAtlas.createTexture(gl)
  // Display preview of atlas
  const atlasCanvas = document.querySelector('#atlas') as HTMLCanvasElement;
  const ctx = atlasCanvas.getContext('2d')!;
  atlasCanvas.width = blockAtlas.pixelWidth
  atlasCanvas.height = blockAtlas.pixelWidth
  ctx.putImageData(blockAtlas.getImageData(), 0, 0)

  // Fetch block models
  modelManager = await ModelManager.fromIds(blockModelIds)

  console.log(modelManager)

  const { vertexCount } = initGl(gl, shaderProgram)

  const viewMatrixLoc = gl.getUniformLocation(shaderProgram,'mView')!

  let then = 0
  function render(now: number) {
    now *= 0.001;
    const deltaTime = now - then;
    then = now;

    yRotation += deltaTime
    xTime += deltaTime
    xRotation = Math.sin(xTime) + 0.2

    drawScene(gl!, viewMatrixLoc, vertexCount, atlasTexture!);

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}

function initShaderProgram(gl: GL, vsSource: string, fsSource: string) {
  const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource)!;
  const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource)!;

  const shaderProgram = gl.createProgram()!;
  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);

  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    console.error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(shaderProgram));
    return null;
  }

  return shaderProgram;
}

function loadShader(gl: GL, type: number, source: string) {
  const shader = gl.createShader(type)!;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

function createBuffer(gl: GL, type: number, array: ArrayBuffer) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(type, buffer);
  gl.bufferData(type, array, gl.STATIC_DRAW);
  return buffer
}

function initBuffers(gl: GL) {
  const positions = []
  const textureCoordinates = []
  const indices = []
  let indexOffset = 0

  for (const b of structure.blocks) {
    const blockState = structure.palette[b.state]
    const model = modelManager.getModel(blockState.Name)
    const buffers = model.getBuffers(blockAtlas, indexOffset, b.pos[0], b.pos[1], b.pos[2], b.state)
    positions.push(...buffers.position)
    textureCoordinates.push(...buffers.texCoord)
    indices.push(...buffers.index)
    indexOffset += buffers.texCoord.length / 2
  }

  return {
    position: createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(positions)),
    textureCoord: createBuffer(gl, gl.ARRAY_BUFFER, new Float32Array(textureCoordinates)),
    indices: createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices)),
    length: indices.length
  };
}

function initGl(gl: GL, shaderProgram: WebGLProgram) {
  const buffers = initBuffers(gl)
  
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clearDepth(1.0);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const fieldOfView = 70 * Math.PI / 180;
  const aspect = (gl.canvas as HTMLCanvasElement).clientWidth / (gl.canvas as HTMLCanvasElement).clientHeight;
  const projMatrix = mat4.create();
  mat4.perspective(projMatrix, fieldOfView, aspect, 0.1, 100.0);

  const vertLoc = gl.getAttribLocation(shaderProgram, 'vertPos')
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
  gl.vertexAttribPointer(vertLoc, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(vertLoc);

  const texCoordLoc = gl.getAttribLocation(shaderProgram, 'texCoord')
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.textureCoord);
  gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(texCoordLoc);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);

  gl.useProgram(shaderProgram);
  
  gl.uniformMatrix4fv(gl.getUniformLocation(shaderProgram, 'mProj'), false, projMatrix);

  return {
    vertexCount: buffers.length
  }
}

function drawScene(gl: GL, viewMatrixLoc: WebGLUniformLocation, vertexCount: number, atlas: WebGLTexture) {
  const viewMatrix = mat4.create();
  mat4.translate(viewMatrix, viewMatrix, [0.0, 0.0, -2.0]);
  mat4.rotate(viewMatrix, viewMatrix, xRotation, [1, 0, 0]);
  mat4.rotate(viewMatrix, viewMatrix, yRotation, [0, 1, 0]);
  mat4.translate(viewMatrix, viewMatrix, [-structure.size[0] / 2, -structure.size[1] / 2, -structure.size[2] / 2]);
  gl.uniformMatrix4fv(viewMatrixLoc, false, viewMatrix);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, atlas);

  gl.drawElements(gl.TRIANGLES, vertexCount, gl.UNSIGNED_SHORT, 0);
}
