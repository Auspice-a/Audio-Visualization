'use client'

import { useEffect, useRef, useCallback } from 'react'

interface FluidConfig {
  SIM_RESOLUTION: number
  DYE_RESOLUTION: number
  CAPTURE_RESOLUTION: number
  DENSITY_DISSIPATION: number
  VELOCITY_DISSIPATION: number
  PRESSURE: number
  PRESSURE_ITERATIONS: number
  CURL: number
  SPLAT_RADIUS: number
  SPLAT_FORCE: number
  SHADING: boolean
  COLORFUL: boolean
  COLOR_UPDATE_SPEED: number
  PAUSED: boolean
  BACK_COLOR: { r: number; g: number; b: number }
  TRANSPARENT: boolean
  BLOOM: boolean
  BLOOM_ITERATIONS: number
  BLOOM_RESOLUTION: number
  BLOOM_INTENSITY: number
  BLOOM_THRESHOLD: number
  BLOOM_SOFT_KNEE: number
  SUNRAYS: boolean
  SUNRAYS_RESOLUTION: number
  SUNRAYS_WEIGHT: number
}

interface Pointer {
  id: number
  texcoordX: number
  texcoordY: number
  prevTexcoordX: number
  prevTexcoordY: number
  deltaX: number
  deltaY: number
  down: boolean
  moved: boolean
  color: { r: number; g: number; b: number }
}

interface FluidSimulationProps {
  audioData?: Uint8Array
  isPlaying?: boolean
  onBeat?: () => void
  triggerSplat?: boolean
}

