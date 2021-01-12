import { mat4 } from "gl-matrix";
import { BlockAtlas } from "./BlockAtlas";
import { BlockModelProvider } from "./BlockModel";
import { BlockDefinitionProvider } from "./BlockDefinition";
import { mergeFloat32Arrays, transformVectors } from "./Util";
import { Structure } from "@webmc/core";
import { ShaderProgram } from "./ShaderProgram";

const vsSource = `
  attribute vec4 vertPos;
  attribute vec2 texCoord;
  attribute vec3 tintColor;

  uniform mat4 mView;
  uniform mat4 mProj;

  varying highp vec2 vTexCoord;
  varying highp vec3 vTintColor;

  void main(void) {
    gl_Position = mProj * mView * vertPos;
    vTexCoord = texCoord;
    vTintColor = tintColor;
  }
`;

const fsSource = `
  precision highp float;
  varying highp vec2 vTexCoord;
  varying highp vec3 vTintColor;

  uniform sampler2D sampler;

  void main(void) {
    vec4 texColor = texture2D(sampler, vTexCoord);
    gl_FragColor = vec4(texColor.xyz * vTintColor, texColor.a);
  }
`;

const vsGrid = `
  attribute vec4 vertPos;
  attribute vec3 vertColor;

  uniform mat4 mView;
  uniform mat4 mProj;

  varying highp vec3 vColor;

  void main(void) {
    gl_Position = mProj * mView * vertPos;
    vColor = vertColor;
  }
`

