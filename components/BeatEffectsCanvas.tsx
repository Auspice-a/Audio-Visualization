'use client'

import { useEffect, useRef, useCallback } from 'react'

interface Ripple {
  id: number
  time: number
  x: number
  y: number
  color: string
}

interface Particle {
  id: number
  time: number
  x: number
  y: number
  vx: number
  vy: number
  color: string
  size: number
}

interface BeatEffectsCanvasProps {
  show: boolean
  isAudioLoaded: boolean
  analyserRef: React.MutableRefObject<AnalyserNode | null>
  onBeat?: () => void
  onBpmChange?: (bpm: number) => void
  onFrequencyData?: (data: Uint8Array) => void
}

export default function BeatEffectsCanvas({ show, isAudioLoaded, analyserRef, onBeat, onBpmChange, onFrequencyData }: BeatEffectsCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>(0)
  
  const ripplesRef = useRef<Ripple[]>([])
  const particlesRef = useRef<Particle[]>([])
  const rippleIdRef = useRef(0)
  const particleIdRef = useRef(0)
  
  const lastBeatTimeRef = useRef(0)
  const energyHistoryRef = useRef<number[]>([])
  
  const MAX_RIPPLES = 8
  const MAX_PARTICLES = 25
  const RIPPLE_DURATION = 2000
  const PARTICLE_DURATION = 1000
  
  const colors = ['#FFD700', '#FF69B4', '#00FF7F', '#00CED1', '#FFA500', '#9400D3']
  
  const createRipple = useCallback((x: number, y: number) => {
    const ripple: Ripple = {
      id: rippleIdRef.current++,
      time: Date.now(),
      x,
      y,
      color: colors[Math.floor(Math.random() * colors.length)]
    }
    ripplesRef.current.push(ripple)
    if (ripplesRef.current.length > MAX_RIPPLES) {
      ripplesRef.current.shift()
    }
  }, [])
  
  const createParticles = useCallback((centerX: number, centerY: number, count: number) => {
    const newParticles: Particle[] = []
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4
      const speed = 3 + Math.random() * 4
      newParticles.push({
        id: particleIdRef.current++,
        time: Date.now(),
        x: centerX,
        y: centerY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 3 + Math.random() * 4
      })
    }
    particlesRef.current.push(...newParticles)
    if (particlesRef.current.length > MAX_PARTICLES) {
      particlesRef.current = particlesRef.current.slice(-MAX_PARTICLES)
    }
  }, [])
  
  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    const now = Date.now()
    
    ripplesRef.current = ripplesRef.current.filter(ripple => now - ripple.time < RIPPLE_DURATION)
    
    for (const ripple of ripplesRef.current) {
      const elapsed = now - ripple.time
      const progress = Math.min(elapsed / RIPPLE_DURATION, 1)
      const size = 30 + progress * 300
      const opacity = 1 - progress
      
      ctx.beginPath()
      ctx.arc(ripple.x, ripple.y, size, 0, Math.PI * 2)
      ctx.strokeStyle = `${ripple.color}${Math.floor(opacity * 255).toString(16).padStart(2, '0')}`
      ctx.lineWidth = 2
      ctx.stroke()
      
      ctx.beginPath()
      ctx.arc(ripple.x, ripple.y, size * 0.8, 0, Math.PI * 2)
      ctx.strokeStyle = `${ripple.color}${Math.floor(opacity * 150).toString(16).padStart(2, '0')}`
      ctx.lineWidth = 1
      ctx.stroke()
      
      ctx.beginPath()
      ctx.arc(ripple.x, ripple.y, size * 0.6, 0, Math.PI * 2)
      ctx.strokeStyle = `${ripple.color}${Math.floor(opacity * 80).toString(16).padStart(2, '0')}`
      ctx.lineWidth = 1
      ctx.stroke()
    }
    
    particlesRef.current = particlesRef.current.filter(p => now - p.time < PARTICLE_DURATION)
    
    for (const particle of particlesRef.current) {
      const elapsed = now - particle.time
      const progress = Math.min(elapsed / PARTICLE_DURATION, 1)
      const x = particle.x + particle.vx * elapsed * 0.05
      const y = particle.y + particle.vy * elapsed * 0.05
      const opacity = 1 - progress
      const size = particle.size * (1 - progress * 0.5)
      
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fillStyle = `${particle.color}${Math.floor(opacity * 255).toString(16).padStart(2, '0')}`
      ctx.shadowColor = particle.color
      ctx.shadowBlur = 10
      ctx.fill()
      ctx.shadowBlur = 0
    }
    
    animationRef.current = requestAnimationFrame(render)
  }, [])
  
  useEffect(() => {
    if (!show || !isAudioLoaded) return
    
    const canvas = canvasRef.current
    if (!canvas) return
    
    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    
    render()
    
    return () => {
      window.removeEventListener('resize', resizeCanvas)
      cancelAnimationFrame(animationRef.current)
    }
  }, [show, isAudioLoaded, render])
  
  useEffect(() => {
    if (!show || !isAudioLoaded || !analyserRef.current) return
    
    const freqData = new Uint8Array(analyserRef.current.frequencyBinCount)
    const beatThreshold = 0.4
    const minBeatInterval = 300
    
    let animationId: number
    
    const detectBeat = () => {
      if (!analyserRef.current) {
        animationId = requestAnimationFrame(detectBeat)
        return
      }
      
      analyserRef.current.getByteFrequencyData(freqData)
      onFrequencyData?.(new Uint8Array(freqData))
      
      let energy = 0
      for (let i = 0; i < freqData.length; i++) {
        energy += freqData[i]
      }
      energy /= freqData.length
      
      energyHistoryRef.current.push(energy)
      if (energyHistoryRef.current.length > 60) {
        energyHistoryRef.current.shift()
      }
      
      const avgEnergy = energyHistoryRef.current.reduce((a, b) => a + b, 0) / energyHistoryRef.current.length
      const variance = energyHistoryRef.current.reduce((sum, val) => sum + Math.pow(val - avgEnergy, 2), 0) / energyHistoryRef.current.length
      const stdDev = Math.sqrt(variance)
      
      const threshold = avgEnergy + stdDev * beatThreshold
      const now = Date.now()
      
      if (energy > threshold && (now - lastBeatTimeRef.current) > minBeatInterval) {
        lastBeatTimeRef.current = now
        onBeat?.()
        
        const rippleCount = Math.min(3 + Math.floor(energy / 80), MAX_RIPPLES - ripplesRef.current.length)
        for (let i = 0; i < rippleCount; i++) {
          const x = Math.random() * window.innerWidth
          const y = Math.random() * window.innerHeight
          createRipple(x, y)
        }
        
        const particleCount = Math.min(4 + Math.floor(energy / 60), MAX_PARTICLES - particlesRef.current.length)
        const centerX = Math.random() * window.innerWidth
        const centerY = Math.random() * window.innerHeight
        createParticles(centerX, centerY, particleCount)
      }
      
      if (energyHistoryRef.current.length > 30 && onBpmChange) {
        const beatIntervals: number[] = []
        for (let i = 1; i < energyHistoryRef.current.length; i++) {
          if (energyHistoryRef.current[i] > avgEnergy + stdDev * 0.5 && 
              energyHistoryRef.current[i-1] <= avgEnergy + stdDev * 0.5) {
            beatIntervals.push(i * (1000 / 60))
          }
        }
        
        if (beatIntervals.length >= 4) {
          const avgInterval = beatIntervals.reduce((a, b) => a + b, 0) / beatIntervals.length
          const calculatedBpm = Math.round(60000 / avgInterval)
          if (calculatedBpm > 60 && calculatedBpm < 200) {
            onBpmChange(calculatedBpm)
          }
        }
      }
      
      animationId = requestAnimationFrame(detectBeat)
    }
    
    detectBeat()
    
    return () => {
      cancelAnimationFrame(animationId)
    }
  }, [show, isAudioLoaded, analyserRef, onBeat, onBpmChange, onFrequencyData, createRipple, createParticles])
  
  if (!show) return null
  
  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-20"
    />
  )
}