export default function FluidSimulation({ audioData, isPlaying = false, triggerSplat = false }: FluidSimulationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const configRef = useRef<FluidConfig>({
    SIM_RESOLUTION: 96,
    DYE_RESOLUTION: 256,
    CAPTURE_RESOLUTION: 256,
    DENSITY_DISSIPATION: 1,
    VELOCITY_DISSIPATION: 0.5,
    PRESSURE: 0.5,
    PRESSURE_ITERATIONS: 10,
    CURL: 10,
    SPLAT_RADIUS: 0.15,
    SPLAT_FORCE: 2000,
    SHADING: false,
    COLORFUL: true,
    COLOR_UPDATE_SPEED: 1,
    PAUSED: false,
    BACK_COLOR: { r: 0, g: 0, b: 0 },
    TRANSPARENT: true,
    BLOOM: true,
    BLOOM_ITERATIONS: 2,
    BLOOM_RESOLUTION: 64,
    BLOOM_INTENSITY: 0.2,
    BLOOM_THRESHOLD: 0.9,
    BLOOM_SOFT_KNEE: 0.95,
    SUNRAYS: false,
    SUNRAYS_RESOLUTION: 196,
    SUNRAYS_WEIGHT: 0.0,
  })

  const glRef = useRef<WebGL2RenderingContext | null>(null)
  const pointersRef = useRef<Pointer[]>([])
  const splatStackRef = useRef<number[]>([])
  const lastUpdateTimeRef = useRef<number>(Date.now())
  const colorUpdateTimerRef = useRef<number>(0)
  const animationRef = useRef<number>(0)

  const dyeRef = useRef<any>(null)
  const velocityRef = useRef<any>(null)
  const divergenceRef = useRef<any>(null)
  const curlRef = useRef<any>(null)
  const pressureRef = useRef<any>(null)
  const bloomRef = useRef<any>(null)
  const bloomFramebuffersRef = useRef<any[]>([])
  const sunraysRef = useRef<any>(null)
  const sunraysTempRef = useRef<any>(null)
  const ditheringTextureRef = useRef<any>(null)

  const extRef = useRef<any>(null)
  const programsRef = useRef<any>({})
  const displayMaterialRef = useRef<any>(null)

  const createShader = useCallback((type: number, source: string, keywords?: string[]) => {
    const gl = glRef.current
    if (!gl) return null

    if (keywords) {
      let keywordsString = ''
      keywords.forEach(keyword => {
        keywordsString += '#define ' + keyword + '\n'
      })
      source = keywordsString + source
    }

    const shader = gl.createShader(type)
    gl.shaderSource(shader!, source)
    gl.compileShader(shader!)

    if (!gl.getShaderParameter(shader!, gl.COMPILE_STATUS)) {
      console.error('Shader error:', gl.getShaderInfoLog(shader!))
      return null
    }

    return shader
  }, [])

  const createProgram = useCallback((vertexShader: WebGLShader, fragmentShader: WebGLShader) => {
    const gl = glRef.current
    if (!gl) return null

    const program = gl.createProgram()
    gl.attachShader(program!, vertexShader)
    gl.attachShader(program!, fragmentShader)
    gl.linkProgram(program!)

    if (!gl.getProgramParameter(program!, gl.LINK_STATUS)) {
      console.error('Program error:', gl.getProgramInfoLog(program!))
      return null
    }

    const uniforms: { [key: string]: WebGLUniformLocation } = {}
    const uniformCount = gl.getProgramParameter(program!, gl.ACTIVE_UNIFORMS)
    for (let i = 0; i < uniformCount; i++) {
      const uniformInfo = gl.getActiveUniform(program!, i)
      if (uniformInfo) {
        const uniformName = uniformInfo.name
        uniforms[uniformName] = gl.getUniformLocation(program!, uniformName)!
      }
    }

    return { program, uniforms }
  }, [])

  const createFBO = useCallback((w: number, h: number, internalFormat: number, format: number, type: number, param: number) => {
    const gl = glRef.current
    if (!gl) return null

    gl.activeTexture(gl.TEXTURE0)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null)

    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.viewport(0, 0, w, h)
    gl.clear(gl.COLOR_BUFFER_BIT)

    const texelSizeX = 1.0 / w
    const texelSizeY = 1.0 / h

    return {
      texture,
      fbo,
      width: w,
      height: h,
      texelSizeX,
      texelSizeY,
      attach(id: number) {
        gl.activeTexture(gl.TEXTURE0 + id)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        return id
      }
    }
  }, [])

  const createDoubleFBO = useCallback((w: number, h: number, internalFormat: number, format: number, type: number, param: number) => {
    const fbos = {
      fbo1: createFBO(w, h, internalFormat, format, type, param),
      fbo2: createFBO(w, h, internalFormat, format, type, param)
    }

    return {
      width: w,
      height: h,
      texelSizeX: fbos.fbo1!.texelSizeX,
      texelSizeY: fbos.fbo1!.texelSizeY,
      get read() { return fbos.fbo1! },
      set read(value) { fbos.fbo1 = value },
      get write() { return fbos.fbo2! },
      set write(value) { fbos.fbo2 = value },
      swap() {
        const temp = fbos.fbo1
        fbos.fbo1 = fbos.fbo2
        fbos.fbo2 = temp
      }
    }
  }, [createFBO])

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const gl = glRef.current
    if (!canvas || !gl) return false

    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth * dpr
    const height = canvas.clientHeight * dpr

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      return true
    }
    return false
  }, [])

  const initFramebuffers = useCallback(() => {
    const gl = glRef.current
    const ext = extRef.current
    const config = configRef.current
    if (!gl || !ext) return

    const simRes = {
      width: config.SIM_RESOLUTION,
      height: Math.round(config.SIM_RESOLUTION * (gl.drawingBufferHeight / gl.drawingBufferWidth))
    }
    if (simRes.height < 16) simRes.height = 16
    if (simRes.width < 16) simRes.width = 16

    const dyeRes = {
      width: config.DYE_RESOLUTION,
      height: Math.round(config.DYE_RESOLUTION * (gl.drawingBufferHeight / gl.drawingBufferWidth))
    }

    const texType = ext.halfFloatTexType
    const rgba = ext.formatRGBA
    const rg = ext.formatRG
    const r = ext.formatR
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST

    gl.disable(gl.BLEND)

    dyeRef.current = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering)
    velocityRef.current = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering)
    divergenceRef.current = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST)
    curlRef.current = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST)
    pressureRef.current = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST)

    initBloomFramebuffers()
    initSunraysFramebuffers()
  }, [createFBO, createDoubleFBO])

  const initBloomFramebuffers = useCallback(() => {
    const gl = glRef.current
    const ext = extRef.current
    const config = configRef.current
    if (!gl || !ext) return

    const res = {
      width: config.BLOOM_RESOLUTION,
      height: Math.round(config.BLOOM_RESOLUTION * (gl.drawingBufferHeight / gl.drawingBufferWidth))
    }

    const texType = ext.halfFloatTexType
    const rgba = ext.formatRGBA
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST

    bloomRef.current = createFBO(res.width, res.height, rgba.internalFormat, rgba.format, texType, filtering)

    bloomFramebuffersRef.current.length = 0
    for (let i = 0; i < config.BLOOM_ITERATIONS; i++) {
      const width = res.width >> (i + 1)
      const height = res.height >> (i + 1)
      if (width < 2 || height < 2) break
      const fbo = createFBO(width, height, rgba.internalFormat, rgba.format, texType, filtering)
      bloomFramebuffersRef.current.push(fbo!)
    }
  }, [createFBO])

  const initSunraysFramebuffers = useCallback(() => {
    const gl = glRef.current
    const ext = extRef.current
    const config = configRef.current
    if (!gl || !ext) return

    const res = {
      width: config.SUNRAYS_RESOLUTION,
      height: Math.round(config.SUNRAYS_RESOLUTION * (gl.drawingBufferHeight / gl.drawingBufferWidth))
    }

    const texType = ext.halfFloatTexType
    const r = ext.formatR
    const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST

    sunraysRef.current = createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering)
    sunraysTempRef.current = createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering)
  }, [createFBO])

  const blit = useCallback((target: any, clear = false) => {
    const gl = glRef.current
    if (!gl) return

    if (target == null) {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    } else {
      gl.viewport(0, 0, target.width, target.height)
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
    }
    if (clear) {
      gl.clearColor(0.0, 0.0, 0.0, 1.0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
  }, [])

  const splat = useCallback((x: number, y: number, dx: number, dy: number, color: { r: number; g: number; b: number }) => {
    const gl = glRef.current
    const config = configRef.current
    if (!gl || !programsRef.current.splat) return

    const splatProgram = programsRef.current.splat
    splatProgram.bind()

    gl.uniform1i(splatProgram.uniforms.uTarget, velocityRef.current.read.attach(0))
    gl.uniform1f(splatProgram.uniforms.aspectRatio, gl.drawingBufferWidth / gl.drawingBufferHeight)
    gl.uniform2f(splatProgram.uniforms.point, x, y)
    gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0)
    gl.uniform1f(splatProgram.uniforms.radius, config.SPLAT_RADIUS / 100.0)
    blit(velocityRef.current.write)
    velocityRef.current.swap()

    gl.uniform1i(splatProgram.uniforms.uTarget, dyeRef.current.read.attach(0))
    gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b)
    blit(dyeRef.current.write)
    dyeRef.current.swap()
  }, [blit])

  const generateColor = useCallback(() => {
    const h = Math.random()
    const s = 1.0
    const v = 1.0

    let r, g, b
    const i = Math.floor(h * 6)
    const f = h * 6 - i
    const p = v * (1 - s)
    const q = v * (1 - f * s)
    const t = v * (1 - (1 - f) * s)

    switch (i % 6) {
      case 0: r = v; g = t; b = p; break
      case 1: r = q; g = v; b = p; break
      case 2: r = p; g = v; b = t; break
      case 3: r = p; g = q; b = v; break
      case 4: r = t; g = p; b = v; break
      case 5: r = v; g = p; b = q; break
      default: r = 0; g = 0; b = 0
    }

    return {
      r: r * 0.08,
      g: g * 0.08,
      b: b * 0.08
    }
  }, [])

  const updateKeywords = useCallback(() => {
    const config = configRef.current
    const displayKeywords: string[] = []
    if (config.SHADING) displayKeywords.push('SHADING')
    if (config.BLOOM) displayKeywords.push('BLOOM')
    if (config.SUNRAYS) displayKeywords.push('SUNRAYS')
    displayMaterialRef.current.setKeywords(displayKeywords)
  }, [])

  const applyAudioData = useCallback((data: Uint8Array) => {
    const config = configRef.current
    if (!data || data.length === 0) return

    const totalEnergy = data.reduce((a, b) => a + b, 0) / data.length
    const length = data.length

    const lowEnd = Math.floor(length * 0.15)
    const highEnd = Math.floor(length * 0.85)

    let lowEnergy = 0
    for (let i = 0; i < lowEnd; i++) lowEnergy += data[i]
    lowEnergy /= lowEnd

    let highEnergy = 0
    for (let i = highEnd; i < length; i++) highEnergy += data[i]
    highEnergy /= (length - highEnd)

    config.VELOCITY_DISSIPATION = Math.max(0.3, 0.5 - (totalEnergy / 255) * 0.15)
    config.PRESSURE = 0.5 + (lowEnergy / 255) * 0.2
    config.CURL = 10 + (highEnergy / 255) * 15

    if (totalEnergy > 100 && Math.random() < (totalEnergy / 255) * 0.1) {
      const x = Math.random()
      const y = Math.random()
      const dx = (Math.random() - 0.5) * totalEnergy * 20
      const dy = (Math.random() - 0.5) * totalEnergy * 20
      const color = generateColor()
      color.r *= (totalEnergy / 150)
      color.g *= (totalEnergy / 150)
      color.b *= (totalEnergy / 150)
      splat(x, y, dx, dy, color)
    }
  }, [generateColor, splat])

  const step = useCallback((dt: number) => {
    const gl = glRef.current
    const config = configRef.current
    if (!gl) return

    gl.disable(gl.BLEND)

    const curlProgram = programsRef.current.curl
    curlProgram.bind()
    gl.uniform2f(curlProgram.uniforms.texelSize, velocityRef.current.texelSizeX, velocityRef.current.texelSizeY)
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocityRef.current.read.attach(0))
    blit(curlRef.current)

    const vorticityProgram = programsRef.current.vorticity
    vorticityProgram.bind()
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocityRef.current.texelSizeX, velocityRef.current.texelSizeY)
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocityRef.current.read.attach(0))
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curlRef.current.attach(1))
    gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL)
    gl.uniform1f(vorticityProgram.uniforms.dt, dt)
    blit(velocityRef.current.write)
    velocityRef.current.swap()

    const divergenceProgram = programsRef.current.divergence
    divergenceProgram.bind()
    gl.uniform2f(divergenceProgram.uniforms.texelSize, velocityRef.current.texelSizeX, velocityRef.current.texelSizeY)
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocityRef.current.read.attach(0))
    blit(divergenceRef.current)

    const clearProgram = programsRef.current.clear
    clearProgram.bind()
    gl.uniform1i(clearProgram.uniforms.uTexture, pressureRef.current.read.attach(0))
    gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE)
    blit(pressureRef.current.write)
    pressureRef.current.swap()

    const pressureProgram = programsRef.current.pressure
    pressureProgram.bind()
    gl.uniform2f(pressureProgram.uniforms.texelSize, velocityRef.current.texelSizeX, velocityRef.current.texelSizeY)
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergenceRef.current.attach(0))
    for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(pressureProgram.uniforms.uPressure, pressureRef.current.read.attach(1))
      blit(pressureRef.current.write)
      pressureRef.current.swap()
    }

    const gradientSubtractProgram = programsRef.current.gradientSubtract
    gradientSubtractProgram.bind()
    gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocityRef.current.texelSizeX, velocityRef.current.texelSizeY)
    gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressureRef.current.read.attach(0))
    gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocityRef.current.read.attach(1))
    blit(velocityRef.current.write)
    velocityRef.current.swap()

    const advectionProgram = programsRef.current.advection
    advectionProgram.bind()
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocityRef.current.texelSizeX, velocityRef.current.texelSizeY)
    const velocityId = velocityRef.current.read.attach(0)
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId)
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityId)
    gl.uniform1f(advectionProgram.uniforms.dt, dt)
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION)
    blit(velocityRef.current.write)
    velocityRef.current.swap()

    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityRef.current.read.attach(0))
    gl.uniform1i(advectionProgram.uniforms.uSource, dyeRef.current.read.attach(1))
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION)
    blit(dyeRef.current.write)
    dyeRef.current.swap()
  }, [blit])

  const applyBloom = useCallback((source: any, destination: any) => {
    const gl = glRef.current
    const config = configRef.current
    if (!gl || bloomFramebuffersRef.current.length < 2) return

    let last = destination

    gl.disable(gl.BLEND)
    const bloomPrefilterProgram = programsRef.current.bloomPrefilter
    bloomPrefilterProgram.bind()
    const knee = config.BLOOM_THRESHOLD * config.BLOOM_SOFT_KNEE + 0.0001
    const curve0 = config.BLOOM_THRESHOLD - knee
    const curve1 = knee * 2
    const curve2 = 0.25 / knee
    gl.uniform3f(bloomPrefilterProgram.uniforms.curve, curve0, curve1, curve2)
    gl.uniform1f(bloomPrefilterProgram.uniforms.threshold, config.BLOOM_THRESHOLD)
    gl.uniform1i(bloomPrefilterProgram.uniforms.uTexture, source.attach(0))
    blit(last)

    const bloomBlurProgram = programsRef.current.bloomBlur
    bloomBlurProgram.bind()
    for (let i = 0; i < bloomFramebuffersRef.current.length; i++) {
      const dest = bloomFramebuffersRef.current[i]
      gl.uniform2f(bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY)
      gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0))
      blit(dest)
      last = dest
    }

    gl.blendFunc(gl.ONE, gl.ONE)
    gl.enable(gl.BLEND)

    for (let i = bloomFramebuffersRef.current.length - 2; i >= 0; i--) {
      const baseTex = bloomFramebuffersRef.current[i]
      gl.uniform2f(bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY)
      gl.uniform1i(bloomBlurProgram.uniforms.uTexture, last.attach(0))
      gl.viewport(0, 0, baseTex.width, baseTex.height)
      blit(baseTex)
      last = baseTex
    }

    gl.disable(gl.BLEND)
    const bloomFinalProgram = programsRef.current.bloomFinal
    bloomFinalProgram.bind()
    gl.uniform2f(bloomFinalProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY)
    gl.uniform1i(bloomFinalProgram.uniforms.uTexture, last.attach(0))
    gl.uniform1f(bloomFinalProgram.uniforms.intensity, config.BLOOM_INTENSITY)
    blit(destination)
  }, [blit])

  const applySunrays = useCallback((source: any, mask: any, destination: any) => {
    const gl = glRef.current
    const config = configRef.current
    if (!gl) return

    gl.disable(gl.BLEND)
    const sunraysMaskProgram = programsRef.current.sunraysMask
    sunraysMaskProgram.bind()
    gl.uniform1i(sunraysMaskProgram.uniforms.uTexture, source.attach(0))
    blit(mask)

    const sunraysProgram = programsRef.current.sunrays
    sunraysProgram.bind()
    gl.uniform1f(sunraysProgram.uniforms.weight, config.SUNRAYS_WEIGHT)
    gl.uniform1i(sunraysProgram.uniforms.uTexture, mask.attach(0))
    blit(destination)
  }, [blit])

  const drawDisplay = useCallback((target: any) => {
    const gl = glRef.current
    const config = configRef.current
    if (!gl) return

    const width = target == null ? gl.drawingBufferWidth : target.width
    const height = target == null ? gl.drawingBufferHeight : target.height

    displayMaterialRef.current.bind()
    if (config.SHADING) {
      gl.uniform2f(displayMaterialRef.current.uniforms.texelSize, 1.0 / width, 1.0 / height)
    }
    gl.uniform1i(displayMaterialRef.current.uniforms.uTexture, dyeRef.current.read.attach(0))
    if (config.BLOOM) {
      gl.uniform1i(displayMaterialRef.current.uniforms.uBloom, bloomRef.current.attach(1))
      gl.uniform1i(displayMaterialRef.current.uniforms.uDithering, ditheringTextureRef.current.attach(2))
      const scaleX = ditheringTextureRef.current.width / width
      const scaleY = ditheringTextureRef.current.height / height
      gl.uniform2f(displayMaterialRef.current.uniforms.ditherScale, scaleX, scaleY)
    }
    if (config.SUNRAYS) {
      gl.uniform1i(displayMaterialRef.current.uniforms.uSunrays, sunraysRef.current.attach(3))
    }
    blit(target)
  }, [blit])

  const render = useCallback((target: any) => {
    const gl = glRef.current
    const config = configRef.current
    if (!gl) return

    if (config.BLOOM) applyBloom(dyeRef.current.read, bloomRef.current)
    if (config.SUNRAYS) {
      applySunrays(dyeRef.current.read, dyeRef.current.write, sunraysRef.current)
    }

    if (target == null || !config.TRANSPARENT) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.enable(gl.BLEND)
    } else {
      gl.disable(gl.BLEND)
    }

    drawDisplay(target)
  }, [applyBloom, applySunrays, drawDisplay])

  const update = useCallback(() => {
    const config = configRef.current

    const now = Date.now()
    const dt = Math.min((now - lastUpdateTimeRef.current) / 1000, 0.016666)
    lastUpdateTimeRef.current = now

    if (resizeCanvas()) {
      initFramebuffers()
    }

    if (config.COLORFUL) {
      colorUpdateTimerRef.current += dt * config.COLOR_UPDATE_SPEED
      if (colorUpdateTimerRef.current >= 1) {
        colorUpdateTimerRef.current = ((colorUpdateTimerRef.current - 1) % 1) + 0
        pointersRef.current.forEach(p => {
          p.color = generateColor()
        })
      }
    }

    if (splatStackRef.current.length > 0) {
      const amount = Math.min(splatStackRef.current.pop()!, 5)
      for (let i = 0; i < amount; i++) {
        const color = generateColor()
        color.r *= 5
        color.g *= 5
        color.b *= 5
        const x = Math.random()
        const y = Math.random()
        const dx = 500 * (Math.random() - 0.5)
        const dy = 500 * (Math.random() - 0.5)
        splat(x, y, dx, dy, color)
      }
    }

    pointersRef.current.forEach(p => {
      if (p.moved) {
        p.moved = false
        const dx = p.deltaX * config.SPLAT_FORCE
        const dy = p.deltaY * config.SPLAT_FORCE
        splat(p.texcoordX, p.texcoordY, dx, dy, p.color)
      }
    })

    if (!config.PAUSED) {
      step(dt)
    }

    render(null)

    animationRef.current = requestAnimationFrame(update)
  }, [resizeCanvas, initFramebuffers, generateColor, splat, step, render])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false }
    const webgl2Ctx = canvas.getContext('webgl2', params) as WebGL2RenderingContext | null
    const webglCtx = canvas.getContext('webgl', params) as WebGLRenderingContext | null
    const gl = webgl2Ctx || webglCtx as WebGL2RenderingContext | null
    if (!gl) {
      console.error('WebGL not supported')
      return
    }

    glRef.current = gl

    let supportLinearFiltering = false
    if (webgl2Ctx) {
      webgl2Ctx.getExtension('EXT_color_buffer_float')
      supportLinearFiltering = !!webgl2Ctx.getExtension('OES_texture_float_linear')
    } else if (webglCtx) {
      const halfFloat = webglCtx.getExtension('OES_texture_half_float')
      supportLinearFiltering = !!webglCtx.getExtension('OES_texture_half_float_linear')
    }

    gl.clearColor(0.0, 0.0, 0.0, 1.0)

    const isWebGL2 = !!webgl2Ctx
    const halfFloatTexType = isWebGL2 
      ? webgl2Ctx.HALF_FLOAT 
      : (webglCtx!.getExtension('OES_texture_half_float') as any).HALF_FLOAT_OES

    let formatRGBA: any, formatRG: any, formatR: any
    if (isWebGL2) {
      formatRGBA = { internalFormat: webgl2Ctx.RGBA16F, format: webgl2Ctx.RGBA }
      formatRG = { internalFormat: webgl2Ctx.RG16F, format: webgl2Ctx.RG }
      formatR = { internalFormat: webgl2Ctx.R16F, format: webgl2Ctx.RED }
    } else {
      formatRGBA = { internalFormat: webglCtx!.RGBA, format: webglCtx!.RGBA }
      formatRG = { internalFormat: webglCtx!.RGBA, format: webglCtx!.RGBA }
      formatR = { internalFormat: webglCtx!.RGBA, format: webglCtx!.RGBA }
    }

    extRef.current = {
      formatRGBA,
      formatRG,
      formatR,
      halfFloatTexType,
      supportLinearFiltering
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.enableVertexAttribArray(0)

    const baseVertexShader = createShader(gl.VERTEX_SHADER, `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform vec2 texelSize;
      void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `)

    const blurVertexShader = createShader(gl.VERTEX_SHADER, `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      uniform vec2 texelSize;
      void main () {
        vUv = aPosition * 0.5 + 0.5;
        float offset = 1.33333333;
        vL = vUv - texelSize * offset;
        vR = vUv + texelSize * offset;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `)

    const blurShader = createShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      uniform sampler2D uTexture;
      void main () {
        vec4 sum = texture2D(uTexture, vUv) * 0.29411764;
        sum += texture2D(uTexture, vL) * 0.35294117;
        sum += texture2D(uTexture, vR) * 0.35294117;
        gl_FragColor = sum;
      }
    `)

    const copyShader = createShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      uniform sampler2D uTexture;
      void main () {
        gl_FragColor = texture2D(uTexture, vUv);
      }
    `)

    const clearShader = createShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      uniform sampler2D uTexture;
      uniform float value;
      void main () {
        gl_FragColor = value * texture2D(uTexture, vUv);
      }
    `)

    const splatShader = createShader(gl.FRAGMENT_SHADER, `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTarget;
      uniform float aspectRatio;
      uniform vec3 color;
      uniform vec2 point;
      uniform float radius;
      void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
      }
    `)

    const advectionShader = createShader(gl.FRAGMENT_SHADER, `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform vec2 texelSize;
      uniform float dt;
      uniform float dissipation;
      void main () {
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        vec4 result = texture2D(uSource, coord);
        float decay = 1.0 + dissipation * dt;
        gl_FragColor = result / decay;
      }
    `)

    const divergenceShader = createShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;
        vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) L = -C.x;
        if (vR.x > 1.0) R = -C.x;
        if (vT.y > 1.0) T = -C.y;
        if (vB.y < 0.0) B = -C.y;
        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
      }
    `)

    const curlShader = createShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
      }
    `)

    const vorticityShader = createShader(gl.FRAGMENT_SHADER, `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uVelocity;
      uniform sampler2D uCurl;
      uniform float curl;
      uniform float dt;
      void main () {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity += force * dt;
        velocity = min(max(velocity, -1000.0), 1000.0);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `)

    const pressureShader = createShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;
      void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float C = texture2D(uPressure, vUv).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
      }
    `)

    const gradientSubtractShader = createShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying highp vec2 vUv;
      varying highp vec2 vL;
      varying highp vec2 vR;
      varying highp vec2 vT;
      varying highp vec2 vB;
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `)

    const bloomPrefilterShader = createShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform vec3 curve;
      uniform float threshold;
      void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        float br = max(c.r, max(c.g, c.b));
        float rq = clamp(br - curve.x, 0.0, curve.y);
        rq = curve.z * rq * rq;
        c *= max(rq, br - threshold) / max(br, 0.0001);
        gl_FragColor = vec4(c, 0.0);
      }
    `)

    const bloomBlurShader = createShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uTexture;
      void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, vL);
        sum += texture2D(uTexture, vR);
        sum += texture2D(uTexture, vT);
        sum += texture2D(uTexture, vB);
        sum *= 0.25;
        gl_FragColor = sum;
      }
    `)

    const bloomFinalShader = createShader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      precision mediump sampler2D;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uTexture;
      uniform float intensity;
      void main () {
        vec4 sum = vec4(0.0);
        sum += texture2D(uTexture, vL);
        sum += texture2D(uTexture, vR);
        sum += texture2D(uTexture, vT);
        sum += texture2D(uTexture, vB);
        sum *= 0.25;
        gl_FragColor = sum * intensity;
      }
    `)

    const sunraysMaskShader = createShader(gl.FRAGMENT_SHADER, `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      void main () {
        vec4 c = texture2D(uTexture, vUv);
        float br = max(c.r, max(c.g, c.b));
        c.a = 1.0 - min(max(br * 20.0, 0.0), 0.8);
        gl_FragColor = c;
      }
    `)

    const sunraysShader = createShader(gl.FRAGMENT_SHADER, `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform float weight;
      #define ITERATIONS 16
      void main () {
        float Density = 0.3;
        float Decay = 0.95;
        float Exposure = 0.7;
        vec2 coord = vUv;
        vec2 dir = vUv - 0.5;
        dir *= 1.0 / float(ITERATIONS) * Density;
        float illuminationDecay = 1.0;
        float color = texture2D(uTexture, vUv).a;
        for (int i = 0; i < ITERATIONS; i++) {
          coord -= dir;
          float col = texture2D(uTexture, coord).a;
          color += col * illuminationDecay * weight;
          illuminationDecay *= Decay;
        }
        gl_FragColor = vec4(color * Exposure, 0.0, 0.0, 1.0);
      }
    `)

    const displayShaderSource = `
      precision highp float;
      precision highp sampler2D;
      varying vec2 vUv;
      varying vec2 vL;
      varying vec2 vR;
      varying vec2 vT;
      varying vec2 vB;
      uniform sampler2D uTexture;
      uniform sampler2D uBloom;
      uniform sampler2D uSunrays;
      uniform sampler2D uDithering;
      uniform vec2 ditherScale;
      uniform vec2 texelSize;
      vec3 linearToGamma (vec3 color) {
        color = max(color, vec3(0));
        return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0));
      }
      void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        #ifdef SHADING
          vec3 lc = texture2D(uTexture, vL).rgb;
          vec3 rc = texture2D(uTexture, vR).rgb;
          vec3 tc = texture2D(uTexture, vT).rgb;
          vec3 bc = texture2D(uTexture, vB).rgb;
          float dx = length(rc) - length(lc);
          float dy = length(tc) - length(bc);
          vec3 n = normalize(vec3(dx, dy, length(texelSize)));
          vec3 l = vec3(0.0, 0.0, 1.0);
          float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
          c *= diffuse;
        #endif
        #ifdef BLOOM
          vec3 bloom = texture2D(uBloom, vUv).rgb;
        #endif
        #ifdef SUNRAYS
          float sunrays = texture2D(uSunrays, vUv).r;
          c *= sunrays;
          #ifdef BLOOM
            bloom *= sunrays;
          #endif
        #endif
        #ifdef BLOOM
          float noise = texture2D(uDithering, vUv * ditherScale).r;
          noise = noise * 2.0 - 1.0;
          bloom += noise / 255.0;
          bloom = linearToGamma(bloom);
          c += bloom;
        #endif
        float a = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c, a);
      }
    `

    const blurProgram = createProgram(blurVertexShader!, blurShader!)
    const copyProgram = createProgram(baseVertexShader!, copyShader!)
    const clearProgram = createProgram(baseVertexShader!, clearShader!)
    const splatProgram = createProgram(baseVertexShader!, splatShader!)
    const advectionProgram = createProgram(baseVertexShader!, advectionShader!)
    const divergenceProgram = createProgram(baseVertexShader!, divergenceShader!)
    const curlProgram = createProgram(baseVertexShader!, curlShader!)
    const vorticityProgram = createProgram(baseVertexShader!, vorticityShader!)
    const pressureProgram = createProgram(baseVertexShader!, pressureShader!)
    const gradientSubtractProgram = createProgram(baseVertexShader!, gradientSubtractShader!)
    const bloomPrefilterProgram = createProgram(baseVertexShader!, bloomPrefilterShader!)
    const bloomBlurProgram = createProgram(baseVertexShader!, bloomBlurShader!)
    const bloomFinalProgram = createProgram(baseVertexShader!, bloomFinalShader!)
    const sunraysMaskProgram = createProgram(baseVertexShader!, sunraysMaskShader!)
    const sunraysProgram = createProgram(baseVertexShader!, sunraysShader!)

    programsRef.current = {
      blur: { program: blurProgram!.program, uniforms: blurProgram!.uniforms, bind: () => gl.useProgram(blurProgram!.program) },
      copy: { program: copyProgram!.program, uniforms: copyProgram!.uniforms, bind: () => gl.useProgram(copyProgram!.program) },
      clear: { program: clearProgram!.program, uniforms: clearProgram!.uniforms, bind: () => gl.useProgram(clearProgram!.program) },
      splat: { program: splatProgram!.program, uniforms: splatProgram!.uniforms, bind: () => gl.useProgram(splatProgram!.program) },
      advection: { program: advectionProgram!.program, uniforms: advectionProgram!.uniforms, bind: () => gl.useProgram(advectionProgram!.program) },
      divergence: { program: divergenceProgram!.program, uniforms: divergenceProgram!.uniforms, bind: () => gl.useProgram(divergenceProgram!.program) },
      curl: { program: curlProgram!.program, uniforms: curlProgram!.uniforms, bind: () => gl.useProgram(curlProgram!.program) },
      vorticity: { program: vorticityProgram!.program, uniforms: vorticityProgram!.uniforms, bind: () => gl.useProgram(vorticityProgram!.program) },
      pressure: { program: pressureProgram!.program, uniforms: pressureProgram!.uniforms, bind: () => gl.useProgram(pressureProgram!.program) },
      gradientSubtract: { program: gradientSubtractProgram!.program, uniforms: gradientSubtractProgram!.uniforms, bind: () => gl.useProgram(gradientSubtractProgram!.program) },
      bloomPrefilter: { program: bloomPrefilterProgram!.program, uniforms: bloomPrefilterProgram!.uniforms, bind: () => gl.useProgram(bloomPrefilterProgram!.program) },
      bloomBlur: { program: bloomBlurProgram!.program, uniforms: bloomBlurProgram!.uniforms, bind: () => gl.useProgram(bloomBlurProgram!.program) },
      bloomFinal: { program: bloomFinalProgram!.program, uniforms: bloomFinalProgram!.uniforms, bind: () => gl.useProgram(bloomFinalProgram!.program) },
      sunraysMask: { program: sunraysMaskProgram!.program, uniforms: sunraysMaskProgram!.uniforms, bind: () => gl.useProgram(sunraysMaskProgram!.program) },
      sunrays: { program: sunraysProgram!.program, uniforms: sunraysProgram!.uniforms, bind: () => gl.useProgram(sunraysProgram!.program) },
    }

    class Material {
      gl: WebGL2RenderingContext | WebGLRenderingContext
      vertexShader: WebGLShader
      fragmentShaderSource: string
      programs: { [key: number]: WebGLProgram } = {}
      activeProgram: WebGLProgram | null = null
      uniforms: { [key: string]: WebGLUniformLocation } = {}

      constructor(gl: WebGL2RenderingContext | WebGLRenderingContext, vertexShader: WebGLShader, fragmentShaderSource: string) {
        this.gl = gl
        this.vertexShader = vertexShader
        this.fragmentShaderSource = fragmentShaderSource
      }

      setKeywords(keywords: string[]) {
        let hash = 0
        for (let i = 0; i < keywords.length; i++) {
          hash += keywords[i].length
        }

        let program = this.programs[hash]
        if (!program) {
          let keywordsString = ''
          keywords.forEach(keyword => {
            keywordsString += '#define ' + keyword + '\n'
          })
          const fragmentShader = this.gl.createShader(this.gl.FRAGMENT_SHADER)!
          this.gl.shaderSource(fragmentShader, keywordsString + this.fragmentShaderSource)
          this.gl.compileShader(fragmentShader)
          program = this.gl.createProgram()!
          this.gl.attachShader(program, this.vertexShader)
          this.gl.attachShader(program, fragmentShader)
          this.gl.linkProgram(program)

          const uniforms: { [key: string]: WebGLUniformLocation } = {}
          const uniformCount = this.gl.getProgramParameter(program, this.gl.ACTIVE_UNIFORMS)
          for (let i = 0; i < uniformCount; i++) {
            const uniformInfo = this.gl.getActiveUniform(program, i)
            if (uniformInfo) {
              const uniformName = uniformInfo.name
              uniforms[uniformName] = this.gl.getUniformLocation(program, uniformName)!
            }
          }
          this.uniforms = uniforms
          this.programs[hash] = program
        }

        if (program === this.activeProgram) return
        this.uniforms = {}
        const uniformCount = this.gl.getProgramParameter(program, this.gl.ACTIVE_UNIFORMS)
        for (let i = 0; i < uniformCount; i++) {
          const uniformInfo = this.gl.getActiveUniform(program, i)
          if (uniformInfo) {
            const uniformName = uniformInfo.name
            this.uniforms[uniformName] = this.gl.getUniformLocation(program, uniformName)!
          }
        }
        this.activeProgram = program
      }

      bind() {
        if (this.activeProgram) {
          this.gl.useProgram(this.activeProgram)
        }
      }
    }

    displayMaterialRef.current = new Material(gl, baseVertexShader!, displayShaderSource)

    const ditheringTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, ditheringTexture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255]))

    ditheringTextureRef.current = {
      texture: ditheringTexture,
      width: 1,
      height: 1,
      attach(id: number) {
        gl.activeTexture(gl.TEXTURE0 + id)
        gl.bindTexture(gl.TEXTURE_2D, ditheringTexture)
        return id
      }
    }

    const image = new Image()
    image.onload = () => {
      ditheringTextureRef.current.width = image.width
      ditheringTextureRef.current.height = image.height
      gl.bindTexture(gl.TEXTURE_2D, ditheringTexture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image)
    }
    image.src = '/LDR_LLL1_0.png'

    pointersRef.current = [{
      id: -1,
      texcoordX: 0,
      texcoordY: 0,
      prevTexcoordX: 0,
      prevTexcoordY: 0,
      deltaX: 0,
      deltaY: 0,
      down: false,
      moved: false,
      color: generateColor()
    }]

    initFramebuffers()
    updateKeywords()

    const amount = Math.floor(Math.random() * 20) + 5
    for (let i = 0; i < amount; i++) {
      const color = generateColor()
      color.r *= 10
      color.g *= 10
      color.b *= 10
      const x = Math.random()
      const y = Math.random()
      const dx = 1000 * (Math.random() - 0.5)
      const dy = 1000 * (Math.random() - 0.5)
      splat(x, y, dx, dy, color)
    }

    const handleMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const posX = e.clientX - rect.left
      const posY = e.clientY - rect.top
      const pointer = pointersRef.current.find(p => p.id === -1) || {
        id: -1,
        texcoordX: 0,
        texcoordY: 0,
        prevTexcoordX: 0,
        prevTexcoordY: 0,
        deltaX: 0,
        deltaY: 0,
        down: false,
        moved: false,
        color: generateColor()
      }
      pointer.id = -1
      pointer.down = true
      pointer.moved = false
      pointer.texcoordX = posX / canvas.clientWidth
      pointer.texcoordY = 1.0 - posY / canvas.clientHeight
      pointer.prevTexcoordX = pointer.texcoordX
      pointer.prevTexcoordY = pointer.texcoordY
      pointer.deltaX = 0
      pointer.deltaY = 0
      pointer.color = generateColor()
      if (!pointersRef.current.find(p => p.id === -1)) {
        pointersRef.current.push(pointer)
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      const pointer = pointersRef.current[0]
      if (!pointer.down) return
      const rect = canvas.getBoundingClientRect()
      const posX = e.clientX - rect.left
      const posY = e.clientY - rect.top
      pointer.prevTexcoordX = pointer.texcoordX
      pointer.prevTexcoordY = pointer.texcoordY
      pointer.texcoordX = posX / canvas.clientWidth
      pointer.texcoordY = 1.0 - posY / canvas.clientHeight
      pointer.deltaX = pointer.texcoordX - pointer.prevTexcoordX
      pointer.deltaY = pointer.texcoordY - pointer.prevTexcoordY
      pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0
    }

    const handleMouseUp = () => {
      pointersRef.current[0].down = false
    }

    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault()
      const touches = e.targetTouches
      while (touches.length >= pointersRef.current.length) {
        pointersRef.current.push({
          id: -1,
          texcoordX: 0,
          texcoordY: 0,
          prevTexcoordX: 0,
          prevTexcoordY: 0,
          deltaX: 0,
          deltaY: 0,
          down: false,
          moved: false,
          color: generateColor()
        })
      }
      for (let i = 0; i < touches.length; i++) {
        const rect = canvas.getBoundingClientRect()
        const posX = touches[i].clientX - rect.left
        const posY = touches[i].clientY - rect.top
        const pointer = pointersRef.current[i + 1]
        pointer.id = touches[i].identifier
        pointer.down = true
        pointer.moved = false
        pointer.texcoordX = posX / canvas.clientWidth
        pointer.texcoordY = 1.0 - posY / canvas.clientHeight
        pointer.prevTexcoordX = pointer.texcoordX
        pointer.prevTexcoordY = pointer.texcoordY
        pointer.deltaX = 0
        pointer.deltaY = 0
        pointer.color = generateColor()
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      const touches = e.targetTouches
      for (let i = 0; i < touches.length; i++) {
        const pointer = pointersRef.current[i + 1]
        if (!pointer.down) continue
        const rect = canvas.getBoundingClientRect()
        const posX = touches[i].clientX - rect.left
        const posY = touches[i].clientY - rect.top
        pointer.prevTexcoordX = pointer.texcoordX
        pointer.prevTexcoordY = pointer.texcoordY
        pointer.texcoordX = posX / canvas.clientWidth
        pointer.texcoordY = 1.0 - posY / canvas.clientHeight
        pointer.deltaX = pointer.texcoordX - pointer.prevTexcoordX
        pointer.deltaY = pointer.texcoordY - pointer.prevTexcoordY
        pointer.moved = Math.abs(pointer.deltaX) > 0 || Math.abs(pointer.deltaY) > 0
      }
    }

    const handleTouchEnd = (e: TouchEvent) => {
      const touches = e.changedTouches
      for (let i = 0; i < touches.length; i++) {
        const pointer = pointersRef.current.find(p => p.id === touches[i].identifier)
        if (pointer) pointer.down = false
      }
    }

    canvas.addEventListener('mousedown', handleMouseDown)
    canvas.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false })
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false })
    window.addEventListener('touchend', handleTouchEnd)

    lastUpdateTimeRef.current = Date.now()
    animationRef.current = requestAnimationFrame(update)

    return () => {
      cancelAnimationFrame(animationRef.current)
      canvas.removeEventListener('mousedown', handleMouseDown)
      canvas.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      canvas.removeEventListener('touchstart', handleTouchStart)
      canvas.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [initFramebuffers, updateKeywords, generateColor, splat, update])

  useEffect(() => {
    if (isPlaying && audioData) {
      applyAudioData(audioData)
    }
  }, [audioData, isPlaying, applyAudioData])

  useEffect(() => {
    if (triggerSplat) {
      splatStackRef.current.push(15 + Math.floor(Math.random() * 15))
    }
  }, [triggerSplat])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ zIndex: -1 }}
    />
  )
}