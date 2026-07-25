"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import FluidSimulation from '../components/FluidSimulation'
import BeatEffectsCanvas from '../components/BeatEffectsCanvas'

// ==================== 类型定义 ====================

/**
 * 歌词行接口
 * @param time - 时间戳（秒）
 * @param text - 歌词文本
 */
interface LyricLine {
  time: number
  text: string
}

/**
 * 音频捕获模式
 * none - 未捕获
 * local-file - 本地文件
 * system-audio - 系统内录
 * microphone - 麦克风
 */
type CaptureMode = 'none' | 'local-file' | 'system-audio' | 'microphone'

/**
 * 频谱分析器组件属性
 * @param analyserRef - 音频分析器引用
 */
interface SpectrumAnalyzerProps {
  analyserRef: React.MutableRefObject<AnalyserNode | null>
}

// ==================== 频谱分析器组件 ====================

/**
 * 频谱分析器组件
 * 显示底部实时音频频谱柱状图
 */
function SpectrumAnalyzer({ analyserRef }: SpectrumAnalyzerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !analyserRef.current) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    // 调整画布大小
    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = 120
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    
    // 初始化频率数据数组
    const frequencyData = new Uint8Array(analyserRef.current.frequencyBinCount)
    const bars = 128  // 柱状图数量
    const gap = 1     // 柱间距
    
    let animationId: number
    
    // 渲染循环
    const render = () => {
      if (!analyserRef.current) return
      
      // 获取频率数据
      analyserRef.current.getByteFrequencyData(frequencyData)
      // 清空画布
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      
      // 计算每个柱状图的宽度
      const barWidth = (canvas.width - (bars - 1) * gap) / bars
      
      // 绘制每个柱状图
      for (let i = 0; i < bars; i++) {
        // 获取对应频率的数据
        const dataIndex = Math.floor((i / bars) * frequencyData.length * 0.8)
        const value = frequencyData[dataIndex]
        const height = (value / 255) * canvas.height
        
        // 根据频率设置颜色（彩虹渐变）
        const ratio = i / bars
        let r, g, b
        
        if (ratio < 0.3) {
          // 低频：紫色→红色
          r = Math.floor(255 * (ratio / 0.3))
          g = 0
          b = Math.floor(255 * (1 - ratio / 0.3))
        } else if (ratio < 0.6) {
          // 中频：红色→黄色
          r = 255
          g = Math.floor(255 * ((ratio - 0.3) / 0.3))
          b = 0
        } else {
          // 高频：黄色→青色→蓝色
          r = Math.floor(255 * (1 - (ratio - 0.6) / 0.4))
          g = 255
          b = Math.floor(255 * ((ratio - 0.6) / 0.4))
        }
        
        // 创建渐变效果
        const gradient = ctx.createLinearGradient(0, canvas.height - height, 0, canvas.height)
        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.8)`)  // 顶部明亮
        gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.5)`) // 中部半透明
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.2)`)  // 底部淡出
        
        // 设置样式和发光效果
        ctx.fillStyle = gradient
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.5)`
        ctx.shadowBlur = 10
        
        // 绘制柱状图
        ctx.fillRect(i * (barWidth + gap), canvas.height - height, barWidth, height)
        
        ctx.shadowBlur = 0
        
        // 高能量时添加粒子飞溅效果
        if (height > canvas.height * 0.5) {
          ctx.fillStyle = `rgba(255, 255, 255, ${0.5 - (height / canvas.height)})`
          ctx.beginPath()
          ctx.arc(
            i * (barWidth + gap) + barWidth / 2,
            canvas.height - height,
            2,
            0,
            Math.PI * 2
          )
          ctx.fill()
        }
      }
      
      // 继续下一帧渲染
      animationId = requestAnimationFrame(render)
    }
    
    // 开始渲染
    render()
    
    // 清理函数
    return () => {
      window.removeEventListener('resize', resizeCanvas)
      cancelAnimationFrame(animationId)
    }
  }, [analyserRef])
  
  return (
    <canvas
      ref={canvasRef}
      className="w-full h-[120px]"
      style={{ background: 'linear-gradient(to top, rgba(20,15,40,0.8), transparent)' }}
    />
  )
}

// ==================== 主组件 ====================

/**
 * 主页面组件
 * 包含所有音频可视化功能
 */