const fsGrid = `
  precision highp float;
  varying highp vec3 vColor;

  void main(void) {
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

type StructureBuffers = {
  position: WebGLBuffer
  texCoord: WebGLBuffer
  tintColor: WebGLBuffer
  index: WebGLBuffer
  length: number
}

type GridBuffers = {
  position: WebGLBuffer
  color: WebGLBuffer
  length: number
}

export class StructureRenderer {
  private shaderProgram: WebGLProgram
  private gridShaderProgram: WebGLProgram

  private structureBuffers: StructureBuffers
  private gridBuffers: GridBuffers
  private atlasTexture: WebGLTexture
  private projMatrix: mat4
  private activeShader: WebGLProgram

  constructor(
    private gl: WebGLRenderingContext,
    private blockDefinitionProvider: BlockDefinitionProvider,
    private blockModelProvider: BlockModelProvider, 
    private blockAtlas: BlockAtlas,
    private structure: Structure
  ) {
    this.shaderProgram = new ShaderProgram(gl, vsSource, fsSource).getProgram()
    this.gridShaderProgram = new ShaderProgram(gl, vsGrid, fsGrid).getProgram()

    this.structureBuffers = this.getStructureBuffers()
    this.gridBuffers = this.getGridBuffers()
    this.atlasTexture = this.getBlockTexture()
    this.projMatrix = this.getPerspective()
    this.activeShader = this.shaderProgram
    this.initialize()
  }

  public setStructure(structure: Structure) {
    this.structure = structure
    this.structureBuffers = this.getStructureBuffers()
    this.gridBuffers = this.getGridBuffers()
  }

  private initialize() {
    this.gl.enable(this.gl.DEPTH_TEST)
    this.gl.depthFunc(this.gl.LEQUAL)

    this.gl.enable(this.gl.BLEND)
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA)

    this.gl.enable(this.gl.CULL_FACE)
    this.gl.cullFace(this.gl.BACK)
  }

  private getBlockTexture() {
    const texture = this.gl.createTexture()!;
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.blockAtlas.getImageData());
    this.gl.generateMipmap(this.gl.TEXTURE_2D);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    return texture
  }

  private getPerspective() {
    const fieldOfView = 70 * Math.PI / 180;
    const aspect = (this.gl.canvas as HTMLCanvasElement).clientWidth / (this.gl.canvas as HTMLCanvasElement).clientHeight;
    const projMatrix = mat4.create();
    mat4.perspective(projMatrix, fieldOfView, aspect, 0.1, 100.0);
    return projMatrix
  }

  private getStructureBuffers(): StructureBuffers {
    const positions = []
    const textureCoordinates = []
    const tintColors = []
    const indices = []
    let indexOffset = 0

    let buffers
    for (const b of this.structure.getBlocks()) {
      try {
        const blockDefinition = this.blockDefinitionProvider.getBlockDefinition(b.state.getName())
        if (!blockDefinition) {
          continue
        }
        buffers = blockDefinition.getBuffers(b.state.getName(), b.state.getProperties(), this.blockAtlas, this.blockModelProvider, indexOffset)
        const t = mat4.create()
        mat4.translate(t, t, b.pos)
        transformVectors(buffers.position, t)
      } catch(e) {
        console.error(e)
        continue
      }
      positions.push(buffers.position)
      textureCoordinates.push(...buffers.texCoord)
      tintColors.push(...buffers.tintColor)
      indices.push(...buffers.index)
      indexOffset += buffers.texCoord.length / 2
    }

    return {
      position: this.createBuffer(this.gl.ARRAY_BUFFER, mergeFloat32Arrays(...positions)),
      texCoord: this.createBuffer(this.gl.ARRAY_BUFFER, new Float32Array(textureCoordinates)),
      tintColor: this.createBuffer(this.gl.ARRAY_BUFFER, new Float32Array(tintColors)),
      index: this.createBuffer(this.gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices)),
      length: indices.length
    };
  }

  private getGridBuffers(): GridBuffers {
    const [X, Y, Z] = this.structure.getSize()
    const position: number[] = []
    const color: number[] = []

    position.push(0, 0, 0, X, 0, 0)
    color.push(1, 0, 0, 1, 0, 0)

    position.push(0, 0, 0, 0, 0, Z)
    color.push(0, 0, 1, 0, 0, 1)

    position.push(0, 0, 0, 0, Y, 0)
    position.push(X, 0, 0, X, Y, 0)
    position.push(0, 0, Z, 0, Y, Z)
    position.push(X, 0, Z, X, Y, Z)

    position.push(0, Y, 0, 0, Y, Z)
    position.push(X, Y, 0, X, Y, Z)
    position.push(0, Y, 0, X, Y, 0)
    position.push(0, Y, Z, X, Y, Z)

    for (let x = 1; x <= X; x += 1) position.push(x, 0, 0, x, 0, Z)
    for (let z = 1; z <= Z; z += 1) position.push(0, 0, z, X, 0, z)
    for (let i = 0; i < 8 + X + Z; i += 1) color.push(0.8, 0.8, 0.8, 0.8, 0.8, 0.8)

    return {
      position: this.createBuffer(this.gl.ARRAY_BUFFER, new Float32Array(position)),
      color: this.createBuffer(this.gl.ARRAY_BUFFER, new Float32Array(color)),
      length: position.length / 3
    }
  }

  private createBuffer(type: number, array: ArrayBuffer) {
    const buffer = this.gl.createBuffer()!;
    this.gl.bindBuffer(type, buffer);
    this.gl.bufferData(type, array, this.gl.STATIC_DRAW);
    return buffer
  }

  public drawGrid(viewMatrix: mat4) {
    this.setShader(this.gridShaderProgram)

    this.setVertexAttr('vertPos', 3, this.gridBuffers.position)
    this.setVertexAttr('vertColor', 3, this.gridBuffers.color)
    this.setUniform('mView', viewMatrix)
    this.setUniform('mProj', this.projMatrix)

    this.gl.drawArrays(this.gl.LINES, 0, this.gridBuffers.length)
  }

  public drawStructure(viewMatrix: mat4) {
    this.setShader(this.shaderProgram)

    this.gl.activeTexture(this.gl.TEXTURE0)
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.atlasTexture)

    this.setVertexAttr('vertPos', 3, this.structureBuffers.position)
    this.setVertexAttr('texCoord', 2, this.structureBuffers.texCoord)
    this.setVertexAttr('tintColor', 3, this.structureBuffers.tintColor)
    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.structureBuffers.index)
    this.setUniform('mView', viewMatrix)
    this.setUniform('mProj', this.projMatrix)

    this.gl.drawElements(this.gl.TRIANGLES, this.structureBuffers.length, this.gl.UNSIGNED_SHORT, 0)
  }

  public setViewport(x: number, y: number, width: number, height: number) {
    this.gl.viewport(x, y, width, height)
    this.projMatrix = this.getPerspective()
  }

  private setShader(shader: WebGLProgram) {
    this.gl.useProgram(shader)
    this.activeShader = shader
  }

  private setVertexAttr(name: string, size: number, buffer: WebGLBuffer | null) {
    const location = this.gl.getAttribLocation(this.activeShader, name)
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer)
    this.gl.vertexAttribPointer(location, size, this.gl.FLOAT, false, 0, 0)
    this.gl.enableVertexAttribArray(location)
  }

  private setUniform(name: string, value: Float32List) {
    const location = this.gl.getUniformLocation(this.activeShader, name)    
    this.gl.uniformMatrix4fv(location, false, value)
  }
}