export default function Home() {
  // ==================== Ref 引用 ====================
  
  // Canvas 画布引用（Butterchurn 渲染）
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // HTML5 Audio 元素引用（本地文件播放）
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Web Audio API 上下文引用
  const audioContextRef = useRef<AudioContext | null>(null)
  // 音频源节点引用
  const sourceNodeRef = useRef<AudioNode | null>(null)
  // 延迟音频节点引用（用于本地播放同步）
  const delayedAudibleRef = useRef<AudioNode | null>(null)
  // 媒体流引用（系统内录/麦克风）
  const mediaStreamRef = useRef<MediaStream | null>(null)
  // Butterchurn 可视化器引用
  const visualizerRef = useRef<any>(null)
  // Butterchurn 模块引用（动态导入）
  const butterchurnRef = useRef<any>(null)
  // Butterchurn 预设模块引用（动态导入）
  const butterchurnPresetsRef = useRef<any>(null)

  // ==================== 状态管理 ====================
  
  // 播放状态
  const [isPlaying, setIsPlaying] = useState(false)
  // 当前音频名称
  const [audioName, setAudioName] = useState('')
  // 音频是否已加载
  const [isAudioLoaded, setIsAudioLoaded] = useState(false)
  // 当前捕获模式
  const [currentCaptureMode, setCurrentCaptureMode] = useState<CaptureMode>('none')
  // 是否正在捕获音频
  const [isCapturing, setIsCapturing] = useState(false)
  // 歌词数据
  const [lyrics, setLyrics] = useState<LyricLine[]>([])
  // 当前显示的歌词
  const [currentLyric, setCurrentLyric] = useState('')
  // 下一句歌词
  const [nextLyric, setNextLyric] = useState('')
  // 当前播放时间
  const [currentTime, setCurrentTime] = useState(0)
  // 音频总时长
  const [duration, setDuration] = useState(0)
  // 是否显示提示消息
  const [showToast, setShowToast] = useState(false)
  // 提示消息内容
  const [toastMessage, setToastMessage] = useState('')
  // 当前选中的预设名称
  const [selectedPreset, setSelectedPreset] = useState<string>('')
  // 是否显示预设选择面板
  const [showPresets, setShowPresets] = useState(false)
  // 可视化器是否已加载
  const [isVisualizerLoaded, setIsVisualizerLoaded] = useState(false)
  // 是否自动循环预设
  const [presetCycle, setPresetCycle] = useState(true)
  // 是否随机切换预设
  const [presetRandom, setPresetRandom] = useState(true)
  // 预设循环间隔（秒）
  const [presetCycleLength, setPresetCycleLength] = useState(15)
  // 是否全屏
  const [isFullscreen, setIsFullscreen] = useState(false)
  // 所有预设数据
  const [presets, setPresets] = useState<Record<string, any>>({})
  // 鼠标是否活跃（用于自动隐藏界面）
  const [isMouseActive, setIsMouseActive] = useState(true)
  // 当前设置面板标签页
  const [activeSettingsTab, setActiveSettingsTab] = useState<'presets' | 'more' | 'rendering'>('presets')
  // 自动预设过渡时间（秒）
  const [autoBlendTime, setAutoBlendTime] = useState(2.7)
  // 用户手动切换预设过渡时间（秒）
  const [userBlendTime, setUserBlendTime] = useState(5.7)
  // 帧率限制
  const [frameLimit, setFrameLimit] = useState(45)
  // 画布尺寸
  const [canvasSize, setCanvasSize] = useState('4X')
  // 网格尺寸
  const [meshSize, setMeshSize] = useState('48x36')
  
  // 节拍器相关状态
  const [showMetronome, setShowMetronome] = useState(false)
  // 频谱分析器相关状态
  const [showSpectrum, setShowSpectrum] = useState(false)
  // 音频源选择菜单
  const [showAudioSourceMenu, setShowAudioSourceMenu] = useState(false)
  // 频率数据（用于流体模拟）
  const [frequencyData, setFrequencyData] = useState<Uint8Array | undefined>(undefined)
  // 是否显示流体模拟
  const [showFluid, setShowFluid] = useState(true)
  // 触发流体爆炸效果
  const [triggerFluidSplat, setTriggerFluidSplat] = useState(false)
  
  // BPM（每分钟节拍数）
  const [bpm, setBpm] = useState(0)
  // 节拍计数
  const [beatCount, setBeatCount] = useState(0)
  // 是否正在节拍上
  const [isOnBeat, setIsOnBeat] = useState(false)

  // ==================== 额外 Ref 引用 ====================
  
  // 鼠标闲置定时器
  const idleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 音频分析器引用
  const analyserRef = useRef<AnalyserNode | null>(null)

  // ==================== 计算属性 ====================
  
  /**
   * 获取排序后的预设名称列表
   */
  const presetNames = useMemo(() => {
    const names = Object.keys(presets)
    return names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  }, [presets])

  // ==================== 音频工具函数 ====================
  
  /**
   * 初始化音频上下文
   * 创建 AudioContext 和 AnalyserNode
   */
  const initAudioContext = useCallback(() => {
    // 创建或复用 AudioContext
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    
    // 创建 AnalyserNode（用于频谱分析和节拍检测）
    if (!analyserRef.current) {
      analyserRef.current = audioContextRef.current.createAnalyser()
      analyserRef.current.fftSize = 2048           // FFT 大小，决定频率分辨率
      analyserRef.current.smoothingTimeConstant = 0.8 // 平滑系数，使频谱更平滑
    }
    
    return audioContextRef.current
  }, [])

  /**
   * 显示提示消息
   * @param message - 消息内容
   */
  const showToastMessage = useCallback((message: string) => {
    setToastMessage(message)
    setShowToast(true)
    setTimeout(() => {
      setShowToast(false)
    }, 2500)
  }, [])

  /**
   * 清理音频资源
   * 断开所有音频节点，停止媒体流
   */
  const cleanupAudio = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }
    
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect() } catch {}
      sourceNodeRef.current = null
    }
    
    if (delayedAudibleRef.current) {
      try { delayedAudibleRef.current.disconnect() } catch {}
      delayedAudibleRef.current = null
    }
    
    if (visualizerRef.current && typeof visualizerRef.current.disconnectAudio === 'function') {
      try { visualizerRef.current.disconnectAudio() } catch {}
    }
    
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    
    setIsPlaying(false)
    setIsAudioLoaded(false)
    setCurrentCaptureMode('none')
    setIsCapturing(false)
    setAudioName('')
    setCurrentTime(0)
    setDuration(0)
    setCurrentLyric('')
    setNextLyric('')
  }, [])

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    cleanupAudio()
    
    const ctx = initAudioContext()
    const url = URL.createObjectURL(file)
    
    audioRef.current = new Audio()
    audioRef.current.src = url
    audioRef.current.crossOrigin = 'anonymous'
    
    audioRef.current.onloadedmetadata = () => {
      setDuration(audioRef.current?.duration || 0)
      setAudioName(file.name)
      setIsAudioLoaded(true)
      setCurrentCaptureMode('local-file')
      
      const source = ctx.createMediaElementSource(audioRef.current!)
      sourceNodeRef.current = source
      
      if (delayedAudibleRef.current) {
        try { delayedAudibleRef.current.disconnect() } catch {}
      }
      
      delayedAudibleRef.current = ctx.createDelay()
      ;(delayedAudibleRef.current as any).delayTime.value = 0.26
      
      source.connect(delayedAudibleRef.current)
      delayedAudibleRef.current.connect(ctx.destination)
      
      if (analyserRef.current) {
        source.connect(analyserRef.current)
      }
      
      if (visualizerRef.current) {
        visualizerRef.current.connectAudio(delayedAudibleRef.current)
      }
    }
    
    audioRef.current.onerror = () => {
      setAudioName('音频加载失败，请重试')
      setIsAudioLoaded(false)
    }
    
    audioRef.current.ontimeupdate = () => {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime)
      }
    }
    
    audioRef.current.onended = () => {
      setIsPlaying(false)
      setCurrentTime(0)
      if (audioRef.current) {
        audioRef.current.currentTime = 0
      }
    }
    
    event.target.value = ''
  }, [cleanupAudio, initAudioContext])

  const handleCaptureAudio = useCallback(async (sourceType: 'system' | 'microphone') => {
    if (isCapturing) {
      cleanupAudio()
      showToastMessage('已停止音频监听')
      setShowAudioSourceMenu(false)
      return
    }

    const wasLocalFile = currentCaptureMode === 'local-file'
    cleanupAudio()
    
    const ctx = initAudioContext()
    setShowAudioSourceMenu(false)
    
    try {
      let stream: MediaStream
      let mode: 'system-audio' | 'microphone'
      let name: string
      let toast: string
      
      if (sourceType === 'system') {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        })
        stream.getVideoTracks().forEach(track => track.stop())
        mode = 'system-audio'
        name = '🎤 系统声音内录中...'
        toast = '系统内录已启动'
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        mode = 'microphone'
        name = '🎤 麦克风监听中...'
        toast = '麦克风监听已启动'
      }
      
      mediaStreamRef.current = stream
      
      const source = ctx.createMediaStreamSource(stream)
      sourceNodeRef.current = source
      
      const gainNode = ctx.createGain()
      gainNode.gain.value = sourceType === 'microphone' ? 2.0 : 1.25
      source.connect(gainNode)
      
      if (analyserRef.current) {
        source.connect(analyserRef.current)
      }
      
      if (visualizerRef.current) {
        visualizerRef.current.connectAudio(gainNode)
      }
      
      setCurrentCaptureMode(mode)
      setIsCapturing(true)
      setIsAudioLoaded(true)
      setAudioName(name)
      
      if (wasLocalFile) {
        showToastMessage(`已切换到${sourceType === 'system' ? '系统内录' : '麦克风'}模式，本地音频已停止`)
      } else {
        showToastMessage(toast)
      }
      
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }
    } catch (error) {
      setAudioName('无法访问音频设备，请检查权限')
      setIsAudioLoaded(false)
      showToastMessage(`无法访问${sourceType === 'system' ? '系统声音' : '麦克风'}，请检查浏览器权限设置`)
    }
  }, [isCapturing, cleanupAudio, initAudioContext, currentCaptureMode, showToastMessage])

  const parseLRC = useCallback((lrcText: string): LyricLine[] => {
    const lines = lrcText.split('\n')
    const result: LyricLine[] = []
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g
    
    for (const line of lines) {
      const matches = [...line.matchAll(timeRegex)]
      const text = line.replace(timeRegex, '').trim()
      
      if (text && matches.length > 0) {
        for (const match of matches) {
          const minutes = parseInt(match[1])
          const seconds = parseInt(match[2])
          const milliseconds = parseInt(match[3].padEnd(3, '0'))
          const totalTime = minutes * 60 + seconds + milliseconds / 1000
          result.push({ time: totalTime, text })
        }
      }
    }
    
    return result.sort((a, b) => a.time - b.time)
  }, [])

  const handleLyricSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    
    const tryDecode = (content: string) => {
      const hasReplacement = content.includes('\uFFFD')
      if (hasReplacement) {
        return false
      }
      const parsedLyrics = parseLRC(content)
      if (parsedLyrics.length > 0) {
        setLyrics(parsedLyrics)
        setCurrentLyric(parsedLyrics[0].text)
        setNextLyric(parsedLyrics[1]?.text || '')
        showToastMessage(`成功加载 ${parsedLyrics.length} 句歌词`)
      } else {
        showToastMessage('未解析到有效歌词')
      }
      return true
    }
    
    reader.onload = (e) => {
      const arrayBuffer = e.target?.result as ArrayBuffer
      if (!arrayBuffer) return
      
      const textDecoderUtf8 = new TextDecoder('utf-8')
      const utf8Content = textDecoderUtf8.decode(arrayBuffer)
      
      if (!tryDecode(utf8Content)) {
        try {
          const textDecoderGbk = new TextDecoder('gbk')
          const gbkContent = textDecoderGbk.decode(arrayBuffer)
          tryDecode(gbkContent)
        } catch {
          showToastMessage('无法识别歌词文件编码')
        }
      }
    }
    
    reader.readAsArrayBuffer(file)
    event.target.value = ''
  }, [parseLRC, showToastMessage])

  const togglePlay = useCallback(async () => {
    if (currentCaptureMode !== 'local-file') return
    if (!audioRef.current || !isAudioLoaded) return
    
    const ctx = initAudioContext()
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
    
    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current.play()
      setIsPlaying(true)
    }
  }, [currentCaptureMode, isPlaying, isAudioLoaded, initAudioContext])

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (currentCaptureMode !== 'local-file' || !audioRef.current) return
    const time = parseFloat(e.target.value)
    audioRef.current.currentTime = time
    setCurrentTime(time)
  }, [currentCaptureMode])

  const presetIndexRef = useRef(0)
  const presetIndexHistRef = useRef<number[]>([])
  const cycleIntervalRef = useRef<number | null>(null)

  const loadPresetByName = useCallback((presetName: string) => {
    if (!visualizerRef.current || !presets[presetName]) return
    visualizerRef.current.loadPreset(presets[presetName], userBlendTime)
    setSelectedPreset(presetName)
    const index = presetNames.indexOf(presetName)
    if (index !== -1) {
      presetIndexRef.current = index
    }
  }, [presets, presetNames, userBlendTime])

  const nextPreset = useCallback((blendTime = userBlendTime) => {
    if (presetNames.length === 0) return
    
    presetIndexHistRef.current.push(presetIndexRef.current)
    
    if (presetRandom) {
      presetIndexRef.current = Math.floor(Math.random() * presetNames.length)
    } else {
      presetIndexRef.current = (presetIndexRef.current + 1) % presetNames.length
    }
    
    const presetName = presetNames[presetIndexRef.current]
    if (visualizerRef.current && presets[presetName]) {
      visualizerRef.current.loadPreset(presets[presetName], blendTime)
      setSelectedPreset(presetName)
    }
  }, [presetNames, presets, presetRandom])

  const prevPreset = useCallback((blendTime = 5.7) => {
    if (presetNames.length === 0) return
    
    if (presetIndexHistRef.current.length > 0) {
      presetIndexRef.current = presetIndexHistRef.current.pop()!
    } else {
      presetIndexRef.current = ((presetIndexRef.current - 1) + presetNames.length) % presetNames.length
    }
    
    const presetName = presetNames[presetIndexRef.current]
    if (visualizerRef.current && presets[presetName]) {
      visualizerRef.current.loadPreset(presets[presetName], blendTime)
      setSelectedPreset(presetName)
    }
  }, [presetNames, presets])

  const restartCycleInterval = useCallback(() => {
    if (cycleIntervalRef.current) {
      clearInterval(cycleIntervalRef.current)
      cycleIntervalRef.current = null
    }
    
    if (presetCycle && isAudioLoaded) {
      cycleIntervalRef.current = window.setInterval(() => nextPreset(autoBlendTime), presetCycleLength * 1000)
    }
  }, [presetCycle, isAudioLoaded, presetCycleLength, nextPreset, autoBlendTime])

  useEffect(() => {
    restartCycleInterval()
    return () => {
      if (cycleIntervalRef.current) {
        clearInterval(cycleIntervalRef.current)
      }
    }
  }, [restartCycleInterval])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.which === 32 || e.which === 39) {
        e.preventDefault()
        nextPreset()
      } else if (e.which === 8 || e.which === 37) {
        e.preventDefault()
        prevPreset()
      } else if (e.which === 72) {
        e.preventDefault()
        nextPreset(0)
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        const container = document.getElementById('app-container')
        if (container && !document.fullscreenElement) {
          container.requestFullscreen()
        } else if (document.fullscreenElement) {
          document.exitFullscreen()
        }
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [nextPreset, prevPreset])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  useEffect(() => {
    const handleMouseMove = () => {
      setIsMouseActive(true)
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current)
      }
      idleTimeoutRef.current = setTimeout(() => {
        setIsMouseActive(false)
      }, 3000)
    }
    window.addEventListener('mousemove', handleMouseMove)
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-audio-menu]')) {
        setShowAudioSourceMenu(false)
      }
    }
    if (showAudioSourceMenu) {
      window.addEventListener('click', handleClickOutside)
    }
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('click', handleClickOutside)
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (currentCaptureMode !== 'local-file' || lyrics.length === 0) return
    
    const currentIndex = lyrics.findIndex(l => l.time > currentTime)
    
    if (currentIndex === -1) {
      if (lyrics.length > 0) {
        setCurrentLyric(lyrics[lyrics.length - 1].text)
        setNextLyric('')
      }
    } else if (currentIndex === 0) {
      setCurrentLyric('')
      setNextLyric(lyrics[0].text)
    } else {
      setCurrentLyric(lyrics[currentIndex - 1].text)
      setNextLyric(lyrics[currentIndex].text)
    }
  }, [currentTime, currentCaptureMode, lyrics])

  const handleBeat = useCallback(() => {
    setIsOnBeat(true)
    setBeatCount(prev => prev + 1)
    setTimeout(() => setIsOnBeat(false), 100)
    
    if (showFluid) {
      setTriggerFluidSplat(true)
      setTimeout(() => setTriggerFluidSplat(false), 100)
    }
  }, [showFluid])

  const [canvasReady, setCanvasReady] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) {
      setCanvasReady(true)
    }
  }, [])

  useEffect(() => {
    if (!canvasReady) return
    
    const canvas = canvasRef.current
    if (!canvas) return
    
    const loadVisualizer = async () => {
      if (butterchurnRef.current && butterchurnPresetsRef.current) return
      
      const [butterchurnModule, butterchurnPresetsModule] = await Promise.all([
        import('butterchurn'),
        import('butterchurn-presets')
      ])
      
      butterchurnRef.current = butterchurnModule.default || butterchurnModule
      butterchurnPresetsRef.current = butterchurnPresetsModule.default || butterchurnPresetsModule
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      const ctx = initAudioContext()
      
      try {
        canvas.width = window.innerWidth
        canvas.height = window.innerHeight
        
        const gl = canvas.getContext('webgl2', { 
          alpha: true, 
          antialias: false,
          preserveDrawingBuffer: false,
          powerPreference: 'high-performance'
        }) || canvas.getContext('webgl', { 
          alpha: true, 
          antialias: false,
          preserveDrawingBuffer: false,
          powerPreference: 'high-performance'
        })
        
        console.log('WebGL context obtained:', !!gl)
        console.log('Canvas in DOM:', document.body.contains(canvas))
        
        if (!gl) {
          console.error('WebGL not supported or context creation failed')
          return
        }
        
        const visualizer = butterchurnRef.current.createVisualizer(ctx, canvas, {
          width: window.innerWidth,
          height: window.innerHeight,
          pixelRatio: window.devicePixelRatio || 1,
          textureRatio: 1
        })
        
        visualizerRef.current = visualizer
        
        const currentPresets = typeof butterchurnPresetsRef.current.getPresets === 'function' 
          ? butterchurnPresetsRef.current.getPresets() 
          : butterchurnPresetsRef.current
        setPresets(currentPresets)
        const currentPresetNames = Object.keys(currentPresets).sort((a, b) => 
          a.toLowerCase().localeCompare(b.toLowerCase())
        )
        
        if (currentPresetNames.length > 0) {
          presetIndexRef.current = Math.floor(Math.random() * currentPresetNames.length)
          const defaultPreset = currentPresets[currentPresetNames[presetIndexRef.current]]
          if (defaultPreset) {
            visualizer.loadPreset(defaultPreset, 0.0)
            setSelectedPreset(currentPresetNames[presetIndexRef.current])
          }
        }
        
        const render = () => {
          visualizer.render()
          requestAnimationFrame(render)
        }
        render()
        
        const handleResize = () => {
          canvas.width = window.innerWidth
          canvas.height = window.innerHeight
          visualizer.setRendererSize(window.innerWidth, window.innerHeight)
        }
        window.addEventListener('resize', handleResize)
        
        setIsVisualizerLoaded(true)
        
        return () => {
          window.removeEventListener('resize', handleResize)
          visualizer.destroy()
        }
      } catch (error) {
        console.error('Failed to create visualizer:', error)
      }
    }
    
    loadVisualizer()
  }, [canvasReady, initAudioContext])

  useEffect(() => {
    if (!isVisualizerLoaded || isCapturing) return
    
    const startSystemAudioCapture = async () => {
      try {
        const ctx = initAudioContext()
        
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        })
        stream.getVideoTracks().forEach(track => track.stop())
        
        mediaStreamRef.current = stream
        
        const source = ctx.createMediaStreamSource(stream)
        sourceNodeRef.current = source
        
        const gainNode = ctx.createGain()
        gainNode.gain.value = 1.25
        source.connect(gainNode)
        
        if (analyserRef.current) {
          source.connect(analyserRef.current)
        }
        
        if (visualizerRef.current) {
          visualizerRef.current.connectAudio(gainNode)
        }
        
        setCurrentCaptureMode('system-audio')
        setIsCapturing(true)
        setIsAudioLoaded(true)
        setAudioName('🎤 系统声音内录中...')
        
        if (ctx.state === 'suspended') {
          await ctx.resume()
        }
      } catch (error) {
        console.log('系统声音自动监听失败，用户需手动开启')
      }
    }
    
    startSystemAudioCapture()
  }, [isVisualizerLoaded, isCapturing, initAudioContext])

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  const getModeStatus = () => {
    switch (currentCaptureMode) {
      case 'local-file': return '📁 本地文件'
      case 'system-audio': return '🎤 系统内录'
      case 'microphone': return '🎤 麦克风'
      default: return '⏸️ 未加载'
    }
  }

  return (
    <div id="app-container" className="h-screen w-screen bg-[#0A0A1A] flex flex-col overflow-hidden relative">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full z-0"
        style={{
          background: 'transparent',
          opacity: showFluid ? 0.9 : 1
        }}
      />
      
      {showFluid && isAudioLoaded && frequencyData && isVisualizerLoaded && (
        <FluidSimulation audioData={frequencyData} isPlaying={isPlaying} triggerSplat={triggerFluidSplat} />
      )}
      
      <div className="absolute inset-0 bg-gradient-to-b from-[rgba(0,0,0,0.3)] via-transparent to-[rgba(0,0,0,0.5)] z-10 pointer-events-none" />

      <header className={`relative z-20 px-4 py-3 bg-gradient-to-b from-[rgba(20,15,40,0.8)] to-transparent backdrop-blur-md border-b border-[rgba(100,50,255,0.1)] transition-opacity duration-500 ${(!isMouseActive || isFullscreen) ? 'opacity-0 pointer-events-none' : ''}`}>
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#00FF7F] to-[#00CED1] flex items-center justify-center shadow-lg shadow-[rgba(0,255,127,0.4)]">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#0A0A1A]" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 19V5M12 5l-7 7 7 7M12 5l7 7-7 7"/>
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#00FF7F] tracking-wide">幻音视界</h1>
              <p className="text-xs text-[#00CED1]/70">Audio Visualizer</p>
            </div>
          </div>
          
          <button
            onClick={() => setShowPresets(!showPresets)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[rgba(100,50,255,0.3)] hover:bg-[rgba(100,50,255,0.5)] rounded-lg border border-[rgba(100,50,255,0.3)] transition-all duration-300"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#FFD700]" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
            <span className="text-sm text-white/80 hidden md:inline">预设</span>
          </button>
        </div>
      </header>

      <main className="flex-1 relative z-10 flex flex-col justify-center items-center px-4">
        {(currentLyric || nextLyric) && (
          <div className="text-center space-y-2 mb-8">
            <h2 className="text-3xl md:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#FFD700] via-[#FFA500] to-[#FF69B4]">
              {currentLyric}
            </h2>
            {nextLyric && (
              <p className="text-lg text-white/40 animate-pulse">
                {nextLyric}
              </p>
            )}
          </div>
        )}

        {!isAudioLoaded && (
          <div className="flex flex-col items-center gap-6">
            <div className="w-32 h-32 rounded-full bg-gradient-to-br from-[#FFD700]/20 to-[#FF69B4]/20 border-2 border-[rgba(255,215,0,0.3)] flex items-center justify-center animate-pulse">
              <svg viewBox="0 0 24 24" className="w-16 h-16 text-[#FFD700]" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 18V5l12-2v13"/>
                <circle cx="6" cy="18" r="3"/>
                <circle cx="18" cy="16" r="3"/>
              </svg>
            </div>
            <p className="text-white/60 text-sm">
              导入本地 MP3 或开启系统内录
            </p>
          </div>
        )}
      </main>

      {showMetronome && isAudioLoaded && (
        <div className="absolute top-20 right-4 z-30">
          <div className={`bg-[rgba(20,15,40,0.8)] backdrop-blur-md rounded-xl border ${isOnBeat ? 'border-[#FFD700] shadow-lg shadow-[rgba(255,215,0,0.5)]' : 'border-[rgba(100,50,255,0.3)]'} p-4 transition-all duration-100`}>
            <div className="text-center">
              <p className="text-xs text-white/50">BPM</p>
              <p className={`text-3xl font-bold ${isOnBeat ? 'text-[#FFD700] scale-110' : 'text-[#00FF7F]'} transition-all duration-100`}>
                {bpm || '--'}
              </p>
              <p className="text-xs text-white/50 mt-1">Beat: {beatCount}</p>
            </div>
          </div>
        </div>
      )}

      <BeatEffectsCanvas 
        show={showMetronome} 
        isAudioLoaded={isAudioLoaded} 
        analyserRef={analyserRef}
        onBeat={handleBeat}
        onBpmChange={setBpm}
        onFrequencyData={showFluid ? setFrequencyData : undefined}
      />

      {showSpectrum && isAudioLoaded && (
        <div className="absolute bottom-36 left-0 right-0 z-10 px-4">
          <SpectrumAnalyzer analyserRef={analyserRef} />
        </div>
      )}

      <footer className={`relative z-20 px-4 py-4 bg-gradient-to-t from-[rgba(20,15,40,0.9)] to-transparent backdrop-blur-md border-t border-[rgba(100,50,255,0.1)] transition-opacity duration-500 ${(!isMouseActive || isFullscreen) ? 'opacity-0 pointer-events-none' : ''}`}>
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-center gap-3 mb-3 flex-wrap">
            <label className="relative group">
              <input
                type="file"
                accept="audio/mpeg"
                onChange={handleFileSelect}
                className="hidden"
              />
              <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#FFD700] to-[#FFA500] text-[#0A0A1A] rounded-full font-bold cursor-pointer hover:shadow-lg hover:shadow-[rgba(255,215,0,0.4)] transition-all duration-300 hover:scale-105 active:scale-95">
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                </svg>
                <span>导入 MP3</span>
              </div>
            </label>

            <label className="relative group">
              <input
                type="file"
                accept=".lrc"
                onChange={handleLyricSelect}
                className="hidden"
              />
              <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#FF69B4] to-[#9400D3] text-white rounded-full font-bold cursor-pointer hover:shadow-lg hover:shadow-[rgba(255,105,180,0.4)] transition-all duration-300 hover:scale-105 active:scale-95">
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                </svg>
                <span>导入歌词</span>
              </div>
            </label>

            <div className="relative" data-audio-menu>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (isCapturing) {
                    handleCaptureAudio('system')
                  } else {
                    setShowAudioSourceMenu(!showAudioSourceMenu)
                  }
                }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-full font-bold transition-all duration-300 hover:scale-105 active:scale-95 ${
                  isCapturing
                    ? 'bg-gradient-to-r from-[#FF4500] to-[#FF0000] text-white hover:shadow-lg hover:shadow-[rgba(255,69,0,0.4)]'
                    : 'bg-gradient-to-r from-[#00FF7F] to-[#00CED1] text-[#0A0A1A] hover:shadow-lg hover:shadow-[rgba(0,255,127,0.4)]'
                }`}
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  {isCapturing ? (
                    <path d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  ) : (
                    <path d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
                  )}
                </svg>
                <span>{isCapturing ? '停止监听' : '监听声音'}</span>
                {!isCapturing && (
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                )}
              </button>
              
              {showAudioSourceMenu && !isCapturing && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-[rgba(20,15,40,0.95)] backdrop-blur-md rounded-xl border border-[rgba(100,50,255,0.3)] shadow-xl py-2 min-w-[200px] z-50">
                  <button
                    onClick={() => handleCaptureAudio('system')}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[rgba(100,50,255,0.2)] transition-colors"
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#FFD700]" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
                    </svg>
                    <div>
                      <p className="text-sm text-white font-medium">系统声音</p>
                      <p className="text-xs text-white/50">监听电脑播放的音乐</p>
                    </div>
                  </button>
                  <button
                    onClick={() => handleCaptureAudio('microphone')}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[rgba(100,50,255,0.2)] transition-colors"
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#00FF7F]" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3zM19 10v2a7 7 0 01-14 0v-2M12 19c5.523 0 10-4.477 10-10S17.523 0 12 0 2 4.477 2 10s4.477 10 10 10z"/>
                    </svg>
                    <div>
                      <p className="text-sm text-white font-medium">麦克风</p>
                      <p className="text-xs text-white/50">监听说话的声音</p>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {(currentCaptureMode === 'local-file' || isCapturing) && (
              <button
                onClick={togglePlay}
                disabled={!isAudioLoaded}
                className={`flex items-center justify-center w-12 h-12 rounded-full transition-all duration-300 ${
                  isAudioLoaded
                    ? 'bg-gradient-to-r from-[#FFD700] to-[#FFA500] text-[#0A0A1A] hover:shadow-lg hover:shadow-[rgba(255,215,0,0.4)] hover:scale-110 active:scale-95'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                {isPlaying ? (
                  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="w-6 h-6 ml-0.5" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                )}
              </button>
            )}

            <button
              onClick={() => nextPreset()}
              className="flex items-center justify-center w-10 h-10 rounded-full bg-[rgba(100,50,255,0.3)] hover:bg-[rgba(100,50,255,0.5)] border border-[rgba(100,50,255,0.3)] transition-all duration-300 hover:scale-110 active:scale-95"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>

            <button
              onClick={() => prevPreset()}
              className="flex items-center justify-center w-10 h-10 rounded-full bg-[rgba(100,50,255,0.3)] hover:bg-[rgba(100,50,255,0.5)] border border-[rgba(100,50,255,0.3)] transition-all duration-300 hover:scale-110 active:scale-95"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>
          </div>

          {isAudioLoaded && (
            <div className="flex items-center justify-center gap-4 mb-3 flex-wrap">
              <label className="flex items-center gap-2 text-xs text-white/60">
                <input
                  type="checkbox"
                  checked={presetCycle}
                  onChange={(e) => setPresetCycle(e.target.checked)}
                  className="w-4 h-4 rounded bg-[rgba(100,50,255,0.3)] border-[rgba(100,50,255,0.5)] text-[#FFD700]"
                />
                <span>自动循环</span>
              </label>
              
              <label className="flex items-center gap-2 text-xs text-white/60">
                <input
                  type="checkbox"
                  checked={presetRandom}
                  onChange={(e) => setPresetRandom(e.target.checked)}
                  className="w-4 h-4 rounded bg-[rgba(100,50,255,0.3)] border-[rgba(100,50,255,0.5)] text-[#FFD700]"
                />
                <span>随机切换</span>
              </label>
              
              <div className="flex items-center gap-2 text-xs text-white/60">
                <span>间隔:</span>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={presetCycleLength}
                  onChange={(e) => setPresetCycleLength(parseInt(e.target.value) || 15)}
                  className="w-12 bg-[rgba(100,50,255,0.3)] border border-[rgba(100,50,255,0.5)] rounded px-2 py-1 text-white text-center"
                />
                <span>秒</span>
              </div>
              
              <button
                onClick={() => {
                  const container = document.getElementById('app-container')
                  if (container && !document.fullscreenElement) {
                    container.requestFullscreen()
                  } else if (document.fullscreenElement) {
                    document.exitFullscreen()
                  }
                }}
                className="flex items-center gap-2 text-xs text-white/60 hover:text-[#FFD700] transition-colors"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                <span>全屏 (F)</span>
              </button>
            </div>
          )}

          {currentCaptureMode === 'local-file' && isAudioLoaded && duration > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <span className="text-xs text-[#FFD700]/70 w-10">{formatTime(currentTime)}</span>
                <div className="flex-1 relative">
                  <input
                    type="range"
                    min="0"
                    max={duration}
                    step="0.1"
                    value={currentTime}
                    onChange={handleSeek}
                    className="w-full h-2 bg-[rgba(100,50,255,0.3)] rounded-full appearance-none cursor-pointer progress-slider"
                  />
                </div>
                <span className="text-xs text-[#FFD700]/70 w-10 text-right">{formatTime(duration)}</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mt-3">
            <div className="text-left">
              {audioName && (
                <p className="text-sm text-white/80 truncate max-w-[200px]">
                  {audioName}
                </p>
              )}
              <p className={`text-xs ${
                currentCaptureMode === 'local-file' ? 'text-[#FFD700]/70' : 
                currentCaptureMode === 'system-audio' || currentCaptureMode === 'microphone' ? 'text-[#00FF7F]/70' : 'text-gray-500'
              }`}>
                {getModeStatus()}
              </p>
            </div>
            
            <div className="flex items-center gap-4">
              {selectedPreset && (
                <p className="text-xs text-[#FF69B4]/70 truncate max-w-[200px]">
                  当前预设: {selectedPreset.split(',')[0]}
                </p>
              )}
            </div>
          </div>
        </div>
      </footer>

      {showPresets && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1A1030] rounded-2xl border border-[rgba(100,50,255,0.3)] w-full max-w-2xl max-h-[70vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-[rgba(100,50,255,0.2)] flex items-center justify-between">
              <h3 className="text-xl font-bold text-[#FFD700]">设置</h3>
              <button
                onClick={() => setShowPresets(false)}
                className="w-8 h-8 rounded-full bg-[rgba(255,69,0,0.2)] hover:bg-[rgba(255,69,0,0.4)] flex items-center justify-center transition-colors"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#FF4500]" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
            
            <div className="flex border-b border-[rgba(100,50,255,0.2)]">
              <button
                onClick={() => setActiveSettingsTab('presets')}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  activeSettingsTab === 'presets' ? 'text-[#FFD700] border-b-2 border-[#FFD700]' : 'text-white/50 hover:text-white/70'
                }`}
              >
                PRESETS
              </button>
              <button
                onClick={() => setActiveSettingsTab('more')}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  activeSettingsTab === 'more' ? 'text-[#FFD700] border-b-2 border-[#FFD700]' : 'text-white/50 hover:text-white/70'
                }`}
              >
                MORE
              </button>
              <button
                onClick={() => setActiveSettingsTab('rendering')}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  activeSettingsTab === 'rendering' ? 'text-[#FFD700] border-b-2 border-[#FFD700]' : 'text-white/50 hover:text-white/70'
                }`}
              >
                RENDERING
              </button>
            </div>
            
            <div className="p-4 overflow-y-auto max-h-[calc(70vh-140px)]">
              {activeSettingsTab === 'presets' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-white/70 mb-2">选择预设</label>
                    <select
                      value={selectedPreset || ''}
                      onChange={(e) => loadPresetByName(e.target.value)}
                      className="w-full bg-[rgba(100,50,255,0.2)] border border-[rgba(100,50,255,0.3)] rounded-lg px-4 py-2 text-white text-sm appearance-none cursor-pointer hover:border-[rgba(100,50,255,0.5)] focus:outline-none focus:border-[#FFD700]"
                    >
                      <option value="" disabled>Select a preset</option>
                      {presetNames.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm text-white/70">
                      <input
                        type="checkbox"
                        checked={presetCycle}
                        onChange={(e) => setPresetCycle(e.target.checked)}
                        className="w-4 h-4 rounded bg-[rgba(100,50,255,0.3)] border-[rgba(100,50,255,0.5)] text-[#FFD700]"
                      />
                      <span>Cycle presets every</span>
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={presetCycleLength}
                      onChange={(e) => setPresetCycleLength(parseInt(e.target.value) || 15)}
                      className="w-16 bg-[rgba(100,50,255,0.2)] border border-[rgba(100,50,255,0.3)] rounded-lg px-3 py-1.5 text-white text-sm text-center"
                    />
                    <span className="text-sm text-white/50">seconds</span>
                  </div>
                  
                  <label className="flex items-center gap-2 text-sm text-white/70">
                    <input
                      type="checkbox"
                      checked={presetRandom}
                      onChange={(e) => setPresetRandom(e.target.checked)}
                      className="w-4 h-4 rounded bg-[rgba(100,50,255,0.3)] border-[rgba(100,50,255,0.5)] text-[#FFD700]"
                    />
                    <span>Randomize next preset</span>
                  </label>
                </div>
              )}
              
              {activeSettingsTab === 'more' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-white/70 mb-2">Auto preset blend for</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        max="10"
                        step="0.1"
                        value={autoBlendTime}
                        onChange={(e) => setAutoBlendTime(parseFloat(e.target.value) || 2.7)}
                        className="w-20 bg-[rgba(100,50,255,0.2)] border border-[rgba(100,50,255,0.3)] rounded-lg px-3 py-1.5 text-white text-sm text-center"
                      />
                      <span className="text-sm text-white/50">seconds</span>
                    </div>
                    <p className="text-xs text-white/40 mt-1">自动切换预设时的过渡时间</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm text-white/70 mb-2">User solicited preset blend for</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        max="10"
                        step="0.1"
                        value={userBlendTime}
                        onChange={(e) => setUserBlendTime(parseFloat(e.target.value) || 5.7)}
                        className="w-20 bg-[rgba(100,50,255,0.2)] border border-[rgba(100,50,255,0.3)] rounded-lg px-3 py-1.5 text-white text-sm text-center"
                      />
                      <span className="text-sm text-white/50">seconds</span>
                    </div>
                    <p className="text-xs text-white/40 mt-1">手动切换预设时的过渡时间</p>
                  </div>
                  
                  <div className="border-t border-[rgba(100,50,255,0.2)] pt-4">
                    <p className="text-sm text-[#FFD700] mb-3">功能模块</p>
                    <label className="flex items-center gap-3 mb-3">
                      <input
                        type="checkbox"
                        checked={showMetronome}
                        onChange={(e) => setShowMetronome(e.target.checked)}
                        className="w-5 h-5 rounded bg-[rgba(100,50,255,0.3)] border-[rgba(100,50,255,0.5)] text-[#FFD700]"
                      />
                      <div>
                        <p className="text-sm text-white/80">音乐节拍器</p>
                        <p className="text-xs text-white/40">实时显示BPM和节拍动画</p>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 mb-3">
                      <input
                        type="checkbox"
                        checked={showSpectrum}
                        onChange={(e) => setShowSpectrum(e.target.checked)}
                        className="w-5 h-5 rounded bg-[rgba(100,50,255,0.3)] border-[rgba(100,50,255,0.5)] text-[#FFD700]"
                      />
                      <div>
                        <p className="text-sm text-white/80">频谱分析器</p>
                        <p className="text-xs text-white/40">底部实时音频频谱柱状图</p>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 mb-3">
                      <input
                        type="checkbox"
                        checked={showFluid}
                        onChange={(e) => setShowFluid(e.target.checked)}
                        className="w-5 h-5 rounded bg-[rgba(100,50,255,0.3)] border-[rgba(100,50,255,0.5)] text-[#FFD700]"
                      />
                      <div>
                        <p className="text-sm text-white/80">流体模拟</p>
                        <p className="text-xs text-white/40">WebGL流体动态背景，受音乐驱动</p>
                      </div>
                    </label>
                    </div>
                </div>
              )}
              
              {activeSettingsTab === 'rendering' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-white/70 mb-2">Frame Limit</label>
                    <select
                      value={frameLimit}
                      onChange={(e) => setFrameLimit(parseInt(e.target.value))}
                      className="w-full bg-[rgba(100,50,255,0.2)] border border-[rgba(100,50,255,0.3)] rounded-lg px-4 py-2 text-white text-sm appearance-none cursor-pointer hover:border-[rgba(100,50,255,0.5)] focus:outline-none focus:border-[#FFD700]"
                    >
                      <option value={30}>30 FPS</option>
                      <option value={45}>45 FPS</option>
                      <option value={60}>60 FPS</option>
                      <option value={90}>90 FPS</option>
                      <option value={120}>120 FPS</option>
                    </select>
                    <p className="text-xs text-white/40 mt-1">限制帧率，降低功耗</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm text-white/70 mb-2">Canvas Size</label>
                    <select
                      value={canvasSize}
                      onChange={(e) => setCanvasSize(e.target.value)}
                      className="w-full bg-[rgba(100,50,255,0.2)] border border-[rgba(100,50,255,0.3)] rounded-lg px-4 py-2 text-white text-sm appearance-none cursor-pointer hover:border-[rgba(100,50,255,0.5)] focus:outline-none focus:border-[#FFD700]"
                    >
                      <option value="1X">1X Native</option>
                      <option value="2X">2X Native</option>
                      <option value="4X">4X Native</option>
                      <option value="8X">8X Native</option>
                    </select>
                    <p className="text-xs text-white/40 mt-1">画布渲染尺寸，越大画质越好但更耗性能</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm text-white/70 mb-2">Mesh Size</label>
                    <select
                      value={meshSize}
                      onChange={(e) => setMeshSize(e.target.value)}
                      className="w-full bg-[rgba(100,50,255,0.2)] border border-[rgba(100,50,255,0.3)] rounded-lg px-4 py-2 text-white text-sm appearance-none cursor-pointer hover:border-[rgba(100,50,255,0.5)] focus:outline-none focus:border-[#FFD700]"
                    >
                      <option value="24x18">24 x 18</option>
                      <option value="32x24">32 x 24</option>
                      <option value="48x36">48 x 36</option>
                      <option value="64x48">64 x 48</option>
                      <option value="96x72">96 x 72</option>
                    </select>
                    <p className="text-xs text-white/40 mt-1">渲染网格精细程度，越高画面越细腻</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 transition-all duration-500 ${
        showToast ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'
      }`}>
        <div className="bg-[rgba(20,15,40,0.9)] backdrop-blur-lg text-white px-6 py-3 rounded-full shadow-2xl border border-[rgba(255,215,0,0.3)]">
          <p className="text-sm font-medium flex items-center gap-2">
            <span className="text-[#FFD700]">✨</span>
            <span>{toastMessage}</span>
          </p>
        </div>
      </div>

      <style>{`
        .progress-slider::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: linear-gradient(135deg, #FFD700, #FFA500);
          cursor: pointer;
          box-shadow: 0 0 12px rgba(255, 215, 0, 0.6);
          transition: all 0.2s;
        }
        .progress-slider::-webkit-slider-thumb:hover {
          transform: scale(1.3);
          box-shadow: 0 0 20px rgba(255, 215, 0, 0.8);
        }
        .progress-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: linear-gradient(135deg, #FFD700, #FFA500);
          cursor: pointer;
          box-shadow: 0 0 12px rgba(255, 215, 0, 0.6);
          border: none;
        }
      `}</style>
    </div>
  )
}